@echo off
:: Clover CLI — interactive terminal chat
:: Usage: clover
cd /d "%~dp0"
npx tsx apps/backend/src/cli.ts %*
