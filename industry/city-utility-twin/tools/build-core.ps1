# Build one terrain core (and its own world shell) for any AOI in config/aoi/.
#
# The same steps as build-flughafen.ps1, with the two survey downloads routed through
# tools/geodata/fetch_geobasis.py, so the AOI's geobasis.provider (bavaria, hamburg, lgl-bw) decides
# where tiles come from. Vegetation is not built here: it needs a per-state tree source and is
# optional in the asset contract.
#
#   pwsh -NoProfile -File tools/build-core.ps1 -Aoi hamburg-centre
#   pwsh -NoProfile -File tools/build-core.ps1 -Aoi stuttgart-centre -LodMirror D:\zips\lod2
#   pwsh -NoProfile -File tools/build-core.ps1 -Aoi stuttgart-centre -From buildings

param(
    [Parameter(Mandatory = $true)][string]$Aoi,
    [string]$From,
    [string]$Python = 'python',
    # A folder of already-downloaded provider ZIPs, read before the network (fetch_lgl.py --mirror).
    [string]$LodMirror
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repo "config\aoi\$Aoi.json"))) { throw "No AOI config config/aoi/$Aoi.json" }
$log = Join-Path $repo "tools\$Aoi-build.log"

# The pipeline prints Greek deltas and umlauts; a cp1252 console kills verify_registration.py
# after it has done all its work, which reads as a failed registration and is not one.
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

Set-Location $repo
$started = -not $From

$lodExtra = @()
if ($LodMirror) { $lodExtra = @('--', '--mirror', $LodMirror) }

$steps = @(
    # Not optional: verify_registration.py check F reads data/osm/<aoi>/overpass_places.json.
    @{ name = 'places';      args = @('tools/geodata/resolve_places.py', '--aoi', $Aoi) },
    @{ name = 'dgm1';        args = @('tools/geodata/fetch_geobasis.py', '--aoi', $Aoi, '--product', 'dgm1') },
    @{ name = 'terrain';     args = @('tools/geodata/build_terrain.py', '--aoi', $Aoi) },
    @{ name = 'copdem';      args = @('tools/geodata/fetch_copdem.py', '--aoi', $Aoi) },
    @{ name = 'shell';       args = @('tools/geodata/build_shell.py', '--aoi', $Aoi) },
    @{ name = 'verify';      args = @('tools/geodata/verify_registration.py', '--aoi', $Aoi) },
    @{ name = 'osm-landuse'; args = @('tools/geodata/fetch_osm_landuse.py', '--aoi', $Aoi) },
    @{ name = 'landuse';     args = @('tools/geodata/build_landuse.py', '--aoi', $Aoi) },
    # Drape BEFORE buildings: build_lod2_mesh.py samples every roof colour from drape.jpg, and with
    # no drape it does not fail, it paints a whole flat city.
    @{ name = 'drape';       args = @('tools/geodata/fetch_dop20.py', '--aoi', $Aoi) },
    @{ name = 'shell-drape'; args = @('tools/geodata/fetch_dop20.py', '--aoi', $Aoi, '--extent', 'shell') },
    @{ name = 'lod2';        args = @('tools/geodata/fetch_geobasis.py', '--aoi', $Aoi, '--product', 'lod2') + $lodExtra },
    @{ name = 'buildings';   args = @('tools/geodata/build_lod2_mesh.py', '--aoi', $Aoi) }
)

# A misspelt -From would skip every step and still print "build finished". Refuse it first.
if ($From -and -not ($steps | Where-Object { $_.name -eq $From })) {
    throw "Unknown step '$From'. Steps: $(($steps | ForEach-Object { $_.name }) -join ', ')"
}
"=== $Aoi build started $(Get-Date -Format o) ===" | Out-File $log -Encoding utf8

foreach ($step in $steps) {
    if ($From -and $step.name -ne $From -and -not $started) { continue }
    $started = $true
    $header = "`n=== step $($step.name) @ $(Get-Date -Format HH:mm:ss) ==="
    $header | Tee-Object -FilePath $log -Append | Write-Host
    & $Python @($step.args) 2>&1 | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -ne 0) {
        "### STEP $($step.name) FAILED with exit $LASTEXITCODE" | Tee-Object -FilePath $log -Append | Write-Host
        exit $LASTEXITCODE
    }
}

"`n=== $Aoi build finished $(Get-Date -Format o) ===" | Tee-Object -FilePath $log -Append | Write-Host
