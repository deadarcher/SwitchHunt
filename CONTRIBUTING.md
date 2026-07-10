# Contributing to SwitchHunt

The most valuable thing you can add is a **catalog entry for a weird installer** - the custom-CLI, mandatory-property, gotcha-laden vendor packages that signature detection can't derive. If you've ever reverse-engineered a silent string the hard way, save the next admin the pain.

## Add a catalog entry

**No coding? Use the form.** The fastest path is the [**Submit a silent-install string**](https://github.com/deadarcher/SwitchHunt/issues/new?template=silent-install-string.yml) issue form - fill in the app, the command that actually worked, and how you verified it. We'll turn it into a catalog entry. (Browse what's already in there: [CATALOG.md](CATALOG.md).)

**Prefer a PR?** Catalog entries live in [`src/lib/catalog.ts`](src/lib/catalog.ts). Each is one object:

```ts
{
  name: 'CrowdStrike Falcon Sensor',
  match: {
    product: /crowdstrike|falcon sensor/i,   // matches the detected ProductName (optional)
    file: /WindowsSensor|FalconSensor/i,      // matches the dropped file name (optional)
  },
  install: '{file} /install /quiet /norestart CID=<your-CID>',
  uninstall: '{file} /uninstall /quiet',      // optional
  detect: 'C:\\Program Files\\CrowdStrike\\CSFalconService.exe', // optional - real install path
  // Why it's non-obvious - the gotcha worth surfacing:
  note: 'CID (customer ID + checksum) is REQUIRED - without it the sensor installs but never registers.',
}
```

- `{file}` is replaced with the real dropped filename at render time.
- Provide `product` and/or `file` regexes - whichever reliably identifies it. Keep them specific enough not to false-match.
- **`uninstall` / `detect` are optional but gold for well-known apps** - the real silent uninstall command and a file path that proves it's installed. The tool can't read either from an EXE installer, so the catalog is the only source. Only add paths you're *sure* of (a wrong one ships a broken package).
- The `note` is the most useful field: call out the mandatory property, the non-standard verb, the reboot behavior - whatever bit you. Bias the catalog toward gotchas, not the obvious `/S`.

### Rules of the road

1. **Verify it.** Only submit strings you've actually run, or that come from the vendor's own docs / `/?` output. Cite the source in your PR description.
2. **Silent + unattended.** The command must complete with no UI and no prompts.
3. **No installers in the PR.** Just the string and how you verified it.
4. **One vendor per PR** where practical - keeps review fast.

After editing `catalog.ts`, run `npm run gen:catalog` to regenerate the readable [`CATALOG.md`](CATALOG.md) table and the machine-readable `catalog/catalog.json`. **Don't hand-edit those two** - they're generated from the `.ts`.

## Improve engine detection

Detection lives in [`src/lib/installerDetect.ts`](src/lib/installerDetect.ts) (byte signatures + PE/MSI parsing). If an installer is misidentified, a PR that adds/sharpens a signature - with a note on the marker bytes you keyed off - is very welcome. MSI table decoding is in [`src/lib/msi.ts`](src/lib/msi.ts).

## Always test in a throwaway VM

Silent switches are detected/curated best-effort. A wrong switch silently ships a broken package to every machine. **Validate any command in a disposable VM before you deploy it.** Catalog entries are community-contributed and provided as-is (see the MIT license's no-warranty clause).

## Dev setup

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # must pass before you open a PR
```

Then fork, branch, and open a PR. Thanks for making fleet deployment a little less painful. 
