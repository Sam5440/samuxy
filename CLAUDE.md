# samuxy

Windows-only Electron distribution.

## Development

Work from the `electron` directory for application code, tests, packaging, and release configuration.

```powershell
cd electron
npm ci
npm run typecheck
npm test
npm run test:e2e
npm run pack:win
```

The `scripts/start.bat` and `scripts/start.ps1` scripts are the supported local launchers for Windows:

```powershell
.\scripts\start.bat -Mode dev -KillExisting
.\scripts\start.bat -Mode packaged -SkipInstall -NoBuild -KillExisting
```

## Rules

- Keep this repository Windows/Electron-only.
- Do not reintroduce macOS Swift targets, SPM files, Sparkle appcasts, Homebrew release scripts, or macOS-only documentation.
- Prefer tested changes. If behavior is user-facing or protocol-facing, add or update Vitest and Playwright coverage.
- Keep generated output out of source control: `electron/dist`, `electron/release`, `electron/build`, `electron/test-results`, and `electron/node_modules`.
