<#
    Extract-BurnBundle.ps1  -  from SwitchHunt (getrff.com/switchhunt)
    Written by Brian Vitko. Free to use and share.

    Unpacks a WiX "Burn" bootstrapper .exe into its real inner files (the prerequisite EXEs, the MSI,
    and the MSI's external cabs) with their PROPER names, so you can drive a silent install directly.

    Why you need this: a Burn .exe is a stub + attached CAB containers. 7-Zip and WinRAR only show the
    FIRST container (the bootstrapper's own files); the MSI lives in a second container they don't
    expose. Some vendor bundles also ship a custom bootstrapper that ignores /quiet and /layout, so the
    normal silent switch pops a wizard. This reads the bundle's own manifest, extracts every payload,
    and renames them from cryptic ids (a0, a1, ...) back to real filenames.

    Nothing leaves your machine. Uses only built-in Windows tools (expand.exe).

    USAGE:
      .\Extract-BurnBundle.ps1 -Path .\Some_Installer.exe
      .\Extract-BurnBundle.ps1 -Path .\Some_Installer.exe -OutDir C:\extracted

    Then install silently from the output folder, e.g.:
      .\vc_redist.x64.exe /install /quiet /norestart
      msiexec /i "App.msi" /qn /norestart
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'
$Path = (Resolve-Path $Path).Path
if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent $Path) (([System.IO.Path]::GetFileNameWithoutExtension($Path)) + '_extracted') }
$bytes = [System.IO.File]::ReadAllBytes($Path)

function U16([int]$o) { return [BitConverter]::ToUInt16($bytes, $o) }
function U32([int]$o) { return [int][BitConverter]::ToUInt32($bytes, $o) }
function Is-Mscf([int]$o) { return ($bytes[$o] -eq 0x4d -and $bytes[$o+1] -eq 0x53 -and $bytes[$o+2] -eq 0x43 -and $bytes[$o+3] -eq 0x46) }

# --- Locate the Burn stub via the PE .wixburn section ------------------------------------------------
$pe = U32 0x3c
if ((U32 $pe) -ne 0x00004550) { throw "Not a PE executable." }
$nsec = U16 ($pe + 6)
$optSize = U16 ($pe + 20)
$secBase = $pe + 24 + $optSize
$praw = -1
for ($i = 0; $i -lt $nsec; $i++) {
    $off = $secBase + $i * 40
    $name = [System.Text.Encoding]::ASCII.GetString($bytes, $off, 8).TrimEnd([char]0)
    if ($name -eq '.wixburn') { $praw = U32 ($off + 20); break }
}
if ($praw -lt 0) { throw "No .wixburn section - this is not a WiX Burn bundle." }
if ((U32 $praw) -ne 0x00f14300) { throw "Unexpected Burn section signature." }
$stubSize = U32 ($praw + 24)

function Carve-Cab([int]$off, [string]$dest) {
    if (-not (Is-Mscf $off)) { throw "No CAB found at offset $off." }
    $cb = U32 ($off + 8)
    $slice = New-Object byte[] $cb
    [Array]::Copy($bytes, $off, $slice, 0, $cb)
    [System.IO.File]::WriteAllBytes($dest, $slice)
    return $cb
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$tmp = Join-Path $OutDir '_burn_tmp'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host "Reading bundle manifest..." -ForegroundColor Cyan

# --- Container 1 (UX): pull BurnManifest.xml (member "0") --------------------------------------------
$uxCab = Join-Path $tmp 'ux.cab'
$uxSize = Carve-Cab $stubSize $uxCab
& expand.exe $uxCab "-F:0" $tmp | Out-Null
$manifest = Join-Path $tmp 'BurnManifest.xml'
Move-Item (Join-Path $tmp '0') $manifest -Force
[xml]$m = Get-Content $manifest

# Two lookups from the manifest's <Payload> elements:
#   $map   SourcePath (a0, a1, ...) -> real FilePath   (used to rename the extracted members)
#   $idMap Payload Id               -> real FilePath   (a chain package names its primary payload by Id)
$map = @{}
$idMap = @{}
foreach ($p in $m.GetElementsByTagName('Payload')) {
    $sp = $p.GetAttribute('SourcePath'); $fp = $p.GetAttribute('FilePath'); $plid = $p.GetAttribute('Id')
    if ($sp -and $fp) { $map[$sp] = $fp }
    if ($plid -and $fp -and -not $idMap.ContainsKey($plid)) { $idMap[$plid] = $fp }
}

# --- Container 2 (payload): the real files -----------------------------------------------------------
$p2 = $stubSize + $uxSize
while ($p2 -lt ($bytes.Length - 4) -and -not (Is-Mscf $p2)) { $p2++ }   # skip alignment padding
if (-not (Is-Mscf $p2)) { throw "Could not find the payload container." }
$plCab = Join-Path $tmp 'payload.cab'
Carve-Cab $p2 $plCab | Out-Null
Write-Host "Extracting payloads..." -ForegroundColor Cyan
& expand.exe $plCab "-F:*" $OutDir | Out-Null

# Rename the cryptic members (a0, a1, ...) back to their real filenames.
$renamed = 0
Get-ChildItem $OutDir -File | ForEach-Object {
    if ($map.ContainsKey($_.Name)) {
        $target = Join-Path $OutDir ($map[$_.Name] -replace '/', '\')
        $td = Split-Path -Parent $target
        if ($td -and -not (Test-Path $td)) { New-Item -ItemType Directory -Force -Path $td | Out-Null }
        Move-Item $_.FullName $target -Force
        $renamed++
    }
}
Remove-Item $tmp -Recurse -Force

# --- Report the chain + ready-to-run silent commands ------------------------------------------------
Write-Host ""
Write-Host "Extracted $renamed file(s) to:" -ForegroundColor Green
Write-Host "  $OutDir"
Write-Host ""
Write-Host "The bundle installs this chain, in order:" -ForegroundColor Green
$chainEl = $m.GetElementsByTagName('Chain')
$hints = New-Object System.Collections.ArrayList
if ($chainEl.Count -gt 0) {
    foreach ($pkg in $chainEl[0].ChildNodes) {
        $ln = $pkg.LocalName
        if ($ln -eq 'ExePackage' -or $ln -eq 'MsiPackage' -or $ln -eq 'MspPackage' -or $ln -eq 'MsuPackage') {
            $id = $pkg.GetAttribute('Id')
            $file = if ($idMap.ContainsKey($id)) { $idMap[$id] } else { $id }
            if ($ln -eq 'ExePackage') {
                $ia = $pkg.GetAttribute('InstallArguments')
                Write-Host ("  [EXE] {0}  {1}" -f $file, $ia)
                [void]$hints.Add(('.\{0} {1}' -f $file, $ia).Trim())
            } elseif ($ln -eq 'MsiPackage') {
                Write-Host ("  [MSI] {0}" -f $file)
                [void]$hints.Add(('msiexec /i "{0}" /qn /norestart' -f $file))
            } else {
                Write-Host ("  [{0}] {1}" -f $ln, $file)
            }
        }
    }
}
Write-Host ""
Write-Host "Silent install (run elevated, from the folder above):" -ForegroundColor Cyan
foreach ($h in $hints) { Write-Host "  $h" }
Write-Host ""
Write-Host "Always pilot in a throwaway VM before deploying." -ForegroundColor DarkGray
