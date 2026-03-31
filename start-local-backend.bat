@echo off
setlocal

set "SCRIPT_PATH=%~dp0start-local-timetable-tunnel.ps1"
if not exist "%SCRIPT_PATH%" (
  set "SCRIPT_PATH=E:\SJTU\Projects\Hackathon\Diary\duo-journal-apk\start-local-timetable-tunnel.ps1"
)
if not exist "%SCRIPT_PATH%" (
  echo [Duo Journal] Cannot find start-local-timetable-tunnel.ps1
  echo Tried:
  echo   %~dp0start-local-timetable-tunnel.ps1
  echo   E:\SJTU\Projects\Hackathon\Diary\duo-journal-apk\start-local-timetable-tunnel.ps1
  pause
  exit /b 1
)

for %%I in ("%SCRIPT_PATH%") do set "PROJECT_DIR=%%~dpI"
cd /d "%PROJECT_DIR%"

echo [Duo Journal] Starting local timetable backend + tunnel...
echo [Duo Journal] Keep this window open while Sync Timetable is in use.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_PATH%" %*

echo.
echo [Duo Journal] Backend process exited.
pause
