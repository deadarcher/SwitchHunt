/**
 * Client-side MSI database reader + install/uninstall property analysis.
 *
 * An MSI is an OLE compound file (already sniffed by the CFB signature in installerDetect).
 * `cfb` handles the compound-file container; on top of it we decode just enough of the MSI
 * database to read the Property / LaunchCondition / Control / CustomAction tables, then derive:
 *   - the full property list (incl. which are public / which are secrets),
 *   - a TIERED "properties you probably must set" model (required / likely / sensitive / optional),
 *   - an uninstall-replay warning: MSI properties are transaction-scoped, so deferred custom
 *     actions re-run at UNINSTALL with the MSI's AUTHORED defaults - not your install-time values.
 *
 * Pure parsing: nothing is executed, nothing leaves the browser.
 *
 * Format references (the MSI on-disk format is arcane; constants cross-checked against the
 * rust-msi crate's reader and the Wine msi string-table loader):
 *   - Table/stream names are MSI-mangled: most chars pack into codepoints 0x3800–0x4840, and
 *     table streams carry a leading 0x4840 marker.
 *   - _StringPool: u32 codepage header (high bit = 3-byte string refs), then per-string
 *     (u16 length, u16 refcount); length==0 && refcount>0 means a >64KB string whose real
 *     length follows as a u32. _StringData is the strings concatenated, indexed cumulatively.
 *   - Column "Type" word: 0x0800 = string column, low byte = size; 0x1000 nullable, 0x2000 key.
 *   - Rows are stored COLUMN-major. Integers carry a +0x8000 (2-byte) / +0x80000000 (4-byte)
 *     bias so that a stored 0 can mean NULL; string columns store a 1-based _StringPool index.
 *
 * We read the OLE container ourselves (a small MS-CFB reader, below) rather than via a library,
 * because the common JS readers eagerly index the WHOLE file - and they trip on the 4096-byte-
 * sector containers that large enterprise MSIs use. We only follow the chains for the handful of
 * tiny metadata/table streams, never the (often 100+ MB) embedded cabinet.
 */

// ── stream-name de-mangling ──────────────────────────────────────────────────
const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._';
const TABLE_PREFIX = 0x4840; // leading marker on table-stream names

function decodeStreamName(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const cp = raw.charCodeAt(i);
    if (cp >= 0x3800 && cp < 0x4800) {        // two packed base64 chars
      const v = cp - 0x3800;
      out += B64[v & 0x3f] + B64[(v >> 6) & 0x3f];
    } else if (cp >= 0x4800 && cp < 0x4840) { // one base64 char
      out += B64[cp - 0x4800];
    } else {                                  // literal
      out += String.fromCharCode(cp);
    }
  }
  return out;
}

// ── string pool ──────────────────────────────────────────────────────────────
interface StringPool { strings: string[]; longRefs: boolean; }

function decoderFor(codepage: number): TextDecoder {
  try {
    if (codepage === 65001) return new TextDecoder('utf-8');
    if (codepage === 1200) return new TextDecoder('utf-16le');
    // 0 = neutral/ANSI; default everything else to windows-1252 (ASCII-safe for prop names/values).
    return new TextDecoder('windows-1252');
  } catch {
    return new TextDecoder('utf-8');
  }
}

function readStringPool(pool: Uint8Array, data: Uint8Array): StringPool {
  const dv = new DataView(pool.buffer, pool.byteOffset, pool.byteLength);
  const header = dv.getUint32(0, true);
  const longRefs = (header & 0x80000000) !== 0; // 3-byte vs 2-byte string references
  const dec = decoderFor(header & 0x7fffffff);

  const strings: string[] = ['']; // index 0 = the null string
  let pos = 4;       // skip the codepage header (occupies the "string 0" slot)
  let dataOff = 0;
  while (pos + 4 <= pool.length) {
    let len = dv.getUint16(pos, true); pos += 2;
    const ref = dv.getUint16(pos, true); pos += 2;
    if (len === 0 && ref > 0) {        // >64KB string: real length follows as a u32
      if (pos + 4 > pool.length) break;
      len = dv.getUint32(pos, true); pos += 4;
    }
    strings.push(len ? dec.decode(data.subarray(dataOff, dataOff + len)) : '');
    dataOff += len;
  }
  return { strings, longRefs };
}

// ── generic table decode ─────────────────────────────────────────────────────
type ColKind = 'string' | 'int2' | 'int4';
interface Col { name: string; kind: ColKind; }
type Cell = string | number | null;

function colWidth(kind: ColKind, longRefs: boolean): number {
  if (kind === 'string') return longRefs ? 3 : 2;
  return kind === 'int4' ? 4 : 2;
}

function typeToKind(type: number): ColKind {
  if (type & 0x0800) return 'string';      // COL_STRING_BIT
  return (type & 0xff) === 4 ? 'int4' : 'int2';
}

function readUintLE(b: Uint8Array, off: number, width: number): number {
  let v = 0;
  for (let i = 0; i < width; i++) v += b[off + i] * 2 ** (8 * i);
  return v;
}

function decodeTable(bytes: Uint8Array, cols: Col[], sp: StringPool): Record<string, Cell>[] {
  const widths = cols.map((c) => colWidth(c.kind, sp.longRefs));
  const rowSize = widths.reduce((a, b) => a + b, 0);
  if (rowSize === 0) return [];
  const rowCount = Math.floor(bytes.length / rowSize);

  // Column-major: column c's block starts after all prior columns' full blocks.
  const colBase: number[] = [];
  let acc = 0;
  for (let c = 0; c < cols.length; c++) { colBase[c] = acc; acc += widths[c] * rowCount; }

  const rows: Record<string, Cell>[] = [];
  for (let r = 0; r < rowCount; r++) {
    const row: Record<string, Cell> = {};
    for (let c = 0; c < cols.length; c++) {
      const off = colBase[c] + r * widths[c];
      const raw = readUintLE(bytes, off, widths[c]);
      if (cols[c].kind === 'string') {
        row[cols[c].name] = raw ? (sp.strings[raw] ?? '') : '';
      } else {
        const bias = cols[c].kind === 'int4' ? 0x80000000 : 0x8000;
        row[cols[c].name] = raw === 0 ? null : raw - bias; // stored 0 = NULL
      }
    }
    rows.push(row);
  }
  return rows;
}

// _Columns / _Tables have fixed, self-describing schemas (chicken-and-egg bootstrap).
const COLUMNS_SCHEMA: Col[] = [
  { name: 'Table', kind: 'string' },
  { name: 'Number', kind: 'int2' },
  { name: 'Name', kind: 'string' },
  { name: 'Type', kind: 'int2' },
];

// ── minimal MS-CFB (OLE compound file) reader ────────────────────────────────
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

interface Cfb {
  /** Read a stream's bytes by DECODED name (e.g. "_StringPool", "Property"), or null. */
  read(name: string): Uint8Array | null;
}

function readCompoundFile(buf: ArrayBuffer): Cfb | null {
  const u8 = new Uint8Array(buf);
  if (u8.length < 512) return null;
  for (let i = 0; i < 8; i++) if (u8[i] !== CFB_SIG[i]) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  const sectorSize = 1 << dv.getUint16(0x1e, true);       // 512 or 4096
  const miniSectorSize = 1 << dv.getUint16(0x20, true);   // usually 64
  const numFatSectors = dv.getUint32(0x2c, true);
  const dirStart = dv.getUint32(0x30, true);
  const miniCutoff = dv.getUint32(0x38, true);            // streams < this go in the mini stream
  const miniFatStart = dv.getUint32(0x3c, true);
  const numMiniFat = dv.getUint32(0x40, true);
  const difatStart = dv.getUint32(0x44, true);
  const numDifat = dv.getUint32(0x48, true);
  const perSector = sectorSize / 4;

  // The header is padded to one sector, so data sector N begins at (N+1)*sectorSize.
  const sectorOff = (n: number) => (n + 1) * sectorSize;
  const sectorDV = (n: number): DataView => {
    const off = sectorOff(n);
    if (off + sectorSize > u8.length) throw new Error('sector out of bounds');
    return new DataView(u8.buffer, u8.byteOffset + off, sectorSize);
  };

  // 1) DIFAT → the list of FAT sector numbers (109 in the header, then any DIFAT-chain sectors)
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const s = dv.getUint32(0x4c + i * 4, true);
    if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
  }
  let dsec = difatStart, dguard = 0;
  while (numDifat > 0 && dsec !== ENDOFCHAIN && dsec !== FREESECT && dguard++ < numDifat + 4) {
    const v = sectorDV(dsec);
    for (let i = 0; i < perSector - 1 && fatSectors.length < numFatSectors; i++) {
      const s = v.getUint32(i * 4, true);
      if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
    }
    dsec = v.getUint32((perSector - 1) * 4, true);
  }

  // 2) FAT (next-sector pointers)
  const fat = new Uint32Array(fatSectors.length * perSector);
  let fi = 0;
  for (const fs of fatSectors) {
    const v = sectorDV(fs);
    for (let i = 0; i < perSector; i++) fat[fi++] = v.getUint32(i * 4, true);
  }
  const chain = (start: number, table: Uint32Array): number[] => {
    const out: number[] = [];
    let s = start, g = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && s < table.length && g++ <= table.length) {
      out.push(s);
      s = table[s];
    }
    return out;
  };
  const readBig = (start: number, size: number): Uint8Array => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * sectorSize);
    for (let k = 0; k < secs.length; k++) out.set(u8.subarray(sectorOff(secs[k]), sectorOff(secs[k]) + sectorSize), k * sectorSize);
    return size >= 0 && size <= out.length ? out.subarray(0, size) : out;
  };

  // 3) miniFAT
  let miniFat = new Uint32Array(0);
  if (numMiniFat > 0 && miniFatStart !== ENDOFCHAIN) {
    const secs = chain(miniFatStart, fat);
    miniFat = new Uint32Array(secs.length * perSector);
    let mi = 0;
    for (const ms of secs) {
      const v = sectorDV(ms);
      for (let i = 0; i < perSector; i++) miniFat[mi++] = v.getUint32(i * 4, true);
    }
  }

  // 4) directory entries (scanned linearly; we don't need the red-black tree order)
  const dirSecs = chain(dirStart, fat);
  const dir = new Uint8Array(dirSecs.length * sectorSize);
  for (let k = 0; k < dirSecs.length; k++) dir.set(u8.subarray(sectorOff(dirSecs[k]), sectorOff(dirSecs[k]) + sectorSize), k * sectorSize);
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);

  interface Entry { name: string; type: number; start: number; size: number; }
  const entries: Entry[] = [];
  for (let base = 0; base + 128 <= dir.length; base += 128) {
    const type = dir[base + 0x42];          // 0 unused, 1 storage, 2 stream, 5 root
    if (type !== 1 && type !== 2 && type !== 5) continue;
    const nameLen = ddv.getUint16(base + 0x40, true);
    const chars = Math.max(0, Math.floor(nameLen / 2) - 1);
    let name = '';
    for (let c = 0; c < chars; c++) name += String.fromCharCode(ddv.getUint16(base + c * 2, true));
    entries.push({ name, type, start: ddv.getUint32(base + 0x74, true), size: ddv.getUint32(base + 0x78, true) });
  }

  // The root entry's stream IS the mini stream (container for all sub-cutoff streams).
  const root = entries.find((e) => e.type === 5);
  const miniStream = root ? readBig(root.start, root.size) : new Uint8Array(0);
  const readMini = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let s = start, written = 0, g = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && s < miniFat.length && written < size && g++ <= miniFat.length) {
      const off = s * miniSectorSize;
      const take = Math.min(miniSectorSize, size - written);
      out.set(miniStream.subarray(off, off + take), written);
      written += take;
      s = miniFat[s];
    }
    return out;
  };

  // Map decoded stream name → entry (stream entries only; strip the 0x4840 table marker).
  const byName = new Map<string, Entry>();
  for (const e of entries) {
    if (e.type !== 2 || !e.name) continue;
    const isTable = e.name.charCodeAt(0) === TABLE_PREFIX;
    byName.set(decodeStreamName(isTable ? e.name.slice(1) : e.name), e);
  }

  return {
    read(name: string): Uint8Array | null {
      const e = byName.get(name);
      if (!e) return null;
      return e.size >= miniCutoff ? readBig(e.start, e.size) : readMini(e.start, e.size);
    },
  };
}

export interface MsiDb {
  table(name: string): Record<string, Cell>[] | null;
}

/** Parse an MSI into a table-reader, or null if it isn't a readable MSI database. */
export function readMsi(buf: ArrayBuffer): MsiDb | null {
  let cf: Cfb | null;
  try { cf = readCompoundFile(buf); } catch { return null; }
  if (!cf) return null;

  const poolBytes = cf.read('_StringPool');
  const dataBytes = cf.read('_StringData');
  const colBytes = cf.read('_Columns');
  if (!poolBytes || !dataBytes || !colBytes) return null;

  const sp = readStringPool(poolBytes, dataBytes);
  const colRows = decodeTable(colBytes, COLUMNS_SCHEMA, sp);

  // Build each table's ordered column schema from _Columns.
  const byTable = new Map<string, { num: number; name: string; type: number }[]>();
  for (const r of colRows) {
    const t = r.Table as string;
    if (!t) continue;
    if (!byTable.has(t)) byTable.set(t, []);
    byTable.get(t)!.push({ num: (r.Number as number) ?? 0, name: r.Name as string, type: (r.Type as number) ?? 0 });
  }
  const schemas = new Map<string, Col[]>();
  for (const [t, cols] of byTable) {
    cols.sort((a, b) => a.num - b.num);
    schemas.set(t, cols.map((c) => ({ name: c.name, kind: typeToKind(c.type) })));
  }

  return {
    table(tname: string) {
      const bytes = cf!.read(tname);
      const schema = schemas.get(tname);
      if (!bytes || !schema) return null;
      return decodeTable(bytes, schema, sp);
    },
  };
}

// ── analysis ─────────────────────────────────────────────────────────────────
export type Tier = 'required' | 'likely' | 'sensitive' | 'optional';

export interface MsiProperty { name: string; value: string; isPublic: boolean; isSecret: boolean; }
export interface RequiredProperty { name: string; value: string; tier: Tier; reason: string; }

export interface MsiAnalysis {
  productCode?: string;
  productName?: string;
  productVersion?: string;
  manufacturer?: string;
  upgradeCode?: string;
  properties: MsiProperty[];
  /** The actionable set: required ∪ likely ∪ sensitive (+ pre-filled optionals from UI). */
  required: RequiredProperty[];
  /** Public props that feed deferred custom actions / are secrets → replay these on /x. */
  uninstallReplay: string[];
  /** MSI uses AppSearch + RegLocator, so some values may be recovered from the registry. */
  registryRecovery: boolean;
  /** Ready-to-edit uninstall command with the replay props as placeholders. */
  uninstallCommand: string;
}

// A public property is settable from the command line: its name is all-uppercase.
const isPublicName = (n: string): boolean => /^[A-Z_][A-Z0-9_.]*$/.test(n);
const PROP_TOKEN = /[A-Za-z_][A-Za-z0-9_.]*/g;

// All-caps tokens that show up in conditions/CA targets but aren't user-supplied props.
const STD_PROPS = new Set([
  'AND', 'OR', 'NOT', 'XOR', 'EQV', 'IMP',
  'ALLUSERS', 'REMOVE', 'REINSTALL', 'REINSTALLMODE', 'TARGETDIR', 'ROOTDRIVE',
  'NEWERVERSIONDETECTED', 'OLDERVERSIONBEENINSTALLED', 'UPGRADEABLE', 'NEWPRODUCTFOUND',
]);

const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function analyzeMsi(buf: ArrayBuffer): MsiAnalysis | null {
  const db = readMsi(buf);
  if (!db) return null;
  const propRows = db.table('Property');
  if (!propRows) return null;

  const propMap = new Map<string, string>();
  for (const r of propRows) {
    const name = (r.Property ?? '') as string;
    if (name) propMap.set(name, (r.Value ?? '') as string);
  }
  const get = (k: string): string => propMap.get(k) ?? '';
  const splitList = (s: string): string[] => s.split(';').map((x) => x.trim()).filter(Boolean);

  const hidden = new Set(splitList(get('MsiHiddenProperties')));

  const properties: MsiProperty[] = [];
  for (const [name, value] of propMap) {
    properties.push({ name, value, isPublic: isPublicName(name), isSecret: hidden.has(name) });
  }
  properties.sort((a, b) => a.name.localeCompare(b.name));

  // ── tiered requiredness (highest tier wins per property) ──
  const RANK: Record<Tier, number> = { required: 3, likely: 2, sensitive: 1, optional: 0 };
  const tiers = new Map<string, RequiredProperty>();
  const bump = (name: string, tier: Tier, reason: string): void => {
    const cur = tiers.get(name);
    if (!cur || RANK[tier] > RANK[cur.tier]) tiers.set(name, { name, value: get(name), tier, reason });
  };

  // sensitive: public props the author hid from the log (secrets you're meant to supply)
  for (const name of hidden) {
    if (isPublicName(name)) {
      bump(name, 'sensitive', 'In MsiHiddenProperties - a secret the author hides from logs; supply it explicitly.');
    }
  }

  // likely / optional: public props bound to a setup-wizard Edit field
  const controls = db.table('Control');
  if (controls) {
    for (const c of controls) {
      const type = (c.Type ?? '') as string;
      const prop = (c.Property ?? '') as string;
      if (!prop || !isPublicName(prop) || !/edit/i.test(type)) continue;
      const hasDefault = get(prop) !== '';
      bump(
        prop,
        hasDefault ? 'optional' : 'likely',
        hasDefault
          ? 'Pre-filled in the setup wizard - override only if the default is wrong.'
          : 'Collected by a setup-wizard field with no default - a silent install must pass it.',
      );
    }
  }

  // likely / optional: SecureCustomProperties - public props the author exposes for command-line
  // configuration (the custom switches). This is how a UI-less / silently-deployed MSI declares them,
  // when there are no wizard Edit fields to collect them. Filter out WiX/MSI/ARP internals.
  const isUserProp = (n: string): boolean =>
    isPublicName(n) && !STD_PROPS.has(n) && !n.startsWith('ARP') && !n.startsWith('WIX_') && !n.startsWith('MSI');
  for (const name of splitList(get('SecureCustomProperties'))) {
    if (!isUserProp(name)) continue;
    const hasDefault = get(name) !== '';
    bump(
      name,
      hasDefault ? 'optional' : 'likely',
      hasDefault
        ? 'Declared in SecureCustomProperties (command-line configurable) - has a default; override if needed.'
        : 'Declared in SecureCustomProperties - a custom property the author expects on the command line.',
    );
  }

  // required: public props gating a LaunchCondition (install aborts if unmet)
  const conds = db.table('LaunchCondition');
  if (conds) {
    for (const c of conds) {
      const cond = (c.Condition ?? '') as string;
      for (const tok of cond.match(PROP_TOKEN) ?? []) {
        if (isPublicName(tok) && !STD_PROPS.has(tok) && propMap.has(tok)) {
          bump(tok, 'required', `Gated by a LaunchCondition (${truncate(cond, 50)}) - install fails if unmet.`);
        }
      }
    }
  }

  const required = [...tiers.values()].sort(
    (a, b) => RANK[b.tier] - RANK[a.tier] || a.name.localeCompare(b.name),
  );

  // ── uninstall replay ──
  // MSI props are transaction-scoped: at /x, deferred (in-script) custom actions re-run with the
  // package's AUTHORED defaults, not your install-time values. Collect public props referenced by
  // deferred CAs, then keep only the ACTIONABLE ones (a secret, or already flagged required/likely/
  // sensitive) - that's what an admin actually set at install and must replay. Avoids listing the
  // long tail of defaulted booleans some installers' uninstall CAs also touch.
  const deferredRefs = new Set<string>();
  const cas = db.table('CustomAction');
  if (cas) {
    for (const ca of cas) {
      const t = (ca.Type as number) ?? 0;
      if ((t & 0x0400) === 0) continue; // msidbCustomActionTypeInScript = deferred
      const text = `${(ca.Source ?? '') as string} ${(ca.Target ?? '') as string}`;
      for (const tok of text.match(PROP_TOKEN) ?? []) {
        if (isPublicName(tok) && !STD_PROPS.has(tok)) deferredRefs.add(tok);
      }
    }
  }
  const replay = new Set<string>();
  for (const name of tiers.keys()) {
    if (hidden.has(name) || deferredRefs.has(name)) replay.add(name);
  }

  const registryRecovery = !!db.table('RegLocator') && !!db.table('AppSearch');

  const productCode = get('ProductCode');
  const replayList = [...replay].sort();
  const replayArgs = replayList.map((p) => `${p}=…`).join(' ');
  const uninstallCommand = `msiexec /x ${productCode || '{ProductCode}'}${replayArgs ? ' ' + replayArgs : ''} /qn /norestart`;

  return {
    productCode: productCode || undefined,
    productName: get('ProductName') || undefined,
    productVersion: get('ProductVersion') || undefined,
    manufacturer: get('Manufacturer') || undefined,
    upgradeCode: get('UpgradeCode') || undefined,
    properties,
    required,
    uninstallReplay: replayList,
    registryRecovery,
    uninstallCommand,
  };
}
