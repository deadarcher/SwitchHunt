/**
 * MSI property coverage: SwitchHunt's reader vs the Windows Installer itself.
 *
 * The oracle is INDEPENDENT on purpose - a JSON dump produced by the Windows Installer COM API
 * reading the same file's Property table. Comparing our parser against our parser proves nothing.
 *
 * Public properties (ALL-CAPS) are the ones an operator can actually set on the command line, so a
 * miss there is a real gap. Private ones are internal state and are reported separately.
 *
 *   npx tsx scripts/msi-oracle.ts <oracle.json> <msi> [msi...]
 */
import { readFileSync } from 'node:fs';
import { analyzeMsi } from '../src/lib/msi.ts';

const oracle: Record<string, string[]> = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const isPublic = (n: string) => /^[A-Z][A-Z0-9_]*$/.test(n);

let totalMissed = 0;
for (const path of process.argv.slice(3)) {
  const name = path.split(/[\\/]/).pop()!;
  let buf: Buffer;
  try { buf = readFileSync(path); } catch (e) { console.log(`SKIP ${name}: ${(e as Error).message.slice(0, 50)}`); continue; }
  // MSIs are read IN FULL: an OLE compound file's directory and streams can live past any head
  // slice, and a truncated read yields an MSI with zero properties and no warning.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  // analyzeMsi is what the PAGE calls, so compare against that. MsiDb exposes table(name), not a
  // properties map - an earlier version of this harness read a field that does not exist and
  // reported 0/25 on every file while the UI was showing all 25. The harness was the bug.
  const t0 = Date.now();
  let ours: string[] = [];
  let ok = true;
  try {
    const a = analyzeMsi(ab);
    if (!a) ok = false; else ours = a.properties.map((x) => x.name);
  } catch (e) { ok = false; }
  const ms = Date.now() - t0;

  const truth = oracle[name] ?? [];
  const truthPub = truth.filter(isPublic);
  const oursSet = new Set(ours);
  const missedPub = truthPub.filter((p) => !oursSet.has(p));
  const extra = ours.filter((p) => !truth.includes(p));

  const pct = truthPub.length ? Math.round((100 * (truthPub.length - missedPub.length)) / truthPub.length) : 100;
  totalMissed += missedPub.length;

  console.log(`\n=== ${name}  ${(buf.length / 1048576).toFixed(1)} MB  ${ms}ms  ${ok ? '' : 'READ FAILED '}`);
  console.log(`    installer sees ${truth.length} properties (${truthPub.length} public)`);
  console.log(`    SwitchHunt sees ${ours.length}`);
  console.log(`    PUBLIC coverage: ${truthPub.length - missedPub.length}/${truthPub.length} (${pct}%)`);
  if (missedPub.length) console.log(`    MISSED: ${missedPub.slice(0, 25).join(' ')}${missedPub.length > 25 ? ` ... +${missedPub.length - 25}` : ''}`);
  if (extra.length) console.log(`    extra (not in Property table): ${extra.slice(0, 8).join(' ')}`);

  // What the UI actually shows the operator for this MSI.
  try {
    const a = analyzeMsi(ab);
    if (a) console.log(`    UI would show: ${a.required.length} required/likely, ${a.properties.filter((p) => p.isPublic).length} public props`);
  } catch { /* ignore */ }
}
console.log(`\nTOTAL public properties missed across all files: ${totalMissed}`);
