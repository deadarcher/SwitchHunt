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
    note: 'Custom bootstrapper; properties are bare NAME=value (no slash). Add Include_test=0 to skip the test suite.',
  },
  {
    name: 'Visual Studio Code',
    match: { product: /visual studio code/i, file: /VSCode.*Setup/i },
    install: '{file} /VERYSILENT /MERGETASKS=!runcode',
    note: 'Inno Setup. /MERGETASKS=!runcode stops it launching after install; add addcontextmenufiles,addtopath for shell integration + PATH.',
  },
  {
    name: 'Git for Windows',
    match: { product: /^git\b/i, file: /Git-\d.*64-bit/i },
    install: '{file} /VERYSILENT /NORESTART',
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
    match: { product: /eset/i, file: /ees_|eea_|eset/i },
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
  { name: 'Mozilla Firefox', match: { product: /mozilla firefox/i, file: /Firefox.*Setup/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\Mozilla Firefox\\uninstall\\helper.exe" /S', detect: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', note: 'NSIS. Drop a policies.json / use the MSI for managed settings.' },
  { name: '7-Zip', match: { product: /^7-zip/i, file: /7z\d.*\.exe/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\7-Zip\\Uninstall.exe" /S', detect: 'C:\\Program Files\\7-Zip\\7zFM.exe' },
  { name: 'Notepad++', match: { product: /notepad\+\+/i, file: /npp\..*Installer/i }, install: '{file} /S /allusers', uninstall: '"%ProgramFiles%\\Notepad++\\uninstall.exe" /S', detect: 'C:\\Program Files\\Notepad++\\notepad++.exe', note: 'NSIS. /allusers installs machine-wide (HKLM, Program Files); drop it for a per-user install.' },
  { name: 'VLC media player', match: { product: /vlc media player/i, file: /vlc-.*win/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\VideoLAN\\VLC\\uninstall.exe" /S', detect: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe' },
  { name: 'WinRAR', match: { product: /^winrar/i, file: /winrar|wrar\d/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\WinRAR\\uninstall.exe" /S', detect: 'C:\\Program Files\\WinRAR\\WinRAR.exe' },
  { name: 'OBS Studio', match: { product: /obs studio/i, file: /OBS-Studio|obs-studio/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\obs-studio\\uninstall.exe" /S', detect: 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe', note: 'NSIS.' },
  { name: 'GIMP', match: { product: /^gimp/i, file: /gimp.*setup/i }, install: '{file} /VERYSILENT /NORESTART', note: 'Inno Setup.' },
  { name: 'Node.js', match: { product: /node\.js/i, file: /node-v.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart' },
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
