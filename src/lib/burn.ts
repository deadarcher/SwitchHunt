/**
 * WiX Burn bundle X-ray — runs ENTIRELY in the browser, no upload.
 *
 * A Burn ".exe" is a stub followed by attached CAB containers. The FIRST container (the "UX"
 * container, right after the stub) holds the bootstrapper application + a `BurnManifest.xml` that
 * describes the whole bundle: which bootstrapper drives the UI and exactly which MSIs/EXEs it chains.
 *
 * Why this matters: /quiet is parsed by the Burn ENGINE, but a bundle built with a CUSTOM bootstrapper
 * (rather than the standard WiX one) can ignore it and pop a wizard anyway — a defect you can't fix with
 * a switch (Sony Catalyst Browse is the canonical example). Static signatures can't see that; the
 * manifest can. So we read it and tell the user the truth: "custom bootstrapper → /quiet may be ignored
 * → here's the inner chain, extract and drive the MSI directly."
 *
 * Everything here is best-effort and defensive: any parse failure returns null and the caller falls back
 * to the generic Burn advice. The UX container lives at the very front of the file (right after the
 * ~KB-scale stub), so this works on the head-slice the page reads for large bundles too.
 */

export interface BurnPackage {
  kind: 'MSI' | 'EXE' | 'MSP' | 'MSU' | 'package';
  /** Best display name — the package's main payload filename (e.g. "CatalystBrowse.msi"), else its Id. */
  name: string;
  /** ExePackage per-package install arguments, when the manifest carries them. */
  installArgs?: string;
}

export interface BurnAnalysis {
  /** 'standard' = the WiX-provided bootstrapper (honors /quiet). 'custom' = a vendor/managed BA that
   *  MAY ignore silent. 'unknown' = couldn't classify. */
  baType: 'standard' | 'custom' | 'unknown';
  /** The bootstrapper application's main DLL filename, for display (e.g. "TestBA.dll", "wixstdba.dll"). */
  baName?: string;
  /** The ordered chain of packages the bundle installs. */
  chain: BurnPackage[];
  /** True when /quiet is at real risk of being ignored (custom BA). Drives the warning banner. */
  silentRisk: boolean;
  bundleName?: string;
  bundleVersion?: string;
  manufacturer?: string;
}

// ── tiny binary helpers ───────────────────────────────────────────────────────
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Locate the UX container CAB: parse the PE for the .wixburn section, read the stub size, and the
 *  UX CAB starts right after the stub. Returns [offset, length] or null. Exported for tests. */
export function findUxCab(b: Uint8Array): [number, number] | null {
  try {
    if (b[0] !== 0x4d || b[1] !== 0x5a) return null;               // MZ
    const pe = u32(b, 0x3c);
    if (pe + 24 > b.length || u32(b, pe) !== 0x00004550) return null; // "PE\0\0"
    const nsec = u16(b, pe + 6);
    const optSize = u16(b, pe + 20);
    const secBase = pe + 24 + optSize;
    let praw = -1;
    for (let i = 0; i < Math.min(nsec, 96); i++) {
      const off = secBase + i * 40;
      if (off + 40 > b.length) break;
      let name = '';
      for (let j = 0; j < 8; j++) { const c = b[off + j]; if (c === 0) break; name += String.fromCharCode(c); }
      if (name === '.wixburn') { praw = u32(b, off + 20); break; }
    }
    if (praw < 0 || praw + 28 > b.length) return null;
    // BURN_SECTION_DATA: dwSignature(4) dwVersion(4) guid(16) then dwStubSize(4) at offset 24.
    if (u32(b, praw) !== 0x00f14300) return null;                  // Burn section magic
    const stubSize = u32(b, praw + 24);
    if (stubSize <= 0 || stubSize + 4 > b.length) return null;
    // The UX CAB sits at file offset == stubSize. Confirm 'MSCF' and read its self-declared size.
    if (!(b[stubSize] === 0x4d && b[stubSize + 1] === 0x53 && b[stubSize + 2] === 0x43 && b[stubSize + 3] === 0x46)) return null;
    const cbCab = u32(b, stubSize + 8);
    if (cbCab <= 0 || stubSize + cbCab > b.length) return null;    // must be fully within our (head) buffer
    return [stubSize, cbCab];
  } catch { return null; }
}

/** Extract one member (by name) from a CAB, MSZIP-decompressing its folder. Returns the bytes or null.
 *  Minimal single-archive CAB reader — enough for a Burn UX container (one folder, MSZIP). Exported for tests. */
export async function cabExtract(cab: Uint8Array, memberName: string): Promise<Uint8Array | null> {
  try {
    if (!(cab[0] === 0x4d && cab[1] === 0x53 && cab[2] === 0x43 && cab[3] === 0x46)) return null; // MSCF
    const coffFiles = u32(cab, 16);
    const cFolders = u16(cab, 26);
    const cFiles = u16(cab, 28);
    const flags = u16(cab, 30);
    let p = 36;
    let cbCFFolder = 0, cbCFData = 0;
    if (flags & 0x0004) { // RESERVE_PRESENT
      const cbCFHeader = u16(cab, p); cbCFFolder = cab[p + 2]; cbCFData = cab[p + 3];
      p += 4 + cbCFHeader;
    }
    if (flags & 0x0001) { // PREV_CABINET: szCabinetPrev + szDiskPrev (skip two C-strings)
      for (let k = 0; k < 2; k++) { while (p < cab.length && cab[p] !== 0) p++; p++; }
    }
    if (flags & 0x0002) { // NEXT_CABINET
      for (let k = 0; k < 2; k++) { while (p < cab.length && cab[p] !== 0) p++; p++; }
    }
    // Folders.
    type Folder = { coffStart: number; cCFData: number; typeCompress: number };
    const folders: Folder[] = [];
    for (let i = 0; i < cFolders; i++) {
      folders.push({ coffStart: u32(cab, p), cCFData: u16(cab, p + 4), typeCompress: u16(cab, p + 6) });
      p += 8 + cbCFFolder;
    }
    // Files — find the one we want.
    let fp = coffFiles;
    let target: { cbFile: number; uoff: number; iFolder: number } | null = null;
    for (let i = 0; i < cFiles; i++) {
      const cbFile = u32(cab, fp);
      const uoff = u32(cab, fp + 4);
      const iFolder = u16(cab, fp + 8);
      let np = fp + 16, name = '';
      while (np < cab.length && cab[np] !== 0) { name += String.fromCharCode(cab[np]); np++; }
      np++;
      if (name === memberName) { target = { cbFile, uoff, iFolder }; break; }
      fp = np;
    }
    if (!target) return null;
    const folder = folders[target.iFolder];
    if (!folder || folder.typeCompress !== 1) return null; // only MSZIP (1) supported; else bail to fallback

    // MSZIP: each CFDATA is 'CK' + a SELF-TERMINATING deflate stream, but its LZ back-references reach
    // into the previous block's uncompressed output (a rolling 32 KB window). DecompressionStream has no
    // preset-dictionary API, so per block we synthesize [stored deflate block = prior 32 KB][this block's
    // deflate] and drop the prefix from the output. We stop as soon as we've produced enough bytes to
    // cover the wanted member (member "0", the manifest, sits at the front → only the first few blocks).
    const need = target.uoff + target.cbFile;
    const outChunks: Uint8Array[] = [];
    let produced = 0;
    let window = new Uint8Array(0); // last <=32 KB of uncompressed output
    let dp = folder.coffStart;
    for (let i = 0; i < folder.cCFData && produced < need; i++) {
      const cbData = u16(cab, dp + 4);
      const dataStart = dp + 8 + cbCFData;
      const blockDeflate = cab.subarray(dataStart + 2, dataStart + cbData); // strip 'CK'
      dp = dataStart + cbData;

      // Prefix = a stored (uncompressed, non-final) deflate block carrying the current window as history.
      let stream: Uint8Array;
      if (window.length) {
        const len = window.length; // <= 32768, fits a single stored block
        stream = new Uint8Array(5 + len + blockDeflate.length);
        stream[0] = 0x00;                                   // BFINAL=0, BTYPE=00 (stored)
        stream[1] = len & 0xff; stream[2] = (len >> 8) & 0xff;
        stream[3] = (~len) & 0xff; stream[4] = ((~len) >> 8) & 0xff; // NLEN = ~LEN
        stream.set(window, 5);
        stream.set(blockDeflate, 5 + len);
      } else {
        stream = blockDeflate;
      }

      const ds = new DecompressionStream('deflate-raw');
      const wr = ds.writable.getWriter(); wr.write(stream as BufferSource); wr.close();
      const full = new Uint8Array(await new Response(ds.readable).arrayBuffer());
      const block = full.subarray(window.length); // drop the injected dictionary
      outChunks.push(block);
      produced += block.length;
      // Roll the window forward (keep the trailing 32 KB of everything produced so far).
      const combined = new Uint8Array(window.length + block.length);
      combined.set(window); combined.set(block, window.length);
      window = combined.length > 32768 ? combined.subarray(combined.length - 32768) : combined;
    }

    // Assemble just enough of the uncompressed folder and slice the member out.
    const uncomp = new Uint8Array(produced);
    { let o = 0; for (const c of outChunks) { uncomp.set(c, o); o += c.length; } }
    if (uncomp.length < need) return null;
    return uncomp.subarray(target.uoff, target.uoff + target.cbFile);
  } catch { return null; }
}

const KNOWN_STD_BA = /^(wixstdba|mbahost|mbapreq|BootstrapperCore|Microsoft\.Deployment|WixToolset|GalaSoft|dnhost|dotnetcore)/i;

/** Full pipeline: bytes → BurnAnalysis, or null if anything can't be parsed (caller shows generic advice). */
export async function analyzeBurn(bytes: Uint8Array): Promise<BurnAnalysis | null> {
  const ux = findUxCab(bytes);
  if (!ux) return null;
  const cab = bytes.subarray(ux[0], ux[0] + ux[1]);
  const manifestBytes = await cabExtract(cab, '0'); // Burn stores BurnManifest.xml as member "0"
  if (!manifestBytes) return null;

  let doc: Document;
  try {
    const xml = new TextDecoder('utf-8').decode(manifestBytes);
    doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
  } catch { return null; }

  const local = (el: Element, name: string) =>
    Array.from(el.children).filter((c) => c.localName === name);
  const root = doc.documentElement;

  // Bootstrapper application: look at the UX payloads. A DLL not in the known-standard set = custom BA.
  const uxEl = root.getElementsByTagName('*');
  const uxPayloads: string[] = [];
  for (let i = 0; i < uxEl.length; i++) {
    const el = uxEl[i];
    if (el.localName === 'Payload' && (el.getAttribute('Container') === 'WixUXContainer' || el.getAttribute('SourcePath')?.startsWith('u'))) {
      const fp = el.getAttribute('FilePath') || '';
      if (fp) uxPayloads.push(fp);
    }
  }
  const dlls = uxPayloads.filter((f) => /\.dll$/i.test(f));
  const foreign = dlls.filter((f) => !KNOWN_STD_BA.test(f.replace(/^.*[\\/]/, '')));
  let baType: BurnAnalysis['baType'] = 'unknown';
  let baName: string | undefined;
  if (foreign.length > 0) { baType = 'custom'; baName = foreign[0].replace(/^.*[\\/]/, ''); }
  else if (dlls.some((f) => /wixstdba/i.test(f))) { baType = 'standard'; baName = 'wixstdba.dll'; }
  else if (dlls.length > 0) { baType = 'standard'; baName = dlls[0].replace(/^.*[\\/]/, ''); }

  // A package's PRIMARY payload is the <Payload> whose Id equals the package's Id (verified against real
  // manifests — payloads link to packages by matching Id, there is no @Package attribute). Map Id->FilePath.
  const fileById = new Map<string, string>();
  for (let i = 0; i < uxEl.length; i++) {
    const el = uxEl[i];
    if (el.localName === 'Payload') {
      const id = el.getAttribute('Id'); const fp = el.getAttribute('FilePath');
      if (id && fp && !fileById.has(id)) fileById.set(id, fp);
    }
  }
  const kindMap: Record<string, BurnPackage['kind']> = {
    MsiPackage: 'MSI', ExePackage: 'EXE', MspPackage: 'MSP', MsuPackage: 'MSU',
  };
  const chain: BurnPackage[] = [];
  const chainEl = root.getElementsByTagName('Chain')[0] || Array.from(uxEl).find((e) => e.localName === 'Chain');
  if (chainEl) {
    for (const pkgEl of Array.from(chainEl.children)) {
      const kind = kindMap[pkgEl.localName];
      if (!kind) continue;
      const id = pkgEl.getAttribute('Id') || '(package)';
      const main = fileById.get(id) || id;          // real filename via Id match, else the Id itself
      chain.push({
        kind,
        name: main.replace(/^.*[\\/]/, ''),
        installArgs: pkgEl.getAttribute('InstallArguments') || undefined,
      });
    }
  }
  if (chain.length === 0) return null; // nothing useful parsed

  // Bundle metadata (Registration element carries name/version/publisher).
  const reg = root.getElementsByTagName('Registration')[0];
  const arp = reg ? (reg.getElementsByTagName('Arp')[0] || local(reg, 'Arp')[0]) : undefined;

  return {
    baType,
    baName,
    chain,
    silentRisk: baType === 'custom',
    bundleName: arp?.getAttribute('DisplayName') || undefined,
    bundleVersion: reg?.getAttribute('Version') || undefined,
    manufacturer: arp?.getAttribute('Publisher') || undefined,
  };
}
