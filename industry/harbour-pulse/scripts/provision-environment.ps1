<#
.SYNOPSIS
    Stand up HarbourPulse in a brand-new tenant / workspace, end to end.

.DESCRIPTION
    Automates every step that can be automated:

      1. Resolves (or creates) the target Fabric workspace.
      2. Ensures the Entra SPA app registration used for direct Eventhouse
         (Kusto) access from the browser exists.
      3. Publishes all Fabric items from `fabric/` via fabric-cicd, rebinding
         every environment-specific id through `fabric/parameter.yml`.
      4. Reads the new Eventhouse query URI and writes `.env`.
      5. Deploys the Rayfin app (`rayfin up`), which creates the AppBackend,
         the Fabric SQL database and the static hosting site.
      6. Patches the SPA redirect URIs of the Entra app with the freshly minted
         hosting URL - this can only happen after step 5 because the hostname
         is random.

    Steps that still need a human are listed at the end.

    Idempotent: safe to re-run.

.PARAMETER TenantId
    Target Entra tenant GUID.

.PARAMETER WorkspaceName
    Fabric workspace display name. Created if it does not exist. An existing
    workspace's id is also accepted, in which case the workspace must exist.

.PARAMETER CapacityId
    Fabric capacity GUID. Required only when the workspace must be created.

.PARAMETER EntraAppName
    Display name of the SPA app registration used for the Kusto token.

.PARAMETER SkipFabric
    Skip publishing Fabric items.

.PARAMETER SkipRayfin
    Skip the Rayfin app deployment.

.PARAMETER PruneOrphans
    Delete items in the target workspace that this repo does not define. Off by
    default - only safe in a workspace dedicated to this solution.

.EXAMPLE
    ./scripts/provision-environment.ps1 `
        -TenantId 00000000-0000-0000-0000-000000000000 `
        -WorkspaceName 'Harbour Pulse' `
        -CapacityId 11111111-1111-1111-1111-111111111111

    Find your tenant id with `az account show --query tenantId -o tsv`, and your
    capacity id in the Fabric admin portal under Capacity settings.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$TenantId,
    [Parameter(Mandatory)][string]$WorkspaceName,
    [string]$CapacityId,
    [string]$EntraAppName = 'HarbourPulse Kusto Client',
    [switch]$SkipFabric,
    [switch]$SkipRayfin,
    [switch]$PruneOrphans
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$fabricApi = 'https://api.fabric.microsoft.com/v1'
$graph = 'https://graph.microsoft.com/v1.0'
$manualSteps = [System.Collections.Generic.List[string]]::new()

function Invoke-Json {
    param([string]$Method, [string]$Uri, [string]$Token, $Body)
    $headers = @{ Authorization = "Bearer $Token" }
    if ($null -eq $Body) {
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers
    }
    Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers `
        -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 10 -Compress)
}

function Set-GraphBody {
    <# az rest chokes on inline JSON in PowerShell; always go via a file. #>
    param([string]$Method, [string]$Uri, [hashtable]$Body)
    $tmp = [IO.Path]::GetTempFileName()
    try {
        Set-Content -Path $tmp -Value ($Body | ConvertTo-Json -Depth 10) -Encoding utf8
        az rest --method $Method --url $Uri --headers 'Content-Type=application/json' --body "@$tmp" | Out-Null
    }
    finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- 0. sign in
Write-Host '== Signing in ==' -ForegroundColor Cyan
$account = az account show --query tenantId -o tsv 2>$null
$needLogin = $LASTEXITCODE -ne 0 -or $account -ne $TenantId
if (-not $needLogin) {
    # A cached token can be well-formed and still be refused - continuous access
    # evaluation invalidates it after a policy change. The Graph calls in step 2
    # would be the first to notice, so find out here instead.
    az ad signed-in-user show --query id -o tsv 2>$null | Out-Null
    $needLogin = $LASTEXITCODE -ne 0
    if ($needLogin) { Write-Host '  cached credentials rejected, signing in again…' }
}
# Ask for Graph explicitly. A plain `az login` can hand back a token minted under
# superseded policies, which Fabric accepts and Graph rejects - so the failure
# would surface at the app registration instead of here.
#
# The doubled slash in `//.default` is not a typo. With a single slash the CLI
# recognises the scope, finds a cached token for it and returns without ever
# prompting - which is useless when the cached token is precisely the problem.
# The doubled slash defeats that match and forces the interactive round trip.
if ($needLogin) {
    az login --tenant $TenantId --scope 'https://graph.microsoft.com//.default' --only-show-errors | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'az login failed.' }
}
$fabricToken = az account get-access-token --resource 'https://api.fabric.microsoft.com' --query accessToken -o tsv
if (-not $fabricToken) { throw 'Could not acquire a Fabric token.' }

# ------------------------------------------------------------- 1. workspace
Write-Host '== Fabric workspace ==' -ForegroundColor Cyan
$allWorkspaces = (Invoke-Json GET "$fabricApi/workspaces" $fabricToken).value
$workspace = $allWorkspaces | Where-Object displayName -EQ $WorkspaceName | Select-Object -First 1

# A GUID is an accident waiting to happen: without this, passing a workspace id
# creates a second workspace whose *name* is that id, on the wrong capacity.
if (-not $workspace -and $WorkspaceName -match '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') {
    $workspace = $allWorkspaces | Where-Object id -EQ $WorkspaceName | Select-Object -First 1
    if (-not $workspace) {
        throw "'$WorkspaceName' looks like a workspace id but no such workspace is visible to you. Pass the display name to create one."
    }
}

if (-not $workspace) {
    if (-not $CapacityId) { throw "Workspace '$WorkspaceName' not found and -CapacityId was not supplied." }
    Write-Host "  creating '$WorkspaceName'…"
    $workspace = Invoke-Json POST "$fabricApi/workspaces" $fabricToken @{
        displayName = $WorkspaceName
        capacityId  = $CapacityId
    }
}
$workspaceId = $workspace.id
Write-Host "  $WorkspaceName = $workspaceId"

# ------------------------------------------------------- 2. Entra SPA app
Write-Host '== Entra app registration (browser -> Kusto) ==' -ForegroundColor Cyan
$appJson = az ad app list --display-name $EntraAppName --query "[0].{appId:appId,objectId:id}" -o json
if ($LASTEXITCODE -ne 0) {
    throw "Microsoft Graph refused the request. Sign in again with:`n  az login --tenant $TenantId --scope 'https://graph.microsoft.com//.default'`n(the doubled slash is deliberate - it stops the CLI reusing the cached token)"
}
$app = $appJson | ConvertFrom-Json

if (-not $app.appId) {
    Write-Host "  creating '$EntraAppName'…"
    $app = az ad app create --display-name $EntraAppName --sign-in-audience AzureADMyOrg `
        --query "{appId:appId,objectId:id}" -o json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $app.appId) { throw "Could not create the '$EntraAppName' app registration." }
    az ad sp create --id $app.appId --only-show-errors | Out-Null
    $manualSteps.Add("Grant admin consent for '$EntraAppName' -> Kusto user_impersonation if your tenant requires it.")
}

# Without this the run continues with an empty client id and produces an app
# that deploys cleanly and cannot authenticate.
if (-not $app.appId) { throw "No appId resolved for '$EntraAppName'." }
Write-Host "  appId    = $($app.appId)"
Write-Host "  objectId = $($app.objectId)"

# --------------------------------------------------------- 3. Fabric items
if (-not $SkipFabric) {
    Write-Host '== Publishing Fabric items ==' -ForegroundColor Cyan

    python -m pip install -r (Join-Path $repoRoot 'fabric/requirements.txt') --quiet
    if ($LASTEXITCODE -ne 0) { throw 'pip install failed.' }

    $env:FABRIC_WORKSPACE_ID = $workspaceId
    $env:FABRIC_ENVIRONMENT = 'DEV'
    # deploy.py deletes any in-scope item the repo does not define. That is fine
    # for a workspace this solution owns and destructive anywhere else, so it is
    # opt-in here even though CI leaves it on.
    $env:SKIP_UNPUBLISH = if ($PruneOrphans) { '0' } else { '1' }
    if ($PruneOrphans) {
        Write-Host '  -PruneOrphans: items in this workspace that the repo does not define WILL BE DELETED.' -ForegroundColor Yellow
    }
    python (Join-Path $repoRoot 'fabric/deploy.py')
    if ($LASTEXITCODE -ne 0) { throw 'fabric/deploy.py failed.' }
}

# --------------------------------------------- 4. Eventhouse URI -> .env
Write-Host '== Writing .env ==' -ForegroundColor Cyan
$eventhouse = (Invoke-Json GET "$fabricApi/workspaces/$workspaceId/eventhouses" $fabricToken).value |
    Where-Object displayName -EQ 'SydneyFerriesEventhouse' | Select-Object -First 1
if (-not $eventhouse) { throw 'SydneyFerriesEventhouse not found - did the Fabric publish succeed?' }

$clusterUri = $eventhouse.properties.queryServiceUri
Write-Host "  cluster = $clusterUri"

$envPath = Join-Path $repoRoot '.env'
$examplePath = Join-Path $repoRoot '.env.example'
if (-not (Test-Path $envPath)) { Copy-Item $examplePath $envPath }
else {
    # Rewriting in place would otherwise lose the previous environment's cluster
    # and client id with no way back.
    $backup = "$envPath.bak"
    Copy-Item $envPath $backup -Force
    Write-Host "  previous .env saved to $backup"
}

$generated = @{
    VITE_KUSTO_CLUSTER   = $clusterUri
    VITE_KUSTO_DATABASE  = 'SydneyFerriesKustoDB'
    VITE_ENTRA_CLIENT_ID = $app.appId
    VITE_ENTRA_TENANT_ID = $TenantId
}
$lines = Get-Content $envPath
foreach ($key in $generated.Keys) {
    $entry = "$key=$($generated[$key])"
    if ($lines -match "^\s*$key\s*=") {
        $lines = $lines -replace "^\s*$key\s*=.*$", $entry
    }
    else {
        $lines += $entry
    }
}
Set-Content -Path $envPath -Value $lines -Encoding utf8

foreach ($secret in 'VITE_CESIUM_ION_TOKEN', 'TFNSW_API_KEY') {
    if (-not ($lines | Where-Object { $_ -match "^\s*$secret\s*=\s*\S" })) {
        $manualSteps.Add("Set $secret in .env (see .env.example for where to get it).")
    }
}

# ------------------------------------------- 4b. seed the lakehouse .env
# The loader notebook reads /lakehouse/default/Files/.env for the TfNSW key and
# the Eventstream connection string. The connection string is minted per
# workspace, so it cannot live in the repo - but it is readable over REST, which
# beats asking every deployer to copy it out of the portal by hand.
Write-Host '== Seeding the lakehouse .env ==' -ForegroundColor Cyan
$tfnswKey = ($lines | Where-Object { $_ -match '^\s*TFNSW_API_KEY\s*=\s*(\S.*)$' } |
    Select-Object -First 1) -replace '^\s*TFNSW_API_KEY\s*=\s*', ''

$eventstream = (Invoke-Json GET "$fabricApi/workspaces/$workspaceId/eventstreams" $fabricToken).value |
    Where-Object displayName -EQ 'SydneyFerriesEH' | Select-Object -First 1
$lakehouse = (Invoke-Json GET "$fabricApi/workspaces/$workspaceId/lakehouses" $fabricToken).value |
    Where-Object displayName -EQ 'EnvLakehouse' | Select-Object -First 1

if (-not $eventstream -or -not $lakehouse -or -not $tfnswKey) {
    $manualSteps.Add('Upload a Files/.env to the EnvLakehouse containing TRANSPORT_APIKEY and EVENTSTREAM_CONNECTION_STRING (copy the latter from the SydneyFerriesEH custom endpoint).')
    if (-not $tfnswKey) { Write-Host '  skipped: TFNSW_API_KEY is not set in .env' -ForegroundColor Yellow }
    else { Write-Host '  skipped: Eventstream or EnvLakehouse not found' -ForegroundColor Yellow }
}
else {
    $topology = Invoke-Json GET "$fabricApi/workspaces/$workspaceId/eventstreams/$($eventstream.id)/topology" $fabricToken
    $source = $topology.sources | Where-Object type -EQ 'CustomEndpoint' | Select-Object -First 1
    if (-not $source) { throw 'No custom endpoint source on the SydneyFerriesEH eventstream.' }

    $conn = (Invoke-Json GET "$fabricApi/workspaces/$workspaceId/eventstreams/$($eventstream.id)/sources/$($source.id)/connection" $fabricToken).accessKeys.primaryConnectionString
    if (-not $conn) { throw 'Eventstream returned no connection string.' }

    # OneLake is an ADLS Gen2 endpoint, so it takes a storage token, not a Fabric
    # one, and wants create/append/flush rather than a single PUT.
    $oneLakeToken = az account get-access-token --resource 'https://storage.azure.com' --query accessToken -o tsv
    $filePath = "https://onelake.dfs.fabric.microsoft.com/$workspaceId/$($lakehouse.id)/Files/.env"
    $payload = "TRANSPORT_APIKEY=$tfnswKey`nEVENTSTREAM_CONNECTION_STRING=$conn`n"
    $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $headers = @{ Authorization = "Bearer $oneLakeToken" }

    Invoke-RestMethod -Method Put -Uri "${filePath}?resource=file" -Headers $headers | Out-Null
    Invoke-RestMethod -Method Patch -Uri "${filePath}?action=append&position=0" -Headers $headers `
        -ContentType 'application/octet-stream' -Body $bytes | Out-Null
    Invoke-RestMethod -Method Patch -Uri "${filePath}?action=flush&position=$($bytes.Length)" -Headers $headers | Out-Null
    Write-Host '  wrote Files/.env to EnvLakehouse (TRANSPORT_APIKEY, EVENTSTREAM_CONNECTION_STRING)'
}

# ------------------------------------------------------------- 5. Rayfin up
$hostingUrl = $null
if (-not $SkipRayfin) {
    Write-Host '== Deploying Rayfin app ==' -ForegroundColor Cyan
    Push-Location $repoRoot
    try {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        npx rayfin up --workspace-id $workspaceId --tenant $TenantId --yes
        # The backend deploys first and the static upload last, and that last
        # step returns a bare 500 often enough that the CLI prints its own retry
        # hint. Retrying only the upload is safe - the backend is already up.
        if ($LASTEXITCODE -ne 0) {
            Write-Host '  static upload failed, retrying it on its own…' -ForegroundColor Yellow
            npx rayfin up staticapp deploy
            if ($LASTEXITCODE -ne 0) { throw 'rayfin up failed.' }
        }
    }
    finally { Pop-Location }

    $deployments = Get-Content (Join-Path $repoRoot 'rayfin/.deployments.json') -Raw | ConvertFrom-Json
    $hostingUrl = $deployments.deployments.($deployments.active).hostingUrl
    Write-Host "  hosting = $hostingUrl"
}

# ------------------------------------------- 6. redirect URIs (after hosting)
Write-Host '== Redirect URIs ==' -ForegroundColor Cyan
$existing = az ad app show --id $app.appId --query 'spa.redirectUris' -o json | ConvertFrom-Json
$uris = [System.Collections.Generic.List[string]]::new()
if ($existing) { $existing | ForEach-Object { $uris.Add($_) } }
foreach ($u in @('http://localhost:5173', $hostingUrl)) {
    if ($u -and -not $uris.Contains($u)) { $uris.Add($u) }
}
Set-GraphBody PATCH "$graph/applications/$($app.objectId)" @{ spa = @{ redirectUris = $uris } }
$uris | ForEach-Object { Write-Host "  $_" }

# Rayfin keeps its own allow-list; `rayfin up` appends the new origin itself,
# so just confirm it landed.
$rayfinYml = Join-Path $repoRoot 'rayfin/rayfin.yml'
if ($hostingUrl -and -not (Select-String -Path $rayfinYml -SimpleMatch $hostingUrl -Quiet)) {
    $manualSteps.Add("Add $hostingUrl to services.auth.allowedRedirectUris in rayfin/rayfin.yml and re-run rayfin up.")
}

# ------------------------------------------------------------ 7. loose ends
$manualSteps.Add('Run the SydneyFerriesEventLoader notebook once to start filling the Eventhouse.')
$manualSteps.Add('ReferenceLocation is created empty - the wharf markers stay hidden until you ingest wharf rows into it.')

Write-Host ''
Write-Host '== Done ==' -ForegroundColor Green
Write-Host "Workspace : $workspaceId"
Write-Host "Cluster   : $clusterUri"
Write-Host "Entra app : $($app.appId)"
if ($hostingUrl) { Write-Host "App URL   : $hostingUrl" }
Write-Host ''
Write-Host 'Manual follow-ups:' -ForegroundColor Yellow
$manualSteps | ForEach-Object { Write-Host "  - $_" }
