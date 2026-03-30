$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root "msup"

if (Test-Path $out) {
  Remove-Item -Recurse -Force $out
}
New-Item -ItemType Directory -Path $out | Out-Null

function Copy-IfExists {
  param(
    [string]$SourcePath,
    [string]$TargetPath
  )
  if (Test-Path $SourcePath) {
    $parent = Split-Path -Parent $TargetPath
    if ($parent -and -not (Test-Path $parent)) {
      New-Item -ItemType Directory -Path $parent | Out-Null
    }
    Copy-Item -Recurse -Force $SourcePath $TargetPath
  }
}

# Minimal files needed for ModelScope app startup
Copy-IfExists (Join-Path $root "app.py") (Join-Path $out "app.py")
Copy-IfExists (Join-Path $root "agent.py") (Join-Path $out "agent.py")
Copy-IfExists (Join-Path $root "requirements.txt") (Join-Path $out "requirements.txt")
Copy-IfExists (Join-Path $root "Dockerfile") (Join-Path $out "Dockerfile")
Copy-IfExists (Join-Path $root "ms_deploy.json") (Join-Path $out "ms_deploy.json")
Copy-IfExists (Join-Path $root "agentconfig") (Join-Path $out "agentconfig")
Copy-IfExists (Join-Path $root "dist") (Join-Path $out "dist")

Write-Host "ModelScope upload package created:"
Write-Host "  $out"
Write-Host ""
Write-Host "Upload ONLY this folder to avoid long-path failures."
