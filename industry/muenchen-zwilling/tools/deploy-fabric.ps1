# Deploy München Zwilling as a NEW Fabric app item, in a new neutral folder.
#
# ⚠️ THIS CREATES A NEW ITEM AND MUST NOT TOUCH AN EXISTING ONE. The repo was copied from
# another app, whose rayfin/.deployments.json bound it to a different AppBackend — deploying with
# that file still in place would have published this app OVER that existing app. It was
# removed before this script was written, and the guard below refuses to run if it comes back
# pointing at an item this project did not create.
#
# ⚠️ TOKEN IN MEMORY ONLY: minted from the Azure CLI, passed to the child process, cleared in
# `finally`. `rayfin up` is run WITHOUT --verbose because that mode prints a token prefix.

param(
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo


# Konfiguration kommt aus Umgebungsvariablen, siehe UMSETZUNG.md. Es gibt bewusst KEINE
# Vorgabewerte: ein Wert, der "meistens passt", schreibt sonst in einen fremden Mandanten.
function Need([string]$Name) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  if (-not $v) { throw "Umgebungsvariable $Name fehlt (siehe UMSETZUNG.md)." }
  return $v
}
$tenant = Need 'FABRIC_TENANT_ID'
$subscription = Need 'AZURE_SUBSCRIPTION_ID'
$workspace = Need 'FABRIC_WORKSPACE_ID'
$customerFolder = [Environment]::GetEnvironmentVariable('FABRIC_FOLDER_ID')   # optional
$folderName = 'München Ökosystem'
$displayName = 'München Zwilling'

# --- guard -------------------------------------------------------------------------------------
$registry = Join-Path $repo 'rayfin\.deployments.json'
if (Test-Path $registry) {
    $existing = Get-Content $registry -Raw | ConvertFrom-Json
    $inherited = $existing.deployments.PSObject.Properties |
        Where-Object { $_.Value.fabricItemId -eq '00000000-0000-0000-0000-000000000000' }
    if ($inherited) {
        throw 'rayfin/.deployments.json points at a foreign item. Refusing to deploy over it.'
    }
}

$account = az account show --subscription $subscription --query '{tenantId:tenantId}' -o json | ConvertFrom-Json
if ($account.tenantId -ne $tenant) { throw "Unexpected tenant $($account.tenantId)." }

$token = az account get-access-token --subscription $subscription `
    --resource 'https://api.fabric.microsoft.com' --query accessToken -o tsv
if (-not $token) { throw 'No Fabric token returned.' }
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

try {
    # --- folder --------------------------------------------------------------------------------
    $folders = Invoke-RestMethod -Uri "https://api.fabric.microsoft.com/v1/workspaces/$workspace/folders" -Headers $headers -TimeoutSec 60
    $folder = $folders.value | Where-Object { $_.displayName -eq $folderName -and $_.parentFolderId -eq $customerFolder }
    if ($folder) {
        "folder exists: $($folder.id)"
    } elseif ($WhatIf) {
        "WHATIF would create folder '$folderName' under the configured folder"
    } else {
        $body = @{ displayName = $folderName; parentFolderId = $customerFolder } | ConvertTo-Json
        $folder = Invoke-RestMethod -Method Post -Uri "https://api.fabric.microsoft.com/v1/workspaces/$workspace/folders" `
            -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 60
        "created folder '$folderName': $($folder.id)"
    }

    if ($WhatIf) { 'WHATIF stopping before rayfin up'; return }

    # --- deploy --------------------------------------------------------------------------------
    $env:RAYFIN_TOKEN = $token
    $env:RAYFIN_FABRIC_API_URL = 'https://api.fabric.microsoft.com'
    "`nrunning rayfin up ..."
    npx --no-install rayfin up --tenant $tenant --workspace-id $workspace --yes --json |
        Tee-Object -FilePath (Join-Path $repo 'tools\deploy.log')
    if ($LASTEXITCODE -ne 0) { throw "rayfin up failed with exit $LASTEXITCODE" }

    $registryAfter = Get-Content $registry -Raw | ConvertFrom-Json
    $active = $registryAfter.deployments.($registryAfter.active)
    "`nitem:    $($active.fabricItemId)"
    "hosting: $($active.hostingUrl)"

    # --- rename and file it --------------------------------------------------------------------
    # The CLI names the item from the slug in rayfin.yml. The readable name is set afterwards,
    # for the same reason the app's UI is German: the audience reads it.
    $patch = @{ displayName = $displayName } | ConvertTo-Json
    Invoke-RestMethod -Method Patch -Uri "https://api.fabric.microsoft.com/v1/workspaces/$workspace/items/$($active.fabricItemId)" `
        -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($patch)) -TimeoutSec 60 | Out-Null
    "renamed to '$displayName'"

    $move = @{ targetFolderId = $folder.id } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "https://api.fabric.microsoft.com/v1/workspaces/$workspace/items/$($active.fabricItemId)/move" `
        -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($move)) -TimeoutSec 60 | Out-Null
    "moved into '$folderName'"

    "`nDONE: $($active.hostingUrl)"
} finally {
    $env:RAYFIN_TOKEN = $null
    $env:RAYFIN_FABRIC_API_URL = $null
    $token = $null
    $headers = $null
    [System.GC]::Collect()
}
