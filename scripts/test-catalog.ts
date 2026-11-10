// Catalog matching + {file} substitution. Run: npm run test:catalog
// Dropbox case from a 2026-11-10 report: the offline installer reads as a 7-Zip SFX with no version info,
// so the catalog (matched by file name) is the only source of the switch, and the vendor's own file name
// has spaces, which a bare {file} turned into a broken command line.
import { detectInstaller } from '../src/lib/installerDetect';
import { CATALOG, lookupCatalog, fillCatalogCmd } from '../src/lib/catalog';

let bad = 0, n = 0;
const eq = (what: string, got: unknown, want: unknown) => {
  n++;
  if (got !== want) { console.log(`FAIL  ${what}\n      got:  ${String(got)}\n      want: ${String(want)}`); bad++; }
};

// Stand-in bytes: MZ header + a 7z signature, no version resource (what the real file gave the page).
const stub = new Uint8Array(4096);
stub.set([0x4d, 0x5a], 0);
stub.set([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], 2048);

for (const name of ['Dropbox_278.4.4020_Offline_Installer.x64.exe', 'Dropbox 278.4.4020 Offline Installer.x64.exe']) {
  const r = detectInstaller(stub.buffer, name);
  eq(`${name}: engine`, r.engine, 'sfx-7z');
  const cat = lookupCatalog({ product: r.product, fileName: r.fileName });
  eq(`${name}: catalog`, cat?.name, 'Dropbox');
  const q = /\s/.test(name) ? `"${name}"` : name;
  eq(`${name}: install`, cat && fillCatalogCmd(cat.install, name), `${q} /S`);
  eq(`${name}: uninstall`, cat?.uninstall && fillCatalogCmd(cat.uninstall, name),
    '"%ProgramFiles(x86)%\\Dropbox\\Client\\DropboxUninstaller.exe" /InstallType:MACHINE /S');
}
eq('no catalog for an unrelated 7z SFX', lookupCatalog({ fileName: 'Some_Other_Tool_Setup.exe' }), null);

// Substitution rules.
eq('bare, no spaces', fillCatalogCmd('{file} /S', 'a.exe'), 'a.exe /S');
eq('bare, spaces', fillCatalogCmd('{file} /S', 'a b.exe'), '"a b.exe" /S');
eq('already quoted, spaces', fillCatalogCmd('msiexec /i "{file}" /qn', 'a b.msi'), 'msiexec /i "a b.msi" /qn');
eq('already quoted, no spaces', fillCatalogCmd('msiexec /i "{file}" /qn', 'a.msi'), 'msiexec /i "a.msi" /qn');
eq('no placeholder', fillCatalogCmd('"%ProgramFiles%\\x.exe" /S', 'a b.exe'), '"%ProgramFiles%\\x.exe" /S');

// No catalog command may use start with a non-empty first quoted argument (start takes it as the title).
for (const e of CATALOG) for (const c of [e.install, e.uninstall ?? '']) {
  if (/\bstart\s+"[^"]/i.test(c)) { n++; bad++; console.log(`FAIL  ${e.name}: start with a quoted title: ${c}`); }
}

console.log(bad === 0 ? `all ${n} cases ok` : `${bad} of ${n} wrong`);
if (bad) process.exitCode = 1;
