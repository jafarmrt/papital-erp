# ============================================================
#  Papital ERP - Local Stop Script
#  Stops: Dev Server + Portable PostgreSQL
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$pgCtl = "$root\.pgsql\bin\pg_ctl.exe"
if (-not (Test-Path $pgCtl)) {
    $pgCtl = "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe"
}

Write-Host "=== Papital ERP Stop ===" -ForegroundColor Cyan

# --- 1) Stop node dev server (tsx server.ts) ---
$nodeProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match 'server\.ts|tsx' }
if ($nodeProcs) {
    $nodeProcs | ForEach-Object {
        Write-Host "[1/2] Stopping node PID $($_.ProcessId)..." -ForegroundColor Yellow
        Stop-Process -Id $_.ProcessId -Force
    }
} else {
    Write-Host "[1/2] No dev server running." -ForegroundColor Gray
}

# --- 2) Stop PostgreSQL ---
& $pgCtl -D "$root\.pgdata" stop -m fast 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "[2/2] PostgreSQL stopped." -ForegroundColor Green
} else {
    Write-Host "[2/2] PostgreSQL was not running." -ForegroundColor Gray
}

Write-Host "Done." -ForegroundColor Green
