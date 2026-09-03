/**
 * Before/after harness for the FireEye/Trellix AgentCleanupTool miss (2026-09-03).
 *
 * Ground truth from the binary's own embedded help, which is UTF-16 (.NET #US heap):
 *   FireEyeAgentCleanupToolCmd.exe /run=MsiApi,Registry /detect /verbose
 *   /Reboot  /RebootForce  /RebootMsg="Message"  /RebootTime=  /Timeout=
 *   /FixMSI[=<Msi Path>]  /ConvertGuid=  /ConvertReg=
 * plus an ALL-CAPS verb table: CLEANUP CLEAN REMOVE DETECT ... QUIET VERBOSE ...
 *
 * Brian reported the tool actually takes `/verbose /clean`, and SwitchHunt surfaced neither.
 *
 *   npx tsx scripts/probe-fireeye.ts <path-to-exe>
 */
import { readFileSync } from 'node:fs';
import { bestEffortSwitches, detectInstaller } from '../src/lib/installerDetect.ts';

const path = process.argv[2] ?? 'C:\\Temp\\FireEyeAgentCleanupToolCmd 9\\FireEyeAgentCleanupToolCmd.exe';
const buf = readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

const det = detectInstaller(ab, path.split(/[\\/]/).pop(), buf.byteLength);
console.log(`engine: ${det.engine ?? '(none)'}   notes: ${(det.notes ?? '').slice(0, 90)}`);

const r = bestEffortSwitches(ab) as { flags: string[]; options: string[]; switches?: string[] };
console.log(`\nflags   (${r.flags.length}): ${r.flags.join(' ')}`);
console.log(`options (${r.options.length}): ${r.options.join(' ')}`);
if (r.switches) console.log(`switches(${r.switches.length}): ${r.switches.join(' ')}`);

// The two Brian named, plus the rest of the documented set.
const want = ['verbose', 'clean', 'detect', 'run', 'Reboot', 'RebootForce', 'Timeout', 'FixMSI', 'ConvertGuid'];
const found = new Set([...r.flags, ...r.options, ...(r.switches ?? [])].map((s) => s.replace(/^[-/]+/, '').toLowerCase()));
console.log('');
let hit = 0;
for (const w of want) {
  const ok = found.has(w.toLowerCase());
  if (ok) hit++;
  console.log(`${ok ? 'FOUND  ' : 'MISSED '} ${w}`);
}
console.log(`\n${hit}/${want.length} documented switches surfaced`);
