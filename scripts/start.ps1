param(
  [ValidateSet("dev", "packaged")]
  [string]$Mode = "dev",
  [switch]$SkipInstall,
  [switch]$KillExisting,
  [switch]$NoBuild
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
      ($name -in @("node.exe", "electron.exe") -and $commandLine.Contains($normalizedElectronPath.ToLowerInvariant())) -or
      $commandLine.Contains("samuxy")
  }

  foreach ($process in $processes) {
    Write-Host "Stopping existing process $($process.ProcessId) $($process.Name)"
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
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
  Invoke-Step "Stop existing samuxy/Electron processes for this project" {
    Stop-SamuxyProcess -ElectronPath $electronRoot
  }
}

Push-Location $electronRoot
try {
  if (-not $SkipInstall -or -not (Test-Path "node_modules")) {
    Invoke-Step "Install Electron dependencies" {
      if (Test-Path "package-lock.json") {
        npm ci
      } else {
        npm install
      }
    }
  }

  Invoke-Step "Prepare Windows icon assets" {
    npm run prepare:icon
  }

  if ($Mode -eq "packaged") {
    if (-not (Test-Path "release\win-unpacked\samuxy.exe") -or -not $NoBuild) {
      Invoke-Step "Build unpacked Windows package" {
        npm run pack:win
      }
    }
    $exe = Join-Path (Get-Location).Path "release\win-unpacked\samuxy.exe"
    if (-not (Test-Path $exe)) {
      throw "Packaged executable was not found at $exe"
    }
    Invoke-Step "Launch packaged samuxy" {
      Start-Process -FilePath $exe -WorkingDirectory (Get-Location).Path
    }
    Write-Host "samuxy launched from $exe"
    exit 0
  }

  if ($NoBuild) {
    Invoke-Step "Launch Electron without rebuilding" {
      npx electron .
    }
  } else {
    Invoke-Step "Build and launch Electron" {
      npm run electron
    }
  }
} finally {
  Pop-Location
}
