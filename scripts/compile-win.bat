@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%compile-win.ps1"

if not exist "%PS_SCRIPT%" (
  echo compile-win.ps1 was not found at "%PS_SCRIPT%"
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
exit /b %ERRORLEVEL%
