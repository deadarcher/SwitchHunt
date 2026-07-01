/**
 * Regenerate catalog/catalog.json from the canonical TypeScript catalog (src/lib/catalog.ts).
 * RegExp matchers are serialized to their `.source` string. The .ts file is the source of
 * truth; the JSON is a generated, machine-readable mirror for non-code consumers.
 *
 *   npm run gen:catalog
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATALOG } from '../src/lib/catalog.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const entries = CATALOG.map((e) => ({
  name: e.name,
  match: {
    product: e.match.product?.source ?? null,
    file: e.match.file?.source ?? null,
  },
  install: e.install,
  uninstall: e.uninstall ?? null,
  detect: e.detect ?? null,
  note: e.note ?? null,
}));

const out = {
  _comment:
    'GENERATED from src/lib/catalog.ts by scripts/gen-catalog.ts - do not hand-edit. Regenerate: npm run gen:catalog',
  count: entries.length,
  entries,
};

writeFileSync(join(root, 'catalog', 'catalog.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote catalog/catalog.json (${entries.length} entries)`);

// Human-readable browse table (CATALOG.md). Built with string concat to dodge backtick-escaping.
const esc = (s: string) => s.replace(/\|/g, '\\|');
const code = (s: string | null | undefined) => (s ? '`' + esc(s) + '`' : '-');
const rows = CATALOG.map(
  (e) =>
    '| ' + esc(e.name) + ' | ' + code(e.install) + ' | ' + code(e.uninstall) + ' | ' +
    code(e.detect) + ' | ' + (e.note ? esc(e.note) : '') + ' |',
);
const mdLines = [
  '# SwitchHunt catalog',
  '',
  "Hand-verified silent-install strings for apps whose switches you can't derive from the installer alone -",
  'custom CLIs, mandatory keys, compressed payloads. `{file}` is replaced with the dropped installer name at',
  'runtime. For well-known apps the catalog also carries the real uninstall command and a file-detection path.',
  '',
  '**' + CATALOG.length + ' entries.** Generated from `src/lib/catalog.ts` - do not hand-edit; run `npm run gen:catalog`.',
  '',
  'Got one we miss? [Submit it with the issue form](https://github.com/deadarcher/SwitchHunt/issues/new?template=silent-install-string.yml) (no coding needed) - or PR `src/lib/catalog.ts` ([CONTRIBUTING](CONTRIBUTING.md)).',
  '',
  '| App | Silent install | Silent uninstall | Detection (file) | Notes |',
  '|---|---|---|---|---|',
  ...rows,
  '',
];
writeFileSync(join(root, 'CATALOG.md'), mdLines.join('\n'));
console.log(`wrote CATALOG.md (${CATALOG.length} entries)`);
