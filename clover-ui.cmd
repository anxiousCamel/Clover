@echo off
:: Clover UI — starts backend + opens web interface
:: Usage: clover-ui
cd /d "%~dp0"

echo Starting Clover backend...
start /b npx tsx apps/backend/src/index.ts

:: Wait for backend to be ready
:wait_loop
timeout /t 1 /nobreak >nul
curl -s http://localhost:3001/api/health >nul 2>&1
if errorlevel 1 goto wait_loop

echo Backend ready on http://localhost:3001

echo Starting UI...
start http://localhost:1420
npx vite apps/ui --port 1420
