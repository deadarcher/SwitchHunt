# SwitchHunt

**Drop a Windows installer in your browser → get its silent-install switches.** No upload, no signup, no agent. The file you drop is read **entirely in your browser** - it never touches a server.

**Use it now (hosted):** https://getrff.com/switchhunt

Works on ~85% of installers out of the box, plus a curated catalog for the painful vendor one-offs.

---

## What it does

Drop an `.exe` or `.msi` and SwitchHunt identifies the installer engine from its bytes, then hands you:

- **The full command set** - install / repair / uninstall / extract, not just a single silent flag - with the modifier switches for each.
- **CMD ⇄ PowerShell** toggle (rewrites `.\`, the `&` call operator, `$env:` paths) and an **interactive command builder** (operation, UI level, INSTALLDIR, properties).
- **Deep MSI analysis** - a from-scratch in-browser MS-CFB (compound-file) reader decodes the `Property`, `Control`, `LaunchCondition` and `CustomAction` tables to surface a tiered "**properties you probably need to set**" list (required / likely / sensitive / optional), a full property dump, and an **uninstall-replay** warning (MSI properties are transaction-scoped, so secrets set at install must be passed again at `/x`).
- **Package for deployment, client-side:**
  - a **PSAppDeployToolkit v4** wrapper (`Invoke-AppDeployToolkit.ps1`) with the right `Start-ADTMsiProcess` / `Start-ADTProcess` calls, plus DeployMode / suppress-reboot / Terminal-Server options;
  - a real **`.intunewin`** built in the browser (STORE zip + AES-256-CBC + HMAC-SHA256 + `Detection.xml`, exactly like `IntuneWinAppUtil.exe`) - uploadable straight to Intune, no toolchain to install.

### Engines detected

MSI · WiX Burn · Advanced Installer · Inno Setup · NSIS · InstallShield · InstallAware · BitRock InstallBuilder · Wise · MSIX/AppX · Squirrel · 7-Zip/WinRAR self-extractors - with a best-effort switch *harvest* for the packed/custom long tail.

### The catalog (the weird stuff)

Signature detection can't derive a custom CLI's flags (Citrix, Teams machine-wide, AnyDesk, Docker Desktop, CrowdStrike, GlobalProtect…). Those live in [`src/lib/catalog.ts`](src/lib/catalog.ts) as **hand-verified known strings**, clearly labeled in the UI as "from catalog, not read from your file." For well-known apps the catalog also carries the real **uninstall** command and a **detection** path (the install dir an EXE installer never records).

- **Browse the catalog:** [CATALOG.md](CATALOG.md) (readable table) - or the machine-readable [`catalog/catalog.json`](catalog/catalog.json).
- **Add one - no coding:** [open a submission issue](https://github.com/deadarcher/SwitchHunt/issues/new?template=silent-install-string.yml) (a quick form), or PR `src/lib/catalog.ts` ([CONTRIBUTING](CONTRIBUTING.md)).

This is where the project most needs help. `CATALOG.md` + `catalog/catalog.json` are generated from the `.ts` - run `npm run gen:catalog`, don't hand-edit them.

---

## Why client-side?

Feeding a community-sourced "install command" into a tool that runs it as SYSTEM across a fleet is a supply-chain attack surface. SwitchHunt deliberately **does not run anything** - it only reads bytes and looks up strings. Nothing is uploaded; you can pull your network cable and it still works. Open the devtools Network tab and watch: zero requests with your file.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/ - deploy anywhere
```

No backend. `dist/` is plain static files; host it on GitHub Pages, Cloudflare Pages, Netlify, or `npx serve dist`.

### Docker

No Node install needed - the image builds the site and serves it with nginx:

```bash
docker compose up -d --build   # http://localhost:4321
```

Or without compose:

```bash
docker build -t switchhunt .
docker run -d --name switchhunt -p 4321:80 switchhunt
```

Same 100% client-side guarantee - the container only serves static files; installers you drop still never leave your browser.

Thanks to [timwelchnz](https://www.reddit.com/user/timwelchnz/) for suggesting this install option.

## How it works (short version)

- **Engine detection** (`src/lib/installerDetect.ts`): byte signatures + PE version-resource parsing for metadata. `.NET` requires the `_CorExeMain` stub (not just an `mscoree.dll` string) to avoid false positives, etc.
- **MSI parsing** (`src/lib/msi.ts`): a hand-rolled MS-CFB reader (the `cfb` npm package chokes on the 4096-byte-sector MSIs large enterprise packages use) that decodes the table streams.
- **Packaging** (`src/lib/psadt.ts`, `src/lib/intunewin.ts`): pure string-templating + WebCrypto. No native deps.

## License

MIT - see [LICENSE](LICENSE).

Built by [RFF](https://getrff.com) - Really Freakin' Fast Windows endpoint deployment.
