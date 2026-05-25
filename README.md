# samuxy

samuxy is a Windows-only Electron desktop app for project workspaces, terminal panes, file browsing, lightweight file preview/editing, source-control status, AI usage summaries, and mobile remote control.

This repository is prepared as a standalone Windows distribution. The app source, tests, and packaging configuration live under `electron/`; launch and build scripts live under `scripts/`.

## Reference Source

samuxy is a Windows/Electron adaptation of the original Muxy desktop workflow. The reference behavior came from the upstream macOS Muxy project structure and documentation that existed before this Windows-only cleanup:

- project/worktree/workspace model
- tabs, split panes, terminal ownership, and mobile remote protocol
- file tree, editor/preview behavior, AI usage panel, notifications, and source-control panel
- Git management behavior modeled from the original macOS VCS implementation

The macOS Swift source and macOS release pipeline have been removed from this repository so the new repository can ship only the Windows version.

## Requirements

- Windows 10/11
- Node.js 22
- npm
- Git

## Install Dependencies

```powershell
cd electron
npm ci
```

## Run In Development

From the repository root:

```powershell
.\scripts\start.bat -Mode dev -KillExisting
```

Or directly from the Electron package:

```powershell
cd electron
npm run electron
```

## Build Windows Package

Unpacked Windows build:

```powershell
cd electron
npm run pack:win
```

Or from the repository root:

```powershell
.\scripts\compile-win.bat -Target unpacked
```

The executable is generated at:

```text
electron\release\win-unpacked\samuxy.exe
```

NSIS installer build:

```powershell
cd electron
npm run dist:win
```

Signed installer build requires `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`:

```powershell
cd electron
npm run dist:win:signed
```

## Test

```powershell
cd electron
npm run typecheck
npm test
npm run test:e2e
```

Full Windows CI script:

```powershell
cd electron
npm run ci:windows
```

GitHub Actions:

- `.github/workflows/electron-windows.yml` runs Windows verification and packaging on every push to `main` and every pull request targeting `main`.
- `.github/workflows/release-windows.yml` publishes a GitHub Release automatically when the root `version` value changes on `main`.
- To release a new version, update the root `version` file, commit it, and push to `main`. The release workflow syncs that value into `electron/package.json`, builds the Windows installer, creates or updates tag `vX.Y.Z`, and uploads the installer, blockmap, and `latest.yml`.

## Start A Test Project

Create an isolated test workspace under `.samuxy-test/` and launch samuxy against it:

```powershell
.\scripts\start-test-project.bat -Mode packaged -NoBuild -SkipInstall -KillExisting
```

## Runtime Data

Default Windows app data location:

```text
%APPDATA%\samuxy
```

Useful local overrides:

```text
SAMUXY_APP_DATA_DIR
SAMUXY_AI_USAGE_DIR
SAMUXY_VERSION_FILE
SAMUXY_REMOTE_VERSION_URL
SAMUXY_REPOSITORY_URL
```

## Update Checks

samuxy reads the local version from the repository root `version` file, then compares it with:

```text
https://raw.githubusercontent.com/Sam5440/samuxy/refs/heads/main/version
```

samuxy checks this file on every app startup and every project/workspace switch. When the remote version is newer, the Windows UI shows an update reminder. Clicking `打开更新` opens:

```text
https://github.com/Sam5440/samuxy
```


## Repository Layout

```text
electron/
  assets/                 Windows packaging assets
  scripts/                Electron build helper scripts
  src/main/               Electron main process
  src/renderer/           React renderer
  src/shared/             Shared protocol DTOs
  tests/                  Vitest and Playwright tests
  package.json            Windows app package and electron-builder config
scripts/
  compile-win.bat         Windows compile/package entry
  start.bat               Windows app launcher entry
  start-test-project.bat  Isolated test-project launcher entry
```
