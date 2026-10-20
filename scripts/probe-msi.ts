// Run the real detection engine on an installer file and print what SwitchHunt would show.
// Usage: npx tsx scripts/probe-msi.ts <path-to-installer>
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { detectInstaller } from '../src/lib/installerDetect';

const path = process.argv[2];
if (!path) { console.error('usage: tsx scripts/probe-msi.ts <installer>'); process.exit(2); }
const buf = readFileSync(path);
const r = detectInstaller(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), basename(path), buf.byteLength);
console.log(`${r.label} | ${r.product} ${r.version}`);
for (const c of r.commands) console.log(`  ${c.label}: ${c.cmd}`);
console.log(`  modifiers: ${r.modifiers}`);
console.log(`  notes: ${r.notes}`);
console.log(`  dualPurpose=${r.msi?.dualPurpose} installDirProperty=${r.msi?.installDirProperty}`);
