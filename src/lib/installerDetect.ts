/**
 * Client-side Windows-installer identifier.
 *
 * Runs ENTIRELY in the browser: the page reads the chosen file into an ArrayBuffer and
 * hands the raw bytes here — nothing is ever uploaded. Given those bytes, this sniffs the
 * installer ENGINE by signature (MSI / Inno / NSIS / WiX Burn / InstallShield / SFX) and
 * returns the canonical command set for that engine.
 *
 * Static identification only — it NEVER executes the installer. For the deterministic
 * engines (MSI / Inno / WiX Burn) the switches are the engine's documented flags and are
 * effectively always correct — and they're engine built-ins, so we can hand back the FULL
 * operation matrix (install / repair / uninstall / layout), not just the silent-install pair.
 * For NSIS / InstallShield / SFX it's best-effort with caveats, because those leave silent
 * support partly up to the author. Unknown/packed EXEs fall through to a "here's how to find
 * it manually" result.
 */
import { analyzeMsi, type MsiAnalysis } from './msi';

export type InstallerEngine =
  | 'msi'
  | 'inno'
  | 'nsis'
  | 'wix-burn'
  | 'installshield'
  | 'advanced-installer'
  | 'installaware'
  | 'installbuilder'
  | 'wise'
  | 'msix'
  | 'squirrel'
  | 'dotnet'
  | 'sfx-7z'
  | 'sfx-winrar'
  | 'unknown-exe'
  | 'not-installer';

/** One operation (install / repair / uninstall / extract) and its command line. */
export interface InstallerCommand {
  /** Short operation label, e.g. "Install (silent)", "Repair", "Uninstall". */
  label: string;
  /** The command line for that operation. */
  cmd: string;
}

export interface DetectionResult {
  engine: InstallerEngine;
  /** Human-friendly engine name for the heading. */
  label: string;
  /**
   * Ordered operation matrix for this engine, in admin-logical order
   * (install → repair → uninstall → extract/layout). For deterministic engines these are
   * engine built-ins so the full set is shown; for the fuzzier engines it may be just install
   * (+ uninstall). Empty when nothing can be determined statically (packed/custom EXE).
   */
  commands: InstallerCommand[];
  /** Modifier flags that apply across the operations above (UI level, restart, logging, target). */
  modifiers?: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** Caveats / how-to notes rendered under the result. */
  notes?: string;
  /** Best-effort metadata pulled from the PE version resource (may be undefined). */
  product?: string;
  version?: string;
  company?: string;
  fileName?: string;
  /** Authoring-tool version read from the binary, e.g. "Advanced Installer 21.8.2". */
  engineVersion?: string;
  /** Custom public property NAMES harvested from the binary (Advanced Installer) — names only. */
  customProperties?: string[];
  /** Deep MSI analysis (property matrix + uninstall-replay), present only for MSI packages. */
  msi?: MsiAnalysis;
}

// ── byte helpers ─────────────────────────────────────────────────────────────
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** Naive byte search with a first-byte fast-skip. Returns the index or -1. */
function indexOfBytes(hay: Uint8Array, needle: number[], from = 0): number {
  if (needle.length === 0) return -1;
  const first = needle[0];
  const last = hay.length - needle.length;
  for (let i = from; i <= last; i++) {
    if (hay[i] !== first) continue;
    let ok = true;
    for (let j = 1; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

const has = (hay: Uint8Array, sig: number[]): boolean => indexOfBytes(hay, sig) !== -1;

function startsWith(hay: Uint8Array, sig: number[]): boolean {
  if (hay.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (hay[i] !== sig[i]) return false;
  return true;
}

/** UTF-16LE byte pattern for an ASCII string — used to find version-info keys. */
function utf16(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) { out.push(s.charCodeAt(i) & 0xff, 0x00); }
  return out;
}

/**
 * Best-effort VS_VERSIONINFO String reader: locate a UTF-16LE key (ProductName /
 * ProductVersion / CompanyName), skip its terminator + 4-byte padding, and read the
 * UTF-16LE value until NUL. Heuristic (not a full PE resource-tree walk) but reliable
 * enough for a display hint; returns undefined on anything unexpected.
 */
function readVersionString(bytes: Uint8Array, key: string): string | undefined {
  let pos = indexOfBytes(bytes, utf16(key));
  if (pos < 0) return undefined;
  pos += utf16(key).length;
  if (bytes[pos] === 0x00 && bytes[pos + 1] === 0x00) pos += 2; // key's NUL terminator
  while (pos % 4 !== 0) pos++;                                   // VS_VERSIONINFO 4-byte align
  const chars: number[] = [];
  for (let i = pos; i < bytes.length - 1 && chars.length < 256; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (code === 0) break;
    chars.push(code);
  }
  const val = String.fromCharCode(...chars).trim();
  return val.length ? val : undefined;
}

/**
 * Locate the VS_VERSIONINFO blob via a real PE resource-tree walk (DOS → PE → sections → .rsrc →
 * RT_VERSION → first id → first language → data leaf). Scoping the key-search to this small blob is
 * what makes the metadata reliable: a bare whole-file scan for "ProductName" can lock onto a match
 * inside a 100+ MB compressed payload and decode garbage. Returns null on any malformed/oversized PE.
 */
function findVersionResource(b: Uint8Array): Uint8Array | null {
  if (b.length < 0x40 || b[0] !== 0x4d || b[1] !== 0x5a) return null; // MZ
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const peOff = dv.getUint32(0x3c, true);
  if (peOff + 24 > b.length || dv.getUint32(peOff, true) !== 0x00004550) return null; // 'PE\0\0'
  const numSections = dv.getUint16(peOff + 6, true);
  const optSize = dv.getUint16(peOff + 20, true);
  const secStart = peOff + 24 + optSize;

  let rsrcVA = 0, rsrcPtr = 0;
  for (let i = 0; i < numSections; i++) {
    const so = secStart + i * 40;
    if (so + 40 > b.length) break;
    let name = '';
    for (let k = 0; k < 8 && b[so + k]; k++) name += String.fromCharCode(b[so + k]);
    if (name === '.rsrc') { rsrcVA = dv.getUint32(so + 12, true); rsrcPtr = dv.getUint32(so + 20, true); break; }
  }
  if (!rsrcPtr) return null;

  // Resource-directory entry lookup: offsets are relative to the start of the .rsrc section.
  const entry = (dirOff: number, matchId: number | null): { off: number; isDir: boolean } | null => {
    if (dirOff + 16 > b.length) return null;
    const n = dv.getUint16(dirOff + 12, true) + dv.getUint16(dirOff + 14, true);
    for (let i = 0; i < n; i++) {
      const eo = dirOff + 16 + i * 8;
      if (eo + 8 > b.length) break;
      const nameField = dv.getUint32(eo, true);
      const offField = dv.getUint32(eo + 4, true);
      const id = (nameField & 0x80000000) ? -1 : nameField >>> 0;
      if (matchId === null || id === matchId) {
        return { off: rsrcPtr + (offField & 0x7fffffff), isDir: (offField & 0x80000000) !== 0 };
      }
    }
    return null;
  };

  const lvl1 = entry(rsrcPtr, 16);          // RT_VERSION
  if (!lvl1?.isDir) return null;
  const lvl2 = entry(lvl1.off, null);       // first version resource id
  if (!lvl2?.isDir) return null;
  const lvl3 = entry(lvl2.off, null);       // first language → data leaf
  if (!lvl3 || lvl3.isDir || lvl3.off + 16 > b.length) return null;

  const dataOff = rsrcPtr + (dv.getUint32(lvl3.off, true) - rsrcVA); // RVA → file offset within .rsrc
  const dataSize = dv.getUint32(lvl3.off + 4, true);
  if (dataSize <= 0 || dataSize > (1 << 20) || dataOff < 0 || dataOff + dataSize > b.length) return null;
  return b.subarray(dataOff, dataOff + dataSize);
}

// ── signatures ───────────────────────────────────────────────────────────────
const SIG = {
  cfb:           [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // OLE compound (MSI/MSP/MST)
  mz:            [0x4d, 0x5a],                                     // PE / EXE
  sevenZip:      [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],             // 7z archive
  rar:           ascii('Rar!'),                                   // WinRAR archive
  nsis:          ascii('NullsoftInst'),                           // NSIS first-header
  inno:          ascii('Inno Setup'),
  innoData:      ascii('Inno Setup Setup Data'),
  wixBurn:       ascii('.wixburn'),                               // PE section name
  installShield: ascii('InstallShield'),
  advInstaller:  ascii('Advanced Installer'),                     // Advanced Installer bootstrapper marker
  installAware:  ascii('InstallAware'),
  installBuilder: ascii('InstallBuilder'),                        // BitRock / VMware InstallBuilder
  wise:          ascii('WiseMain'),                               // Wise Installation System stub
  zip:           [0x50, 0x4b, 0x03, 0x04],                        // ZIP local header (MSIX/AppX containers)
  appxManifest:  ascii('AppxManifest.xml'),
  appxBundle:    ascii('AppxBundleManifest.xml'),
  squirrel:      ascii('Squirrel'),                               // Squirrel.Windows
  corExeMain:    ascii('_CorExeMain'),                            // .NET PE entry stub
  sfxConfig:     ascii(';!@Install@!UTF-8!'),                     // 7z SFX RunProgram config
};

// Advanced Installer bootstrapper command-line switches (per their EXE-setup docs), in display
// order. The reader below reports which of these THIS specific build actually contains.
const AI_SWITCHES: Array<{ flag: string; label: string }> = [
  { flag: '/exenoui',       label: '/exenoui (no UI)' },
  { flag: '/exebasicui',    label: '/exebasicui (progress only)' },
  { flag: '/exefullui',     label: '/exefullui (full UI)' },
  { flag: '/exelog',        label: '/exelog "path" (bootstrapper log)' },
  { flag: '/exelang',       label: '/exelang <LCID>' },
  { flag: '/exenoupdates',  label: '/exenoupdates (skip update check)' },
  { flag: '/noprereqs',     label: '/noprereqs (skip prerequisites)' },
  { flag: '/prereqs',       label: '/prereqs <list>' },
  { flag: '/extract',       label: '/extract "dir" (unpack the MSI)' },
  { flag: '/listlangs',     label: '/listlangs' },
  { flag: '/aespassword',   label: '/aespassword <pwd>' },
  { flag: '/newinst',       label: '/newinst (new instance)' },
  { flag: '/upgrdinst',     label: '/upgrdinst <code>' },
  { flag: '/selinst',       label: '/selinst <code>' },
  { flag: '/proxyusername', label: '/proxyusername <user>' },
  { flag: '/proxypassword', label: '/proxypassword <pwd>' },
];

// MSI / Advanced-Installer internal properties to exclude when harvesting custom switch names.
const AI_PROP_DENY = new Set([
  'ALL', 'ALLUSERS', 'INSTALLLEVEL', 'INSTALLDIR', 'INSTALLLOCATION', 'APPDIR', 'SHORTCUTDIR',
  'RUNAPPLICATION', 'VIEWREADME', 'PROMPTROLLBACKCOST', 'OLDPRODUCTS', 'SETUPEXEDIR', 'SOURCEDIR',
  'REINSTALL', 'REINSTALLMODE', 'REMOVE', 'REBOOT', 'ROOTDRIVE', 'TARGETDIR', 'COMBOBOX_1_PROP',
  'NEWPRODUCTFOUND', 'NEWERVERSIONDETECTED', 'OLDERVERSIONBEENINSTALLED', 'UPGRADEABLE',
  // generic log/UI/mode tokens that look property-shaped but aren't install switches
  'ERR', 'INFO', 'WARN', 'ERROR', 'DEBUG', 'TRACE', 'NONE', 'NULL', 'TRUE', 'FALSE',
  'YES', 'NO', 'OK', 'CANCEL', 'ABORT', 'RETRY', 'IGNORE', 'TYPICAL', 'COMPLETE', 'CUSTOM',
]);
// A harvested token is a plausible custom public property: ALL-CAPS, not an AI/MSI/ARP internal.
function isCustomProp(n: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test(n)
    && !/^(AI_|PERSISTENT_|ORIG_|ARP|WIX_|MSI|SET_|CTRL)/.test(n)
    && !AI_PROP_DENY.has(n);
}

/**
 * Read the EXACT Advanced Installer build from the binary's strings: its version, which bootstrapper
 * switches it exposes, AND the custom public-property NAMES (the package's real install switches).
 * Even though the MSI itself is compressed, the property names leak into the bootstrapper's string
 * data as MSI Formatted refs `[PROP]` (clean `[ ]` delimiters) and AI's `<PROP>_Set`/`_SetDefault`
 * custom-action names. We harvest both (ASCII + UTF-16LE), filter AI/MSI internals, and dedupe.
 * Bounded to the front of the file — PE code/resources live there; the appended payload doesn't.
 */
function readAdvancedInstaller(bytes: Uint8Array): { version?: string; switches: string[]; customProperties: string[] } {
  const cap = Math.min(bytes.length, 48 << 20);
  let narrow = '', wide = '';
  try { narrow = new TextDecoder('windows-1252').decode(bytes.subarray(0, cap)); } catch { /* ignore */ }
  try { wide = new TextDecoder('utf-16le').decode(bytes.subarray(0, cap)); } catch { /* ignore */ }

  const version = narrow.match(/Advanced Installer\s+([\d][\d.]*)/)?.[1];
  const switches = AI_SWITCHES.filter((s) => wide.includes(s.flag) || narrow.includes(s.flag)).map((s) => s.flag);

  const props = new Set<string>();
  const harvest = (text: string): void => {
    for (const m of text.matchAll(/\[([A-Z][A-Z0-9_]{2,})\]/g)) if (isCustomProp(m[1])) props.add(m[1]);      // [PROP] Formatted refs
    for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{2,}?)_Set(?:Default)?(?:_\d+)?\b/g)) if (isCustomProp(m[1])) props.add(m[1]); // AI _Set/_SetDefault CAs
  };
  harvest(wide);
  harvest(narrow);

  return { version, switches, customProperties: [...props].sort() };
}

// ── best-effort switch harvest (opt-in, for custom/unrecognized installers) ──
// Known silent-install flag tokens to look for verbatim (boundary-checked, so binary garbage
// doesn't produce false hits). Longer, distinctive tokens only — no bare /s /q.
const BEST_FLAGS = [
  'silent', 'verysilent', 'quiet', 'unattended', 'passive', 'norestart', 'noreboot',
  '/silent', '/verysilent', '/quiet', '/qn', '/qb', '/passive', '/norestart', '/exenoui',
  '--silent', '--quiet', '--unattended', '/SUPPRESSMSGBOXES', '/SP-',
];
// An identifier is a plausible install OPTION if it contains one of these strong config keywords.
const OPT_KW = /(server|port|hostname|host|username|password|silent|unattended|uninstall|install|datadir|directory|path|url|ipaddress|address|account|mode|token|secret|license|proxy|timeout|reboot|norestart|quiet|registry|subkey|service|config|sync|certificate|database|endpoint|apikey|apiurl)/i;

/**
 * Best-effort, NOISY harvest of candidate switches from ANY binary — for the custom/unrecognized
 * long tail where there's no structural marker. Pulls known flag tokens + identifiers that look like
 * config options (+ the MSI [PROP]/`_Set` signals). Expect false positives; this is an opt-in "try
 * anyway", not the authoritative read. Names only.
 */
export function bestEffortSwitches(buf: ArrayBuffer): { flags: string[]; options: string[] } {
  const bytes = new Uint8Array(buf);
  const reg = bytes.subarray(0, Math.min(bytes.length, 96 << 20));
  let a = '', w = '';
  try { a = new TextDecoder('windows-1252').decode(reg); } catch { /* ignore */ }
  try { w = new TextDecoder('utf-16le').decode(reg); } catch { /* ignore */ }
  const text = `${a}\n${w}`;

  const flags = new Set<string>();
  for (const tok of BEST_FLAGS) {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lead = tok[0] === '/' || tok[0] === '-' ? '(?<![\\w/-])' : '(?<![\\w])';
    try { if (new RegExp(lead + esc + '(?![\\w])', 'i').test(text)) flags.add(tok); } catch { /* ignore */ }
  }

  // Harvest option candidates from the UTF-16 (#US) literals only — that's where the app's own
  // strings (CLI args, UI labels) live; the BCL type / P-Invoke names sit in the ASCII metadata
  // heap, so wide-only cuts most framework noise. Then drop verb-prefixed method names.
  const VERB = /^(Get|Set|On|Create|Enumerate|Adjust|Bind|Bound|Detect|Handle|Execute|Apply|Is|Has|Should|Can|Validate|Render|Update|Initialize|Convert|Format|Parse|Load|Save|Read|Write|Add|Remove|Open|Close|Show|Hide|Enable|Disable|Allowed|Denied)/;
  // A real option name is COMPOUND: underscore'd (SERVER_ADDRESS) or multi-word PascalCase
  // (KeystoneServerIpAddress, HostFile) — this drops generic single-word fragments (Server, port,
  // install) and all-lowercase duplicates, which are the bulk of the noise.
  const compound = (id: string): boolean =>
    id.includes('_') || ((id.match(/[A-Z]/g) ?? []).length >= 2 && id !== id.toUpperCase());
  const options = new Set<string>();
  let scanned = 0;
  for (const m of w.matchAll(/[A-Za-z][A-Za-z0-9_]{3,40}/g)) {
    if (++scanned > 4_000_000) break; // safety bound
    const id = m[0];
    if (OPT_KW.test(id) && compound(id) && !VERB.test(id) && !/(Exception|Attribute|Services|Failure|NotFound|ViewModel|Element|Status|Percent|Handle)$/.test(id)) options.add(id);
  }
  for (const m of text.matchAll(/\[([A-Z][A-Z0-9_]{2,})\]/g)) if (isCustomProp(m[1])) options.add(m[1]);          // MSI [PROP] refs
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{2,}?)_Set(?:Default)?(?:_\d+)?\b/g)) if (isCustomProp(m[1])) options.add(m[1]); // AI _Set CAs

  return { flags: [...flags].sort(), options: [...options].sort().slice(0, 120) };
}

/**
 * Identify the installer engine and return its command matrix.
 *
 * Order matters: the distinctive engine markers (MSI header, .wixburn section, Inno/NSIS/
 * InstallShield loader strings) are checked BEFORE the generic 7z/RAR archive signatures,
 * which are short and can appear coincidentally inside compressed payloads. So an Inno/NSIS
 * installer that happens to embed a 7z blob is still reported as Inno/NSIS.
 */
export function detectInstaller(buf: ArrayBuffer, fileName?: string): DetectionResult {
  const bytes = new Uint8Array(buf);
  const exe = fileName ?? 'setup.exe';
  const msi = fileName ?? 'package.msi';

  // 1) MSI / OLE compound document
  if (startsWith(bytes, SIG.cfb)) {
    // Deep-parse the MSI database (property matrix + uninstall-replay). Never throws out — a
    // parse failure just falls back to the generic file-path commands below.
    let analysis: MsiAnalysis | null = null;
    try { analysis = analyzeMsi(buf); } catch { analysis = null; }
    const code = analysis?.productCode;
    // Prefer the real ProductCode GUID for repair/uninstall — it works regardless of the .msi's path.
    const byCode = (op: string) => (code ? `msiexec ${op} ${code} /qn /norestart` : `msiexec ${op} "${msi}" /qn /norestart`);

    return {
      engine: 'msi',
      label: 'Windows Installer (MSI)',
      commands: [
        { label: 'Install (silent)',        cmd: `msiexec /i "${msi}" /qn /norestart` },
        { label: 'Repair (silent)',         cmd: byCode('/f') },
        { label: 'Uninstall (silent)',      cmd: byCode('/x') },
        { label: 'Admin install (extract)', cmd: `msiexec /a "${msi}" TARGETDIR="C:\\Path" /qn` },
      ],
      modifiers:
        '/qn (no UI) · /qb (basic UI) · /norestart · /l*v "C:\\out.log" (verbose log) · ' +
        'PROP=VALUE public properties (e.g. INSTALLDIR="C:\\Apps")',
      confidence: 'high',
      notes:
        'MSI silent install is ALWAYS /qn — no guessing. /a is an administrative install (unpacks the ' +
        'payload to a network point — the MSI equivalent of a layout). Repair flags can be tuned ' +
        '(/fa reinstalls all files, /fvomus forces a full repair). (.msp patches install with /p; ' +
        '.mst transforms apply via TRANSFORMS=.)',
      // Property-table metadata is authoritative for an MSI; the PE version-resource heuristic
      // doesn't apply to OLE files, so analysis is the primary source here.
      product: analysis?.productName ?? readVersionString(bytes, 'ProductName'),
      version: analysis?.productVersion ?? readVersionString(bytes, 'ProductVersion'),
      company: analysis?.manufacturer ?? readVersionString(bytes, 'CompanyName'),
      fileName,
      msi: analysis ?? undefined,
    };
  }

  // MSIX / AppX — a ZIP package (not a PE); installs via PowerShell/DISM, not msiexec.
  if (startsWith(bytes, SIG.zip) && (has(bytes, SIG.appxManifest) || has(bytes, SIG.appxBundle))) {
    const pkg = fileName ?? 'app.msix';
    return {
      engine: 'msix',
      label: 'MSIX / AppX package',
      commands: [
        { label: 'Install (current user)',        cmd: `Add-AppxPackage -Path "${pkg}"` },
        { label: 'Provision (all users / image)', cmd: `Add-AppxProvisionedPackage -Online -PackagePath "${pkg}" -SkipLicense` },
        { label: 'Uninstall',                     cmd: 'Get-AppxPackage *<Name>* | Remove-AppxPackage' },
      ],
      modifiers:
        'PowerShell-native — there is no /qn. Per-user: Add-AppxPackage. All-users / image: ' +
        'Add-AppxProvisionedPackage -Online (add -LicensePath for a licensed bundle, or -SkipLicense to ' +
        'stage without one). DISM equivalent: dism /online /add-provisionedappxpackage /packagepath:"…".',
      confidence: 'high',
      notes:
        'MSIX/AppX is a signed, ZIP-based package — it installs through PowerShell (or DISM), not msiexec, ' +
        'so there is no silent switch; the cmdlets are inherently non-interactive. Add-AppxPackage installs ' +
        'for the current user; Add-AppxProvisionedPackage -Online stages it for all users + new profiles ' +
        '(the fleet-deploy path). The package must be code-signed and trusted by the machine (or sideloading ' +
        'enabled). .msixbundle / .appxbundle install the same way.',
      fileName,
    };
  }

  // Anything else must be a PE to be a Windows installer.
  if (!startsWith(bytes, SIG.mz)) {
    return {
      engine: 'not-installer',
      label: 'Not a Windows installer',
      commands: [],
      confidence: 'none',
      notes:
        "No MZ/PE or MSI (OLE) header, so this isn't a Windows installer executable. If it's a " +
        '.zip / .7z / .cab, extract it and check the contents.',
      fileName,
    };
  }

  // Scope the version-string scan to the actual VS_VERSIONINFO blob (falls back to a whole-file
  // scan only if the resource tree can't be walked) — see findVersionResource for why.
  const verBlob = findVersionResource(bytes) ?? bytes;
  const meta = {
    product: readVersionString(verBlob, 'ProductName'),
    version: readVersionString(verBlob, 'ProductVersion'),
    company: readVersionString(verBlob, 'CompanyName'),
    fileName,
  };

  // 2) WiX Burn bundle
  if (has(bytes, SIG.wixBurn)) {
    return {
      ...meta,
      engine: 'wix-burn',
      label: 'WiX Burn bundle',
      commands: [
        { label: 'Install (silent)',   cmd: `${exe} /install /quiet /norestart` },
        { label: 'Repair (silent)',    cmd: `${exe} /repair /quiet /norestart` },
        { label: 'Uninstall (silent)', cmd: `${exe} /uninstall /quiet /norestart` },
        { label: 'Extract / layout',   cmd: `${exe} /layout "C:\\Path" /quiet` },
      ],
      modifiers:
        '/passive (progress only, no prompts) · /quiet (no UI at all) · /norestart · ' +
        '/log "C:\\out.log" (verbose log)',
      confidence: 'high',
      notes:
        '/install is the default verb — you can drop it (/quiet /norestart alone installs), but it ' +
        'reads clearer in a deploy script. /repair, /uninstall and /layout are Burn-engine built-ins — ' +
        'identical for every Burn bundle, not specific to this one. /layout copies the bundle + all ' +
        'payloads to a folder for redistribution. A Burn bootstrapper usually chains one or more MSIs ' +
        'internally.',
    };
  }

  // 3) Inno Setup
  if (has(bytes, SIG.inno) || has(bytes, SIG.innoData)) {
    return {
      ...meta,
      engine: 'inno',
      label: 'Inno Setup',
      commands: [
        { label: 'Install (silent)',   cmd: `${exe} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-` },
        { label: 'Uninstall (silent)', cmd: '"%ProgramFiles%\\<App>\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES' },
      ],
      modifiers:
        '/SILENT (progress bar only) vs /VERYSILENT (nothing) · /SUPPRESSMSGBOXES · /NORESTART · ' +
        '/SP- (skip the "this will install…" prompt) · /DIR="C:\\Path" · /LOG="C:\\out.log"',
      confidence: 'high',
      notes:
        'Inno has no separate repair/layout verb — reinstalling over the top repairs. The generated ' +
        'unins000.exe in the install dir is the uninstaller.',
    };
  }

  // 4) NSIS
  if (has(bytes, SIG.nsis)) {
    return {
      ...meta,
      engine: 'nsis',
      label: 'NSIS (Nullsoft Scriptable Install System)',
      commands: [
        { label: 'Install (silent)',   cmd: `${exe} /S` },
        { label: 'Uninstall (silent)', cmd: '"%ProgramFiles%\\<App>\\Uninstall.exe" /S' },
      ],
      modifiers: '/D=C:\\Path sets the target — it must be LAST and UNQUOTED, even with spaces in the path',
      confidence: 'medium',
      notes:
        '/S is case-SENSITIVE. Silent support is technically author-optional, but the vast majority ' +
        'of NSIS installers honor /S. NSIS has no repair or layout verb.',
    };
  }

  // 5) InstallShield
  if (has(bytes, SIG.installShield)) {
    return {
      ...meta,
      engine: 'installshield',
      label: 'InstallShield',
      commands: [
        { label: 'Install (silent)', cmd: `${exe} /s /v"/qn"` },
      ],
      modifiers: '/v"…" forwards args to the inner msiexec (e.g. /v"/qn INSTALLDIR=\\"C:\\Apps\\"")',
      confidence: 'medium',
      notes:
        'InstallShield is the inconsistent one. Modern MSI-backed setups take /s /v"/qn" (the /v ' +
        'forwards args to the inner msiexec). Older InstallScript setups need a recorded response ' +
        'file: run setup.exe /r to record, then setup.exe /s /f1"C:\\setup.iss". Often it just ' +
        'wraps an MSI you can extract (7-Zip, or setup.exe /a) and run directly.',
    };
  }

  // 6) Advanced Installer EXE bootstrapper (wraps an MSI). Checked before the generic SFX
  //    signatures because AI EXEs embed a compressed cab/MSI that can trip the 7z/RAR markers.
  if (has(bytes, SIG.advInstaller) || has(bytes, utf16('Advanced Installer'))) {
    // Read THIS build: its AI version + the switches actually present in the binary.
    const ai = readAdvancedInstaller(bytes);
    const present = ai.switches.length ? AI_SWITCHES.filter((s) => ai.switches.includes(s.flag)) : AI_SWITCHES;
    const switchList = present.map((s) => s.label).join(' · ');
    return {
      ...meta,
      engine: 'advanced-installer',
      label: 'Advanced Installer package',
      engineVersion: ai.version ? `Advanced Installer ${ai.version}` : undefined,
      customProperties: ai.customProperties.length ? ai.customProperties : undefined,
      commands: [
        { label: 'Install (silent)',   cmd: `${exe} /exenoui /qn` },
        { label: 'Uninstall (silent)', cmd: `${exe} /x /exenoui /qn` },
        { label: 'Extract the MSI',    cmd: `${exe} /extract "C:\\Path"` },
      ],
      modifiers:
        `${switchList} · plus any msiexec arg (/qn /qb /norestart, /l*v "C:\\msi.log", INSTALLDIR= and PROP=VALUE)`,
      confidence: 'high',
      notes:
        (ai.version ? `Read from this build: Advanced Installer ${ai.version}. ` : '') +
        'The switches above are the bootstrapper\'s own (detected in this binary); everything else ' +
        'forwards to the embedded MSI — so /qn, /qb, /norestart, /l*v "log" and PROPERTY=VALUE all work. ' +
        "Put EXE switches before the msiexec ones; uninstall with /x (or msiexec /x {ProductCode}). The " +
        "MSI's CUSTOM public properties (the package-specific switches) are compressed inside and can't be " +
        'read here — run /extract and drop the resulting MSI back in for its full property list.',
    };
  }

  // Squirrel.Windows (Electron / .NET desktop apps — Teams classic, Discord, …)
  if (has(bytes, SIG.squirrel)) {
    return {
      ...meta,
      engine: 'squirrel',
      label: 'Squirrel installer',
      commands: [
        { label: 'Install (silent)',   cmd: `${exe} --silent` },
        { label: 'Uninstall (silent)', cmd: '"%LocalAppData%\\<App>\\Update.exe" --uninstall -s' },
      ],
      modifiers:
        '--silent suppresses the install flash. Squirrel is PER-USER (installs under %LocalAppData%) — ' +
        'there is no system-wide install, so fleet deploys must run it in the user context, not as SYSTEM.',
      confidence: 'medium',
      notes:
        'Squirrel.Windows — common for Electron and .NET desktop apps. Setup.exe installs per-user to ' +
        '%LocalAppData%\\<App> and is mostly silent already; --silent hides the progress flash. Uninstall ' +
        "via the app's Update.exe --uninstall -s.",
    };
  }

  // InstallAware native setup
  if (has(bytes, SIG.installAware)) {
    return {
      ...meta,
      engine: 'installaware',
      label: 'InstallAware setup',
      commands: [{ label: 'Install (silent)', cmd: `${exe} /s` }],
      modifiers: '/s (silent) · pass setup variables as NAME="value" on the command line · /l "C:\\Windows\\Temp\\setup.log" (log)',
      confidence: 'medium',
      notes:
        "InstallAware native installer. /s runs silently using each dialog's default values; override them " +
        'by passing the setup variables as command-line parameters (NAME="value") — no response file needed. ' +
        'If it wraps an MSI, msiexec options may also pass through.',
    };
  }

  // BitRock / VMware InstallBuilder (cross-platform)
  if (has(bytes, SIG.installBuilder) || has(bytes, ascii('BitRock'))) {
    return {
      ...meta,
      engine: 'installbuilder',
      label: 'BitRock InstallBuilder',
      commands: [{ label: 'Install (silent)', cmd: `${exe} --mode unattended` }],
      modifiers: '--mode unattended (silent) · --unattendedmodeui none|minimal · --prefix "C:\\App" (dir) · --<optionname> <value> (prefilled answers)',
      confidence: 'medium',
      notes:
        'BitRock/VMware InstallBuilder — common for cross-platform apps (PostgreSQL, Bitnami stacks). ' +
        '--mode unattended takes the configured defaults; preset answers with --<optionname> <value> ' +
        '(run --help to list them), and --unattendedmodeui none hides the progress bar.',
    };
  }

  // Wise Installation System (legacy)
  if (has(bytes, SIG.wise) || has(bytes, ascii('Wise Installation'))) {
    return {
      ...meta,
      engine: 'wise',
      label: 'Wise Installation (legacy)',
      commands: [{ label: 'Install (silent)', cmd: `${exe} /s` }],
      modifiers: '/s (silent) — Wise is CASE-SENSITIVE and finicky: if /s does nothing, try /S, or a recorded response file (setup.exe /s "C:\\resp.txt")',
      confidence: 'low',
      notes:
        'Wise Installation System — an old, discontinued engine. /s is the documented silent flag, but Wise ' +
        'is notoriously inconsistent: some builds need /S (uppercase), some need a recorded response file ' +
        '(record with setup.exe /r). Test in a VM — and note many Wise setups wrap an MSI you can extract instead.',
    };
  }

  // A .NET app that matched no known installer engine → a custom installer with bespoke switches.
  // Require the _CorExeMain managed entry stub — NOT just the "mscoree.dll" string, which also
  // appears in native self-extractors (e.g. Citrix's CAB bootstrapper) that merely bundle a CLR
  // component. A genuine 7-Zip SFX has a native stub too, so it falls through to the SFX branch.
  if (has(bytes, SIG.corExeMain)) {
    const embeds7z = has(bytes, SIG.sevenZip);
    return {
      ...meta,
      engine: 'dotnet',
      label: 'Custom installer (.NET)',
      commands: [],
      confidence: 'low',
      notes:
        "This is a .NET application that parses its OWN command-line switches — there's no universal " +
        'silent flag. The switch names (often NAME=value pairs, plus a bare "silent") are defined in ' +
        "code and look identical to the app's other strings to a scanner, so they can't be read out " +
        'reliably. ' +
        (embeds7z
          ? 'It embeds a 7-Zip payload it extracts itself, so it is NOT a standard 7-Zip SFX you can just unpack. '
          : '') +
        'Check the vendor docs, or try common patterns in a throwaway VM (NAME=value, silent, /silent, ' +
        '/S, /quiet). Apps like this are exactly what the community catalog (coming) will carry, keyed by name/hash.',
    };
  }

  // 7) Self-extractors (checked AFTER the engine markers above)
  if (has(bytes, SIG.rar)) {
    return {
      ...meta,
      engine: 'sfx-winrar',
      label: 'WinRAR self-extracting archive',
      commands: [
        { label: 'Extract (silent)', cmd: `${exe} /S` },
      ],
      confidence: 'medium',
      notes:
        '/S suppresses the WinRAR extractor dialog. Whatever it launches after extracting (the ' +
        'INNER installer) has its own silent switch — identify that to be fully silent.',
    };
  }
  if (has(bytes, SIG.sevenZip)) {
    const cfg = has(bytes, SIG.sfxConfig);
    return {
      ...meta,
      engine: 'sfx-7z',
      label: '7-Zip self-extracting archive',
      commands: [],
      confidence: 'low',
      notes:
        `Self-extracting 7-Zip archive${cfg ? ' (with an embedded SFX RunProgram config)' : ''}. ` +
        "There's no universal silent switch — extract it (7-Zip ▸ Open archive, or `7z x file.exe`) " +
        'to find the INNER installer, then use that engine’s silent flag.' +
        (cfg ? ' Its ;!@Install@! config block defines what runs after extraction.' : ''),
    };
  }

  // 7) Unrecognized PE
  return {
    ...meta,
    engine: 'unknown-exe',
    label: 'Unrecognized installer (custom or packed EXE)',
    commands: [],
    confidence: 'none',
    notes:
      "Couldn't identify the engine from static signatures — it's a custom or packed installer. " +
      'Try common switches in a throwaway VM: /S, /silent, /quiet, /qn, /verysilent, /exenoui. ' +
      'Check the vendor docs, or extract it with 7-Zip to see if there’s an MSI inside. Found ' +
      'the switch? Add it to the community catalog so the next admin doesn’t have to dig.',
  };
}
