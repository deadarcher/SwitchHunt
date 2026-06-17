/**
 * In-browser .intunewin packager. Produces a real Intune Win32 content package with zero install and
 * nothing uploaded — the installer bytes are zipped, AES-256-CBC encrypted, HMAC-SHA256 authenticated,
 * and wrapped with a Detection.xml, exactly as Microsoft's IntuneWinAppUtil.exe does.
 *
 * Format (reverse-engineered; svrooij.io + MSEndpointMgr):
 *   .intunewin = zip {
 *     IntuneWinPackage/Metadata/Detection.xml          (plaintext, holds the keys)
 *     IntuneWinPackage/Contents/IntunePackage.intunewin (encrypted payload)
 *   }
 *   encrypted payload = [HMAC-SHA256: 32B][IV: 16B][AES-256-CBC(payloadZip), PKCS7]
 *   HMAC is computed over (IV ‖ ciphertext) with a separate MAC key.
 *   FileDigest = SHA-256 of the UNENCRYPTED payload zip.
 *   payloadZip = a STORE zip of the source folder (here: just the installer file).
 */

// ── CRC-32 (for the zip entries) ─────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── minimal STORE (no-compression) zip writer ────────────────────────────────
interface ZipFile { name: string; data: Uint8Array; }
function zipStore(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const lh = new Uint8Array(30 + name.length);
    const ld = new DataView(lh.buffer);
    ld.setUint32(0, 0x04034b50, true);
    ld.setUint16(4, 20, true);          // version needed
    ld.setUint16(8, 0, true);           // method: store
    ld.setUint16(12, 0x21, true);       // mod date (1980-01-01, fixed — no Date.now in this build)
    ld.setUint32(14, crc, true);
    ld.setUint32(18, size, true);
    ld.setUint32(22, size, true);
    ld.setUint16(26, name.length, true);
    lh.set(name, 30);
    parts.push(lh, f.data);

    const ch = new Uint8Array(46 + name.length);
    const cd = new DataView(ch.buffer);
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);          // version made by
    cd.setUint16(6, 20, true);          // version needed
    cd.setUint16(10, 0, true);          // method: store
    cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);     // local header offset
    ch.set(name, 46);
    centrals.push(ch);

    offset += lh.length + size;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const c of centrals) centralSize += c.length;

  const eocd = new Uint8Array(22);
  const ed = new DataView(eocd.buffer);
  ed.setUint32(0, 0x06054b50, true);
  ed.setUint16(8, files.length, true);
  ed.setUint16(10, files.length, true);
  ed.setUint32(12, centralSize, true);
  ed.setUint32(16, centralStart, true);

  const out = new Uint8Array(centralStart + centralSize + 22);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  for (const c of centrals) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
const xmlEsc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function detectionXml(o: { appName: string; setupFile: string; unencSize: number; key: string; macKey: string; iv: string; mac: string; digest: string }): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ApplicationInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ToolVersion="1.8.6.0">
  <Name>${xmlEsc(o.appName)}</Name>
  <UnencryptedContentSize>${o.unencSize}</UnencryptedContentSize>
  <FileName>IntunePackage.intunewin</FileName>
  <SetupFile>${xmlEsc(o.setupFile)}</SetupFile>
  <EncryptionInfo>
    <EncryptionKey>${o.key}</EncryptionKey>
    <MacKey>${o.macKey}</MacKey>
    <InitializationVector>${o.iv}</InitializationVector>
    <Mac>${o.mac}</Mac>
    <ProfileIdentifier>ProfileVersion1</ProfileIdentifier>
    <FileDigest>${o.digest}</FileDigest>
    <FileDigestAlgorithm>SHA256</FileDigestAlgorithm>
  </EncryptionInfo>
</ApplicationInfo>`;
}

/** Build a .intunewin wrapping a single installer file. Returns the package bytes. */
export async function buildIntuneWin(setupFile: string, installer: Uint8Array, appName: string): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;

  // 1) payload = STORE zip of the source folder (just the installer)
  const payload = zipStore([{ name: setupFile, data: installer }]);

  // 2) digest of the UNENCRYPTED payload
  const digest = new Uint8Array(await subtle.digest('SHA-256', payload));

  // 3) random keys + IV
  const aesRaw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const macRaw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));

  // 4) AES-256-CBC encrypt (WebCrypto applies PKCS7 padding)
  const aesKey = await subtle.importKey('raw', aesRaw, { name: 'AES-CBC' }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, aesKey, payload));

  // 5) HMAC-SHA256 over (IV ‖ ciphertext)
  const ivCt = new Uint8Array(iv.length + ct.length);
  ivCt.set(iv, 0);
  ivCt.set(ct, iv.length);
  const macKey = await subtle.importKey('raw', macRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await subtle.sign('HMAC', macKey, ivCt));

  // 6) encrypted inner = HMAC(32) ‖ IV(16) ‖ ciphertext
  const encInner = new Uint8Array(mac.length + ivCt.length);
  encInner.set(mac, 0);
  encInner.set(ivCt, mac.length);

  // 7) Detection.xml + 8) outer zip
  const xml = detectionXml({
    appName, setupFile, unencSize: payload.length,
    key: b64(aesRaw), macKey: b64(macRaw), iv: b64(iv), mac: b64(mac), digest: b64(digest),
  });
  return zipStore([
    { name: 'IntuneWinPackage/Metadata/Detection.xml', data: new TextEncoder().encode(xml) },
    { name: 'IntuneWinPackage/Contents/IntunePackage.intunewin', data: encInner },
  ]);
}
