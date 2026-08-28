# ============================================================
#  Papital ERP - Local Startup Script
#  Starts: Portable PostgreSQL -> Dev Server (API + Frontend)
#  URL: http://localhost:3000
#  NOTE: Always stop with .\stop-local.ps1 - never Ctrl+C this window.
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$pgCtl = "$root\.pgsql\bin\pg_ctl.exe"
if (-not (Test-Path $pgCtl)) {
    $pgCtl = "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe"
}

function Test-PgPort {
    return (Test-NetConnection -ComputerName localhost -Port 5433 -InformationLevel Quiet -WarningAction SilentlyContinue)
}

Write-Host "=== Papital ERP Local Launcher ===" -ForegroundColor Cyan

# --- 1) Start PostgreSQL if not running (TCP port check, no pg_ctl status hang) ---
if (Test-PgPort) {
    Write-Host "[1/2] PostgreSQL already running (port 5433)." -ForegroundColor Green
} else {
    Write-Host "[1/2] Starting PostgreSQL (first start after reboot may take 1-3 minutes for crash recovery)..." -ForegroundColor Yellow
    # Own hidden console => Ctrl+C in this window can never kill the database.
    # -w -t 240 : wait up to 4 minutes for startup/recovery to finish.
    Start-Process -FilePath $pgCtl `
        -ArgumentList @('-D', "`"$root\.pgdata`"", '-l', "`"$root\.pgdata\server.log`"", '-o', '"-p 5433"', '-w', '-t', '240', 'start') `
        -WindowStyle Hidden -Wait
    $tries = 0
    while (-not (Test-PgPort) -and $tries -lt 30) {
        Start-Sleep -Seconds 2
        $tries++
    }
    if (Test-PgPort) {
        Write-Host "      PostgreSQL started." -ForegroundColor Green
    } else {
        Write-Host "      PostgreSQL did NOT come up - check .pgdata\server.log" -ForegroundColor Red
        exit 1
    }
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
    Write-Host "To stop    =>  .\stop-local.ps1" -ForegroundColor Gray
} catch {
    Write-Host "Server is still warming up... check dev-server.log in a few seconds." -ForegroundColor Yellow
}
