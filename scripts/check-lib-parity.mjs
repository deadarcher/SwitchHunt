#!/usr/bin/env node
/**
 * Fail when a SHARED ENGINE FILE has drifted between its copies.
 *
 * WHY THIS EXISTS. The installer-parsing engine lives byte-identical in more than one repo
 * (the public SwitchHunt tool, the hosted copy on the marketing site, and RFF.Web's deploy
 * wizard). A banner comment at the top of each file asks you to keep them in sync. Banners do
 * not work: measured 2026-07-29, within ONE HOUR of a deliberate sync, installerDetect.ts and
 * burn.ts were both already out of step - in OPPOSITE directions. One had a fix the other
 * lacked, and vice versa. Nobody noticed because nothing was looking.
 *
 * So this looks.
 *
 * Usage:
 *   node scripts/check-lib-parity.mjs                     auto-detect sibling checkouts
 *   node scripts/check-lib-parity.mjs <path>              compare against an explicit path
 *   node scripts/check-lib-parity.mjs --require <path>    CI mode - see below
 *
 * --require is MANDATORY IN CI. Without it, three different mishaps all produce a green build
 * that compared nothing:
 *   - the sibling checkout step failed  -> no candidates      -> exit 0 "skipping"
 *   - the path is wrong                 -> every file MISSING -> exit 0 having skipped them all
 *   - someone renames the shared files  -> zero compared      -> exit 0
 * Under --require each of those is a failure. A check that cannot prove it ran must not pass.
 *
 * THIS SCRIPT IS ITSELF A SHARED FILE. It is byte-identical in SwitchHunt, rff-marketing and
 * RFF.Web on purpose, so that any repo can run it and get the right answer without a per-repo
 * fork. It forked once already (2026-09-03: three copies, three behaviours - see SELF_FILES
 * below for what that cost). Sync it like any other shared file.
 *
 * NOT CHECKED: catalog.ts. It legitimately diverges - the marketing copy carries catalogSlug()
 * for its /switchhunt/<slug> routes and the public copy has no such pages. Entry parity there is
 * a different question; compare CATALOG.md counts instead.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/**
 * Groups exist so --require stays meaningful: a repo that was never meant to carry a file must
 * not be reported as drifting from it. Each candidate below declares which groups it holds.
 *
 * The `tools` group was briefly removed (2026-08-02) when the RFF.Web copies were deleted and
 * this repo was its only home - a group with no second home compares nothing while still
 * reporting success. It is back because the open-source rff-tools repo is now a real second
 * home. Group and candidate were added back together, which is the rule.
 */
const GROUPS = {
  installer: ['msi.ts', 'installerDetect.ts', 'burn.ts', 'intunewin.ts', 'psadt.ts'],
  // Free-tools analysis engine. Each tool is its own public repo, so a module can live in three
  // or four places at once - collectorScript is in ALL of them. Split per tool so --require does
  // not report a repo as drifting from a file it was never meant to carry: culprit has no
  // driftDiff, works-on-mine has no baselineCheck.
  perf:      ['perfAnalyzer.ts'],
  drift:     ['driftDiff.ts'],
  baseline:  ['baselineCheck.ts', 'hardeningBaseline.ts'],
  collector: ['collectorScript.ts'],
  procmon:   ['procmonAnalyzer.ts'],
  // RFF's deploy wizard (2026-08-25): the SwitchHunt panel needs only the detector + MSI parser,
  // not burn/intunewin/psadt - the wizard suggests switches, it never repackages.
  wizard:    ['msi.ts', 'installerDetect.ts'],
};

/**
 * Where the other copies might live locally. Extend when a further home lands.
 *
 * An entry is either a path (its lib is at src/lib) or {path, lib} when the repo nests it
 * elsewhere - RFF.Web is a project inside the platform monorepo, not a repo root.
 */
const ALL_TOOLS = ['perf', 'drift', 'baseline', 'collector', 'procmon'];
const CANDIDATES = [
  { path: resolve(repoRoot, '..', 'rff-marketing'), groups: ['installer', ...ALL_TOOLS] },
  { path: 'C:/temp/rff-marketing',                  groups: ['installer', ...ALL_TOOLS] },
  { path: resolve(repoRoot, '..', 'SwitchHunt'),    groups: ['installer'] },
  { path: 'C:/Temp/SwitchHunt',                     groups: ['installer'] },
  // The RFF product repo nests its web app inside the platform monorepo (the {path, lib} case
  // the comment above was written for). Private repo, so only local runs ever see it.
  { path: resolve(repoRoot, '..', 'rff'),           lib: 'platform/src/RFF.Web/src/lib', groups: ['wizard'] },
  { path: 'C:/temp/rff',                            lib: 'platform/src/RFF.Web/src/lib', groups: ['wizard'] },
  // RFF.Web running this script sees the monorepo from the INSIDE: its own repoRoot is the
  // RFF.Web project, so the siblings above are reached by climbing out of platform/src.
  { path: resolve(repoRoot, '..', '..', '..', '..', 'SwitchHunt'),    groups: ['installer'] },
  { path: resolve(repoRoot, '..', '..', '..', '..', 'rff-marketing'), groups: ['installer', ...ALL_TOOLS] },
  // One public repo per tool; each carries only the modules its own page imports.
  { path: resolve(repoRoot, '..', 'culprit'),       groups: ['perf', 'collector'] },
  { path: 'C:/temp/culprit',                        groups: ['perf', 'collector'] },
  { path: resolve(repoRoot, '..', 'works-on-mine'), groups: ['drift', 'collector'] },
  { path: 'C:/temp/works-on-mine',                  groups: ['drift', 'collector'] },
  { path: resolve(repoRoot, '..', 'hardened'),      groups: ['drift', 'baseline', 'collector'] },
  { path: 'C:/temp/hardened',                       groups: ['drift', 'baseline', 'collector'] },
  { path: resolve(repoRoot, '..', 'denied'),        groups: ['procmon'] },
  { path: 'C:/temp/denied',                         groups: ['procmon'] },
];

/**
 * Which files THIS repo carries, DERIVED from what is on disk rather than hand-declared.
 *
 * This is the fix for the 2026-09-03 incident. Every repo used to keep its own fork of this
 * script with its own hard-coded file list, because the file list differs per repo: SwitchHunt
 * has all five installer modules, RFF.Web has two of them, the tool repos have none. Three
 * forks meant three behaviours, and the two downstream ones rotted - SwitchHunt's still called
 * RFF.Web "planned" and compared this repo against ITSELF (a case-only path mismatch defeated
 * its repoRoot filter), so 5 of its 15 "compared" files were a file diffed against itself.
 *
 * Deriving the local side means one script is correct everywhere, so there is nothing to fork.
 * A candidate's declared groups say what IT holds; intersecting with this says what the pair
 * genuinely share. Anything held by exactly one side of a pair is still a MISSING failure under
 * --require, so this cannot be used to quietly skip a file that ought to be there.
 */
const SELF_FILES = new Set(
  [...new Set(Object.values(GROUPS).flat())].filter((f) => existsSync(join(repoRoot, 'src', 'lib', f))),
);

/** Fill in the default lib subpath and expand the group list into concrete filenames. */
const asCandidate = (c) => ({
  ...c,
  lib: c.lib ?? join('src', 'lib'),
  files: [...new Set(c.groups.flatMap((g) => GROUPS[g]))].filter((f) => SELF_FILES.has(f)),
});

const REQUIRE = process.argv.includes('--require');
const explicit = process.argv.slice(2).find((a) => !a.startsWith('--'));

/**
 * --groups=installer,tools restricts an EXPLICIT target to the groups it actually carries.
 *
 * Without it an explicit path is compared against every group, so CI cloning the SwitchHunt repo
 * demanded the tools engine from it and failed with five MISSING files (broke main 2026-08-03).
 * Defaulting to every group is still right for a local one-off against a full mirror; CI passes
 * the flag because it knows what each sibling holds.
 */
const groupsArg = process.argv.slice(2).find((a) => a.startsWith('--groups='));
const explicitGroups = groupsArg ? groupsArg.slice('--groups='.length).split(',').map((g) => g.trim()).filter(Boolean) : null;
for (const g of explicitGroups ?? []) {
  if (!GROUPS[g]) {
    console.error(`check-lib-parity: unknown group "${g}". Known groups: ${Object.keys(GROUPS).join(', ')}`);
    process.exit(1);
  }
}

if (SELF_FILES.size === 0) {
  console.error('check-lib-parity: this repo carries NONE of the shared engine files.');
  console.error('Either the files were renamed/moved, or the script is being run from the wrong root.');
  console.error('Looked in: ' + join(repoRoot, 'src', 'lib'));
  process.exit(1);
}

const others = explicit
  ? [asCandidate({ path: resolve(explicit), groups: explicitGroups ?? Object.keys(GROUPS) })]
  : (() => {
      // De-duplicate by RESOLVED LIB DIRECTORY: the relative and absolute entries above
      // frequently point at the same checkout, which would otherwise compare (and report)
      // everything twice.
      //
      // The key is the lib directory and NOT the repo path, because the same lib is reachable
      // under two different roots: RFF.Web's own root is platform/src/RFF.Web, while the
      // monorepo entry names it as {path: 'C:/temp/rff', lib: 'platform/src/RFF.Web/src/lib'}.
      // Those repo paths differ, so a path-keyed filter let RFF.Web compare against ITSELF.
      // Compared case-INSENSITIVELY too, because Windows treats C:/Temp and C:/temp as one
      // directory while === does not - that mismatch caused the same self-compare in SwitchHunt.
      // Both spellings of "it's me" have now bitten; key on the thing being read.
      const selfLib = resolve(join(repoRoot, 'src', 'lib')).toLowerCase();
      const seen = new Set();
      return CANDIDATES.map(asCandidate)
        .filter((c) => {
          const key = resolve(join(c.path, c.lib)).toLowerCase();
          if (key === selfLib || seen.has(key)) return false;
          if (!existsSync(join(c.path, c.lib))) return false;
          seen.add(key);
          return true;
        })
        // A sibling that shares no files with this repo is not drift, it is simply unrelated
        // (SwitchHunt has no business carrying procmonAnalyzer.ts). Drop it silently rather
        // than printing an empty section.
        .filter((c) => c.files.length > 0);
    })();

if (others.length === 0) {
  if (REQUIRE) {
    console.error('check-lib-parity: --require was set but no comparable sibling checkout was found.');
    console.error('Nothing was compared. Failing rather than reporting a pass it did not earn.');
    process.exit(1);
  }
  console.log('check-lib-parity: no sibling checkout found locally - skipping (not a failure).');
  process.exit(0);
}

let failed = false;
let compared = 0;

for (const other of others) {
  console.log('');
  console.log('Comparing against ' + other.path + ' (' + other.lib + ')');
  for (const f of other.files) {
    const a = join(repoRoot, 'src', 'lib', f);
    const b = join(other.path, other.lib, f);

    if (!existsSync(a) || !existsSync(b)) {
      // Under --require a missing file is a FAILURE. An explicit-but-wrong path makes `others`
      // non-empty, so every file would "skip" and the script would exit 0 having compared
      // nothing - a check that passes without checking.
      console.log('  ' + f.padEnd(22) + (REQUIRE ? 'MISSING - cannot compare' : 'SKIP (missing on one side)'));
      if (REQUIRE) failed = true;
      continue;
    }

    // Normalise line endings only - the repos disagree about CRLF via .gitattributes, and that
    // is not drift anyone needs to act on.
    const norm = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n');
    const x = norm(a);
    const y = norm(b);
    compared++;

    if (x === y) {
      console.log('  ' + f.padEnd(22) + 'ok');
      continue;
    }

    failed = true;
    const xl = x.split('\n');
    const yl = y.split('\n');
    let i = 0;
    while (i < xl.length && i < yl.length && xl[i] === yl[i]) i++;
    console.log('  ' + f.padEnd(22) + 'DRIFT - first difference at line ' + (i + 1));
    console.log('      this repo : ' + String(xl[i] ?? '(eof)').trim().slice(0, 100));
    console.log('      other repo: ' + String(yl[i] ?? '(eof)').trim().slice(0, 100));
  }
}

if (REQUIRE && compared === 0) {
  console.error('');
  console.error('check-lib-parity: --require was set but ZERO files were actually compared.');
  process.exit(1);
}

if (failed) {
  console.error('');
  console.error('Shared engine files have drifted, or could not be compared.');
  console.error('Apply the change to EVERY copy before committing. See the banner at the top of each file.');
  process.exit(1);
}

console.log('');
console.log('All shared engine files are in sync (' + compared + ' compared).');
