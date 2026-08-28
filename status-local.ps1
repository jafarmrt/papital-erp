# ============================================================
#  Papital ERP - Quick Status Check
#  Shows: PostgreSQL state, server health, DB size, migration count
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$pgCtl = "$root\.pgsql\bin\pg_ctl.exe"
if (-not (Test-Path $pgCtl)) {
    $pgCtl = "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe"
}

Write-Host "=== Papital ERP Status ===" -ForegroundColor Cyan

# PostgreSQL
& $pgCtl -D "$root\.pgdata" status 2>$null | Select-Object -First 1

# Health endpoints
$live = Invoke-WebRequest -Uri http://localhost:3000/health/live -UseBasicParsing -TimeoutSec 5
if ($live) { Write-Host "Liveness : UP (200)" -ForegroundColor Green } else { Write-Host "Liveness : DOWN" -ForegroundColor Red }

$ready = Invoke-WebRequest -Uri http://localhost:3000/health/ready -UseBasicParsing -TimeoutSec 5
if ($ready) {
    Write-Host "Readiness: UP (200)" -ForegroundColor Green
    Write-Host $ready.Content
} else {
    Write-Host "Readiness: DOWN" -ForegroundColor Red
}

# App version
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
Write-Host ("Version  : " + $pkg.version) -ForegroundColor Cyan
