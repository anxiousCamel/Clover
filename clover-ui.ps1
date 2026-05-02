# Clover UI — starts backend + web interface
# Usage: .\clover-ui
Set-Location $PSScriptRoot

Write-Host "Starting Clover backend..." -ForegroundColor Cyan
$backend = Start-Process -NoNewWindow -PassThru -FilePath "npx" -ArgumentList "tsx apps/backend/src/index.ts"

Write-Host "Waiting for backend..." -ForegroundColor DarkGray
do {
    Start-Sleep -Seconds 1
    try { $null = Invoke-WebRequest -Uri "http://localhost:3001/api/health" -UseBasicParsing -ErrorAction Stop } catch { continue }
    break
} while ($true)

Write-Host "Backend ready!" -ForegroundColor Green
Write-Host "Starting UI on http://localhost:1420..." -ForegroundColor Cyan
Start-Process "http://localhost:1420"

try {
    npx vite apps/ui --port 1420
} finally {
    Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
}
