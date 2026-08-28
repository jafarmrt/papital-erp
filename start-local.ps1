# ============================================================
#  Papital ERP - Local Startup Script
#  Starts: Portable PostgreSQL -> Dev Server (API + Frontend)
#  URL: http://localhost:3000
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$pgCtl = "$root\.pgsql\bin\pg_ctl.exe"
if (-not (Test-Path $pgCtl)) {
    $pgCtl = "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe"
}

Write-Host "=== Papital ERP Local Launcher ===" -ForegroundColor Cyan

# --- 1) Start PostgreSQL if not running ---
$pgRunning = & $pgCtl -D "$root\.pgdata" status 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[1/2] Starting PostgreSQL..." -ForegroundColor Yellow
    & $pgCtl -D "$root\.pgdata" -l "$root\.pgdata\server.log" -o "-p 5433" start | Out-Null
    Start-Sleep -Seconds 2
    Write-Host "      PostgreSQL started." -ForegroundColor Green
} else {
    Write-Host "[1/2] PostgreSQL already running." -ForegroundColor Green
}

# --- 2) Check if port 3000 is free ---
$portBusy = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($portBusy) {
    Write-Host "[2/2] Port 3000 already in use - app probably running: http://localhost:3000" -ForegroundColor Yellow
} else {
    Write-Host "[2/2] Starting Dev Server (API + Frontend on port 3000)..." -ForegroundColor Yellow
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList '/c npm run dev > dev-server.log 2>&1' `
        -WorkingDirectory $root -WindowStyle Hidden
    Start-Sleep -Seconds 8
}

# --- Health check ---
try {
    $live = Invoke-WebRequest -Uri http://localhost:3000/health/live -UseBasicParsing -TimeoutSec 5
    Write-Host ""
    Write-Host "APP IS UP  =>  http://localhost:3000" -ForegroundColor Green
    Write-Host "Logs       =>  dev-server.log" -ForegroundColor Gray
} catch {
    Write-Host "Server is still warming up... check dev-server.log in a few seconds." -ForegroundColor Yellow
}
