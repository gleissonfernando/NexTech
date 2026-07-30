$ErrorActionPreference = "SilentlyContinue"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$patterns = @(
  "vite\bin\vite.js",
  "tsx\dist\cli.mjs",
  "tsx\dist\preflight.cjs",
  "npm run dev:backend",
  "npm run dev:frontend"
)

$processes = Get-CimInstance Win32_Process | Where-Object {
  if (-not $_.CommandLine) {
    return $false
  }

  if ($_.ProcessId -eq $PID) {
    return $false
  }

  if ($_.CommandLine -notlike "*$repoRoot*") {
    return $false
  }

  foreach ($pattern in $patterns) {
    if ($_.CommandLine -like "*$pattern*") {
      return $true
    }
  }

  return $false
}

foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force
  Write-Host "Stopped dev process $($process.ProcessId): $($process.Name)"
}

if (-not $processes) {
  Write-Host "No project dev processes running."
}
