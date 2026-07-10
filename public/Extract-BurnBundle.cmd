@echo off
REM Extract-BurnBundle.cmd  -  drag-and-drop launcher for Extract-BurnBundle.ps1
REM From SwitchHunt (getrff.com/switchhunt). Written by Brian Vitko.
REM Keep this file in the SAME folder as Extract-BurnBundle.ps1, then drag a WiX
REM Burn installer .exe onto THIS file to unpack it.
setlocal
if "%~1"=="" (
  echo.
  echo   Drag a WiX Burn installer .exe onto this file to extract it.
  echo.
  echo   Or run the script directly:
  echo     powershell -ExecutionPolicy Bypass -File "Extract-BurnBundle.ps1" -Path "YourInstaller.exe"
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Extract-BurnBundle.ps1" -Path "%~1"
echo.
pause
