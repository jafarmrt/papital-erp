# ============================================================
#  Papital ERP - Source Packaging Script
#  Creates a clean deployable ZIP of the source code
#  Usage:  .\package-source.ps1
#  Output: papital-erp-source-v<version>.zip
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$zipName = "papital-erp-source-v$($pkg.version).zip"
$stage = Join-Path $env:TEMP "opencode\pkg-stage"

# Clean stage
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# Copy everything except runtime/local artifacts
$excludeDirs = @('node_modules', '.pgdata', '.pgsql', 'dist', 'logs', 'coverage', '.git')
$excludeFiles = @('dev-server.log', 'app.log', '.env', $zipName)

Get-ChildItem $root -Force | Where-Object {
    $_.Name -notin $excludeDirs -and $_.Name -notin $excludeFiles
} | ForEach-Object {
    Copy-Item $_.FullName -Destination $stage -Recurse -Force
}

# Remove nested junk inside the staged copy (safety net)
foreach ($d in $excludeDirs) {
    Get-ChildItem $stage -Recurse -Directory -Filter $d -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\\.pg' } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

# Normalize line endings of shell scripts to LF (required for Linux execution)
Get-ChildItem $stage -Recurse -Include *.sh -File | ForEach-Object {
    $c = [System.IO.File]::ReadAllText($_.FullName)
    $c = $c -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($_.FullName, $c, (New-Object System.Text.UTF8Encoding($false)))
}

# Compress
if (Test-Path $zipName) { Remove-Item $zipName -Force }
Compress-Archive -Path "$stage\*" -DestinationPath $zipName -Force
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

$size = [math]::Round((Get-Item $zipName).Length / 1MB, 1)
Write-Host ""
Write-Host "Package created: $zipName ($size MB)" -ForegroundColor Green
Write-Host "Included: full source + public + scripts + .env.example + local PS1 helpers" -ForegroundColor Cyan
Write-Host "Excluded: node_modules, .pgdata (DB data!), .pgsql, dist, logs" -ForegroundColor Yellow
