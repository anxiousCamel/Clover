# Adds Clover to your user PATH so you can run "clover" from anywhere.
# Usage: Run once as .\install-path.ps1 — then restart your terminal.

$cloverDir = $PSScriptRoot

$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")

if ($currentPath -split ";" | Where-Object { $_ -eq $cloverDir }) {
    Write-Host "Clover already in PATH." -ForegroundColor Green
} else {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$cloverDir", "User")
    Write-Host "Added $cloverDir to user PATH." -ForegroundColor Green
    Write-Host "Restart your terminal, then use 'clover' or 'clover-ui' from anywhere." -ForegroundColor DarkGray
}
