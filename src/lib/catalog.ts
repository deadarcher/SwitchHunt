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
  /** Property name exactly as passed on the command line. Usually all-uppercase (public), but a vendor's own
   *  installer code can read mixed-case ones the MSI never declares (Zoom's zNoDesktopShortCut). */
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
    verified: { on: '2026-11-11', version: '26.10.0.31', uninstall: true },
    note: 'Self-extracting; the switches live in the inner bootstrapper. Add /includeSSON for pass-through SSO, and ADDLOCAL="ReceiverInside,ICA_Client,USB,DesktopViewer,WebHelper" to pick components. Slow: about 11 minutes as SYSTEM in the lab (2610), so raise a 5-minute deployment timeout. It also installs two OTHER products with their own Add/Remove Programs entries, "Zoom VDI Plugin Management (64bit)" and "Microsoft Teams VDI Citrix plugin", and the Citrix uninstall leaves both behind (the Zoom one keeps a service running). Remove them with msiexec /x and their product codes from Add/Remove Programs.',
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
    verified: { on: '2026-11-11', version: '9.8.3', uninstall: true },
    note: 'Custom CLI (not MSI-style). --install REQUIRES the target folder as an argument. Silent removal is --remove --silent (Add/Remove Programs registers plain --uninstall).',
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
    // Lab 2026-11-11: the 64-bit MUI installer registered as "Adobe Acrobat (64-bit)" under this product code.
    uninstall: 'msiexec /x {AC76BA86-1033-FF00-7760-BC15014EA700} /qn /norestart',
    verified: { on: '2026-11-11', version: '26.003.22075', uninstall: true },
    note: '/sAll silent, /rs suppress reboot, /msi forwards the rest to the inner MSI. EULA_ACCEPT=YES is mandatory. The 64-bit Reader is Adobe\'s unified installer, so it shows in Add/Remove Programs as "Adobe Acrobat (64-bit)", not Reader; the uninstall uses that entry\'s product code. It took about 7 minutes as SYSTEM in the lab, so raise a 5-minute deployment timeout.',
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
    uninstall: '{file} /uninstall /quiet',
    verified: { on: '2026-11-11', version: '3.14.10', uninstall: true },
    note: 'Custom bootstrapper; properties are bare NAME=value (no slash). Add Include_test=0 to skip the test suite. It shows about nine entries in Add/Remove Programs (core interpreter, standard library, pip bootstrap, add to path...); the same installer with /uninstall /quiet removed all of them in the lab.',
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
    uninstall: '"%ProgramFiles%\\Git\\unins000.exe" /VERYSILENT /NORESTART',
    verified: { on: '2026-11-11', version: '2.56.0.4', uninstall: true },
    note: 'Inno Setup. Use /LOADINF="config.inf" to preset components/options (record one with /SAVEINF).',
  },
  // Must stay ABOVE 'Zoom': that entry's /^zoom/ and /Zoom.*\.msi/ would otherwise claim the plugin's MSI.
  { name: 'Zoom Outlook Plugin', match: { product: /^zoom outlook plugin/i, file: /ZoomOutlookPlugin.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-18', version: '7.2.0', uninstall: true }, note: 'A separate MSI from the Zoom client, so a Zoom rule will not deploy it. It installed and uninstalled cleanly on a VM with no Outlook present, so deploying it ahead of Office is safe.' },
  {
    name: 'Zoom',
    match: { product: /^zoom/i, file: /Zoom.*\.msi|ZoomInstallerFull/i },
    install: 'msiexec /i "{file}" /qn ZoomAutoUpdate="true"',
    uninstall: 'msiexec /x "{file}" /qn /norestart',
    verified: { on: '2026-11-11', version: '7.2.51704', uninstall: true },
    note: 'Use the MSI (not the per-user exe) for fleet deploys. It registers as "Zoom Workplace (64-bit)". The uninstall by file only matches that same version; once Zoom has updated itself, remove it by the product code in Add/Remove Programs. Zoom\'s options are passed straight to its own installer code, so the MSI declares no defaults for them; the ones below are from Zoom\'s MSI deployment docs. Names are case-insensitive on the command line (msiexec uppercases them).',
    // From Zoom's published MSI options table (support.zoom.com KB0064484). The engine also finds all of them, as
    // [ZNODESKTOPSHORTCUT] etc. in the CustomAction table (the CA-reference tier, 2026-10-20); this list adds the
    // useful values and what each one does.
    properties: [
      { name: 'zNoDesktopShortCut', value: 'True', why: 'No desktop shortcut on install or update.' },
      { name: 'zSilentStart', value: '1', why: 'Start Zoom in the system tray after a reboot.' },
      { name: 'zSSOHost', value: '', why: 'Pre-fill your SSO vanity URL (e.g. yourco.zoom.us).' },
      { name: 'DisableAdvancedSharingService', value: '1', why: 'Skip the CPT service (no UAC prompt during updates; remote control of all apps then prompts).' },
      { name: 'NoForceInstall', value: 'True', why: 'Wait for an in-progress meeting to end; pair with MSIRestartManagerControl=Disable.' },
      { name: 'MSIRestartManagerControl', value: 'Disable', why: 'The other half of NoForceInstall: Restart Manager leaves a running Zoom alone.' },
      { name: 'FirewallPortStart', value: '7200', why: 'Create Zoom\'s inbound/outbound firewall rules from this port; set FirewallPortEnd with it.' },
      { name: 'FirewallPortEnd', value: '17210', why: 'Last port of the firewall rule range; Zoom says never set one without the other.' },
      { name: 'AllowDowngrade', value: '1', why: 'Allow an older MSI over a newer install (blocked by default).' },
    ],
  },
  {
    name: 'Oracle VM VirtualBox',
    match: { product: /virtualbox/i, file: /VirtualBox.*Win/i },
    install: '{file} --silent --ignore-reboot',
    // Lab 2026-11-11: the wrapper installs an MSI; this is that MSI's product code for 7.2.22.
    uninstall: 'msiexec /x {D726D65F-25B7-436D-85D5-41310BA0E8EA} /qn /norestart',
    verified: { on: '2026-11-11', version: '7.2.22', uninstall: true },
    note: 'Custom wrapper around an MSI. --silent + --ignore-reboot; it registers as "Oracle VirtualBox" with an MSI product code, so remove it with msiexec /x (product code shown is for 7.2.22; it changes per version). On a clean Windows 11 VM as SYSTEM it finished in under a minute with no prompt. Older guides say the network-driver install can prompt unless Oracle\'s certificate is pre-trusted; that wasn\'t needed here.',
  },
  {
    name: 'Wireshark',
    // file: current builds are Wireshark-4.6.9-x64.exe, which the old /Wireshark.*win/ missed.
    match: { product: /wireshark/i, file: /Wireshark.*(win|x64|arm64).*\.exe/i },
    install: '{file} /S /desktopicon=yes',
    uninstall: '"%ProgramFiles%\\Wireshark\\uninstall-wireshark.exe" /S',
    verified: { on: '2026-11-11', version: '4.6.9', uninstall: true },
    note: 'NSIS. A silent install does NOT install Npcap (lab, 4.6.9 as SYSTEM: no Npcap afterwards), so Wireshark opens but can\'t capture until Npcap is installed. Npcap\'s free edition has no silent install; silent deployment needs the Npcap OEM edition.',
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
    // Editor only. Was /foxit/ and /Foxit.*(Setup|Editor)/, which claimed the free READER's MSI ("Foxit PDF Reader",
    // FoxitPDFReader..._Setup_x64.msi) because this entry comes first: Reader users were told to pass a KEYCODE
    // (lab match check, 2026-11-11).
    match: { product: /foxit (pdf )?editor|phantompdf/i, file: /Foxit.*Editor|PhantomPDF/i },
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
    uninstall: '"C:\\Program Files\\RustDesk\\RustDesk.exe" --uninstall',
    // Lab 2026-11-11 (1.5.1 as SYSTEM, seen twice): one --uninstall removed the Add/Remove Programs entry (exit 1) and
    // left the RustDesk service running, set to Automatic; a second run removed the service and the folder. So only
    // the install is marked verified.
    verified: { on: '2026-11-11', version: '1.5.1' },
    note: 'Custom double-dash CLI (not MSI-style). --silent-install installs + registers the service. Drop a RustDesk2.toml beside the exe to preconfigure the relay/key. UNINSTALL TRAP: run as SYSTEM, one --uninstall removed the Add/Remove Programs entry and exited 1, but the RustDesk service kept running (set to Automatic), so a remote-access tool stayed live on a machine that looked clean. Running the same command a second time removed the service and the folder. Run it twice, then check that the RustDesk service is gone.',
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
    uninstall: 'msiexec /x "{file}" /qn /norestart',
    verified: { on: '2026-11-11', version: '157.0.8103.51', uninstall: true },
    // 2026-10-20: the MSI's custom actions take only Google's internal tag/uninstall plumbing (TAGSTRING,
    // UNINSTALLCMDARGS); nothing an admin is meant to set. Say so, so a short list does not read as a miss.
    note: 'Use the Enterprise MSI, not the consumer stub exe, for fleet deploys. Chrome updates itself and its product code changes with every version, so the uninstall by file only matches the build you installed; after an update, use the code in Add/Remove Programs. Its custom actions take only Google\'s own updater plumbing (TAGSTRING replaces the whole install tag; UNINSTALLCMDLINE/UNINSTALLCMDARGS drive removal), nothing to configure Chrome with: that is done by policy after install (the ADMX templates via GPO or Intune, or HKLM\\SOFTWARE\\Policies\\Google\\Chrome).',
  },
  { name: 'Mozilla Firefox', match: { product: /mozilla firefox/i, file: /Firefox.*Setup/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\Mozilla Firefox\\uninstall\\helper.exe" /S', detect: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', verified: { on: '2026-07-29', version: '153.0.1', uninstall: true }, note: 'NSIS. Drop a policies.json / use the MSI for managed settings. The ESR installer takes the same switches and the same uninstall (lab, 153.7.0esr as SYSTEM, 2026-11-11); it registers as "Mozilla Firefox ESR".' },
  { name: '7-Zip', match: { product: /^7-zip/i, file: /7z\d.*\.exe/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\7-Zip\\Uninstall.exe" /S', detect: 'C:\\Program Files\\7-Zip\\7zFM.exe', verified: { on: '2026-11-11', version: '26.06', uninstall: true } },
  { name: 'Notepad++', match: { product: /notepad\+\+/i, file: /npp\..*Installer/i }, install: '{file} /S /allusers', uninstall: '"%ProgramFiles%\\Notepad++\\uninstall.exe" /S', detect: 'C:\\Program Files\\Notepad++\\notepad++.exe', verified: { on: '2026-11-11', version: '8.9.9', uninstall: true }, note: 'NSIS. /allusers installs machine-wide (HKLM, Program Files); drop it for a per-user install.' },
  { name: 'VLC media player', match: { product: /vlc media player/i, file: /vlc-.*win/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\VideoLAN\\VLC\\uninstall.exe" /S', detect: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe', verified: { on: '2026-11-11', version: '3.0.24', uninstall: true } },
  { name: 'WinRAR', match: { product: /^winrar/i, file: /winrar|wrar\d/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\WinRAR\\uninstall.exe" /S', detect: 'C:\\Program Files\\WinRAR\\WinRAR.exe', verified: { on: '2026-07-29', version: '7.23', uninstall: true } },
  { name: 'OBS Studio', match: { product: /obs studio/i, file: /OBS-Studio|obs-studio/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\obs-studio\\uninstall.exe" /S', detect: 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe', verified: { on: '2026-07-29', version: '32.1.2', uninstall: true }, note: 'NSIS.' },
  { name: 'GIMP', match: { product: /^gimp/i, file: /gimp.*setup/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS', uninstall: '"%ProgramFiles%\\GIMP 3\\uninst\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-11-11', version: '3.2.8', uninstall: true }, note: 'Inno Setup, and /VERYSILENT alone is NOT enough. Like Greenshot, GIMP shows the Inno "Select Setup Install Mode" dialog, presented BEFORE the silent machinery engages - no /SILENT flag suppresses it. Without /ALLUSERS it hangs forever under a deployment tool (session 0 has nobody to click it). Verified installing machine-wide with these switches. It can be SLOW: about 9 minutes for 3.2.4 on one lab VM, 1.5 minutes for 3.2.8 on another, so raise a 5-minute deployment timeout. The uninstaller sits in an uninst subfolder, not next to gimp.exe.' },
  { name: 'Node.js', match: { product: /node\.js/i, file: /node-v.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '26.12.1', uninstall: true } },

  // ── Added 2026-07-26. Every command below was confirmed against TWO independent sources
  // (vendor/upstream documentation + the offlineinstallersetup silent-install cheatsheet) before
  // being published. Slack was left out here: its official docs now document MSIX only, and the
  // widely-copied "msiexec /i slack-standalone.msi /qn" line no longer matches what Slack ships.
  // It was added on 2026-11-11 as 'Slack (MSIX, all users)', lab-tested with the MSIX itself.
  { name: 'FileZilla', match: { product: /filezilla/i, file: /filezilla.*setup/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\FileZilla FTP Client\\uninstall.exe" /S', note: 'NSIS. /S suppresses the wizard; the bundled-offer screens are skipped by the official silent setup.' },
  { name: 'PuTTY', match: { product: /^putty/i, file: /putty.*installer\.msi/i }, install: 'msiexec /i "{file}" /quiet /norestart', uninstall: 'msiexec /x "{file}" /quiet /norestart', verified: { on: '2026-11-11', version: '0.85', uninstall: true }, note: 'MSI (the .exe on the download page is the program itself, not an installer - grab the 64-bit MSI).' },
  // Audacity 4 ships an MSI (audacity-win-4.x-x86_64.msi). File-only match and ABOVE the 3.x entry: both carry the
  // product name "Audacity", and a product match here would hand msiexec lines to the 3.x Inno exe.
  { name: 'Audacity 4 (MSI)', match: { file: /audacity-win-.*\.msi$/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '4.0.2', uninstall: true }, note: 'From version 4 Audacity ships an MSI instead of the Inno Setup exe, so the old /VERYSILENT line no longer applies. It registers as "Audacity 4.0".' },
  { name: 'Audacity', match: { product: /audacity/i, file: /audacity-win/i }, install: '{file} /VERYSILENT /NORESTART', verified: { on: '2026-07-29', version: '3.7.8' }, note: 'Inno Setup (Audacity 3.x). Audacity 4 ships an MSI instead; see the Audacity 4 entry.' },
  { name: 'Postman', match: { product: /postman/i, file: /postman.*\.msi/i }, install: 'msiexec /i "{file}" /qn', note: 'Enterprise MSI only (the consumer build is a per-user .exe). INSTALLDIR sets a custom path.' },

  // Batch 2, 2026-07-26. Same two-source rule.
  // Foxit PDF READER is a different product from the Foxit PDF EDITOR entry above - reader is free,
  // editor is licensed, and they ship separate installers. Command from Foxit's own "PDF Reader
  // Deployment and Configuration" PDF, corroborated by ManageEngine's package definition.
  { name: 'Foxit PDF Reader', match: { product: /foxit (pdf )?reader/i, file: /foxit.*reader.*\.msi/i }, install: 'msiexec /i "{file}" /quiet', uninstall: 'msiexec /x "{file}" /quiet CLEAN="1"', verified: { on: '2026-11-11', version: '2026.2.1.39815', uninstall: true }, note: 'Vendor docs use /quiet. CLEAN="1" on uninstall also removes registry + user data. ADDLOCAL="FX_PDFVIEWER" installs the viewer only.' },
  { name: 'Sumatra PDF', match: { product: /sumatra/i, file: /sumatra/i }, install: '{file} -install -all-users -d "C:\\Program Files\\SumatraPDF" -s', uninstall: '{file} -uninstall -s', verified: { on: '2026-10-12', version: '3.6.1', uninstall: true }, note: 'Custom installer - NOT an MSI and NOT NSIS, so /S and /qn both do nothing. The documented "-install -s" is a PER-USER install (into %LocalAppData%) - under a deployment tool that means the SYSTEM profile, and no real user ever sees it. Even -all-users alone, run as SYSTEM, still put the program in SYSTEM\'s profile in our lab (3.6.1); pinning the folder with -d is what made it machine-wide. Add -no-desktop-shortcut on 3.7+.' },
  { name: 'Greenshot', match: { product: /greenshot/i, file: /greenshot.*installer/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS', detect: 'C:\\Program Files\\Greenshot\\Greenshot.exe', verified: { on: '2026-07-29', version: '1.3.315' }, note: 'Inno Setup, and /VERYSILENT alone is NOT enough. The installer shows a "Select Setup Install Mode" dialog that no /SILENT flag suppresses - without /ALLUSERS it hangs forever under a deployment tool (session 0 has nobody to click it). Also: the silent install OPENS THE GREENSHOT WEBSITE in a browser when it finishes and there is no switch to stop it, confirmed by the maintainers. Add /MERGETASKS="!startup" to skip the run-at-startup entry. No uninstall string is published: the vendor-registered unins000.exe /SILENT hung indefinitely as SYSTEM in testing, and a hanging uninstall is worse than none.' },
  { name: 'LibreOffice', match: { product: /libreoffice/i, file: /libreoffice.*\.msi/i }, install: 'msiexec /i "{file}" /quiet /norestart', uninstall: 'msiexec /x "{file}" /quiet /norestart', verified: { on: '2026-11-11', version: '26.8.2.2', uninstall: true }, note: 'Standard MSI. Add REGISTER_ALL_MSO_TYPES=1 to take over Office file associations, or REGISTER_NO_MSO_TYPES=1 to leave them alone.',
    properties: [
      { name: 'REGISTER_ALL_MSO_TYPES', value: '1', why: 'Take over .docx/.xlsx/.pptx associations from Office.' },
      { name: 'REGISTER_NO_MSO_TYPES',  value: '1', why: 'Leave Office file associations alone.' },
      // 2026-10-20 sweep: both defined (=1) and used by the 26.2.5 MSI; documented on LibreOffice's own users list.
      { name: 'CREATEDESKTOPLINK', value: '0', why: 'No desktop shortcut.' },
      { name: 'ISCHECKFORPRODUCTUPDATES', value: '0', why: 'Turn off the built-in update check (you deploy updates).' },
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
  // 'v14': releases from 14.50 (late 2025) register as "Microsoft Visual C++ v14 Redistributable (x64)", so the year
  // range alone missed every up-to-date machine (found on the lab VM, 2026-10-19).
  { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', match: { product: /visual c\+\+ (2015-2022|v14) redistributable \(x64\)/i, file: /vc_redist\.x64\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-16', version: '14.44.35211', uninstall: true }, note: 'One redistributable covers 2015 through 2022 (all 14.x). 32-bit apps need vc_redist.x86.exe as well, even on 64-bit Windows. Running an OLDER build where a newer one is installed exits 1638 (a newer version is already installed), which is success for a deployment. 3010 means a reboot is pending.' },
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
      // 2026-10-20 sweep: in the MSI's custom actions and Puppet's MSI properties doc (help.puppet.com, Core 8.13).
      { name: 'PUPPET_CA_SERVER', value: '', why: 'The CA server, when it is not PUPPET_SERVER.' },
      { name: 'PUPPET_AGENT_ENVIRONMENT', value: '', why: 'The node\'s environment (default production).' },
      { name: 'PUPPET_AGENT_ACCOUNT_USER', value: '', why: 'Run the agent service as this account instead of LocalSystem (with _PASSWORD and _DOMAIN).' },
      { name: 'ENABLE_LONG_PATHS', value: 'TRUE', why: 'Long-path support for the agent; also set HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem LongPathsEnabled=1.' },
    ] },
  { name: 'Visual Studio 2010 Tools for Office Runtime (VSTO)', match: { product: /tools for office runtime/i, file: /vstor_redist\.exe/i }, install: '{file} /q /norestart', verified: { on: '2026-10-16', version: '10.0.60917' }, note: 'Still required by many Office add-ins, including current ones. Installs two entries in Add/Remove Programs (10.0.60917 and a 10.0.60922 language pack). No uninstall string is published: msiexec /x on its product code hung as SYSTEM in testing, and a hanging uninstall is worse than none.' },
  // Batch 5, 2026-10-17: the most popular apps still missing (docs/research/market-gaps-2026-10.md). Same lab rule.
  // Batch 5 held back Dropbox (an older offline installer with /S /NOLAUNCH hung as SYSTEM past 20 min) and VC++
  // 2015-2022 x86 (no Add/Remove Programs match). Both shipped in batch 9: plain /S, and the "v14" name.
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
  { name: 'PDF-XChange Editor', match: { product: /^pdf-xchange editor/i, file: /EditorV\d+\.x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-17', version: '11.1.0.0', uninstall: true }, note: 'Without a licence key it installs the free edition, which watermarks anything edited with the paid tools.',
    // 2026-10-20 sweep: every name below is referenced by the 11.1 MSI (custom actions, Registry, wizard fields) and
    // documented in PDF-XChange's "Switches for MSI Installers" help page.
    properties: [
      { name: 'KEYDATA', value: '', why: 'Your licence key (or KEYFILE="\\\\server\\share\\licence.xcvault").' },
      { name: 'USERNAME', value: '', why: 'Name the licence is registered to.' },
      { name: 'ORGANIZATION', value: '', why: 'Organisation the licence is registered to.' },
      { name: 'NOUPDATER', value: '1', why: 'Do not install the PDF-XChange Updater.' },
      { name: 'SET_AS_DEFAULT', value: '0', why: 'Do not take over as the default PDF app.' },
      { name: 'DESKTOP_SHORTCUTS', value: '0', why: 'No desktop shortcuts.' },
      { name: 'VIEW_IN_BROWSERS', value: '0', why: 'Do not register for opening PDFs inside browsers.' },
    ] },
  { name: 'SQL Server Management Studio 20', match: { product: /^microsoft sql server management studio - 20/i, file: /SSMS-Setup-ENU\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-17', version: '20.2.1', uninstall: true }, note: 'SSMS 20 is the last Burn-bundle release; SSMS 21 and later install through the Visual Studio installer with different switches. The uninstall was tested through the copy Burn caches under C:\\ProgramData\\Package Cache, which is the same file and switches.' },
  { name: 'TreeSize Free', match: { product: /treesize free/i, file: /TreeSizeFree.*Setup/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS', uninstall: '"%ProgramFiles%\\JAM Software\\TreeSize Free\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-10-12', version: '4.8.1', uninstall: true }, note: 'Inno Setup. /ALLUSERS matters - winget\'s default is a per-user install into %LocalAppData%\\Programs. The download is TreeSizeFreeSetup.exe with no version in the name, so record which version you packaged.' },
  { name: 'Dell Command | Update', match: { product: /^dell command \| update/i, file: /Dell-Command-Update.*\.exe/i }, install: '{file} /s', uninstall: 'msiexec /x {96322198-2DBD-4C30-8BAA-E61A5340C663} /qn /norestart', verified: { on: '2026-10-18', version: '5.7.0', uninstall: true }, note: 'A Dell Update Package. Run on its own it exited 4 and installed nothing: 4 is the DUP code for a hard dependency, and DCU 5.x needs the .NET 8 Desktop Runtime. Deploy that runtime first and the same command installs cleanly, even on a non-Dell machine. The uninstall product code shown is for 5.7.0; read the current one from Add/Remove Programs for other versions.' },
  { name: 'Microsoft Remote Desktop client (MSRDC)', match: { product: /^remote desktop$/i, file: /RemoteDesktop_.*_x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart ALLUSERS=1', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-18', version: '1.2.7422.0', uninstall: true }, note: 'The client for Azure Virtual Desktop and Windows 365. ALLUSERS=1 is what makes it a machine-wide install; leave it off and the MSI installs for one user. It shows in Add/Remove Programs as just "Remote Desktop".' },
  { name: 'Google Earth Pro', match: { product: /^google earth pro/i, file: /googleearth.*pro.*\.exe/i }, install: '{file} OMAHA=1', uninstall: 'msiexec /x {3D62248F-DE98-4CEB-A1D9-E69073E085D3} /qn /norestart', verified: { on: '2026-10-18', version: '7.3.7.1327', uninstall: true }, note: 'There is no /S or /silent: OMAHA=1 is the property that runs the setup silently. Underneath it is an MSI, so it is removed by product code (the one shown is for 7.3.7.1327).' },
  { name: 'Devolutions Remote Desktop Manager', match: { product: /^remote desktop manager/i, file: /Setup\.RemoteDesktopManager.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-18', version: '2026.3.12.0', uninstall: true }, note: 'A plain machine-wide MSI with no required properties. It is about 350 MB, so stage it close to the endpoints rather than pulling it over a WAN link for every machine.' },
  { name: 'mRemoteNG', match: { product: /^mremoteng/i, file: /mRemoteNG-Installer.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-18', version: '1.76.20.24615', uninstall: true }, note: 'Use the MSI from the GitHub release, not the portable zip. Connection files live in each user\'s profile, so uninstalling the app does not remove anyone\'s saved connections.' },
  { name: 'Microsoft Visual C++ 2012 Redistributable (x86)', match: { product: /visual c\+\+ 2012 redistributable \(x86\)/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-18', version: '11.0.61030', uninstall: true }, note: 'Update 4 (11.0.61030). Same switches as the x64 package; 32-bit apps need this one even on 64-bit Windows, so many machines carry both.' },
  { name: 'Microsoft Visual C++ 2010 Redistributable (x86)', match: { product: /visual c\+\+ 2010\s+x86 redistributable/i }, install: '{file} /q /norestart', uninstall: 'msiexec /x {F0C3E5D1-1ADE-321E-8167-68EF0DE699A5} /qn /norestart', verified: { on: '2026-10-18', version: '10.0.40219', uninstall: true }, note: 'Like the 2010 x64 package it takes /q, not /install /quiet, and is removed by its MSI product code (the one shown, for 10.0.40219 SP1 x86).' },
  // ODBC 17 (added 2026-11-11) sits ABOVE 18: Microsoft names both downloads msodbcsql.msi, so 18's file pattern
  // claimed the 17 MSI too. Here the product name ("...Driver 17...") decides before 18 is reached.
  { name: 'Microsoft ODBC Driver 17 for SQL Server', match: { product: /^microsoft odbc driver 17 for sql server/i, file: /msodbcsql17.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart IACCEPTMSODBCSQLLICENSETERMS=YES', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '17.11.1.1', uninstall: true }, note: 'IACCEPTMSODBCSQLLICENSETERMS=YES is required for a silent install, as with 18. 17 and 18 install side by side; many older apps name "ODBC Driver 17 for SQL Server" in their connection strings, so 18 alone won\'t satisfy them. Microsoft\'s download is named msodbcsql.msi for both versions; rename it to keep them apart.' },
  { name: 'Microsoft ODBC Driver 18 for SQL Server', match: { product: /^microsoft odbc driver 18/i, file: /msodbcsql.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart IACCEPTMSODBCSQLLICENSETERMS=YES', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-18', version: '18.7.1.1', uninstall: true }, note: 'IACCEPTMSODBCSQLLICENSETERMS=YES is required for a silent install. It also needs the Visual C++ 2015-2022 x64 runtime; the lab VM already had one, so deploy the runtime first on a clean image. Driver 18 encrypts connections by default, unlike 17, so test connection strings before replacing 17.', properties: [{ name: 'IACCEPTMSODBCSQLLICENSETERMS', value: 'YES', why: 'Accepts the licence. A silent install will not proceed without it.' }] },
  { name: 'Microsoft Azure Storage Explorer', match: { product: /^microsoft azure storage explorer/i, file: /StorageExplorer.*\.exe/i }, install: '{file} /VERYSILENT /NORESTART /ALLUSERS', uninstall: '"%ProgramFiles%\\Microsoft Azure Storage Explorer\\unins000.exe" /VERYSILENT /NORESTART', verified: { on: '2026-10-18', version: '1.46.0', uninstall: true }, note: 'Inno Setup. With /ALLUSERS it installed machine-wide under Program Files, which is what a fleet deploy wants; keep it, since Inno installers that allow per-user installs can otherwise land in a single profile.' },
  { name: 'Microsoft Access Database Engine 2016 Redistributable (x64)', match: { product: /^microsoft access database engine 2016/i, file: /accessdatabaseengine_x64\.exe/i }, install: '{file} /quiet /norestart', uninstall: 'msiexec /x {90160000-00D1-0409-1000-0000000FF1CE} /qn /norestart', verified: { on: '2026-10-19', version: '16.0.5044.1000', uninstall: true }, note: 'The ACE OLE DB and ODBC drivers that Excel and Access imports need on machines without Office. Microsoft\'s installer refuses to put the x64 engine next to 32-bit Office (and the x86 one next to 64-bit Office), so match the bitness of any Office already installed. It is removed by product code; the one shown is the English x64 package.' },
  { name: 'Microsoft OLE DB Driver 19 for SQL Server', match: { product: /^microsoft ole db driver 19/i, file: /msoledbsql.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart IACCEPTMSOLEDBSQLLICENSETERMS=YES', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-19', version: '19.4.3.0', uninstall: true }, note: 'IACCEPTMSOLEDBSQLLICENSETERMS=YES is required for a silent install. Version 19 installs side by side with 18 under a new provider name (MSOLEDBSQL19), so connection strings must be changed to use it, and like ODBC Driver 18 it encrypts connections by default.' },
  { name: 'Microsoft .NET 8 Hosting Bundle', match: { product: /^microsoft \.net 8[0-9.]* - windows server hosting/i, file: /dotnet-hosting-8.*-win\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-19', version: '8.0.32', uninstall: true }, note: 'The .NET and ASP.NET Core runtimes plus the ASP.NET Core Module for IIS, for servers that host .NET web apps. Install IIS first: if IIS is added later, run the bundle again with /repair so the module registers. OPT_NO_X86=1 skips the 32-bit runtimes.' },
  { name: 'Microsoft Visual C++ 2008 Redistributable (x64)', match: { product: /visual c\+\+ 2008 redistributable - x64/i, file: /vcredist(2008)?_x64\.exe/i }, install: '{file} /q', uninstall: 'msiexec /x {5FCE6D76-F5DC-37AB-B2B8-22AB8CEDB1D4} /qn /norestart', verified: { on: '2026-10-19', version: '9.0.30729.6161', uninstall: true }, note: '2008 SP1 with the MFC security update (9.0.30729.6161), the one old line-of-business apps still ask for. The package takes /q only (/install /quiet came with later years) and is removed by its MSI product code, shown for this version.' },
  { name: 'Microsoft Visual C++ 2008 Redistributable (x86)', match: { product: /visual c\+\+ 2008 redistributable - x86/i, file: /vcredist(2008)?_x86\.exe/i }, install: '{file} /q', uninstall: 'msiexec /x {9BE518E6-ECC6-35A9-88E4-87755C07200F} /qn /norestart', verified: { on: '2026-10-19', version: '9.0.30729.6161', uninstall: true }, note: 'Same /q switch as the x64 package. 32-bit apps need this one even on 64-bit Windows, so many machines carry both. Removed by product code, shown for 9.0.30729.6161.' },
  { name: 'TightVNC', match: { product: /^tightvnc/i, file: /tightvnc-.*-setup-64bit\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart SET_USEVNCAUTHENTICATION=1 VALUE_OF_USEVNCAUTHENTICATION=1 SET_PASSWORD=1 VALUE_OF_PASSWORD=ChangeMe1', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-19', version: '2.8.89', uninstall: true }, note: 'The full install puts a VNC server on the machine, so set the password properties in the same command (the lab run did) or install only the viewer with ADDLOCAL=Viewer. VNC passwords are capped at 8 characters, so also limit port 5900 to admin networks.',
    properties: [
      { name: 'VALUE_OF_PASSWORD', value: '', why: 'The VNC password (up to 8 characters). Needs SET_PASSWORD=1 alongside it.' },
      { name: 'ADDLOCAL', value: 'Viewer', why: 'Install only the viewer, with no server on the machine.' },
      // 2026-10-20 sweep: TightVNC's "Installing from MSI Packages" guide, each name checked present in the 2.8.89 MSI.
      // Every VALUE_OF_X is ignored unless SET_X=1 is passed too.
      { name: 'VALUE_OF_IPACCESSCONTROL', value: '10.0.0.0-10.255.255.255:0,0.0.0.0-255.255.255.255:1', why: 'Allow only your range, deny the rest (rules "IP1-IP2:0|1|2" = allow/deny/ask). Needs SET_IPACCESSCONTROL=1.' },
      { name: 'VALUE_OF_VIEWONLYPASSWORD', value: '', why: 'A separate view-only password. Needs SET_VIEWONLYPASSWORD=1.' },
      { name: 'VALUE_OF_CONTROLPASSWORD', value: '', why: 'Password for the server\'s settings. Needs SET_CONTROLPASSWORD=1 and SET_USECONTROLAUTHENTICATION=1 VALUE_OF_USECONTROLAUTHENTICATION=1.' },
      { name: 'SERVER_ADD_FIREWALL_EXCEPTION', value: '0', why: 'Do not open the Windows Firewall for the server (default adds a rule).' },
    ] },
  { name: 'TortoiseGit', match: { product: /^tortoisegit/i, file: /TortoiseGit-.*-64bit\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-19', version: '2.19.1.0', uninstall: true }, note: 'Installs cleanly without Git for Windows, but it does nothing useful until Git is there, so deploy Git first.' },
  { name: 'R for Windows', match: { product: /^r for windows/i, file: /R-[\d.]+-win\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS', uninstall: '"%ProgramFiles%\\R\\R-4.6.1\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-10-19', version: '4.6.1', uninstall: true }, note: 'Inno Setup. /ALLUSERS puts it in Program Files for everyone. Each R version installs into its own R-x.y.z folder and leaves earlier versions in place, so the uninstall path changes with every release. RStudio Desktop is a separate install that failed as SYSTEM in the lab (exit 666660 from its elevation plugin), so it is not listed.' },
  { name: 'Advanced IP Scanner', match: { product: /^advanced ip scanner/i, file: /Advanced_IP_Scanner_.*\.exe/i }, install: '{file} /SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', uninstall: 'msiexec /x {C8511AEB-814C-4D6F-AA45-44035EAD563B} /qn /norestart', verified: { on: '2026-10-19', version: '2.5.4594.1', uninstall: true }, note: 'The EXE is an Inno wrapper around an MSI, so it installs with Inno switches but must be removed with msiexec: its registered uninstall is MsiExec /X{code}, which sat on an invisible dialog as SYSTEM when given /VERYSILENT. The install also starts the app afterwards (in the lab it ran as SYSTEM), so end advanced_ip_scanner.exe after a deploy. Product code shown is for 2.5.4594.1.' },
  { name: 'HWiNFO64', match: { product: /^hwinfo/i, file: /hwi64_.*\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', uninstall: '"%ProgramFiles%\\HWiNFO64\\unins001.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-10-19', version: '8.54', uninstall: true }, note: 'Inno Setup. Its uninstaller is unins001.exe, not the usual unins000.exe, so read the path from Add/Remove Programs rather than guessing it.' },
  { name: 'CPU-Z', match: { product: /cpu-z/i, file: /cpu-z_.*\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', uninstall: '"%ProgramFiles%\\CPUID\\CPU-Z\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-10-19', version: '3.01', uninstall: true }, note: 'Inno Setup, installed machine-wide under Program Files\\CPUID. Use the installer (cpu-z_x.xx-en.exe), not the zip, if you want it in Add/Remove Programs.' },
  // Batch 9, 2026-10-20. Same lab rule. NOT shipped: Slack machine-wide MSI and RealVNC Viewer (their current download
  // links returned 404), HP Image Assistant (it only extracts a portable tool; nothing to find in Add/Remove Programs),
  // Edge and WebView2 (preinstalled and not removable on Windows 11, so a clean install can't be measured).
  { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x86)', match: { product: /visual c\+\+ (2015-2022|v14) redistributable \(x86\)/i, file: /vc_redist\.x86\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-10-20', version: '14.51.36247', uninstall: true }, note: 'Releases from 14.50 register in Add/Remove Programs as "Microsoft Visual C++ v14 Redistributable (x86)", not "2015-2022", so a detection rule that looks for the old name misses every up-to-date machine. 32-bit apps need this one even on 64-bit Windows.' },
  { name: 'Dropbox', match: { product: /^dropbox$/i, file: /Dropbox.*Offline.?Installer.*\.exe/i }, install: '{file} /S', uninstall: '"%ProgramFiles(x86)%\\Dropbox\\Client\\DropboxUninstaller.exe" /InstallType:MACHINE /S', verified: { on: '2026-10-20', version: '262.4.3183', uninstall: true }, note: 'Use the offline installer. With plain /S it installed machine-wide in about four minutes as SYSTEM; an older build run with /S /NOLAUNCH hung past 20 minutes in an earlier lab run. The registered uninstall carries /InstallType:MACHINE, which is what removes a machine-wide install.' },
  { name: 'MobaXterm', match: { product: /^mobaxterm/i, file: /MobaXterm_installer.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-20', version: '26.5.0.5542', uninstall: true }, note: 'Download the Installer edition, not the Portable one. The zip holds the MSI and MobaXterm_installer.dat, which carries most of the payload (32 MB against a 14 MB MSI), so deploy the two files together from the same folder.' },
  { name: 'UltraVNC', match: { product: /^ultravnc/i, file: /UltraVNC_.*_Setup\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', uninstall: '"%ProgramFiles%\\uvnc\\UltraVNC\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-10-20', version: '1.8.3.0', uninstall: true }, note: 'Inno Setup. To choose components (viewer only, or server with your settings), record the choices once with /SAVEINF="setup.inf" on a test machine and replay them with /LOADINF="setup.inf".' },
  // 21 only since 2026-11-11: the version-free pattern labelled a JDK 17 MSI "OpenJDK 21, lab-tested 21.0.12.1".
  { name: 'Microsoft Build of OpenJDK 21', match: { product: /^microsoft build of openjdk\s+21\./i, file: /microsoft-jdk-21\..*-windows-x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-20', version: '21.0.12.1', uninstall: true }, note: 'A plain MSI. To set JAVA_HOME and PATH as part of the install, add ADDLOCAL=FeatureMain,FeatureEnvironment,FeatureJarFileRunWith,FeatureJavaHome.' },
  { name: 'Oracle JDK 21', match: { product: /^java\(tm\) se development kit 21/i, file: /jdk-21.*_windows-x64_bin\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-20', version: '21.0.12', uninstall: true }, note: 'Check the licence on the exact update you package: Oracle offers JDK 21 free under its No-Fee Terms only for a year after the next LTS release, and later 21 updates move to the OTN licence, which is not free for production use. The Microsoft Build of OpenJDK installs the same way with no such terms.' },
  { name: 'Logi Options+', match: { product: /^logi options\+/i, file: /logioptionsplus_installer\.exe/i }, install: '{file} /quiet /analytics no', uninstall: '"%ProgramFiles%\\LogiOptionsPlus\\logioptionsplus_updater.exe" --uninstall --full --shadow /quiet', verified: { on: '2026-10-20', version: '2.9.994631', uninstall: true }, note: 'The installer is a bootstrapper that downloads the app: the 2.8 download installed 2.9, so machines need internet access and you cannot pin a version this way. /analytics no turns usage analytics off.' },
  { name: 'Royal TS', match: { product: /^royal ts/i, file: /RoyalTSInstaller_.*_x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-20', version: '7.4.50922.0', uninstall: true }, note: 'A plain machine-wide MSI with no required properties. It registers as "Royal TS V7" and is about 260 MB, so stage it close to the endpoints.' },
  { name: 'Beyond Compare 5', match: { product: /^beyond compare 5/i, file: /BCompare-5.*\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS', uninstall: '"%ProgramFiles%\\Beyond Compare 5\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-10-20', version: '5.2.6.32774', uninstall: true }, note: 'Inno Setup, and /ALLUSERS is required: without it the setup sat for more than eight minutes as SYSTEM and had to be killed; with it the install finished in seconds and registered as "Beyond Compare 5 (All users)". The licence key is entered separately.' },
  { name: 'TechSmith Camtasia', match: { product: /^camtasia/i, file: /camtasia.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-20', version: '26.2.2.19936', uninstall: true }, note: 'Deploy the Visual C++ 2015-2022 x64 runtime first: Camtasia 26.2 refuses to install unless it is 14.51.36231 or newer, and a silent install reports that only as exit 1603. Its MSI log says "Camtasia requires Microsoft Visual C++ 2019 Redistributable package v14.51.36231 or later". With a current runtime the same command installed and uninstalled cleanly.',
    // 2026-10-20 sweep: TechSmith's "Camtasia MSI Installation Guide" table, each name checked present in the 26.2.2 MSI
    // (TSC_SOFTWARE_USER from the guide is NOT in 26.2, so it is left out).
    properties: [
      { name: 'TSC_SOFTWARE_KEY', value: '', why: 'Your licence key.' },
      { name: 'TSC_DESKTOP_LINK', value: '0', why: 'No desktop shortcut.' },
      { name: 'TSC_UPDATE_ENABLE', value: '0', why: 'Turn off the update check (you deploy updates).' },
      { name: 'TSC_INST_PP_ADDIN', value: '0', why: 'Skip the PowerPoint add-in.' },
      { name: 'TSC_INCLUDETECHSMITHAGENT', value: '0', why: 'Do not install the TechSmith Agent.' },
      { name: 'TSC_ANALYTICS_OPTIN', value: 'NO', why: 'Opt out of usage analytics.' },
      { name: 'TSC_CRASHREPORTING_OPTIN', value: 'NO', why: 'Opt out of crash reporting.' },
      { name: 'TSC_SHOWREGISTERONLINEDIALOG', value: 'false', why: 'No register-online prompt.' },
      { name: 'TSC_LANG', value: 'ENU', why: 'Product language: ENU, DEU, JPN, FRA, CHS, ESN or PTB.' },
    ] },
  // From a user report (2026-10-20): SwitchHunt offered plain /qn, which failed as SYSTEM; the engine now flags these.
  { name: 'Arduino IDE', match: { product: /^arduino ide/i, file: /arduino-ide_.*_Windows_64bit\.msi/i }, install: 'msiexec /i "{file}" ALLUSERS=1 /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-10-20', version: '2.3.10', uninstall: true }, note: 'A dual-purpose MSI (ALLUSERS=2, MSIINSTALLPERUSER=1) that defaults to a per-user install. Run as SYSTEM without ALLUSERS=1 it exited 1603 and installed nothing; with it, it installed into Program Files for every user. To change the folder use APPLICATIONFOLDER="C:\\Apps\\ArduinoIDE"; INSTALLDIR is ignored by this package. Admin install (/a) only unpacks files, it does not install.' },
  // Batch 11, 2026-11-11, on a clean Windows 11 Pro VM (no deployment agent). Same lab rule: run as SYSTEM, judged by
  // Add/Remove Programs (or the provisioned package), then the uninstall removes it.
  { name: 'Microsoft Windows Desktop Runtime 10 (x64)', match: { product: /windows desktop runtime - 10\./i, file: /windowsdesktop-runtime-10.*-win-x64\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-11-11', version: '10.0.15', uninstall: true }, note: 'What WinForms / WPF apps built on .NET 10 need. Add/Remove Programs shows the runtime as "Microsoft Windows Desktop Runtime - 10.0.15 (x64)" but with DisplayVersion 80.60.61788, an internal number, so a detection rule should key on the name, not on version 10.0.15.' },
  { name: 'Microsoft .NET 10 Hosting Bundle', match: { product: /^microsoft \.net 10[0-9.]* - windows server hosting/i, file: /dotnet-hosting-10.*-win\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-11-11', version: '10.0.15', uninstall: true }, note: 'The .NET 10 and ASP.NET Core 10 runtimes plus the ASP.NET Core Module for IIS. Install IIS first: if IIS is added later, run the bundle again with /repair so the module registers. OPT_NO_X86=1 skips the 32-bit runtimes.' },
  { name: 'Cloudflare One Client (WARP)', match: { product: /^cloudflare (one client|warp)/i, file: /Cloudflare_WARP.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '26.8.2115.0', uninstall: true }, note: 'Renamed: the WARP client now registers as "Cloudflare One Client". Add ORGANIZATION (your Zero Trust team name) to register it with your organization; the lab run installed it without one. The settings below are MSI properties; Cloudflare documents the managed settings file as C:\\ProgramData\\Cloudflare\\mdm.xml. On a new deployment, SWITCH_LOCKED=true needs AUTO_CONNECT as well (0 or more), or clients can start switched off with no way for users to turn them on (Cloudflare\'s docs).',
    // Each name below is referenced by the 26.8.2115.0 MSI's custom actions (engine CA tier, 2026-11-11); meanings
    // from Cloudflare's "Deployment parameters" page.
    properties: [
      { name: 'ORGANIZATION', value: '', why: 'Your Zero Trust team name: registers the device with your organization.' },
      { name: 'SERVICE_MODE', value: 'warp', why: 'warp (traffic and DNS, default), 1dot1 (DNS only), proxy or postureonly.' },
      { name: 'AUTO_CONNECT', value: '0', why: 'Minutes before a switched-off client turns itself back on (0 = stays off).' },
      { name: 'SWITCH_LOCKED', value: 'true', why: 'Users can\'t turn the client off; needs AUTO_CONNECT on new deployments.' },
      { name: 'ONBOARDING', value: 'false', why: 'Hide the first-launch privacy screens.' },
      { name: 'SUPPORT_URL', value: '', why: 'https:// or mailto: link for the in-app Send Feedback button (off by default under MDM).' },
      { name: 'GATEWAY_UNIQUE_ID', value: '', why: 'Your DoH subdomain, for DNS-only deployments without a team name.' },
      { name: 'AUTH_CLIENT_ID', value: '', why: 'Service-token client ID: enrol with no user sign-in (needs AUTH_CLIENT_SECRET).' },
      { name: 'AUTH_CLIENT_SECRET', value: '', why: 'Service-token secret that goes with AUTH_CLIENT_ID.' },
    ] },
  { name: 'OpenVPN Connect', match: { product: /^openvpn connect/i, file: /openvpn-connect-.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '3.9.0', uninstall: true }, note: 'OpenVPN Inc.\'s client (Access Server / CloudConnexa), not the community OpenVPN GUI. The install folder is set with APPLICATIONROOTDIRECTORY; INSTALLDIR is ignored by this package.' },
  { name: 'GitHub Desktop (machine-wide deployment)', match: { product: /^github desktop deployment tool/i, file: /GitHubDesktopSetup-x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '3.6.11.0', uninstall: true }, note: 'This MSI does NOT install GitHub Desktop machine-wide. It installs "GitHub Desktop Deployment Tool" plus an HKLM Run entry (GitHubDesktopDeploymentTool.exe --checkInstall), which installs GitHub Desktop into each user\'s own profile when they sign in. So the app appears per user after their next sign-in, and removing this MSI does not touch copies already installed in profiles.' },
  { name: 'Chrome Remote Desktop Host', match: { product: /^chrome remote desktop host/i, file: /remoting-host\.msi|chromeremotedesktophost\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '157.0.8103.41', uninstall: true }, note: 'Installs the host service only. Nobody can connect until the computer is registered to a Google account, either by a user at remotedesktop.google.com/access or headless with the one-time command Google generates at remotedesktop.google.com/headless.' },
  { name: 'Malwarebytes', match: { product: /^malwarebytes/i, file: /mb\d-setup|MBSetup/i }, install: '{file} /VERYSILENT /NORESTART', uninstall: '"C:\\Program Files\\Malwarebytes\\Anti-Malware\\mbuns.exe" /uninstall /arp /VERYSILENT /NORESTART', verified: { on: '2026-11-11', version: '5.7.3.376', uninstall: true }, note: 'Use the offline installer. The download looks like an NSIS package to a scanner, but what it installs is Inno Setup (its Add/Remove Programs key ends in _is1), and the Inno switches are the ones that worked: /S is not the answer here. About 5 minutes as SYSTEM in the lab. This is the consumer / Premium client; ThreatDown (Malwarebytes for business) deploys its own agent from the Nebula or OneView console.' },
  { name: 'Sublime Text 4', match: { product: /^sublime text/i, file: /sublime_text_build_.*_setup\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', uninstall: '"%ProgramFiles%\\Sublime Text\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-11-11', version: '4 (build 4215)', uninstall: true }, note: 'Inno Setup, machine-wide into Program Files. Add/Remove Programs shows no version number for it, so detect it by the file C:\\Program Files\\Sublime Text\\sublime_text.exe rather than by version. A licence is entered in the app, not at install.' },
  { name: 'RStudio Desktop', match: { product: /^rstudio/i, file: /RStudio-.*\.exe/i }, install: '{file} /S /allusers', uninstall: '"%ProgramFiles%\\RStudio\\Uninstall.exe" /allusers /S', verified: { on: '2026-11-11', version: '2026.10.1+239', uninstall: true }, note: 'NSIS with both scopes: /allusers installs machine-wide (/currentuser is the per-user choice). It needs R installed to run, not to install: deploy R for Windows first or alongside. About 4 minutes as SYSTEM in the lab.' },
  { name: 'Zotero', match: { product: /^zotero/i, file: /Zotero-.*_setup\.exe/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\Zotero\\uninstall\\helper.exe" /S', verified: { on: '2026-11-11', version: '10.0.8', uninstall: true }, note: 'Built on Firefox\'s installer, so a scanner reads the download as a 7-Zip self-extractor and can\'t see the switch. /S installs machine-wide into Program Files; the uninstaller is uninstall\\helper.exe, like Firefox\'s.' },
  // Slack ships its machine-wide package as an MSIX now (see the 2026-07-26 note above: the old MSI line is stale).
  // PowerShell, run elevated or as SYSTEM.
  { name: 'Slack (MSIX, all users)', match: { product: /^slack$/i, file: /^Slack.*\.msix$/i }, install: 'Add-AppxProvisionedPackage -Online -PackagePath "{file}" -SkipLicense', uninstall: 'Get-AppxProvisionedPackage -Online | Where-Object DisplayName -eq "com.tinyspeck.slackdesktop" | Remove-AppxProvisionedPackage -Online -AllUsers', verified: { on: '2026-11-11', version: '4.53.287.0', uninstall: true }, note: 'PowerShell, not msiexec: Slack\'s machine-wide download is Slack.msix. Provisioning stages it for every account, and each user gets it at their next sign-in; it does not show in Add/Remove Programs (check with Get-AppxProvisionedPackage -Online, DisplayName com.tinyspeck.slackdesktop). -AllUsers on the removal also takes it off accounts that already have it.' },
  // Batch 12, 2026-11-11: developer and desk apps. Same VM, same lab rule.
  { name: 'Go', match: { product: /^go programming language/i, file: /go[0-9.]+\.windows-amd64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '1.27.4', uninstall: true }, note: 'A plain MSI into C:\\Program Files\\Go, and it adds Go\'s bin folder to the system PATH; already-open shells and services only see it after a restart of that process.' },
  { name: 'Microsoft Build of OpenJDK 17', match: { product: /^microsoft build of openjdk\s+17\./i, file: /microsoft-jdk-17\..*-windows-x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '17.0.21.0.2', uninstall: true }, note: 'Same package layout as the JDK 21 build: a plain MSI. To set JAVA_HOME and PATH, add ADDLOCAL=FeatureMain,FeatureEnvironment,FeatureJarFileRunWith,FeatureJavaHome.' },
  { name: 'pgAdmin 4', match: { product: /^pgadmin 4/i, file: /pgadmin4-.*-x64\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS', uninstall: '"%ProgramFiles%\\pgAdmin 4\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-11-11', version: '9.19', uninstall: true }, note: 'Inno Setup with both scopes, so pass /ALLUSERS for a machine-wide install (/CURRENTUSER is the per-user one). The uninstaller path assumes the default folder.' },
  { name: 'HeidiSQL', match: { product: /^heidisql/i, file: /HeidiSQL_.*_Setup\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', uninstall: '"%ProgramFiles%\\HeidiSQL\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-11-11', version: '12.22.0.7382', uninstall: true }, note: 'Inno Setup, machine-wide. Installed in about 10 seconds as SYSTEM in the lab.' },
  { name: 'MySQL Workbench', match: { product: /^mysql workbench/i, file: /mysql-workbench-.*-winx64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '26.10.0', uninstall: true }, note: 'A plain MSI. It needs the Visual C++ 2015-2022 x64 runtime; deploy that first on a machine that might not have it.' },
  { name: 'Blender', match: { product: /^blender/i, file: /blender-.*-windows-x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '5.3.0', uninstall: true }, note: 'During the install a custom action runs blender-launcher.exe --register-allusers to register .blend files, so Blender briefly runs as SYSTEM (seen in the lab); the uninstall runs --unregister-allusers. The MSI also carries a custom action that opens fund.blender.org in a browser; no browser was left running after the /qn install in the lab.' },
  { name: 'Obsidian', match: { product: /^obsidian$/i, file: /Obsidian-[0-9.]+\.exe/i }, install: '{file} /S /allusers', uninstall: '"%ProgramFiles%\\Obsidian\\Uninstall Obsidian.exe" /allusers /S', verified: { on: '2026-11-11', version: '1.15.0', uninstall: true }, note: 'NSIS (electron-builder) with both scopes: /allusers is the machine-wide install into Program Files, /currentuser the per-user one. The uninstaller needs /allusers too.' },
  { name: 'Power Automate for desktop', match: { product: /^power automate for desktop/i, file: /Setup\.Microsoft\.PowerAutomate\.exe/i }, install: '{file} -Silent -Install -ACCEPTEULA', uninstall: '{file} -Silent -Uninstall', verified: { on: '2026-11-11', version: '2.74.00191.26302', uninstall: true }, note: 'Its own dash-style switches, not /quiet; -ACCEPTEULA is required for an unattended install. Slow: about 9 minutes as SYSTEM in the lab. It registers two Add/Remove Programs entries and starts its launcher service right away; the -Uninstall removed both.' },
  { name: 'Jabra Direct', match: { product: /^jabra direct/i, file: /JabraDirectSetup\.exe/i }, install: '{file} /install /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-11-11', version: '8.4.30601', uninstall: true }, note: 'A WiX Burn bundle, so it shows three "Jabra Direct" entries in Add/Remove Programs (the bundle and two MSIs); the bundle\'s /uninstall removed all three in the lab.' },
  { name: 'XnView MP', match: { product: /^xnview mp/i, file: /XnView_MP-.*-win-x64\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', uninstall: '"%ProgramFiles%\\XnViewMP\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-11-11', version: '1.12.3', uninstall: true }, note: 'Inno Setup, machine-wide. The install folder is XnViewMP (no space), which matters for a detection rule.' },
  { name: 'Vivaldi', match: { product: /^vivaldi( installer)?$/i, file: /Vivaldi\.[0-9.]+\.x64\.exe/i }, install: '{file} --vivaldi-silent --do-not-launch-chrome --system-level', uninstall: '"C:\\Program Files\\Vivaldi\\Application\\<version>\\Installer\\setup.exe" --uninstall --system-level --force-uninstall', verified: { on: '2026-11-11', version: '8.3.4191.35', uninstall: true }, note: 'Chromium-style switches. --system-level is what makes it machine-wide; without it the installer is per-user. The uninstall path contains the version number, so read it from the UninstallString in the registry. The uninstall exits 19, which Chromium-based installers use for a successful uninstall, so add 19 to your deployment tool\'s success codes.' },
  // Batch 14, 2026-11-11: monitoring and security agents, where the silent string alone is not enough. Each lab
  // run also read the agent's own config afterwards, to prove the property reached it (installed != configured).
  { name: 'Zabbix Agent 2', match: { product: /^zabbix agent 2/i, file: /zabbix_agent2-.*-windows-amd64.*\.msi/i }, install: 'msiexec /i "{file}" /qn SERVER=zabbix.example.com SERVERACTIVE=zabbix.example.com', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '7.4.8', uninstall: true }, note: 'Put your own server in SERVER (who may poll this agent) and SERVERACTIVE (where it sends active checks). In the lab both landed as Server= and ServerActive= in zabbix_agent2.conf and the service started. Without them the agent installs but nothing can talk to it. HOSTNAME defaults to the computer name.',
    // Each name is a property the 7.4.8 MSI declares; meanings from Zabbix's agent configuration docs.
    properties: [
      { name: 'SERVER', value: '', why: 'Zabbix server(s) allowed to poll this agent (passive checks).' },
      { name: 'SERVERACTIVE', value: '', why: 'Zabbix server/proxy the agent sends active checks to.' },
      { name: 'HOSTNAME', value: '', why: 'Host name as configured in Zabbix (default: the computer name).' },
      { name: 'TLSCONNECT', value: 'psk', why: 'Encrypt connections to the server with a pre-shared key.' },
      { name: 'TLSACCEPT', value: 'psk', why: 'Only accept PSK-encrypted connections from the server.' },
      { name: 'TLSPSKIDENTITY', value: '', why: 'PSK identity, matching the host\'s encryption settings in Zabbix.' },
      { name: 'TLSPSKVALUE', value: '', why: 'The pre-shared key itself (hex).' },
    ] },
  { name: 'Wazuh Agent', match: { product: /^wazuh agent/i, file: /wazuh-agent-.*\.msi/i }, install: 'msiexec /i "{file}" /q WAZUH_MANAGER="wazuh.example.com"', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '4.14.10', uninstall: true }, note: 'WAZUH_MANAGER is what points it at your manager; in the lab it landed in ossec.conf as <address>. The service (WazuhSvc) was left STOPPED after the install, so start it in the same deployment: NET START WazuhSvc. Without a start it never enrols.',
    properties: [
      { name: 'WAZUH_MANAGER', value: '', why: 'Your Wazuh manager address.' },
      { name: 'WAZUH_REGISTRATION_SERVER', value: '', why: 'Enrolment server, if it is not the manager.' },
      { name: 'WAZUH_REGISTRATION_PASSWORD', value: '', why: 'Enrolment password, if your manager requires one.' },
      { name: 'WAZUH_AGENT_NAME', value: '', why: 'Agent name (default: the computer name).' },
      { name: 'WAZUH_AGENT_GROUP', value: '', why: 'Agent group(s) to join on enrolment.' },
    ] },
  { name: 'Splunk Universal Forwarder', match: { product: /^universalforwarder/i, file: /splunkforwarder-.*-windows-x64\.msi/i }, install: 'msiexec /i "{file}" AGREETOLICENSE=Yes /quiet', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '10.6.1.1', uninstall: true }, note: 'AGREETOLICENSE=Yes is REQUIRED: the MSI defaults it to No, and without it the lab install failed with 1603 (its log: CheckLicenseAgreement, Return value 3). With it the SplunkForwarder service installed set to Automatic and running. It registers as "UniversalForwarder" in Add/Remove Programs. With no SPLUNKUSERNAME/SPLUNKPASSWORD the MSI\'s default GENRANDOMPASSWORD=1 sets a random admin password.',
    properties: [
      { name: 'AGREETOLICENSE', value: 'Yes', why: 'Required; the default No fails the install with 1603.' },
      { name: 'DEPLOYMENT_SERVER', value: '', why: 'host:port of your deployment server (usually :8089).' },
      { name: 'RECEIVING_INDEXER', value: '', why: 'host:port of the indexer to forward to (usually :9997).' },
      { name: 'SPLUNKUSERNAME', value: '', why: 'Local admin user for the forwarder.' },
      { name: 'SPLUNKPASSWORD', value: '', why: 'Its password (without these two, a random one is generated).' },
    ] },
  { name: 'GLPI Agent', match: { product: /^glpi agent/i, file: /GLPI-Agent-.*-x64\.msi/i }, install: 'msiexec /i "{file}" /quiet SERVER="https://glpi.example.com/"', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '1.21', uninstall: true }, note: 'SERVER is not declared in the MSI\'s property table (the agent\'s own setup reads it), so a scanner can\'t offer it, but it works: in the lab it landed in HKLM\\SOFTWARE\\GLPI-Agent (server) and the glpi-agent service was running. Use your GLPI URL, including the trailing slash.' },
  { name: 'Salt Minion', match: { product: /^salt minion/i, file: /Salt-Minion-.*-Py3-AMD64\.msi/i }, install: 'msiexec /i "{file}" /qn MASTER=salt.example.com', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '3008.5', uninstall: true }, note: 'MASTER points it at your salt master; in the lab it landed in the minion config (master: salt.example.com) and the salt-minion service was running. MINION_ID sets the minion ID.',
    properties: [
      { name: 'MASTER', value: '', why: 'Your salt master (host name or IP).' },
      { name: 'MINION_ID', value: '', why: 'Minion ID (default: the computer name).' },
    ] },
  { name: 'osquery', match: { product: /^osquery/i, file: /osquery-[0-9.]+\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '5.24.1', uninstall: true }, note: 'A plain MSI that installs and STARTS the osqueryd service right away, with the packaged defaults. Ship your osquery.flags / osquery.conf (or your fleet manager\'s) with it.' },
  { name: 'AWS VPN Client', match: { product: /^aws vpn client/i, file: /AWS_VPN_Client\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '6.2.1', uninstall: true }, note: 'A plain MSI; its aws-client-vpn-daemon service starts at install. Users still import the .ovpn profile from your Client VPN endpoint in the app.' },
  { name: 'TortoiseSVN', match: { product: /^tortoisesvn/i, file: /TortoiseSVN-.*-x64-svn-.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '1.15.0.29830', uninstall: true }, note: 'A plain MSI. The Explorer context-menu extension shows up for users after Explorer restarts (sign out and in).' },
  { name: 'VSCodium', match: { product: /^vscodium/i, file: /VSCodiumSetup-x64-/i }, install: '{file} /VERYSILENT /NORESTART /MERGETASKS=!runcode', uninstall: '"%ProgramFiles%\\VSCodium\\unins000.exe" /VERYSILENT /NORESTART', verified: { on: '2026-11-11', version: '1.143.17232', uninstall: true }, note: 'Same installer family as VS Code: use the system installer (VSCodiumSetup-x64-*.exe), not VSCodiumUserSetup, which run as SYSTEM installs into SYSTEM\'s own profile. /MERGETASKS=!runcode stops it launching after install.' },
  { name: 'NoMachine', match: { product: /^nomachine/i, file: /nomachine.*_x64\.exe/i }, install: '{file} /VERYSILENT /NORESTART', uninstall: '"%ProgramData%\\NoMachine\\var\\uninstall\\unins000.exe" /VERYSILENT /NORESTART', verified: { on: '2026-11-11', version: '10.2.3', uninstall: true }, note: 'Inno Setup. It installs the NoMachine SERVER too and starts it at install (nxd and nxserver were running right after, in the lab), so the machine accepts NoMachine connections from then on; check that against your remote-access policy. The uninstaller lives under ProgramData, not Program Files.' },
  { name: 'Mattermost Desktop', match: { product: /^mattermost$/i, file: /mattermost-desktop-.*-win-x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '6.3.2', uninstall: true }, note: 'A machine-wide MSI. The install folder is set with APPLICATIONFOLDER; INSTALLDIR is ignored by this package.' },
  { name: 'Apple iTunes', match: { product: /^itunes$/i, file: /iTunes(64)?Setup\.exe/i }, install: '{file} /quiet /norestart', uninstall: 'msiexec /x {2B368BAD-1383-4272-B8C9-D1A1AAA86A20} /qn /norestart', verified: { on: '2026-11-11', version: '12.13.12.3', uninstall: true }, note: 'The exe unpacks and runs its MSIs; /quiet /norestart installed it as SYSTEM in about a minute. It registered as one "iTunes" entry in Add/Remove Programs, removed with msiexec /x and its product code (shown for 12.13.12.3; it changes per version).' },
  { name: 'Datadog Agent', match: { product: /^datadog agent/i, file: /ddagent-cli-.*\.msi/i }, install: 'msiexec /i "{file}" /qn', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '7.85.2', uninstall: true }, note: 'Add APIKEY (and SITE if you are not on datadoghq.com). Without APIKEY it still installs and the agent service runs, but with an empty api_key in C:\\ProgramData\\Datadog\\datadog.yaml, so it looks healthy and reports nothing (lab). With APIKEY and SITE on the command line both landed in datadog.yaml. About 3 minutes as SYSTEM.',
    // Each name is a property the 7.85.2 MSI declares; meanings from Datadog's Windows agent install docs.
    properties: [
      { name: 'APIKEY', value: '', why: 'Your Datadog API key. Required for the agent to report.' },
      { name: 'SITE', value: 'datadoghq.com', why: 'Your Datadog site (datadoghq.eu, us3.datadoghq.com, ...).' },
      { name: 'TAGS', value: '', why: 'Comma-separated host tags, e.g. env:prod,team:it.' },
      { name: 'HOSTNAME', value: '', why: 'Override the host name the agent reports.' },
    ] },
  { name: 'Grafana Alloy', match: { product: /^(grafana )?alloy/i, file: /alloy-installer-windows-amd64\.exe/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\GrafanaLabs\\Alloy\\uninstall.exe" /S', verified: { on: '2026-11-11', version: '1.21.2', uninstall: true }, note: 'NSIS. It registers as "Alloy" and starts the Alloy service right away with the default configuration; deploy your config.alloy with it (Grafana documents /CONFIG and /DISABLEREPORTING for the installer).' },
  { name: 'Azure Connected Machine Agent (Azure Arc)', match: { product: /^azure connected machine agent/i, file: /AzureConnectedMachineAgent\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '1.70.03595.3521', uninstall: true }, note: 'Installing is only step one: himds, GCArcService and ExtensionService were running afterwards, but the machine is not in Azure until "azcmagent connect" runs with your subscription, resource group, location and a service principal (the onboarding script from the Azure portal does both). Disconnect with "azcmagent disconnect" before uninstalling, or the Azure resource is left behind.' },
  { name: 'New Relic Infrastructure Agent', match: { product: /^new relic infrastructure agent/i, file: /newrelic-infra.*\.msi/i }, install: 'msiexec /qn /i "{file}" GENERATE_CONFIG=true LICENSE_KEY="your-license-key"', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '2.0.2', uninstall: true }, note: 'GENERATE_CONFIG=true is REQUIRED alongside LICENSE_KEY, and the MSI does not declare it, so a scanner won\'t offer it. In the lab (2.0.2 as SYSTEM, with a dummy 40-character key in place of your-license-key): LICENSE_KEY alone installed the agent STOPPED, with newrelic-infra.yml still holding the template key "<ENTER YOUR NEW RELIC KEY HERE>"; with GENERATE_CONFIG=true the key landed in newrelic-infra.yml and the service was running.',
    properties: [
      { name: 'GENERATE_CONFIG', value: 'true', why: 'Write newrelic-infra.yml from these properties (without it LICENSE_KEY is ignored).' },
      { name: 'LICENSE_KEY', value: '', why: 'Your New Relic ingest license key.' },
      { name: 'DISPLAY_NAME', value: '', why: 'Name shown for this host in New Relic.' },
      { name: 'CUSTOM_ATTRIBUTES', value: '', why: 'Extra attributes for this host.' },
      { name: 'PROXY', value: '', why: 'Proxy URL for the agent\'s outbound traffic.' },
    ] },
  // Batch 18, 2026-11-11.
  { name: 'Windows Admin Center (v2)', match: { product: /^windows admin center/i, file: /WindowsAdminCenter\d+\.exe/i }, install: '{file} /VERYSILENT /NORESTART', uninstall: '"%ProgramFiles%\\WindowsAdminCenter\\unins000.exe" /VERYSILENT /NORESTART', verified: { on: '2026-11-11', version: '2.7.6.22', uninstall: true }, note: 'Version 2 is an Inno Setup exe, not the old MSI, so old msiexec lines and SME_PORT-style properties no longer apply. In the lab it took about 5 minutes as SYSTEM, registered as "Windows Admin Center (v2)" and listened on port 6600 (and 6601), not 443; open that port and browse to https://<server>:6600.' },
  { name: 'Azul Zulu JDK 21', match: { product: /^azul zulu/i, file: /zulu.*-ca-jdk21.*-win_x64\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '21.54.109 (21.0.13)', uninstall: true }, note: 'A plain MSI. It registers as "Azul Zulu JDK <build> (<java version>), 64-bit", so a detection rule on the name must not start at "Zulu".' },
  { name: 'Opera', match: { product: /^opera/i, file: /Opera_.*_Setup(_x64)?\.exe/i }, install: '{file} /silent /allusers=1 /launchbrowser=0', uninstall: '"%ProgramFiles%\\Opera\\opera.exe" /uninstall --runimmediately --deleteuserprofile=0', verified: { on: '2026-11-11', version: '140.0.6074.17', uninstall: true }, note: '/allusers=1 is what makes it machine-wide (=0 is per-user). It registers as "Opera Stable" and starts its browser_assistant process at install. The uninstall removed the Add/Remove Programs entry but left the C:\\Program Files\\Opera folder in the lab.' },
  { name: 'Mullvad VPN', match: { product: /^mullvad vpn/i, file: /MullvadVPN-.*_x64\.exe/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\Mullvad VPN\\Uninstall Mullvad VPN.exe" /allusers /S', verified: { on: '2026-11-11', version: '2026.5', uninstall: true }, note: 'NSIS (electron-builder), machine-wide. It installs and starts the MullvadVPN service (Automatic) at install; users sign in with their account number in the app.' },
  { name: 'Cyberduck', match: { product: /^cyberduck/i, file: /Cyberduck-Installer-.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '9.6.0.46406', uninstall: true }, note: 'Use the MSI (Cyberduck-Installer-*.msi) for a machine-wide deploy.' },
  { name: 'Angry IP Scanner', match: { product: /^angry ip scanner/i, file: /ipscan-.*-setup\.exe/i }, install: '{file} /S', uninstall: '"%ProgramFiles%\\Angry IP Scanner\\uninstall.exe" /S', verified: { on: '2026-11-11', version: '3.10.0', uninstall: true }, note: 'NSIS, machine-wide. The 3.10.0 installer is not code-signed; it matched the SHA-256 GitHub publishes for the release asset, which is worth checking before you deploy it.' },
  { name: 'Microsoft Remote Help', match: { product: /^remote help/i, file: /remotehelpinstaller/i }, install: '{file} /quiet /norestart acceptTerms=1', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-11-11', version: '5.2.1040.0', uninstall: true }, note: 'acceptTerms=1 is required for an unattended install; /quiet alone is not enough. A WiX bundle: it shows two "Remote Help" entries in Add/Remove Programs, and the bundle\'s /uninstall removed both. It still needs the Remote Help licence and Intune setup before anyone can connect.' },
  { name: 'Intel Driver & Support Assistant', match: { product: /^intel.*driver.*support assistant/i, file: /Intel-Driver-and-Support-Assistant-Installer\.exe/i }, install: '{file} /quiet /norestart', uninstall: '{file} /uninstall /quiet /norestart', verified: { on: '2026-11-11', version: '26.2.0.7', uninstall: true }, note: 'The download is a small online stub (about 9 MB) that fetches the rest at install time, so the machine needs internet access during the deploy. It installs DSAService and DSAUpdateService (both Automatic, running) and shows two entries in Add/Remove Programs; the bundle\'s /uninstall removed both.' },
  // Batch 21, 2026-11-11: runtimes and drivers older line-of-business apps still need.
  { name: 'Power BI Report Builder', match: { product: /^(microsoft )?power bi report builder/i, file: /PowerBIReportBuilder\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '15.7.1821.21', uninstall: true }, note: 'A plain MSI, separate from Power BI Desktop (for paginated reports).' },
  { name: 'Microsoft Visual C++ 2005 Redistributable (x64)', match: { product: /visual c\+\+ 2005 redistributable \(x64\)/i, file: /vcredist(2005)?_x64\.exe/i }, install: '{file} /q', uninstall: 'msiexec /x {ad8a2fa1-06e7-4b0d-927d-6e54b3d31028} /qn /norestart', verified: { on: '2026-11-11', version: '8.0.61000', uninstall: true }, note: 'An old IExpress wrapper: /q is the whole silent switch. 8.0.61000 is the final 2005 SP1 security update; the uninstall uses its MSI product code.' },
  { name: 'Microsoft Visual C++ 2005 Redistributable (x86)', match: { product: /visual c\+\+ 2005 redistributable$/i, file: /vcredist(2005)?_x86\.exe/i }, install: '{file} /q', uninstall: 'msiexec /x {710f4c1c-cc18-4c49-8cbf-51240c89a1a2} /qn /norestart', verified: { on: '2026-11-11', version: '8.0.61001', uninstall: true }, note: 'An old IExpress wrapper: /q is the whole silent switch. The x86 runtime registers as "Microsoft Visual C++ 2005 Redistributable" with no "(x86)" in the name, unlike the x64 one, so a name-based detection rule must not require "(x86)".' },
  // Batch 15, 2026-11-11.
  { name: 'ONLYOFFICE Desktop Editors', match: { product: /^onlyoffice/i, file: /DesktopEditors_x64\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', uninstall: '"%ProgramFiles%\\ONLYOFFICE\\DesktopEditors\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-11-11', version: '10.0.0', uninstall: true }, note: 'Inno Setup, machine-wide. It installs and starts its own update service (updatesvc) at install time.' },
  { name: 'Shotcut', match: { product: /^shotcut/i, file: /shotcut-win64-.*\.exe/i }, install: '{file} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS', uninstall: '"%ProgramFiles%\\Shotcut\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', verified: { on: '2026-11-11', version: '26.9.27', uninstall: true }, note: 'Inno Setup with both scopes, so pass /ALLUSERS for a machine-wide install (/CURRENTUSER is the per-user one).' },
  { name: 'calibre', match: { product: /^calibre/i, file: /calibre-64bit-.*\.msi/i }, install: 'msiexec /i "{file}" /qn /norestart', uninstall: 'msiexec /x "{file}" /qn /norestart', verified: { on: '2026-11-11', version: '9.18.0', uninstall: true }, note: 'The install folder is set with APPLICATIONFOLDER; INSTALLDIR is ignored by this package.' },
];

/**
 * Put the dropped file's name into a catalog command. Most entries write a bare {file} (it is the
 * program), so a name with spaces broke the line: Dropbox's own download is
 * "Dropbox 278.4.4020 Offline Installer.x64.exe", and the shown "Dropbox 278... /S" failed in CMD and
 * PowerShell (tested 2026-11-10). Quote a bare {file} when the name has whitespace; leave "{file}" alone.
 * The page's CMD note covers the other trap from that day's feedback: start "file.exe" /s answers
 * Invalid switch, because start takes the quoted name as the window title. Every page that
 * renders a catalog command goes through here, so the copy, the PSADT script and Intune agree.
 */
export function fillCatalogCmd(cmd: string, fileName: string): string {
  const q = /\s/.test(fileName) ? `"${fileName}"` : fileName;
  return cmd.split('"{file}"').map(part => part.split('{file}').join(q)).join(`"${fileName}"`);
}

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
