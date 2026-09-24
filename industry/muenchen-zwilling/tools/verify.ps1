$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host '--- tsc ---'
npx tsc --noEmit
Write-Host "tsc exit $LASTEXITCODE"
Write-Host '--- node tests ---'
npm test
Write-Host "tests exit $LASTEXITCODE"
Write-Host '--- build ---'
npm run build
Write-Host "build exit $LASTEXITCODE"
