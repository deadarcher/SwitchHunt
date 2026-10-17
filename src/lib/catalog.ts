/**
 * Curated catalog of KNOWN, hand-verified silent-install strings for popular apps - with a bias
 * toward the WEIRD ones (custom CLIs, mandatory properties, gotchas) that signature detection can't
 * derive. This is the fallback for the custom/compressed long tail (Citrix, AnyDesk, Docker, …) and
 * a confirmation for the common ones.
 *
 * IMPORTANT: every entry here is HARD-CODED, not read from the user's file - the UI labels it as such.
 * `{file}` in a command is replaced with the dropped file's name at render time. Sources: vendor docs
 * + silentinstallhq + verified switch output (e.g. Citrix's own /? ). Starter set; extend freely.
 */
export interface CatalogEntry {
  name: string;
  match: { product?: RegExp; file?: RegExp };
  install: string;
  uninstall?: string;
  /** Known file path that proves the app is installed - used as the Intune File detection rule for EXE
   *  apps whose real install path we can't read from the installer (NSIS/Inno decide it at install time). */
  detect?: string;
  /** Why it's non-obvious - the gotcha worth surfacing. */
  note?: string;
  /**
   * Named properties worth passing, in STRUCTURED form so the UI can act on them.
   *
   * The engine already reads every public property out of an MSI - the problem is that a real MSI
   * declares 100+ of them and the tiering heuristic (MsiHiddenProperties / wizard Edit controls /
   * SecureCustomProperties) only promotes the ones the AUTHOR flagged. A property like
   * REGISTER_ALL_MSO_TYPES is none of those, so it falls into the collapsed "All N properties" dump
   * where nobody finds it.
   *
   * That is the one job the parser genuinely cannot do: knowing WHICH of the 100 matter. A human
   * verified these, so the UI promotes them and offers them as one-click chips into the builder.
   * Prose in `note` cannot be clicked; this can.
   */
  properties?: CatalogProperty[];
  /**
   * Lab evidence, copied from a recorded SwitchHunt harness run - never set by hand. The install
   * command above was run AS SYSTEM (how every deployment tool runs it) on a Windows 11 VM against
   * the named installer version, and the app appeared in Add/Remove Programs for a real user - exit
   * 0 alone is never accepted. `uninstall: true` means the documented uninstall then removed it.
   */
  verified?: { on: string; version: string; uninstall?: boolean };
}

export interface CatalogProperty {
  /** Public (all-uppercase) property name, exactly as passed on the command line. */
  name: string;
  /** The value that does the useful thing. Empty when the admin must supply it (a licence key). */
  value?: string;
  /** Plain-English effect. Shown next to the chip so the choice is obvious without vendor docs. */
  why: string;
}

export const CATALOG: CatalogEntry[] = [
  // ── the weird ones ──
  {
    name: 'Citrix Workspace',
    match: { product: /citrix (workspace|receiver)/i, file: /citrix.?workspace|citrixreceiver/i },
    install: '{file} /silent /noreboot',
    uninstall: '{file} /silent /uninstall',
    note: 'Self-extracting; the switches live in the inner bootstrapper. Add /includeSSON for pass-through SSO, and ADDLOCAL="ReceiverInside,ICA_Client,USB,DesktopViewer,WebHelper" to pick components.',
  },
  // BEFORE the classic entry: the bootstrapper's ProductName is "Microsoft Teams Direct Installer", which the
  // classic entry's /microsoft teams/ would otherwise claim (first match wins). Lab-tested 2026-10-16, see Batch 4.
  {
    name: 'Microsoft Teams (new, machine-wide)',
    match: { product: /teams direct installer|teamsbootstrapper/i, file: /teamsbootstrapper/i },
    install: '{file} -p -o "C:\\path\\to\\MSTeams-x64.msix"',
    uninstall: '{file} -x',
    verified: { on: '2026-10-16', version: '26260.1717.5229.7049', uninstall: true },
    note: 'Not an MSI and not in Add/Remove Programs: -p PROVISIONS the Teams MSIX for every user on the machine (check with Get-AppxProvisionedPackage -Online, DisplayName MSTeams). Plain -p downloads the MSIX from Microsoft at install time; -o points it at a local MSTeams-x64.msix instead, which is what you want for a deployment tool or a machine without open internet. -x removes the provisioned package. Windows 11 often already has MSTeams provisioned; the bootstrapper replaces it.',
  },
  {
    name: 'Microsoft Teams (classic machine-wide)',
    match: { product: /teams machine-wide|microsoft teams/i, file: /Teams_windows|teams.*x64\.msi/i },
    install: 'msiexec /i "{file}" /qn ALLUSERS=1 OPTIONS="noAutoStart=true"',
    note: 'The machine-wide MSI only PROVISIONS a per-user install at each logon. New Teams uses teamsbootstrapper.exe -p instead.',
  },
  {
    name: 'AnyDesk',
    match: { product: /anydesk/i, file: /anydesk/i },
    install: '{file} --install "C:\\Program Files (x86)\\AnyDesk" --start-with-win --create-shortcuts --silent',
    uninstall: '"C:\\Program Files (x86)\\AnyDesk\\AnyDesk.exe" --remove --silent',
    note: 'Custom CLI (not MSI-style). --install REQUIRES the target folder as an argument.',
  },
  {
    name: 'Docker Desktop',
    match: { product: /docker desktop/i, file: /Docker Desktop Installer/i },
    install: '"{file}" install --quiet --accept-license',
    uninstall: '"{file}" uninstall --quiet',
    note: 'Sub-command style (install/uninstall as a verb, not a slash flag). --accept-license is required for unattended.',
  },
  {
    name: 'Adobe Acrobat Reader',
    match: { product: /adobe acrobat reader/i, file: /AcroRdr|Reader.*DC|AcroRead/i },
    install: '{file} /sAll /rs /msi EULA_ACCEPT=YES',
    note: '/sAll silent, /rs suppress reboot, /msi forwards the rest to the inner MSI. EULA_ACCEPT=YES is mandatory.',
  },
  {
    name: 'CrowdStrike Falcon Sensor',
    match: { product: /crowdstrike|falcon sensor/i, file: /WindowsSensor|FalconSensor/i },
    install: '{file} /install /quiet /norestart CID=<your-CID>',
    note: 'CID (customer ID + checksum) is REQUIRED - without it the sensor installs but never registers.',
  },
  {
    name: 'Python',
    match: { product: /^python \d/i, file: /python-3\.\d/i },
    install: '{file} /quiet InstallAllUsers=1 PrependPath=1',
    verified: { on: '2026-07-29', version: '3.12.10' },
    note: 'Custom bootstrapper; properties are bare NAME=value (no slash). Add Include_test=0 to skip the test suite.',
  },
  {
    name: 'Visual Studio Code',
    // file regex was /VSCode.*Setup/ until 2026-10-12, which also matched VSCodeUserSetup - the per-user
    // build that, run as SYSTEM, installs into SYSTEM's own profile (PHANTOM in the 2026-07-29 lab run).
    match: { product: /visual studio code/i, file: /VSCodeSetup/i },
    install: '{file} /VERYSILENT /MERGETASKS=!runcode',
    uninstall: '"%ProgramFiles%\\Microsoft VS Code\\unins000.exe" /VERYSILENT',
    verified: { on: '2026-10-12', version: '1.141.0', uninstall: true },
    note: 'Use the SYSTEM installer (VSCodeSetup-x64-*.exe). The download page and winget default to the USER installer (VSCodeUserSetup-*), which run as SYSTEM installs into SYSTEM\'s own profile - exit 0, and no real user ever sees it. Inno Setup: /MERGETASKS=!runcode stops it launching after install; add addcontextmenufiles,addtopath for shell integration + PATH.',
  },
  {
    name: 'Git for Windows',
    match: { product: /^git\b/i, file: /Git-\d.*64-bit/i },
    install: '{file} /VERYSILENT /NORESTART',
    verified: { on: '2026-07-29', version: '2.55.0.3' },
    note: 'Inno Setup. Use /LOADINF="config.inf" to preset components/options (record one with /SAVEINF).',
  },
  {
    name: 'Zoom',
    match: { product: /^zoom/i, file: /Zoom.*\.msi|ZoomInstallerFull/i },
    install: 'msiexec /i "{file}" /qn ZoomAutoUpdate="true"',
    note: 'Use the MSI (not the per-user exe) for fleet deploys; pass ZConfig/ZoomAutoUpdate properties for config.',
  },
  {
    name: 'Oracle VM VirtualBox',
    match: { product: /virtualbox/i, file: /VirtualBox.*Win/i },
    install: '{file} --silent --ignore-reboot',
    note: 'Qt-based custom installer. --silent + --ignore-reboot; the network-driver install can still prompt unless the Oracle cert is pre-trusted in the cert store.',
  },
  {
    name: 'Wireshark',
    match: { product: /wireshark/i, file: /Wireshark.*win/i },
    install: '{file} /S /desktopicon=yes',
    note: 'NSIS. Bundles Npcap, which runs its own installer - add /quiet and let it through.',
  },
  {
    name: 'TeamViewer (Host)',
    match: { product: /teamviewer/i, file: /TeamViewer.*Setup|TeamViewer_Host/i },
    install: '{file} /S',
    note: 'Add APITOKEN=<token> CUSTOMCONFIGID=<id> ASSIGNMENTOPTIONS="..." to auto-assign the Host to your account.',
  },
  {
    name: 'GlobalProtect (Palo Alto VPN)',
    match: { product: /globalprotect/i, file: /GlobalProtect/i },
    install: 'msiexec /i "{file}" /qn PORTAL="vpn.company.com"',
    note: 'PORTAL= preconfigures the gateway so users aren\'t prompted.',
  },

  // ── more vendor one-offs (mandatory keys / odd CLIs), curated from the RFF package library ──
  {
    name: 'Microsoft 365 Apps / Office',
    match: { product: /microsoft 365|office 365|microsoft office/i, file: /OfficeSetup|OfficeDeploymentTool/i },
    install: '{file} /configure config.xml',
    note: 'Office has NO plain silent switch - it installs via the Office Deployment Tool (setup.exe) driven by a config.xml. Author the XML at config.office.com (channel, bitness, apps, language), ship it next to setup.exe. "{file} /download config.xml" pre-stages the bits first.',
  },
  {
    name: 'Adobe Acrobat (Pro / Standard)',
    match: { product: /adobe acrobat(?! reader)|acrobat pro|acrobat dc/i, file: /Acrobat(?!.*Reader)|AcroPro/i },
    install: '{file} /sAll /rs /msi EULA_ACCEPT=YES',
    note: 'Same flags as Reader (/sAll silent, /rs suppress reboot, /msi forwards to the inner MSI; EULA_ACCEPT=YES mandatory). Volume licensing comes from the package built in the Adobe Admin Console, not a command-line key.',
  },
  {
    name: 'Foxit PDF Editor',
    match: { product: /foxit/i, file: /Foxit.*(Setup|Editor)|FoxitPDFEditor/i },
    install: 'msiexec /i "{file}" /qn /norestart KEYCODE=<your-volume-key>',
    note: 'KEYCODE= (your volume license) is REQUIRED to activate - without it it installs as an unlicensed trial. Add MAKEDEFAULT=0 so it doesn\'t grab the PDF association.',
  },
  {
    name: 'Nitro PDF Pro',
    match: { product: /nitro (pdf )?pro|nitro pdf/i, file: /Nitro.*(Pro|PDF)/i },
    install: 'msiexec /i "{file}" /qn /norestart SERIALNUMBER=<your-key>',
    note: 'SERIALNUMBER= is REQUIRED to activate; without it you get trial mode.',
  },
  {
    name: 'TechSmith Snagit',
    match: { product: /snagit/i, file: /snagit/i },
    install: 'msiexec /i "{file}" /qn TSC_SOFTWARE_KEY=<your-key>',
    note: 'TSC_SOFTWARE_KEY= the software key. TechSmith\'s Deployment Tool emits an .mst - apply it with TRANSFORMS="snagit.mst" to also kill auto-update + the welcome screen.',
  },
  {
    name: 'Webroot SecureAnywhere',
    match: { product: /webroot/i, file: /wsainstall|webroot/i },
    install: '{file} /key=<your-keycode> /silent',
    note: 'Tiny stub installer; /key= (your 20-char keycode) is REQUIRED to register the endpoint, /silent suppresses UI. Add /lockautouninstall=<password> to require a password to remove it.',
  },
  {
    name: 'RustDesk',
    match: { product: /rustdesk/i, file: /rustdesk/i },
    install: '{file} --silent-install',
    uninstall: '{file} --uninstall',
    note: 'Custom double-dash CLI (not MSI-style). --silent-install installs + registers the service. Drop a RustDesk2.toml beside the exe to preconfigure the relay/key.',
  },
  {
    name: 'ESET Endpoint Security',
    // Word-bounded since 2026-10-12. Was /eset/ on both, which matched the "eSet" in "...eSetup.exe"
    // (GoogleDriveSetup, TreeSizeFreeSetup, ChromeSetup, OneDriveSetup...) and "Reset" in product names,
    // handing ESET's switches to unrelated installers.
    match: { product: /\beset\b/i, file: /^(ees|eea)_|\beset[_ .-]/i },
    install: 'msiexec /i "{file}" /qn /norestart',
    note: 'Bare MSI installs the client but it won\'t be MANAGED - for unattended enrollment layer the ESET PROTECT config (a generated .mst / install_config.ini) via TRANSFORMS=. A reboot is usually required.',
  },

  // ── the common ones (confirmation) ──
  {
    name: 'Google Chrome (Enterprise)',
    match: { product: /^google chrome$/i, file: /googlechrome.*enterprise|chrome.*enterprise/i },
    install: 'msiexec /i "{file}" /qn /norestart',
    note: 'Use the Enterprise MSI, not the consumer stub exe, for fleet deploys.',
  },
  { name: 'Mozilla Firefox', match: { product: /mozilla firefox/i, file: /Firefox.*Setup/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\Mozilla Firefox\\uninstall\\helper.exe" /S', detect: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', verified: { on: '2026-07-29', version: '153.0.1', uninstall: true }, note: 'NSIS. Drop a policies.json / use the MSI for managed settings.' },
  { name: '7-Zip', match: { product: /^7-zip/i, file: /7z\d.*\.exe/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\7-Zip\\Uninstall.exe" /S', detect: 'C:\\Program Files\\7-Zip\\7zFM.exe' },
  { name: 'Notepad++', match: { product: /notepad\+\+/i, file: /npp\..*Installer/i }, install: '{file} /S /allusers', uninstall: '"%ProgramFiles%\\Notepad++\\uninstall.exe" /S', detect: 'C:\\Program Files\\Notepad++\\notepad++.exe', note: 'NSIS. /allusers installs machine-wide (HKLM, Program Files); drop it for a per-user install.' },
  { name: 'VLC media player', match: { product: /vlc media player/i, file: /vlc-.*win/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\VideoLAN\\VLC\\uninstall.exe" /S', detect: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe' },
  { name: 'WinRAR', match: { product: /^winrar/i, file: /winrar|wrar\d/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\WinRAR\\uninstall.exe" /S', detect: 'C:\\Program Files\\WinRAR\\WinRAR.exe', verified: { on: '2026-07-29', version: '7.23', uninstall: true } },
  { name: 'OBS Studio', match: { product: /obs studio/i, file: /OBS-Studio|obs-studio/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\obs-studio\\uninstall.exe" /S', detect: 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe', verified: { on: '2026-07-29', version: '32.1.2', uninstall: true }, note: 'NSIS.' },
  { name: 'GIMP', match: { product: /^gimp/i, file: /gimp.*setup/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS', verified: { on: '2026-07-29', version: '3.2.4' }, note: 'Inno Setup, and /VERYSILENT alone is NOT enough. Like Greenshot, GIMP shows the Inno "Select Setup Install Mode" dialog, presented BEFORE the silent machinery engages - no /SILENT flag suppresses it. Without /ALLUSERS it hangs forever under a deployment tool (session 0 has nobody to click it). Verified installing machine-wide with these switches. It is also SLOW - roughly 9 minutes for the ~300 MB payload - so raise your deployment timeout above the usual 5-minute default or the job is killed mid-install.' },
  { name: 'Node.js', match: { product: /node\.js/i, file: /node-v.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', verified: { on: '2026-07-29', version: '24.18.0' } },

  // ── Added 2026-07-26. Every command below was confirmed against TWO independent sources
  // (vendor/upstream documentation + the offlineinstallersetup silent-install cheatsheet) before
  // being published. Deliberately NOT added despite being requested: Slack — its official docs now
  // document MSIX (Add-AppxPackage) only, and the widely-copied "msiexec /i slack-standalone.msi
  // /qn" line no longer matches what Slack ships. Publishing a stale switch on a page whose whole
  // value is "this one is correct" would be worse than omitting the app.
  { name: 'FileZilla', match: { product: /filezilla/i, file: /filezilla.*setup/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\FileZilla FTP Client\\uninstall.exe" /S', note: 'NSIS. /S suppresses the wizard; the bundled-offer screens are skipped by the official silent setup.' },
  { name: 'PuTTY', match: { product: /^putty/i, file: /putty.*installer\.msi/i }, install: 'msiexec /i "{file}" /quiet /norestart', uninstall: 'msiexec /x "{file}" /quiet /norestart', note: 'MSI (the .exe on the download page is the program itself, not an installer - grab the 64-bit MSI).' },
  { name: 'Audacity', match: { product: /audacity/i, file: /audacity-win/i }, install: '{file} /VERYSILENT /NORESTART', verified: { on: '2026-07-29', version: '3.7.8' }, note: 'Inno Setup.' },
  { name: 'Postman', match: { product: /postman/i, file: /postman.*\.msi/i }, install: 'msiexec /i "{file}" /qn', note: 'Enterprise MSI only (the consumer build is a per-user .exe). INSTALLDIR sets a custom path.' },

  // Batch 2, 2026-07-26. Same two-source rule.
  // Foxit PDF READER is a different product from the Foxit PDF EDITOR entry above - reader is free,
  // editor is licensed, and they ship separate installers. Command from Foxit's own "PDF Reader
  // Deployment and Configuration" PDF, corroborated by ManageEngine's package definition.
  { name: 'Foxit PDF Reader', match: { product: /foxit (pdf )?reader/i, file: /foxit.*reader.*\.msi/i }, install: 'msiexec /i "{file}" /quiet', uninstall: 'msiexec /x "{file}" /quiet CLEAN="1"', note: 'Vendor docs use /quiet. CLEAN="1" on uninstall also removes registry + user data. ADDLOCAL="FX_PDFVIEWER" installs the viewer only.' },
  { name: 'Sumatra PDF', match: { product: /sumatra/i, file: /sumatra/i }, install: '{file} -install -all-users -d "C:\\Program Files\\SumatraPDF" -s', uninstall: '{file} -uninstall -s', verified: { on: '2026-10-12', version: '3.6.1', uninstall: true }, note: 'Custom installer - NOT an MSI and NOT NSIS, so /S and /qn both do nothing. The documented "-install -s" is a PER-USER install (into %LocalAppData%) - under a deployment tool that means the SYSTEM profile, and no real user ever sees it. Even -all-users alone, run as SYSTEM, still put the program in SYSTEM\'s profile in our lab (3.6.1); pinning the folder with -d is what made it machine-wide. Add -no-desktop-shortcut on 3.7+.' },
  { name: 'Greenshot', match: { product: /greenshot/i, file: /greenshot.*installer/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS', detect: 'C:\\Program Files\\Greenshot\\Greenshot.exe', verified: { on: '2026-07-29', version: '1.3.315' }, note: 'Inno Setup, and /VERYSILENT alone is NOT enough. The installer shows a "Select Setup Install Mode" dialog that no /SILENT flag suppresses - without /ALLUSERS it hangs forever under a deployment tool (session 0 has nobody to click it). Also: the silent install OPENS THE GREENSHOT WEBSITE in a browser when it finishes and there is no switch to stop it, confirmed by the maintainers. Add /MERGETASKS="!startup" to skip the run-at-startup entry. No uninstall string is published: the vendor-registered unins000.exe /SILENT hung indefinitely as SYSTEM in testing, and a hanging uninstall is worse than none.' },
  { name: 'LibreOffice', match: { product: /libreoffice/i, file: /libreoffice.*\.msi/i }, install: 'msiexec /i "{file}" /quiet /norestart', verified: { on: '2026-07-29', version: '26.2.4.2' }, note: 'Standard MSI. Add REGISTER_ALL_MSO_TYPES=1 to take over Office file associations, or REGISTER_NO_MSO_TYPES=1 to leave them alone.',
    properties: [
      { name: 'REGISTER_ALL_MSO_TYPES', value: '1', why: 'Take over .docx/.xlsx/.pptx associations from Office.' },
      { name: 'REGISTER_NO_MSO_TYPES',  value: '1', why: 'Leave Office file associations alone.' },
    ] },
  // Batch 3, 2026-10-12. Same two-source rule, PLUS every entry below was LAB-TESTED before publishing:
  // the exact install string run AS SYSTEM on a Windows 11 VM (HYD-CLIENT1) via the SwitchHunt harness,
  // judged by Add/Remove Programs (never exit code), and by the install landing outside any service
  // profile; then the exact uninstall string, judged the same way. Detect paths are only included where
  // the file was confirmed present on the VM. Installer variant pinned per entry (several vendors ship a
  // per-user build that winget prefers - see each note). Raw results: scratch harness run, not in repo.
  { name: 'PowerShell 7', match: { product: /^powershell 7/i, file: /PowerShell-7.*-win-x64\.msi/i }, install: 'msiexec /i "{file}" /qn ADD_PATH=1 REGISTER_MANIFEST=1 USE_MU=1 ENABLE_MU=1', uninstall: 'msiexec /x "{file}" /qn', detect: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', verified: { on: '2026-10-12', version: '7.6.6', uninstall: true }, note: 'Use the MSI, not winget\'s default: since 7.6 winget installs the per-user MSIX, which has no remoting endpoint and no $PSHOME config. Microsoft has said there is no MSI from 7.7 onward, so pin to the 7.6 LTS MSI for machine-wide deploys. Every 7.x installs into ...\\PowerShell\\7, so a newer MSI replaces the old one in place.',
    properties: [
      { name: 'ADD_PATH', value: '1', why: 'Put pwsh on the system PATH.' },
      { name: 'ENABLE_PSREMOTING', value: '1', why: 'Enable PowerShell remoting (WinRM endpoint) during install.' },
      { name: 'ADD_EXPLORER_CONTEXT_MENU_OPENPOWERSHELL', value: '1', why: 'Add "Open PowerShell 7 here" to folder right-click.' },
      { name: 'DISABLE_TELEMETRY', value: '1', why: 'Set POWERSHELL_TELEMETRY_OPTOUT machine-wide.' },
      { name: 'USE_MU', value: '1', why: 'Let Microsoft Update / WSUS deliver PowerShell updates.' },
    ] },
  { name: 'Eclipse Temurin JDK', match: { product: /eclipse temurin|adoptium/i, file: /OpenJDK\d+U-jdk_x64_windows_hotspot.*\.msi/i }, install: 'msiexec /i "{file}" /qn ADDLOCAL=FeatureMain,FeatureEnvironment,FeatureJarFileRunWith,FeatureJavaHome', uninstall: 'msiexec /x "{file}" /qn', verified: { on: '2026-10-12', version: '21.0.12.1+1', uninstall: true }, note: 'JAVA_HOME is NOT set by default - FeatureJavaHome has to be in ADDLOCAL. Listing ADDLOCAL replaces the defaults, so keep FeatureMain in it. Skip ADDLOCAL=ALL (what winget uses): it adds FeatureOracleJavaSoft, which rewrites the HKLM JavaSoft keys and can hijack an existing Oracle Java. The install folder carries the build number (jdk-21.0.12.101-hotspot for 21.0.12.1+1), so detect on a fixed INSTALLDIR rather than the default path.',
    properties: [
      { name: 'INSTALLDIR', value: 'C:\\Program Files\\Temurin\\jdk21\\', why: 'Fixed install path, so detection survives patch updates.' },
      { name: 'ADDLOCAL', value: 'FeatureMain,FeatureEnvironment,FeatureJarFileRunWith,FeatureJavaHome', why: 'JDK + PATH + .jar association + JAVA_HOME.' },
    ] },
  { name: 'KeePassXC', match: { product: /keepassxc/i, file: /KeePassXC-.*-Win64\.msi/i }, install: 'msiexec /i "{file}" /qn LAUNCHAPPONEXIT=0 AUTOSTARTPROGRAM=0', uninstall: 'msiexec /x "{file}" /qn', detect: 'C:\\Program Files\\KeePassXC\\KeePassXC.exe', verified: { on: '2026-10-12', version: '2.7.12', uninstall: true }, note: 'Two properties default ON: LAUNCHAPPONEXIT starts the app when the install finishes, and AUTOSTARTPROGRAM adds a run-at-logon entry for every user. Set both to 0 for a quiet fleet deploy. Needs the VC++ 2015-2022 x64 runtime.',
    properties: [
      { name: 'LAUNCHAPPONEXIT', value: '0', why: 'Don\'t launch KeePassXC when the install finishes (default on).' },
      { name: 'AUTOSTARTPROGRAM', value: '0', why: 'Don\'t start it at every user logon (default on).' },
      { name: 'INSTALLDESKTOPSHORTCUT', value: '1', why: 'Add a desktop shortcut (default off).' },
    ] },
  { name: 'Microsoft PowerToys (machine-wide)', match: { product: /powertoys/i, file: /PowerToysSetup-.*x64\.exe/i }, install: '{file} /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', detect: 'C:\\Program Files\\PowerToys\\PowerToys.exe', verified: { on: '2026-10-12', version: '0.101.2362.0', uninstall: true }, note: 'Two installers: PowerToysSetup-*.exe is machine-wide, PowerToysUserSetup-*.exe is per-user - and winget picks the per-user one unless you pass --scope machine. WiX Burn bundle, so the uninstall needs the SAME version\'s bundle (Burn also caches it under C:\\ProgramData\\Package Cache). Don\'t mix the per-user and machine installs on one PC. It installs the WebView2 runtime if missing and then self-updates.' },
  { name: 'Google Drive for desktop', match: { product: /google drive/i, file: /GoogleDriveSetup/i }, install: '{file} --silent --skip_launch_new --gsuite_shortcuts=false', verified: { on: '2026-10-12', version: '132.0.0.0' }, note: 'Machine-wide (Program Files\\Google\\Drive File Stream) and installs a virtual-drive filesystem driver. Without --skip_launch_new it launches straight after install; --gsuite_shortcuts=false skips the Docs/Sheets/Slides Start-menu shortcuts. No stable uninstall string: the uninstaller sits in a versioned folder (Drive File Stream\\<version>\\uninstall.exe --silent --force_stop), so read it from the ARP entry at uninstall time. Grab the evergreen GoogleDriveSetup.exe from dl.google.com rather than a versioned URL.' },
  { name: 'WireGuard', match: { product: /^wireguard/i, file: /wireguard-amd64.*\.msi/i }, install: 'msiexec /i "{file}" /qn DO_NOT_LAUNCH=1', uninstall: 'msiexec /x "{file}" /qn', detect: 'C:\\Program Files\\WireGuard\\wireguard.exe', verified: { on: '2026-10-12', version: '1.1.1', uninstall: true }, note: 'The client UI launches after install unless DO_NOT_LAUNCH=1. Installs the WireGuardNT network driver. Tunnels are added afterwards, e.g. wireguard.exe /installtunnelservice C:\\path\\wg0.conf. Only Administrators can drive the UI unless you enable the LimitedOperatorUI policy for Network Configuration Operators.',
    properties: [
      { name: 'DO_NOT_LAUNCH', value: '1', why: 'Don\'t open the WireGuard UI when the install finishes.' },
    ] },
  { name: 'Tailscale', match: { product: /^tailscale/i, file: /tailscale-setup-.*-amd64\.msi/i }, install: 'msiexec /i "{file}" /qn TS_NOLAUNCH=true', uninstall: 'msiexec /x "{file}" /qn', detect: 'C:\\Program Files\\Tailscale\\tailscaled.exe', verified: { on: '2026-10-12', version: '1.104.1', uninstall: true }, note: 'The GUI launches after install unless TS_NOLAUNCH has any value. There is NO auth-key MSI property - despite what some guides say, the device still has to join your tailnet afterwards, e.g. tailscale up --auth-key=<key>. Set TS_UNATTENDEDMODE=always so the tunnel stays up with nobody logged on.',
    properties: [
      { name: 'TS_UNATTENDEDMODE', value: 'always', why: 'Keep the tunnel running when no user is logged on.' },
      { name: 'TS_INSTALLUPDATES', value: 'always', why: 'Let Tailscale install its own updates.' },
      { name: 'TS_LOGINURL', value: '', why: 'Your own coordination server (e.g. Headscale) instead of tailscale.com.' },
      { name: 'TS_ALLOWINCOMINGCONNECTIONS', value: 'never', why: 'Block incoming connections to this device.' },
    ] },
  { name: 'KeePass Password Safe', match: { product: /^keepass( password safe)?\b(?!xc)/i, file: /KeePass-2\..*\.msi/i }, install: 'msiexec /i "{file}" /qn', uninstall: 'msiexec /x "{file}" /qn', verified: { on: '2026-10-12', version: '2.61.1', uninstall: true }, note: 'Use the MSI for fleet deploys (the Setup.exe alternative is Inno Setup: {file} /VERYSILENT /ALLUSERS). Options go through one property, KPS_OPTIONS - a comma list where a leading ! turns an option off. Downloads come via SourceForge, which serves an HTML page instead of the file to some scripted downloaders - check you actually got a ~3 MB MSI before you package it.',
    properties: [
      { name: 'KPS_OPTIONS', value: '!DesktopIcon,!PreLoad', why: 'No desktop icon, no preload at logon (options: StartMenuIcons, DesktopIcon, NGen, PreLoad).' },
    ] },
  { name: 'WinSCP', match: { product: /^winscp/i, file: /WinSCP-.*-Setup\.exe/i }, install: '{file} /VERYSILENT /ALLUSERS /NORESTART', uninstall: '"%ProgramFiles(x86)%\\WinSCP\\unins000.exe" /VERYSILENT /NORESTART', verified: { on: '2026-10-12', version: '6.5.7', uninstall: true }, note: 'Inno Setup. /ALLUSERS matters: winget\'s default is a per-user install into %LocalAppData%. Machine-wide it lands in Program Files (x86)\\WinSCP even on 64-bit Windows - the uninstall path above is the one we saw. The silent uninstall keeps saved sessions and settings. A WinSCP-*.msi also exists for msiexec /qn shops.' },
  { name: 'Cisco Webex', match: { product: /^webex/i, file: /^Webex\.msi$/i }, install: 'msiexec /i "{file}" /qn ACCEPT_EULA=TRUE ALLUSERS=1', uninstall: 'msiexec /x "{file}" /qn', verified: { on: '2026-10-12', version: '46.9 (Webex.msi)', uninstall: true }, note: 'ACCEPT_EULA=TRUE spares every user the licence prompt, and ALLUSERS=1 is what makes it machine-wide (into Program Files\\Cisco Spark) - without it the MSI installs per-user. Webex starts with Windows by default; AUTOSTART_WITH_WINDOWS=false turns that off (and locks the user\'s toggle). The file is always named Webex.msi, so keep track of the version separately.',
    properties: [
      { name: 'ACCEPT_EULA', value: 'TRUE', why: 'Accept the EULA on behalf of users (no prompt at first launch).' },
      { name: 'ALLUSERS', value: '1', why: 'Machine-wide install; without it the MSI goes per-user.' },
      { name: 'AUTOSTART_WITH_WINDOWS', value: 'false', why: 'Don\'t start Webex at logon (default true).' },
      { name: 'ENABLEOUTLOOKINTEGRATION', value: '0', why: 'Turn off Outlook presence integration.' },
    ] },
  { name: 'Microsoft Power BI Desktop', match: { product: /power ?bi desktop/i, file: /PBIDesktopSetup.*x64\.exe/i }, install: '{file} -quiet -norestart ACCEPT_EULA=1', uninstall: '{file} -uninstall -quiet -norestart', detect: 'C:\\Program Files\\Microsoft Power BI Desktop\\bin\\PBIDesktop.exe', verified: { on: '2026-10-12', version: '2026-09', uninstall: true }, note: 'ACCEPT_EULA=1 is mandatory - without it an unattended install fails. WiX Burn bundle: it registers two ARP entries (the bundle and its MSI), and the uninstall needs the same month\'s bundle (Burn also caches it under C:\\ProgramData\\Package Cache). Slow: ~11 minutes in our lab, so raise a 5-minute deployment timeout. Can\'t coexist with the Microsoft Store version. New release every month.',
    properties: [
      { name: 'ACCEPT_EULA', value: '1', why: 'Accept the licence - required for a silent install.' },
      { name: 'DISABLE_UPDATE_NOTIFICATION', value: '1', why: 'Stop the monthly "update available" nag.' },
      { name: 'ENABLECXP', value: '0', why: 'Opt out of the customer experience (usage data) program.' },
      { name: 'INSTALLDESKTOPSHORTCUT', value: '0', why: 'No desktop shortcut.' },
    ] },
  { name: 'Miniconda', match: { product: /^miniconda/i, file: /Miniconda3-.*-Windows-x86_64\.exe/i }, install: '{file} /InstallationType=AllUsers /RegisterPython=1 /S /D=C:\\ProgramData\\miniconda3', uninstall: '"C:\\ProgramData\\miniconda3\\Uninstall-Miniconda3.exe" /S', detect: 'C:\\ProgramData\\miniconda3\\python.exe', verified: { on: '2026-10-12', version: 'py314_26.7.1-1', uninstall: true }, note: 'NSIS with case-sensitive switches. /D= must be LAST and UNQUOTED (even with spaces) - put it anywhere else and it is ignored. The default is /InstallationType=JustMe, the per-user trap. /AddToPath is ignored for AllUsers installs (disabled for security since 4.12), so add the PATH entry yourself if you need it. Licensing: Anaconda\'s default channels need a paid licence for organisations of 200+ people - point conda at conda-forge if that applies.' },
  { name: 'Mozilla Thunderbird', match: { product: /thunderbird/i, file: /Thunderbird.*Setup/i }, install: '"{file}" /S /PreventRebootRequired=true', uninstall: '"%ProgramFiles%\\Mozilla Thunderbird\\uninstall\\helper.exe" /S', detect: 'C:\\Program Files\\Mozilla Thunderbird\\thunderbird.exe', verified: { on: '2026-10-12', version: '157.0.1', uninstall: true }, note: 'NSIS, same installer framework as Firefox. Quote the file - the vendor names it "Thunderbird Setup <version>.exe", with spaces. It also installs the Mozilla Maintenance Service (pass /MaintenanceService=false to skip it); the uninstall above removed both in our lab. Other switches: /DesktopShortcut=false, /TaskbarShortcut=false, /InstallDirectoryPath=<path>.' },
  { name: 'WinMerge', match: { product: /^winmerge/i, file: /WinMerge-.*-x64-Setup\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-', uninstall: '"%ProgramFiles%\\WinMerge\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', detect: 'C:\\Program Files\\WinMerge\\WinMergeU.exe', verified: { on: '2026-10-12', version: '2.16.58.2', uninstall: true }, note: 'Two installer files: WinMerge-<ver>-x64-Setup.exe is machine-wide, WinMerge-<ver>-x64-PerUser-Setup.exe installs into %LocalAppData% - and winget defaults to the per-user one. Ship the plain x64-Setup.exe. Inno Setup; add /MERGETASKS="!desktopicon" to skip the desktop icon.' },
  { name: 'ShareX', match: { product: /^sharex/i, file: /ShareX-.*-setup/i }, install: '{file} /VERYSILENT /NORUN /NORESTART', uninstall: '"%ProgramFiles%\\ShareX\\unins000.exe" /VERYSILENT /NORESTART', detect: 'C:\\Program Files\\ShareX\\ShareX.exe', verified: { on: '2026-10-12', version: '21.0.0', uninstall: true }, note: 'Inno Setup. /NORUN is ShareX\'s own switch - without it ShareX launches when setup finishes. Run elevated (or as SYSTEM) it installs to Program Files; unelevated it goes per-user. Default tasks add Explorer context-menu and Send To entries and can take over the Print Screen key.' },
  { name: 'IrfanView', match: { product: /irfanview/i, file: /iview\d+_x64_setup/i }, install: '{file} /silent /allusers=1 /desktop=0 /group=1 /assoc=1', uninstall: '"%ProgramFiles%\\IrfanView\\iv_uninstall.exe" /silent', detect: 'C:\\Program Files\\IrfanView\\i_view64.exe', verified: { on: '2026-10-12', version: '4.76 (64-bit)', uninstall: true }, note: 'IrfanView\'s own installer - not Inno, not NSIS, so /S and /VERYSILENT do nothing. /allusers=1 only decides whether the shortcuts go to all users; leave it off under a deployment tool and they land in the SYSTEM profile. /assoc applies to the account that runs setup, so from SYSTEM it won\'t set file associations for your users - push those with a default-apps XML instead. Plugins are a separate installer.' },
  { name: 'Everything (voidtools)', match: { product: /^everything\b/i, file: /Everything-.*\.x64\.msi/i }, install: 'msiexec /i "{file}" /qn', uninstall: 'msiexec /x "{file}" /qn', detect: 'C:\\Program Files\\Everything\\Everything.exe', verified: { on: '2026-10-12', version: '1.4.1.1032', uninstall: true }, note: 'By default the MSI installs and starts the Everything service (so standard users get instant NTFS search) and sets Everything to run at startup for all users. START_ON_STARTUP=0 stops the auto-run. The NSIS setup.exe takes /S instead.',
    properties: [
      { name: 'START_ON_STARTUP', value: '0', why: 'Don\'t auto-run Everything at every logon (default on).' },
      { name: 'EVERYTHING_SERVICE', value: '1', why: 'Install the indexing service so standard users can search (default on).' },
    ] },
  { name: 'Bitwarden', match: { product: /^bitwarden/i, file: /Bitwarden-Installer/i }, install: '{file} /allusers /S', uninstall: '"%ProgramFiles%\\Bitwarden\\Uninstall Bitwarden.exe" /allusers /S', detect: 'C:\\Program Files\\Bitwarden\\Bitwarden.exe', verified: { on: '2026-10-12', version: '2026.9.1', uninstall: true }, note: 'electron-builder NSIS. /allusers is REQUIRED for a machine-wide install - without it the app goes per-user, i.e. into the SYSTEM profile under a deployment tool. It is a WEB installer: the app itself downloads from GitHub during setup, so the endpoint needs to reach github.com. The uninstaller returns before it finishes (about 10 s in our lab). There is no MSI.' },
  { name: 'draw.io', match: { product: /^draw\.io/i, file: /draw\.io-.*-windows-installer\.exe/i }, install: '{file} /allusers /S', uninstall: '"%ProgramFiles%\\draw.io\\Uninstall draw.io.exe" /allusers /S', detect: 'C:\\Program Files\\draw.io\\draw.io.exe', verified: { on: '2026-10-12', version: '32.4.1', uninstall: true }, note: 'Use draw.io-<ver>-windows-installer.exe (NSIS, machine-wide). The draw.io .msi - winget\'s default - is built as a per-user package. The uninstaller returns before it finishes (about 9 s in our lab).' },
  { name: 'AWS CLI v2', match: { product: /aws command line interface/i, file: /AWSCLIV2(?!-User).*\.msi/i }, install: 'msiexec /i "{file}" /qn', uninstall: 'msiexec /x "{file}" /qn', detect: 'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe', verified: { on: '2026-10-12', version: '2.37.12', uninstall: true }, note: 'Use AWSCLIV2.msi. AWSCLIV2-User.msi is the per-user build, and AWS\'s newer install.ps1 is per-user too unless you pass -System. PATH changes only reach new shells.' },
  { name: 'Azure CLI', match: { product: /azure cli/i, file: /azure-cli-.*-x64\.msi/i }, install: 'msiexec /i "{file}" /qn', uninstall: 'msiexec /x "{file}" /qn', detect: 'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd', verified: { on: '2026-10-12', version: '2.91.0', uninstall: true }, note: 'Use the -x64 MSI. The aka.ms/installazurecliwindows link Microsoft\'s quick-start uses is the 32-bit build, which lands in Program Files (x86). Installing the 64-bit MSI over it removes the 32-bit one, but CLI extensions then need reinstalling. Open a new shell before az is on PATH.' },
  { name: 'PDF24 Creator', match: { product: /pdf24/i, file: /pdf24-creator.*\.msi/i }, install: 'msiexec /i "{file}" /qn AUTOUPDATE=No', uninstall: 'msiexec /x "{file}" /qn', detect: 'C:\\Program Files\\PDF24\\pdf24.exe', verified: { on: '2026-10-12', version: '11.30.1', uninstall: true }, note: 'Adds a "PDF24" virtual printer, registers PDF24 as a PDF reader and extends the Explorer right-click menu - each has a property to turn it off. Property values are Yes/No, not 1/0.',
    properties: [
      { name: 'AUTOUPDATE', value: 'No', why: 'Disable PDF24\'s own updater.' },
      { name: 'REGISTERREADER', value: 'No', why: 'Don\'t make PDF24 a PDF reader / default handler.' },
      { name: 'EXTENDSHELLCONTEXTMENU', value: 'No', why: 'No PDF24 entry in the Explorer right-click menu.' },
      { name: 'DESKTOPICONS', value: 'No', why: 'No desktop icons.' },
    ] },
  // Batch 4, 2026-10-16. Same lab rule as Batch 3: exact string run AS SYSTEM on a Windows 11 VM (HYD-CLIENT3),
  // judged by Add/Remove Programs, then the exact uninstall judged the same way. (New Teams sits near the top.)
  { name: 'OpenVPN Community', match: { product: /^openvpn 2/i, file: /OpenVPN-2\..*amd64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-16', version: '2.7.5-I001', uninstall: true }, note: 'The community client (OpenVPN GUI), not OpenVPN Connect. Installs the TAP / ovpn-dco network driver silently as SYSTEM with no driver prompt. Profiles go in C:\\Program Files\\OpenVPN\\config (machine-wide) or %USERPROFILE%\\OpenVPN\\config; non-admin users need to be in the local "OpenVPN Administrators" group to start a connection from the GUI.' },
  { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', match: { product: /visual c\+\+ 2015-2022 redistributable \(x64\)/i, file: /vc_redist\.x64\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-16', version: '14.44.35211', uninstall: true }, note: 'One redistributable covers 2015 through 2022 (all 14.x). 32-bit apps need vc_redist.x86.exe as well, even on 64-bit Windows. Running an OLDER build where a newer one is installed exits 1638 (a newer version is already installed), which is success for a deployment. 3010 means a reboot is pending.' },
  { name: 'Microsoft Windows Desktop Runtime 8 (x64)', match: { product: /windows desktop runtime - 8\./i, file: /windowsdesktop-runtime-8.*-win-x64\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-16', version: '8.0.32', uninstall: true }, note: 'What WinForms / WPF apps built on .NET 8 need (HandBrake 1.11 is one); it is a different download from the ASP.NET Core runtime and the plain .NET runtime. It shows TWO entries in Add/Remove Programs, the bundle and the runtime; the bundle exe with /uninstall removed both in testing.' },
  { name: 'HandBrake', match: { file: /HandBrake-.*-Win_GUI\.exe/i }, install: '{file} /S', uninstall: '"C:\\Program Files\\HandBrake\\uninst.exe" /S', verified: { on: '2026-10-16', version: '1.11.2', uninstall: true }, note: 'NSIS, so /S is case-sensitive. The installer carries no product name, so this matches on the file name. HandBrake 1.11 needs the .NET 8 Desktop Runtime: deploy that first (it was installed first in testing).' },
  { name: 'Krita', match: { product: /^krita/i, file: /krita-x64-.*-setup\.exe/i }, install: '{file} /S', uninstall: '"C:\\Program Files\\Krita (x64)\\uninstall.exe" /S', verified: { on: '2026-10-16', version: '5.3.4', uninstall: true }, note: 'NSIS, so /S is case-sensitive. Installs to C:\\Program Files\\Krita (x64), which is where the uninstall string points.' },
  { name: '1Password', match: { product: /^1password$/i, file: /1PasswordSetup.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-16', version: '8.12.40', uninstall: true }, note: 'The MSI installed machine-wide as SYSTEM with no prompts. Each user still signs in to their own account after the install.' },
  { name: 'Box Drive', match: { product: /^box$/i, file: /BoxDrive.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-16', version: '2.55.140', uninstall: true }, note: 'Machine-wide MSI. It registers in Add/Remove Programs as plain "Box", which matters if you detect or uninstall by name. Each user signs in to Box after the install.' },
  { name: 'Box Tools', match: { product: /^box tools/i, file: /BoxToolsInstaller.*AdminInstall\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-16', version: '4.32.0.1324', uninstall: true }, note: 'Use BoxToolsInstaller-AdminInstall.msi, the admin build Box publishes alongside the regular BoxToolsInstaller.exe. It installed silently as SYSTEM with no prompts.' },
  { name: 'Puppet Agent', match: { product: /^puppet agent/i, file: /puppet-agent-.*x64.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart PUPPET_SERVER=puppet.example.com PUPPET_AGENT_STARTUP_MODE=Automatic', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-16', version: '8.10.0', uninstall: true }, note: 'Set PUPPET_SERVER or the agent looks for a host literally named "puppet". Lab-tested with PUPPET_AGENT_STARTUP_MODE=Manual so the test VM did not try to check in; Automatic is what you want in production.',
    properties: [
      { name: 'PUPPET_SERVER', value: 'puppet.example.com', why: 'Your Puppet server.' },
      { name: 'PUPPET_AGENT_STARTUP_MODE', value: 'Automatic', why: 'Automatic, Manual or Disabled service start.' },
      { name: 'PUPPET_AGENT_CERTNAME', value: '', why: 'Override the certificate name (defaults to the FQDN).' },
    ] },
  { name: 'Visual Studio 2010 Tools for Office Runtime (VSTO)', match: { product: /tools for office runtime/i, file: /vstor_redist\.exe/i }, install: '{file} /q /norestart', verified: { on: '2026-10-16', version: '10.0.60917' }, note: 'Still required by many Office add-ins, including current ones. Installs two entries in Add/Remove Programs (10.0.60917 and a 10.0.60922 language pack). No uninstall string is published: msiexec /x on its product code hung as SYSTEM in testing, and a hanging uninstall is worse than none.' },
  // Batch 5, 2026-10-17: the most popular apps still missing (docs/research/market-gaps-2026-10.md). Same lab rule.
  // NOT shipped: Dropbox (offline installer /S /NOLAUNCH hung as SYSTEM past 20 min), VC++ 2015-2022 x86 (exit 0 but
  // no Add/Remove Programs entry after a clean removal; needs another look before it is published).
  { name: 'Paint.NET', match: { product: /^paint\.net$/i, file: /paint\.net.*winmsi.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-17', version: '5.1.12', uninstall: true }, note: 'Use the .winmsi download, which is an MSI inside a zip: unzip it and deploy the MSI.' },
  { name: 'Amazon Corretto JDK (x64)', match: { product: /^amazon corretto \(x64\)/i, file: /amazon-corretto-\d+.*-windows-x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-17', version: '17.0.20.12', uninstall: true }, note: 'Free OpenJDK build from Amazon, a common Oracle Java replacement. The MSI product name carries no Java version ("Amazon Corretto (x64)"), so check the version column, not the name, when you detect it.' },
  { name: 'Amazon Corretto JRE 8 (x64)', match: { product: /^amazon corretto jre 8/i, file: /amazon-corretto-8.*-windows-x64-jre\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-17', version: '1.8.0.504', uninstall: true }, note: 'The Java 8 runtime only (no compiler), for old apps that still need Java 8 without an Oracle licence.' },
  { name: 'PeaZip', match: { product: /^peazip/i, file: /peazip-.*\.WIN64\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', uninstall: '"C:\\Program Files\\PeaZip\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-10-17', version: '11.2.0', uninstall: true }, note: 'Inno Setup. The installer is NOT code-signed, so AppLocker or WDAC publisher rules will not allow it; allow it by hash or path instead.' },
  { name: 'Brave', match: { product: /^braveSoftware update$/i, file: /BraveBrowserStandaloneSetup/i }, install: '{file} /silent /install', uninstall: '"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\<version>\\Installer\\setup.exe" --uninstall --system-level --force-uninstall', verified: { on: '2026-10-17', version: '1.97.56', uninstall: true }, note: 'Use the STANDALONE setup: the small default download fetches the browser at install time. Run as SYSTEM it installs machine-wide. The uninstall path contains the version number, so read it from the UninstallString in the registry. The uninstall exits 19, which Chromium-based installers use for a successful uninstall, not a failure.' },
  { name: 'Inkscape', match: { product: /^inkscape$/i, file: /inkscape-.*-x64.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-17', version: '1.4.4', uninstall: true }, note: 'The MSI is signed with Inkscape\'s own certificate, which Windows does not chain to a trusted root, so publisher-based allow rules will not match it.' },
  { name: 'WinDirStat', match: { product: /^windirstat/i, file: /WinDirStat-x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-17', version: '2.9.3', uninstall: true } },
  { name: 'Nextcloud Desktop', match: { product: /^nextcloud$/i, file: /Nextcloud-.*-x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart REBOOT=ReallySuppress', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-17', version: '35.0.0', uninstall: true }, note: 'REBOOT=ReallySuppress keeps the install from rebooting the machine on its own. Each user connects their own Nextcloud account afterwards.' },
  { name: 'GitHub CLI', match: { product: /^github cli$/i, file: /gh_.*_windows_amd64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-17', version: '2.102.0', uninstall: true } },
  { name: 'DBeaver Community', match: { product: /^dbeaver/i, file: /dbeaver-ce-.*-windows-x86_64\.exe/i }, install: '{file} /S /allusers', uninstall: '"C:\\Program Files\\DBeaver\\Uninstall.exe" /allusers /S', verified: { on: '2026-10-17', version: '26.2.0', uninstall: true }, note: 'NSIS, so /S is case-sensitive. Add /allusers or it installs for one user only.' },
  { name: 'Microsoft Visual C++ 2013 Redistributable (x64)', match: { product: /visual c\+\+ 2013 redistributable \(x64\)/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-17', version: '12.0.40664', uninstall: true }, note: 'Older apps still need it; it installs side by side with 2015-2022. Microsoft names the download vcredist_x64.exe for every year, so this matches on the product name, not the file name.' },
  { name: 'Microsoft Visual C++ 2013 Redistributable (x86)', match: { product: /visual c\+\+ 2013 redistributable \(x86\)/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-17', version: '12.0.40664', uninstall: true }, note: 'For 32-bit apps, even on 64-bit Windows. Matches on the product name, because the file is just vcredist_x86.exe.' },
  { name: 'Microsoft Visual C++ 2012 Redistributable (x64)', match: { product: /visual c\+\+ 2012 redistributable \(x64\)/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-17', version: '11.0.61030', uninstall: true }, note: 'Update 4 (11.0.61030), the last 2012 build. Matches on the product name, because the file is just vcredist_x64.exe.' },
  { name: 'Microsoft Visual C++ 2010 Redistributable (x64)', match: { product: /visual c\+\+ 2010\s+x64 redistributable/i }, install: '{file} /q /norestart', uninstall: 'msiexec /x {1D8E6291-B0D5-35EC-8441-6616F567A0F7} /qn /norestart', verified: { on: '2026-10-17', version: '10.0.40219', uninstall: true }, note: 'Different switches from the newer ones: 2010 takes /q, not /install /quiet, and is removed by its MSI product code (the one shown, for 10.0.40219 SP1 x64).' },
  { name: 'Microsoft Windows Desktop Runtime 6 (x64)', match: { product: /windows desktop runtime - 6\./i, file: /windowsdesktop-runtime-6.*-win-x64\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-17', version: '6.0.36', uninstall: true }, note: '.NET 6 is out of Microsoft support; install it only for an app that still needs it. Shows two entries in Add/Remove Programs; the bundle exe with /uninstall removed both.' },
  { name: 'Microsoft Windows Desktop Runtime 9 (x64)', match: { product: /windows desktop runtime - 9\./i, file: /windowsdesktop-runtime-9.*-win-x64\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-17', version: '9.0.21', uninstall: true }, note: 'Shows two entries in Add/Remove Programs; the bundle exe with /uninstall removed both.' },
  // Batch 6, 2026-10-17: enterprise apps with a public download. Same lab rule. NOT shipped: Egnyte Desktop App MSI
  // (1603 as SYSTEM). Behind a vendor login, so not lab-testable here: Cisco Secure Client, FortiClient, Zscaler.
  { name: 'Omnissa (VMware) Horizon Client', match: { product: /^(omnissa|vmware) horizon client/i, file: /(Omnissa|VMware)-Horizon-Client-.*\.exe/i }, install: '{file} /silent /norestart', verified: { on: '2026-10-17', version: '8.19.0' }, note: 'Burn bundle; it installs USB redirection and other drivers, so plan a reboot. No uninstall string is published: removing it through its MSI returned 3010 and it stayed in Add/Remove Programs until a reboot, so treat removal as reboot-required.' },
  { name: 'Lenovo System Update', match: { product: /^lenovo system update/i, file: /system_update_.*\.exe/i }, install: '{file} /VERYSILENT /NORESTART', uninstall: '"C:\\Program Files (x86)\\Lenovo\\System Update\\unins000.exe" /VERYSILENT /NORESTART', verified: { on: '2026-10-17', version: '5.08.04.85', uninstall: true }, note: 'Inno Setup. It is a 32-bit app, so it installs under Program Files (x86). It installed and uninstalled cleanly on a non-Lenovo VM.' },
  { name: 'PDF-XChange Editor', match: { product: /^pdf-xchange editor/i, file: /EditorV\d+\.x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-17', version: '11.1.0.0', uninstall: true }, note: 'Without a licence key it installs the free edition, which watermarks anything edited with the paid tools.' },
  { name: 'SQL Server Management Studio 20', match: { product: /^microsoft sql server management studio - 20/i, file: /SSMS-Setup-ENU\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-17', version: '20.2.1', uninstall: true }, note: 'SSMS 20 is the last Burn-bundle release; SSMS 21 and later install through the Visual Studio installer with different switches. The uninstall was tested through the copy Burn caches under C:\\ProgramData\\Package Cache, which is the same file and switches.' },
  { name: 'TreeSize Free', match: { product: /treesize free/i, file: /TreeSizeFree.*Setup/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS', uninstall: '"%ProgramFiles%\\JAM Software\\TreeSize Free\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-10-12', version: '4.8.1', uninstall: true }, note: 'Inno Setup. /ALLUSERS matters - winget\'s default is a per-user install into %LocalAppData%\\Programs. The download is TreeSizeFreeSetup.exe with no version in the name, so record which version you packaged.' },
];

/** First catalog entry whose product/filename match the detected metadata, or null. */
export function lookupCatalog(opts: { product?: string; fileName?: string }): CatalogEntry | null {
  const p = (opts.product ?? '').trim();
  const f = (opts.fileName ?? '').trim();
  for (const e of CATALOG) {
    if (p && e.match.product?.test(p)) return e;
    if (f && e.match.file?.test(f)) return e;
  }
  return null;
}
