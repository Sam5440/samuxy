@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%start-test-project.ps1"

if not exist "%PS_SCRIPT%" (
  echo start-test-project.ps1 was not found at "%PS_SCRIPT%"
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
exit /b %ERRORLEVEL%
