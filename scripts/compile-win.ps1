param(
  [ValidateSet("unpacked", "installer", "signed-installer", "all")]
  [string]$Target = "unpacked",
  [switch]$SkipInstall,
  [switch]$SkipTests,
  [switch]$RunE2E,
  [switch]$Clean,
  [switch]$KillExisting
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  if ($PSScriptRoot) {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  }
  return (Get-Location).Path
}

function Invoke-Step {
  param(
    [string]$Title,
    [scriptblock]$Action
  )
  Write-Host "==> $Title"
  & $Action
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Stop-SamuxyProcess {
  param([string]$ElectronPath)
  $normalizedElectronPath = (Resolve-Path $ElectronPath).Path.ToLowerInvariant()
  $processes = Get-CimInstance Win32_Process | Where-Object {
    $name = if ($_.Name) { $_.Name.ToLowerInvariant() } else { "" }
    $commandLine = if ($_.CommandLine) { $_.CommandLine.ToLowerInvariant() } else { "" }
    $name -eq "samuxy.exe" -or
      ($name -in @("node.exe", "electron.exe") -and $commandLine.Contains($normalizedElectronPath)) -or
      $commandLine.Contains("samuxy")
  }

  foreach ($process in $processes) {
    Write-Host "Stopping existing process $($process.ProcessId) $($process.Name)"
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Remove-GeneratedOutput {
  param([string]$ElectronPath)
  $root = (Resolve-Path $ElectronPath).Path
  foreach ($relativePath in @("dist", "build", "release")) {
    $target = Join-Path $root $relativePath
    if ((Test-Path $target) -and ((Resolve-Path $target).Path.StartsWith($root))) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
  }
}

$repoRoot = Resolve-RepoRoot
$electronRoot = Join-Path $repoRoot "electron"
$packageJson = Join-Path $electronRoot "package.json"

if (-not (Test-Path $packageJson)) {
  throw "Electron package.json was not found at $packageJson"
}

if (-not (Test-Command "node")) {
  throw "Node.js is required but was not found in PATH."
}

if (-not (Test-Command "npm")) {
  throw "npm is required but was not found in PATH."
}

if ($KillExisting) {
  Invoke-Step "Stop existing samuxy/Electron processes" {
    Stop-SamuxyProcess -ElectronPath $electronRoot
  }
}

if ($Clean) {
  Invoke-Step "Remove generated Windows build output" {
    Remove-GeneratedOutput -ElectronPath $electronRoot
  }
}

Push-Location $electronRoot
try {
  if (-not $SkipInstall -or -not (Test-Path "node_modules")) {
    Invoke-Step "Install dependencies" {
      if (Test-Path "package-lock.json") {
        npm ci
      } else {
        npm install
      }
    }
  }

  Invoke-Step "Prepare icon assets" {
    npm run prepare:icon
  }

  Invoke-Step "Typecheck" {
    npm run typecheck
  }

  if (-not $SkipTests) {
    Invoke-Step "Run unit tests" {
      npm test
    }
    if ($RunE2E) {
      Invoke-Step "Run Electron E2E tests" {
        npm run test:e2e
      }
    }
  }

  if ($Target -eq "unpacked" -or $Target -eq "all") {
    Invoke-Step "Build unpacked Windows package" {
      npm run pack:win
    }
  }

  if ($Target -eq "installer" -or $Target -eq "all") {
    Invoke-Step "Build Windows installer" {
      npm run dist:win
    }
  }

  if ($Target -eq "signed-installer") {
    Invoke-Step "Build signed Windows installer" {
      npm run dist:win:signed
    }
  }

  Write-Host ""
  Write-Host "Build complete."
  Write-Host "Unpacked app: $electronRoot\release\win-unpacked\samuxy.exe"
  Write-Host "Installer:    $electronRoot\release\samuxy-0.1.0-x64.exe"
} finally {
  Pop-Location
}
