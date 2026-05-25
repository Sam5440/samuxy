param(
  [ValidateSet("packaged", "dev")]
  [string]$Mode = "packaged",
  [string]$WorkspaceRoot,
  [int]$MobilePort = 58765,
  [switch]$SkipInstall,
  [switch]$NoBuild,
  [switch]$KillExisting,
  [switch]$Reset,
  [switch]$PrepareOnly
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

function New-ID {
  return [guid]::NewGuid().ToString()
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

function Write-Utf8File {
  param(
    [string]$Path,
    [string]$Content
  )
  $directory = Split-Path -Parent $Path
  if ($directory) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

function Write-TestProject {
  param(
    [string]$ProjectPath,
    [string]$Title
  )
  New-Item -ItemType Directory -Path $ProjectPath -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $ProjectPath "src") -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $ProjectPath "docs") -Force | Out-Null

  Write-Utf8File -Path (Join-Path $ProjectPath "README.md") -Content "# $Title`n`nThis is a samuxy Windows test project.`n"
  Write-Utf8File -Path (Join-Path $ProjectPath "src\app.ts") -Content "export const samuxyTestValue: number = 42;`n"
  Write-Utf8File -Path (Join-Path $ProjectPath "docs\notes.md") -Content "# Notes`n`n- Terminal`n- File tree`n- Source control`n"
  Write-Utf8File -Path (Join-Path $ProjectPath "data.json") -Content "{`n  `"name`": `"$Title`",`n  `"enabled`": true`n}`n"

  [byte[]]$png = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=")
  [IO.File]::WriteAllBytes((Join-Path $ProjectPath "pixel.png"), $png)
  [IO.File]::WriteAllBytes((Join-Path $ProjectPath "unsupported.bin"), [byte[]](0, 1, 2, 3, 4, 5))

  if (Test-Command "git") {
    Push-Location $ProjectPath
    try {
      if (-not (Test-Path ".git")) {
        git init | Out-Null
      }
      git add README.md src/app.ts docs/notes.md data.json pixel.png unsupported.bin | Out-Null
    } finally {
      Pop-Location
    }
  }
}

function New-ProjectState {
  param(
    [string]$ProjectPath,
    [int]$SortOrder
  )
  $createdAt = (Get-Date).ToUniversalTime().ToString("o")
  $projectID = New-ID
  $worktreeID = New-ID
  $areaID = New-ID
  $tabID = New-ID
  $paneID = New-ID
  $name = Split-Path -Leaf $ProjectPath

  return [ordered]@{
    project = [ordered]@{
      id = $projectID
      name = $name
      path = $ProjectPath
      sortOrder = $SortOrder
      createdAt = $createdAt
    }
    worktree = [ordered]@{
      id = $worktreeID
      name = $name
      path = $ProjectPath
      isPrimary = $true
      canBeRemoved = $false
      createdAt = $createdAt
    }
    workspace = [ordered]@{
      projectID = $projectID
      worktreeID = $worktreeID
      focusedAreaID = $areaID
      root = [ordered]@{
        type = "tabArea"
        tabArea = [ordered]@{
          id = $areaID
          projectPath = $ProjectPath
          tabs = @(
            [ordered]@{
              id = $tabID
              kind = "terminal"
              title = "PowerShell"
              isPinned = $false
              paneID = $paneID
            }
          )
          activeTabID = $tabID
        }
      }
    }
  }
}

function Write-AppDataFixture {
  param(
    [string]$AppDataPath,
    [string]$UsagePath,
    [string]$PrimaryProject,
    [string]$SecondaryProject,
    [int]$Port
  )
  New-Item -ItemType Directory -Path $AppDataPath -Force | Out-Null
  New-Item -ItemType Directory -Path $UsagePath -Force | Out-Null

  $primary = New-ProjectState -ProjectPath $PrimaryProject -SortOrder 0
  $secondary = New-ProjectState -ProjectPath $SecondaryProject -SortOrder 1

  $snapshot = [ordered]@{
    projects = @($primary.project, $secondary.project)
    worktrees = [ordered]@{
      "$($primary.project.id)" = @($primary.worktree)
      "$($secondary.project.id)" = @($secondary.worktree)
    }
    workspaces = [ordered]@{
      "$($primary.project.id)" = $primary.workspace
      "$($secondary.project.id)" = $secondary.workspace
    }
  }

  $settings = [ordered]@{
    mobilePort = $Port
  }

  $usage = [ordered]@{
    five_hour = [ordered]@{
      utilization = 22
    }
  }

  ($snapshot | ConvertTo-Json -Depth 30) | Set-Content -LiteralPath (Join-Path $AppDataPath "app-model.json") -Encoding UTF8
  ($settings | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath (Join-Path $AppDataPath "settings.json") -Encoding UTF8
  ($usage | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath (Join-Path $UsagePath "claude-usage.json") -Encoding UTF8
}

function Start-WithEnvironment {
  param(
    [string]$FilePath,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [hashtable]$Environment
  )
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.Arguments = $Arguments
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  foreach ($key in $Environment.Keys) {
    $psi.Environment[$key] = [string]$Environment[$key]
  }
  return [System.Diagnostics.Process]::Start($psi)
}

$repoRoot = Resolve-RepoRoot
if (-not $WorkspaceRoot) {
  $WorkspaceRoot = Join-Path $repoRoot ".samuxy-test"
}

$electronRoot = Join-Path $repoRoot "electron"
$primaryProject = Join-Path $WorkspaceRoot "projects\samuxy-test-primary"
$secondaryProject = Join-Path $WorkspaceRoot "projects\samuxy-test-secondary"
$appData = Join-Path $WorkspaceRoot "app-data"
$usage = Join-Path $WorkspaceRoot "usage"

if (-not (Test-Path (Join-Path $electronRoot "package.json"))) {
  throw "Electron package.json was not found under $electronRoot"
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

if ($Reset -and (Test-Path $WorkspaceRoot)) {
  $resolvedRoot = (Resolve-Path $WorkspaceRoot).Path
  if ($resolvedRoot.StartsWith($repoRoot)) {
    Invoke-Step "Reset test workspace" {
      Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
    }
  } else {
    throw "Refusing to reset test workspace outside the repository: $resolvedRoot"
  }
}

Invoke-Step "Prepare test projects and isolated app data" {
  Write-TestProject -ProjectPath $primaryProject -Title "samuxy Test Primary"
  Write-TestProject -ProjectPath $secondaryProject -Title "samuxy Test Secondary"
  Write-AppDataFixture -AppDataPath $appData -UsagePath $usage -PrimaryProject $primaryProject -SecondaryProject $secondaryProject -Port $MobilePort
}

Write-Host "Test workspace: $WorkspaceRoot"
Write-Host "Primary project: $primaryProject"
Write-Host "App data: $appData"
Write-Host "Mobile port: $MobilePort"

if ($PrepareOnly) {
  Write-Host "PrepareOnly was set. Test project data is ready; launch skipped."
  exit 0
}

if ($Mode -eq "packaged") {
  $exe = Join-Path $electronRoot "release\win-unpacked\samuxy.exe"
  if ((-not (Test-Path $exe)) -or (-not $NoBuild)) {
    Invoke-Step "Build unpacked Windows package" {
      & (Join-Path $PSScriptRoot "compile-win.ps1") -Target unpacked -SkipInstall:$SkipInstall -SkipTests
    }
  }
  if (-not (Test-Path $exe)) {
    throw "Packaged executable was not found at $exe"
  }
  Invoke-Step "Launch packaged samuxy test project" {
    $process = Start-WithEnvironment -FilePath $exe -Arguments "" -WorkingDirectory $primaryProject -Environment @{
      SAMUXY_APP_DATA_DIR = $appData
      SAMUXY_AI_USAGE_DIR = $usage
    }
    Write-Host "samuxy test process started: $($process.Id)"
  }
  exit 0
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

  if (-not $NoBuild) {
    Invoke-Step "Build Electron app" {
      npm run build
    }
  }

  $npx = (Get-Command "npx.cmd" -ErrorAction SilentlyContinue)
  if (-not $npx) {
    $npx = Get-Command "npx" -ErrorAction Stop
  }

  Invoke-Step "Launch dev samuxy test project" {
    $process = Start-WithEnvironment -FilePath $npx.Source -Arguments "electron ." -WorkingDirectory $electronRoot -Environment @{
      SAMUXY_APP_DATA_DIR = $appData
      SAMUXY_AI_USAGE_DIR = $usage
    }
    Write-Host "samuxy dev test process started: $($process.Id)"
  }
} finally {
  Pop-Location
}
