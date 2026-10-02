# Build the Flughafen München core and the union world shell.
#
# Runs only the steps this AOI needs. The tree-cadastre steps are deliberately NOT here:
# config/aoi/flughafen.json records why (roughly a gigabyte of district tiles to plant a
# perimeter hedge on an airfield).
#
#   pwsh -NoProfile -File tools/build-flughafen.ps1
#   pwsh -NoProfile -File tools/build-flughafen.ps1 -From verify

param([string]$From)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$python = 'python'
$log = Join-Path $repo 'tools\flughafen-build.log'

# ⚠️ The pipeline prints Greek deltas and German umlauts. Without this the Windows console hands
# Python a cp1252 stdout and verify_registration.py dies on '\u0394' AFTER doing all its work —
# a reporting crash that reads as a failed registration gate.
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

Set-Location $repo
$started = -not $From
"=== flughafen build started $(Get-Date -Format o) ===" | Out-File $log -Encoding utf8

$steps = @(
    # ⚠️ Not optional even though nothing renders from it: verify_registration.py check F reads
    # data/osm/<aoi>/overpass_places.json, so skipping this step fails the gate AFTER checks A-E
    # have already passed, which reads as a registration failure and is not one.
    @{ name = 'places';      args = @('tools/geodata/resolve_places.py', '--aoi', 'flughafen') },
    @{ name = 'dgm1';        args = @('tools/geodata/fetch_bvv.py', '--aoi', 'flughafen') },
    @{ name = 'terrain';     args = @('tools/geodata/build_terrain.py', '--aoi', 'flughafen') },
    @{ name = 'copdem';      args = @('tools/geodata/fetch_copdem.py', '--aoi', 'flughafen') },
    @{ name = 'shell';       args = @('tools/geodata/build_shell.py', '--aoi', 'flughafen') },
    @{ name = 'verify';      args = @('tools/geodata/verify_registration.py', '--aoi', 'flughafen') },
    @{ name = 'osm-landuse'; args = @('tools/geodata/fetch_osm_landuse.py', '--aoi', 'flughafen') },
    @{ name = 'landuse';     args = @('tools/geodata/build_landuse.py', '--aoi', 'flughafen') },
    @{ name = 'drape';       args = @('tools/geodata/fetch_dop20.py', '--aoi', 'flughafen') },
    @{ name = 'shell-drape'; args = @('tools/geodata/fetch_dop20.py', '--aoi', 'flughafen', '--extent', 'shell') },
    @{ name = 'lod2';        args = @('tools/geodata/fetch_bvv.py', '--aoi', 'flughafen', '--product', 'lod2') },
    # ⚠️ BUILDINGS BEFORE THE SPLIT. build_lod2_mesh.py samples drape.jpg for every roof colour,
    # and split_drape.py moves that file out of the shipped set. Split first and the build still
    # succeeds — with every roof falling back to its wall class and the airfield rendering as one
    # flat colour. It warns, but it does not fail.
    @{ name = 'buildings';   args = @('tools/geodata/build_lod2_mesh.py', '--aoi', 'flughafen') },
    @{ name = 'split-drape'; args = @('tools/geodata/split_drape.py', '--aoi', 'flughafen', '--force') }
)

foreach ($step in $steps) {
    if ($From -and $step.name -ne $From -and -not $started) { continue }
    $started = $true

    # ⚠️ The buildings step samples public/terrain/<aoi>/drape.jpg for every roof colour, and the
    # split step moves that mosaic into data/ so it does not ship. A re-run that starts at
    # 'buildings' therefore finds no mosaic and produces a DEGRADED build — it warns and
    # continues, which is exactly the kind of failure that reaches a demo. Put it back first.
    if ($step.name -eq 'buildings') {
        $shipped = Join-Path $repo 'public\terrain\flughafen\drape.jpg'
        $archived = Join-Path $repo 'data\drape-source\flughafen\drape.jpg'
        if (-not (Test-Path $shipped) -and (Test-Path $archived)) {
            Copy-Item $archived $shipped
            "restored the drape mosaic from the build cache for roof sampling" |
                Tee-Object -FilePath $log -Append | Write-Host
        }
    }

    $header = "`n=== step $($step.name) @ $(Get-Date -Format HH:mm:ss) ==="
    $header | Tee-Object -FilePath $log -Append | Write-Host
    & $python @($step.args) 2>&1 | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -ne 0) {
        "### STEP $($step.name) FAILED with exit $LASTEXITCODE" | Tee-Object -FilePath $log -Append | Write-Host
        exit $LASTEXITCODE
    }
}

"`n=== flughafen build finished $(Get-Date -Format o) ===" | Tee-Object -FilePath $log -Append | Write-Host
