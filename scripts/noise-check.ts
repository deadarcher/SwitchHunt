/**
 * Noise regression for the switch harvest added 2026-09-03.
 *
 * The harvest exists to stop MISSING real switches. The opposite failure is worse for a public tool:
 * flooding every result with junk teaches people to ignore the section. So this runs the harvest over
 * a spread of real installers and prints what it would show, for eyeballing.
 *
 *   npx tsx scripts/noise-check.ts <file> [file...]
 */
import { readFileSync, statSync } from 'node:fs';
import { bestEffortSwitches, detectInstaller } from '../src/lib/installerDetect.ts';

const CAP = 32 << 20;   // head slice, same spirit as the page

for (const path of process.argv.slice(2)) {
  let buf: Buffer;
  try {
    const size = statSync(path).size;
    buf = Buffer.alloc(Math.min(size, CAP));
    const fd = (await import('node:fs')).openSync(path, 'r');
    (await import('node:fs')).readSync(fd, buf, 0, buf.length, 0);
    (await import('node:fs')).closeSync(fd);
  } catch (e) {
    console.log(`SKIP ${path}: ${(e as Error).message.slice(0, 60)}`);
    continue;
  }
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const name = path.split(/[\\/]/).pop()!;
  let engine = '?';
  try { engine = detectInstaller(ab, name, buf.length).engine ?? 'none'; } catch { /* ignore */ }

  const t0 = Date.now();
  const r = bestEffortSwitches(ab) as { flags: string[]; options: string[]; switches: string[] };
  const ms = Date.now() - t0;

  console.log(`\n=== ${name}  [${engine}]  ${(buf.length / 1048576).toFixed(1)} MB  ${ms}ms`);
  console.log(`  switches (${r.switches.length}): ${r.switches.slice(0, 30).join(' ')}${r.switches.length > 30 ? ' ...' : ''}`);
}
