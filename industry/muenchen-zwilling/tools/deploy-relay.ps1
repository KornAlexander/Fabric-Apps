# Build and deploy the ADS-B relay.
#
# ⚠️ REUSES EXISTING INFRASTRUCTURE. The resource group, the Container Apps environment and the
# registry all already exist in the demo subscription and already carry sibling relays for this
# family of small relays. The
# ONLY thing this script creates is one Container App.
#
# ⚠️ THE IMAGE IS BUILT BY ACR, NOT BY DOCKER ON THIS MACHINE. `az acr build` uploads the context
# and builds on a linux/amd64 agent. This laptop is ARM64 and a local AMD64 build under emulation
# previously failed to produce a healthy container in this same family of apps.
#
# Usage
#   pwsh -NoProfile -File tools/deploy-relay.ps1 -WhatIf     # show what would happen
#   pwsh -NoProfile -File tools/deploy-relay.ps1             # build + deploy + verify
#   pwsh -NoProfile -File tools/deploy-relay.ps1 -Tag v2     # new revision

param(
    [string]$Tag = 'v1',
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# ⚠️ GUIDs, NOT NAMES. A subscription name is a label that can be reused or renamed; the identity
# that matters is the GUID. An earlier draft checked only the tenant, which would have accepted
# any subscription inside the demo tenant.

# Konfiguration kommt aus Umgebungsvariablen, siehe UMSETZUNG.md. Es gibt bewusst KEINE
# Vorgabewerte: ein Wert, der "meistens passt", schreibt sonst in einen fremden Mandanten.
function Need([string]$Name) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  if (-not $v) { throw "Umgebungsvariable $Name fehlt (siehe UMSETZUNG.md)." }
  return $v
}
$subscriptionId = Need 'AZURE_SUBSCRIPTION_ID'
$demoTenant     = Need 'AZURE_TENANT_ID'
$rg             = Need 'AZURE_RESOURCE_GROUP'
$environment    = Need 'CONTAINERAPPS_ENVIRONMENT'
$registry       = Need 'ACR_NAME'
$appName        = 'ca-adsb-relay'
$appOrigin      = Need 'APP_ORIGIN'
$image          = "$registry.azurecr.io/adsb-relay:$Tag"

# --- target guard ------------------------------------------------------------------------------
$account = az account show --subscription $subscriptionId --query '{tenantId:tenantId,id:id,name:name}' -o json | ConvertFrom-Json
if ($account.id -ne $subscriptionId) { throw "Resolved subscription $($account.id), expected $subscriptionId." }
if ($account.tenantId -ne $demoTenant) { throw "Subscription is in tenant $($account.tenantId), not the demo tenant." }
"subscription : $($account.name)"
"             : $($account.id)"
"tenant       : $($account.tenantId)  (demo)"

if ($WhatIf) {
    "`nWHATIF would:"
    "  az acr build --registry $registry --image adsb-relay:$Tag ./relay"
    "  create or update container app '$appName' in '$environment' ($rg)"
    "    0.25 CPU / 0.5Gi, min 1 / max 1 replicas, external ingress on 8080"
    "    ALLOWED_ORIGINS=$appOrigin"
    "  then poll until a revision is healthy and call /health before reporting success"
    return
}

# --- build -------------------------------------------------------------------------------------
"`n--- acr build ---"
az acr build --subscription $subscriptionId --registry $registry --image "adsb-relay:$Tag" ./relay
if ($LASTEXITCODE -ne 0) { throw "acr build failed ($LASTEXITCODE)" }

# --- does it already exist? --------------------------------------------------------------------
# ⚠️ AN EMPTY RESULT IS NOT THE SAME AS "DOES NOT EXIST". `az ... show` also returns nothing when
# the token expired or the service is unavailable, and treating that as absence would send the
# script down the create path against an app that already exists. Inspect the exit code and the
# error text instead.
$showOutput = az containerapp show --subscription $subscriptionId --name $appName --resource-group $rg -o json 2>&1
$showExit = $LASTEXITCODE
$exists = $false
if ($showExit -eq 0) {
    $exists = $true
} elseif ("$showOutput" -match 'ResourceNotFound|was not found|NotFound|ResourceGroupNotFound') {
    $exists = $false
} else {
    throw "Could not determine whether '$appName' exists. az exited $showExit with: $showOutput"
}

if ($exists) {
    "`n--- updating existing container app ---"
} else {
    "`n--- creating container app ---"
    # ⚠️ TWO-PHASE ON PURPOSE, because the CLI's one-liner is not reliable here.
    #
    # `az containerapp create --image <private> --registry-identity system` bootstraps the app
    # with a public quickstart image, reads back its new system identity, assigns AcrPull, then
    # swaps in the real image. That last part FAILED on the first run of this script: the freshly
    # minted identity had not yet replicated into Microsoft Graph, so the role assignment was
    # rejected with "Cannot find user or service principal in graph database". The app was left
    # created, running the quickstart image, with no registry configured.
    #
    # Creating with the public image deliberately, then assigning the role with a retry, then
    # attaching the registry and the real image, reaches the same end state without depending on
    # replication timing inside someone else's command.
    az containerapp create `
        --subscription $subscriptionId `
        --name $appName `
        --resource-group $rg `
        --environment $environment `
        --image 'mcr.microsoft.com/k8se/quickstart:latest' `
        --system-assigned `
        --target-port 8080 `
        --ingress external `
        --transport auto `
        --cpu 0.25 --memory 0.5Gi `
        --min-replicas 1 --max-replicas 1 `
        --env-vars "ALLOWED_ORIGINS=$appOrigin"
    $createExit = $LASTEXITCODE
    if ($createExit -ne 0) {
        $leftover = az containerapp show --subscription $subscriptionId --name $appName --resource-group $rg -o json 2>$null
        if ($leftover) {
            throw "containerapp create failed ($createExit) AND '$appName' exists in a partial state. Inspect it before rerunning; do not touch the shared RG, environment or registry."
        }
        throw "containerapp create failed ($createExit); no app was left behind."
    }
}

# --- identity, registry, image -----------------------------------------------------------------
# Idempotent: safe on a fresh create and on a rerun against a partially configured app.
$principal = az containerapp show --subscription $subscriptionId --name $appName --resource-group $rg `
    --query 'identity.principalId' -o tsv
if (-not $principal) { throw "No system-assigned identity on '$appName'." }
"identity     : $principal"

$registryId = az acr show --subscription $subscriptionId --name $registry --query id -o tsv
$hasRole = az role assignment list --subscription $subscriptionId --assignee $principal `
    --scope $registryId --role AcrPull --query "[0].id" -o tsv 2>$null
if ($hasRole) {
    "AcrPull      : already assigned"
} else {
    # ⚠️ RETRY, because this is a replication race rather than a permissions problem. The identity
    # exists in ARM the instant the app is created and takes a little longer to appear in Graph.
    $assigned = $false
    foreach ($attempt in 1..10) {
        az role assignment create --subscription $subscriptionId --assignee-object-id $principal `
            --assignee-principal-type ServicePrincipal --scope $registryId --role AcrPull -o none 2>$null
        if ($LASTEXITCODE -eq 0) { $assigned = $true; break }
        "  waiting for the identity to appear in Graph (attempt $attempt)"
        Start-Sleep -Seconds 10
    }
    if (-not $assigned) { throw "Could not assign AcrPull to $principal on $registry." }
    "AcrPull      : assigned"
    # Role propagation is not instant either; the pull happens in the next command.
    Start-Sleep -Seconds 20
}

"`n--- attaching registry and image ---"
az containerapp registry set --subscription $subscriptionId --name $appName --resource-group $rg `
    --server "$registry.azurecr.io" --identity system -o none
if ($LASTEXITCODE -ne 0) { throw "registry set failed ($LASTEXITCODE)" }

az containerapp update --subscription $subscriptionId --name $appName --resource-group $rg `
    --image $image --set-env-vars "ALLOWED_ORIGINS=$appOrigin" -o none
if ($LASTEXITCODE -ne 0) { throw "containerapp update failed ($LASTEXITCODE)" }

# --- verify, rather than assume ----------------------------------------------------------------
"`n--- waiting for a healthy revision ---"
$deadline = (Get-Date).AddMinutes(5)
$ready = $false
while ((Get-Date) -lt $deadline) {
    $state = az containerapp show --subscription $subscriptionId --name $appName --resource-group $rg `
        --query '{running:properties.runningStatus, provisioning:properties.provisioningState, image:properties.template.containers[0].image}' -o json | ConvertFrom-Json
    "  provisioning=$($state.provisioning) running=$($state.running)"
    if ($state.provisioning -eq 'Succeeded' -and $state.running -eq 'Running') {
        if ($state.image -ne $image) { throw "App is running image '$($state.image)', expected '$image'." }
        $ready = $true
        break
    }
    Start-Sleep -Seconds 10
}
if (-not $ready) { throw "No healthy revision within 5 minutes. Inspect '$appName' before rerunning." }

$fqdn = az containerapp show --subscription $subscriptionId --name $appName --resource-group $rg `
    --query 'properties.configuration.ingress.fqdn' -o tsv
if (-not $fqdn) { throw 'No ingress FQDN.' }

"`n--- endpoint checks ---"
$health = Invoke-RestMethod -Uri "https://$fqdn/health" -TimeoutSec 30
"  /health           -> $($health | ConvertTo-Json -Compress)"

# A real query, with the app's Origin, so the CORS header is exercised rather than assumed.
$probe = Invoke-WebRequest -Uri "https://$fqdn/adsb/point/48.3538/11.7861/25" `
    -Headers @{ Origin = $appOrigin; Accept = 'application/json' } -UseBasicParsing -TimeoutSec 30
$aircraft = ($probe.Content | ConvertFrom-Json).ac.Count
"  /adsb/point       -> HTTP $($probe.StatusCode), $aircraft aircraft"
"  allow-origin      -> $($probe.Headers['Access-Control-Allow-Origin'])"
"  expose-headers    -> $($probe.Headers['Access-Control-Expose-Headers'])"
"  relay age         -> $($probe.Headers['x-relay-age-ms']) ms"

# Negative controls: the lockdown has to actually lock something down.
try {
    Invoke-WebRequest -Uri "https://$fqdn/adsb/point/51.5/-0.12/25" -UseBasicParsing -TimeoutSec 20 | Out-Null
    "  !! out-of-area    -> ALLOWED, which it must not be"
} catch {
    "  out-of-area       -> refused ($($_.Exception.Response.StatusCode.value__))"
}
try {
    $denied = Invoke-WebRequest -Uri "https://$fqdn/adsb/point/48.3538/11.7861/25" `
        -Headers @{ Origin = 'https://example.invalid' } -UseBasicParsing -TimeoutSec 20
    "  foreign origin    -> HTTP $($denied.StatusCode), allow-origin='$($denied.Headers['Access-Control-Allow-Origin'])' (empty = browser cannot read it)"
} catch {
    "  foreign origin    -> $($_.Exception.Message)"
}

"`nrelay: https://$fqdn"
"`n!! This is a billable always-on resource (min 1 replica, ~EUR 6/month)."
"   To retire it:  az containerapp delete -n $appName -g $rg --subscription $subscriptionId --yes"
