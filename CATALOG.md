# SwitchHunt catalog

Hand-verified silent-install strings for apps whose switches you can't derive from the installer alone —
custom CLIs, mandatory keys, compressed payloads. `{file}` is replaced with the dropped installer name at
runtime. For well-known apps the catalog also carries the real uninstall command and a file-detection path.

**31 entries.** Generated from `src/lib/catalog.ts` — do not hand-edit; run `npm run gen:catalog`.

Got one we miss? [Submit it with the issue form](https://github.com/deadarcher/SwitchHunt/issues/new?template=silent-install-string.yml) (no coding needed) — or PR `src/lib/catalog.ts` ([CONTRIBUTING](CONTRIBUTING.md)).

| App | Silent install | Silent uninstall | Detection (file) | Notes |
|---|---|---|---|---|
| Citrix Workspace | `{file} /silent /noreboot` | `{file} /silent /uninstall` | — | Self-extracting; the switches live in the inner bootstrapper. Add /includeSSON for pass-through SSO, and ADDLOCAL="ReceiverInside,ICA_Client,USB,DesktopViewer,WebHelper" to pick components. |
| Microsoft Teams (classic machine-wide) | `msiexec /i "{file}" /qn ALLUSERS=1 OPTIONS="noAutoStart=true"` | — | — | The machine-wide MSI only PROVISIONS a per-user install at each logon. New Teams uses teamsbootstrapper.exe -p instead. |
| AnyDesk | `{file} --install "C:\Program Files (x86)\AnyDesk" --start-with-win --create-shortcuts --silent` | `"C:\Program Files (x86)\AnyDesk\AnyDesk.exe" --remove --silent` | — | Custom CLI (not MSI-style). --install REQUIRES the target folder as an argument. |
| Docker Desktop | `"{file}" install --quiet --accept-license` | `"{file}" uninstall --quiet` | — | Sub-command style (install/uninstall as a verb, not a slash flag). --accept-license is required for unattended. |
| Adobe Acrobat Reader | `{file} /sAll /rs /msi EULA_ACCEPT=YES` | — | — | /sAll silent, /rs suppress reboot, /msi forwards the rest to the inner MSI. EULA_ACCEPT=YES is mandatory. |
| CrowdStrike Falcon Sensor | `{file} /install /quiet /norestart CID=<your-CID>` | — | — | CID (customer ID + checksum) is REQUIRED — without it the sensor installs but never registers. |
| Python | `{file} /quiet InstallAllUsers=1 PrependPath=1` | — | — | Custom bootstrapper; properties are bare NAME=value (no slash). Add Include_test=0 to skip the test suite. |
| Visual Studio Code | `{file} /VERYSILENT /MERGETASKS=!runcode` | — | — | Inno Setup. /MERGETASKS=!runcode stops it launching after install; add addcontextmenufiles,addtopath for shell integration + PATH. |
| Git for Windows | `{file} /VERYSILENT /NORESTART` | — | — | Inno Setup. Use /LOADINF="config.inf" to preset components/options (record one with /SAVEINF). |
| Zoom | `msiexec /i "{file}" /qn ZoomAutoUpdate="true"` | — | — | Use the MSI (not the per-user exe) for fleet deploys; pass ZConfig/ZoomAutoUpdate properties for config. |
| Oracle VM VirtualBox | `{file} --silent --ignore-reboot` | — | — | Qt-based custom installer. --silent + --ignore-reboot; the network-driver install can still prompt unless the Oracle cert is pre-trusted in the cert store. |
| Wireshark | `{file} /S /desktopicon=yes` | — | — | NSIS. Bundles Npcap, which runs its own installer — add /quiet and let it through. |
| TeamViewer (Host) | `{file} /S` | — | — | Add APITOKEN=<token> CUSTOMCONFIGID=<id> ASSIGNMENTOPTIONS="..." to auto-assign the Host to your account. |
| GlobalProtect (Palo Alto VPN) | `msiexec /i "{file}" /qn PORTAL="vpn.company.com"` | — | — | PORTAL= preconfigures the gateway so users aren't prompted. |
| Microsoft 365 Apps / Office | `{file} /configure config.xml` | — | — | Office has NO plain silent switch — it installs via the Office Deployment Tool (setup.exe) driven by a config.xml. Author the XML at config.office.com (channel, bitness, apps, language), ship it next to setup.exe. "{file} /download config.xml" pre-stages the bits first. |
| Adobe Acrobat (Pro / Standard) | `{file} /sAll /rs /msi EULA_ACCEPT=YES` | — | — | Same flags as Reader (/sAll silent, /rs suppress reboot, /msi forwards to the inner MSI; EULA_ACCEPT=YES mandatory). Volume licensing comes from the package built in the Adobe Admin Console, not a command-line key. |
| Foxit PDF Editor | `msiexec /i "{file}" /qn /norestart KEYCODE=<your-volume-key>` | — | — | KEYCODE= (your volume license) is REQUIRED to activate — without it it installs as an unlicensed trial. Add MAKEDEFAULT=0 so it doesn't grab the PDF association. |
| Nitro PDF Pro | `msiexec /i "{file}" /qn /norestart SERIALNUMBER=<your-key>` | — | — | SERIALNUMBER= is REQUIRED to activate; without it you get trial mode. |
| TechSmith Snagit | `msiexec /i "{file}" /qn TSC_SOFTWARE_KEY=<your-key>` | — | — | TSC_SOFTWARE_KEY= the software key. TechSmith's Deployment Tool emits an .mst — apply it with TRANSFORMS="snagit.mst" to also kill auto-update + the welcome screen. |
| Webroot SecureAnywhere | `{file} /key=<your-keycode> /silent` | — | — | Tiny stub installer; /key= (your 20-char keycode) is REQUIRED to register the endpoint, /silent suppresses UI. Add /lockautouninstall=<password> to require a password to remove it. |
| RustDesk | `{file} --silent-install` | `{file} --uninstall` | — | Custom double-dash CLI (not MSI-style). --silent-install installs + registers the service. Drop a RustDesk2.toml beside the exe to preconfigure the relay/key. |
| ESET Endpoint Security | `msiexec /i "{file}" /qn /norestart` | — | — | Bare MSI installs the client but it won't be MANAGED — for unattended enrollment layer the ESET PROTECT config (a generated .mst / install_config.ini) via TRANSFORMS=. A reboot is usually required. |
| Google Chrome (Enterprise) | `msiexec /i "{file}" /qn /norestart` | — | — | Use the Enterprise MSI, not the consumer stub exe, for fleet deploys. |
| Mozilla Firefox | `{file} /S` | `"%ProgramFiles%\Mozilla Firefox\uninstall\helper.exe" /S` | `C:\Program Files\Mozilla Firefox\firefox.exe` | NSIS. Drop a policies.json / use the MSI for managed settings. |
| 7-Zip | `{file} /S` | `"%ProgramFiles%\7-Zip\Uninstall.exe" /S` | `C:\Program Files\7-Zip\7zFM.exe` |  |
| Notepad++ | `{file} /S /allusers` | `"%ProgramFiles%\Notepad++\uninstall.exe" /S` | `C:\Program Files\Notepad++\notepad++.exe` | NSIS. /allusers installs machine-wide (HKLM, Program Files); drop it for a per-user install. |
| VLC media player | `{file} /S` | `"%ProgramFiles%\VideoLAN\VLC\uninstall.exe" /S` | `C:\Program Files\VideoLAN\VLC\vlc.exe` |  |
| WinRAR | `{file} /S` | `"%ProgramFiles%\WinRAR\uninstall.exe" /S` | `C:\Program Files\WinRAR\WinRAR.exe` |  |
| OBS Studio | `{file} /S` | `"%ProgramFiles%\obs-studio\uninstall.exe" /S` | `C:\Program Files\obs-studio\bin\64bit\obs64.exe` | NSIS. |
| GIMP | `{file} /VERYSILENT /NORESTART` | — | — | Inno Setup. |
| Node.js | `msiexec /i "{file}" /qn /norestart` | — | — |  |
