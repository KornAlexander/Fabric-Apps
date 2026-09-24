# Measure the deployable package against the Rayfin limit and run the focused tests.
#
# ⚠️ The limit is on the COMPRESSED zip, not on the directory. The raw asset set is far larger
# than the package, because uint16 heightmaps and building meshes compress well and the JPEGs do
# not compress at all. Reporting only the raw size would look alarming and mean nothing.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$raw = (Get-ChildItem dist -Recurse -File | Measure-Object Length -Sum).Sum
"dist raw:    {0:N2} MB" -f ($raw / 1MB)

$zip = Join-Path $env:TEMP 'mz-dist.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path 'dist' '*') -DestinationPath $zip -CompressionLevel Optimal
$packed = (Get-Item $zip).Length
"dist zipped: {0:N2} MiB   (Rayfin MAX_ZIP_SIZE_BYTES = 100 MiB, headroom {1:N2} MiB)" -f `
    ($packed / 1MB), ((100MB - $packed) / 1MB)
Remove-Item $zip -Force

"`n--- tests ---"
node --test (Get-ChildItem tests -Filter *.test.mjs | ForEach-Object { "tests/$($_.Name)" })
