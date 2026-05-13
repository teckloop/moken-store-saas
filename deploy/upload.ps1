# Upload project to VPS via SSH/SCP
# Usage:
#   .\deploy\upload.ps1 -VpsIp 203.0.113.10
# Requires OpenSSH built-in (Windows 10/11).

param(
  [Parameter(Mandatory=$true)]
  [string]$VpsIp,
  [string]$VpsUser = "root",
  [string]$RemotePath = "/var/www/moken"
)

$projectRoot = Split-Path $PSScriptRoot -Parent
Write-Host "==> Project root: $projectRoot" -ForegroundColor Cyan
Write-Host "==> Target: ${VpsUser}@${VpsIp}:${RemotePath}" -ForegroundColor Cyan

# Files/folders to exclude
$excludes = @(
  "node_modules",
  "*/node_modules",
  "*/*/node_modules",
  "dist",
  "*/dist",
  "*/*/dist",
  ".git",
  ".vscode",
  ".idea",
  "apps/api/data",
  "*.log",
  ".env"
)

# Use tar over SSH (fast, handles many small files)
Write-Host "==> Creating archive and streaming to VPS..." -ForegroundColor Yellow

$excludeArgs = ($excludes | ForEach-Object { "--exclude=`"$_`"" }) -join " "

Push-Location $projectRoot
try {
  # Ensure remote dir exists
  ssh "${VpsUser}@${VpsIp}" "mkdir -p $RemotePath"

  # Tar locally and untar remotely in one pipeline
  $cmd = "tar $excludeArgs --exclude-vcs -cf - . | ssh ${VpsUser}@${VpsIp} 'tar -xf - -C $RemotePath'"
  Write-Host "Running: $cmd" -ForegroundColor DarkGray
  Invoke-Expression $cmd

  Write-Host ""
  Write-Host "============================================" -ForegroundColor Green
  Write-Host "✅ Upload complete" -ForegroundColor Green
  Write-Host "============================================" -ForegroundColor Green
  Write-Host "Next: ssh ${VpsUser}@${VpsIp} 'bash $RemotePath/deploy/install-app.sh'" -ForegroundColor Yellow
} finally {
  Pop-Location
}
