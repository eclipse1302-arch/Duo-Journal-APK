param(
  [int]$Port = 7860,
  [switch]$ForceLocalTunnel
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$venvDir = Join-Path $root ".venv_timetable"
$venvPy = Join-Path $venvDir "Scripts\\python.exe"

if (-not (Test-Path $venvPy)) {
  Write-Host "[setup] Creating virtual environment at $venvDir"
  python -m venv $venvDir
}

Write-Host "[setup] Installing Python dependencies"
& $venvPy -m pip install -r (Join-Path $root "requirements.txt")

$toolsDir = Join-Path $root ".tools"
if (-not (Test-Path $toolsDir)) {
  New-Item -ItemType Directory -Path $toolsDir | Out-Null
}

$cloudflaredExe = Join-Path $toolsDir "cloudflared.exe"
$useCloudflared = $false
if ($ForceLocalTunnel) {
  Write-Host "[setup] ForceLocalTunnel enabled. Skipping cloudflared."
  $useCloudflared = $false
} elseif (Test-Path $cloudflaredExe) {
  try {
    & $cloudflaredExe --version | Out-Null
    $useCloudflared = $true
  } catch {
    Write-Host "[setup] Existing cloudflared is not runnable, switching to localtunnel."
    $useCloudflared = $false
  }
} else {
  $downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Write-Host "[setup] Downloading cloudflared from $downloadUrl"
  try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $cloudflaredExe -TimeoutSec 45
    try {
      & $cloudflaredExe --version | Out-Null
      $useCloudflared = $true
    } catch {
      Write-Host "[setup] Downloaded cloudflared is not runnable, switching to localtunnel."
      $useCloudflared = $false
    }
  } catch {
    Write-Host "[setup] cloudflared download failed, will use localtunnel fallback."
  }
}

$env:PORT = "$Port"
Write-Host "[run] Starting local backend on http://127.0.0.1:$Port"
$backendProc = Start-Process -FilePath $venvPy -ArgumentList "app.py" -WorkingDirectory $root -PassThru

try {
  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/version" -Method GET -TimeoutSec 2
      Write-Host "[run] Backend ready. Version: $($version.version)"
      $ready = $true
      break
    } catch {
      # keep waiting
    }
  }

  if (-not $ready) {
    throw "Local backend did not become ready on port $Port"
  }

  Write-Host ""
  if ($useCloudflared) {
    Write-Host "[tunnel] Starting Cloudflare quick tunnel..."
    Write-Host "[tunnel] Keep this window open. Press Ctrl+C to stop."
    Write-Host "[tunnel] Use the printed https://*.trycloudflare.com as VITE_TIMETABLE_API_BASE"
    Write-Host ""
    & $cloudflaredExe tunnel --url "http://127.0.0.1:$Port" --no-autoupdate
  } else {
    Write-Host "[tunnel] Starting localtunnel fallback..."
    Write-Host "[tunnel] Keep this window open. Press Ctrl+C to stop."
    Write-Host "[tunnel] Use the printed https://*.loca.lt as VITE_TIMETABLE_API_BASE"
    Write-Host ""
    npx localtunnel --port $Port
  }
}
finally {
  if ($backendProc -and -not $backendProc.HasExited) {
    Write-Host "[cleanup] Stopping local backend..."
    Stop-Process -Id $backendProc.Id -Force
  }
}
