$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true' -or -not $IsWindows) {
  throw 'Run this installer test only on a disposable Windows CI runner.'
}
$installer = @(Get-ChildItem 'release/*-Windows-*-Setup.exe')
if ($installer.Count -ne 1) { throw 'Expected exactly one Windows installer.' }
$installDir = Join-Path $env:RUNNER_TEMP '安装验证 Spine Shelf'
$library = Join-Path $env:APPDATA 'Spine Shelf/Library'
$marker = Join-Path $library ('installer-test-' + [guid]::NewGuid() + '.txt')
New-Item -ItemType Directory -Force $library | Out-Null
Set-Content $marker 'Keep my library when upgrading or uninstalling.'

function Install-App {
  $process = Start-Process $installer[0].FullName -ArgumentList "/S /currentuser /D=$installDir" -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
  if (-not (Test-Path "$installDir/Spine Shelf.exe")) { throw 'Installed application is missing.' }
  if (-not (Test-Path $marker)) { throw 'Installation removed library data.' }
}

try {
  Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture | Format-List
  Install-App
  foreach ($notice in @('LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/spine-4.2.txt', 'examples/LICENSE', 'icon.ico')) {
    if (-not (Test-Path "$installDir/resources/$notice")) { throw "Missing bundled notice/icon: $notice" }
  }
  $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Spine Shelf.lnk'
  if (-not (Test-Path $shortcut)) { throw 'Start menu shortcut is missing.' }
  $env:SPINE_SHELF_EXECUTABLE = Join-Path $installDir 'Spine Shelf.exe'
  npm run test:e2e
  if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke test failed.' }
  $env:SPINE_TEST_APP = $env:SPINE_SHELF_EXECUTABLE
  npm run test:projects
  if ($LASTEXITCODE -ne 0) { throw 'Installed application project export test failed.' }
  # Installing the same version again exercises the existing-install path.
  Install-App
  $uninstaller = Get-ChildItem "$installDir/*Uninstall*.exe" | Select-Object -First 1
  if (-not $uninstaller) { throw 'Uninstaller is missing.' }
  $process = Start-Process $uninstaller.FullName -ArgumentList '/S /currentuser' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
  if (Test-Path "$installDir/Spine Shelf.exe") { throw 'Uninstaller left the application executable behind.' }
  if (-not (Test-Path $marker)) { throw 'Uninstall removed user library data.' }
  Write-Host 'PASS: install, start menu shortcut, bundled notices, installed app E2E, reinstall and uninstall with library retention'
} finally {
  Remove-Item Env:SPINE_SHELF_EXECUTABLE -ErrorAction SilentlyContinue
  Remove-Item Env:SPINE_TEST_APP -ErrorAction SilentlyContinue
  Remove-Item $marker -ErrorAction SilentlyContinue
}
