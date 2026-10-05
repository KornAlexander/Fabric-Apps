# Deploy City Utility Twin as a NEW Fabric app item, in a new neutral folder.
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


# Configuration comes from environment variables, see UMSETZUNG.md. There are deliberately NO
# defaults: a value that "usually fits" ends up writing into somebody else's tenant.
function Need([string]$Name) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  if (-not $v) { throw "Environment variable $Name is missing (see UMSETZUNG.md)." }
  return $v
}
$tenant = Need 'FABRIC_TENANT_ID'
$subscription = Need 'AZURE_SUBSCRIPTION_ID'
$workspace = Need 'FABRIC_WORKSPACE_ID'
$customerFolder = [Environment]::GetEnvironmentVariable('FABRIC_FOLDER_ID')   # optional parent folder
$folderName = 'City Utility Twin'
$displayName = 'City Utility Twin'

# --- guard (part 1: local registry) --------------------------------------------------------------
$registry = Join-Path $repo 'rayfin\.deployments.json'
$boundItemId = $null
if (Test-Path $registry) {
    $existing = Get-Content $registry -Raw | ConvertFrom-Json
    $boundItemId = $existing.deployments.($existing.active).fabricItemId
    if (-not $boundItemId) { throw 'rayfin/.deployments.json has no active item. Remove it or repair it by hand.' }
}

$account = az account show --subscription $subscription --query '{tenantId:tenantId}' -o json | ConvertFrom-Json
if ($account.tenantId -ne $tenant) { throw "Unexpected tenant $($account.tenantId)." }

$token = az account get-access-token --subscription $subscription `
    --resource 'https://api.fabric.microsoft.com' --query accessToken -o tsv
if (-not $token) { throw 'No Fabric token returned.' }
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

try {
    # --- guard (part 2: the workspace) ---------------------------------------------------------
    # rayfin up reuses an item it finds in its registry, else one whose display name matches the
    # slug (case-insensitive), and --yes accepts that. So: a redeploy must point at OUR renamed
    # item, and a first deploy must find no item carrying either name.
    $slug = 'city-utility-twin'
    # Every page: the CLI searches all of them, so a clash on page two must stop us too.
    $apps = @()
    $uri = "https://api.fabric.microsoft.com/v1/workspaces/$workspace/items?type=AppBackend"
    while ($uri) {
        $page = Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 60
        $apps += @($page.value)
        $uri = $page.continuationUri
    }
    $before = @($apps | ForEach-Object { $_.id })
    if ($boundItemId) {
        # The CLI picks the first registry record for this workspace, not necessarily 'active'.
        $records = @($existing.deployments.PSObject.Properties | Where-Object { $_.Value.fabricWorkspaceId -eq $workspace })
        if ($records.Count -ne 1 -or $records[0].Value.fabricItemId -ne $boundItemId) {
            throw 'rayfin/.deployments.json does not hold exactly one record for this workspace, bound to the active item.'
        }
        $bound = $apps | Where-Object { $_.id -eq $boundItemId }
        if (-not $bound -or $bound.displayName -ne $displayName) {
            throw "rayfin/.deployments.json is bound to an item that is not '$displayName' in this workspace. Refusing to deploy over it."
        }
        "redeploy of the existing '$displayName' item"
    } else {
        $clash = $apps | Where-Object { $_.displayName -ieq $slug -or $_.displayName -ieq $displayName }
        if ($clash) { throw "An app item named '$($clash[0].displayName)' already exists. Refusing a first deploy that could adopt it." }
        'first deploy: no item with this name exists'
    }

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
    # ⚠️ A LEFTOVER public/rayfin.config.json IS REUSED UNCHANGED by the CLI (it only writes the
    # file when none exists), so a copy from another item would ship in this bundle. Refuse it.
    if (Test-Path (Join-Path $repo 'public\rayfin.config.json')) {
        throw 'public/rayfin.config.json already exists. Delete it; rayfin up writes a fresh one.'
    }
    $env:RAYFIN_TOKEN = $token
    $env:RAYFIN_FABRIC_API_URL = 'https://api.fabric.microsoft.com'
    # The bundle gate pins the runtime config to this item on a redeploy.
    $env:FABRIC_ITEM_ID = $boundItemId
    "`nrunning rayfin up ..."
    npx --no-install rayfin up --tenant $tenant --workspace-id $workspace --yes --json |
        Tee-Object -FilePath (Join-Path $repo 'tools\deploy.log')
    if ($LASTEXITCODE -ne 0) { throw "rayfin up failed with exit $LASTEXITCODE" }

    $registryAfter = Get-Content $registry -Raw | ConvertFrom-Json
    $active = $registryAfter.deployments.($registryAfter.active)
    "`nitem:    $($active.fabricItemId)"
    "hosting: $($active.hostingUrl)"
    if ($boundItemId -and $active.fabricItemId -ne $boundItemId) { throw 'rayfin up deployed to a different item than the bound one. Stopping before rename/move.' }
    if (-not $boundItemId -and $before -contains $active.fabricItemId) { throw 'rayfin up adopted an item that existed before this first deploy. Stopping before rename/move.' }

    # --- rename and file it --------------------------------------------------------------------
    # The CLI names the item from the slug in rayfin.yml. The readable name is set afterwards,
    # because the audience reads it.
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
    $env:FABRIC_ITEM_ID = $null
    $token = $null
    $headers = $null
    [System.GC]::Collect()
}
