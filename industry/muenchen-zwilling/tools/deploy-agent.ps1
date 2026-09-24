# Build and deploy the München Zwilling agent backend.
#
# ⚠️ A SECOND CONTAINER APP, NOT AN EXTENSION OF THE RELAY. `ca-adsb-relay` is a fixed-destination
# proxy whose entire security argument is that no caller input can influence the upstream host,
# path or query. Adding an agent and database writes to it would destroy exactly that property,
# so the two stay apart even though they share the resource group, environment and registry.
#
# ⚠️ THE SQL IDENTITY IS NOT CREATED HERE. Granting the container's managed identity access to the
# Fabric SQL Database means running `CREATE USER ... FROM EXTERNAL PROVIDER` inside the database
# as an Entra admin, which this script cannot do with `az`. It prints the exact statement instead,
# and `tools/grant-sql-identity.ps1` runs it.
#
# Usage
#   pwsh -NoProfile -File tools/deploy-agent.ps1 -WhatIf
#   pwsh -NoProfile -File tools/deploy-agent.ps1 -Tag v1

param(
    [string]$Tag = 'v1',
    [switch]$SkipBuild,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# ⚠️ THE CONSOLE MUST BE UTF-8 BEFORE `az acr build` RUNS, AND THIS IS NOT COSMETIC. The CLI
# streams the build log through colorama, which writes to the console's code page. On a German
# Windows that is cp1252, and the first non-ASCII byte in a pip progress line kills the command
# with `UnicodeEncodeError: 'charmap' codec can't encode characters`.
#
# ⚠️ AND THE BUILD ITSELF SURVIVES THAT CRASH, which is the genuinely misleading part. The build
# runs on an ACR agent, not here; the client dies while reading its log. Measured on 2026-09-21:
# `az acr build` exited 1 with that traceback while run cg30 completed and pushed the image. A
# script that trusts the exit code alone reports a failed build that actually succeeded.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'


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
$appName        = 'ca-muenchen-zwilling'
$appOrigin      = Need 'APP_ORIGIN'
$image          = "$registry.azurecr.io/muenchen-zwilling-agent:$Tag"

# Reused from the sibling app in the same resource group; proven against this account.
$openAiEndpoint = Need 'AZURE_OPENAI_ENDPOINT'
$openAiDeployment = Need 'AZURE_OPENAI_DEPLOYMENT'
$openAiAccount  = Need 'AZURE_OPENAI_ACCOUNT'

# The Fabric SQL Database created for the coordination notes.
$sqlServer   = (Need 'FABRIC_SQL_SERVER') + ',1433'
$sqlDatabase = Need 'FABRIC_SQL_DATABASE'
$notesOdbc   = "Driver={ODBC Driver 18 for SQL Server};Server=tcp:$sqlServer;Database=$sqlDatabase;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;"

# ⚠️ NOT A SECRET, AND THE NAME SAYS SO. This is a cost and abuse limiter that ships inside a
# public JavaScript bundle. It stops a stranger who finds the URL from running up Foundry tokens;
# it authenticates nobody.
$appKey = $env:ZWILLING_APP_KEY
if (-not $appKey) { throw 'Umgebungsvariable ZWILLING_APP_KEY fehlt (siehe UMSETZUNG.md).' }
# Optional: geprüfte Autoren (siehe UMSETZUNG.md, Abschnitt Entra). Nur gesetzte Werte gehen
# an den Container; REQUIRE_AUTH erst auf true, wenn die Anmeldung durchgespielt ist.
$entraVars = @()
foreach ($n in 'ENTRA_TENANT_ID', 'ENTRA_API_AUDIENCE', 'REQUIRE_AUTH') {
    $v = [Environment]::GetEnvironmentVariable($n)
    if ($v) { $entraVars += "$n=$v" }
}

# --- target guard ------------------------------------------------------------------------------
$account = az account show --subscription $subscriptionId --query '{tenantId:tenantId,id:id,name:name}' -o json | ConvertFrom-Json
if ($account.id -ne $subscriptionId) { throw "Resolved subscription $($account.id), expected $subscriptionId." }
if ($account.tenantId -ne $demoTenant) { throw "Subscription is in tenant $($account.tenantId), not the demo tenant." }
"subscription : $($account.name)"
"tenant       : $($account.tenantId)  (demo)"

if ($WhatIf) {
    "`nWHATIF would:"
    "  az acr build --registry $registry --image muenchen-zwilling-agent:$Tag -f Dockerfile.agent ."
    "  create or update container app '$appName' in '$environment' ($rg)"
    "    0.5 CPU / 1.0Gi, min 1 / max 1, external ingress on 8080"
    "    AZURE_OPENAI_ENDPOINT=$openAiEndpoint"
    "    AZURE_OPENAI_CHAT_DEPLOYMENT=$openAiDeployment"
    "    ZWILLING_NOTES_ODBC=<Fabric SQL, $sqlDatabase>"
    "  grant the identity 'Cognitive Services OpenAI User' on $openAiAccount"
    "  then verify /health and one real tool call"
    return
}

# --- build -------------------------------------------------------------------------------------
# ⚠️ BUILT BY ACR, NOT BY DOCKER HERE. This laptop is ARM64; the container runs linux/amd64.
if ($SkipBuild) {
    "`n--- skipping build, verifying the tag exists ---"
} else {
    "`n--- acr build ---"
    # ⚠️ `--no-logs` IS LOAD-BEARING ON A GERMAN WINDOWS. Streaming the build log routes it through
    # colorama, which encodes using the console code page (cp1252 here), and the first non-ASCII
    # byte in a pip progress line kills the CLI with `UnicodeEncodeError: 'charmap' codec`.
    # Setting `[Console]::OutputEncoding` and `PYTHONIOENCODING` does NOT fix it, because `az` is
    # a separate frozen interpreter whose console writer is chosen from the code page. Measured
    # twice on 2026-09-21: both streamed builds died this way while the build itself succeeded.
    #
    # The build result is then read from the ACR run record and the tag, which is better evidence
    # than a log anyway.
    az acr build --subscription $subscriptionId --registry $registry --no-logs `
        --image "muenchen-zwilling-agent:$Tag" --file Dockerfile.agent .
    if ($LASTEXITCODE -ne 0) {
        "  az exited $LASTEXITCODE; checking the run record and the registry before giving up"
    }
    $lastRun = az acr task list-runs --subscription $subscriptionId --registry $registry --top 1 `
        --query "[0].{run:runId,status:status,tag:outputImages[0].tag}" -o json | ConvertFrom-Json
    "  last ACR run   : $($lastRun.run) status=$($lastRun.status) tag=$($lastRun.tag)"
    if ($lastRun.status -ne 'Succeeded') {
        throw "ACR run $($lastRun.run) ended as '$($lastRun.status)'. Inspect with: az acr task logs --registry $registry --run-id $($lastRun.run)"
    }
}

# The tag is the evidence, not the exit code. See the encoding note at the top of this file.
$tags = az acr repository show-tags --subscription $subscriptionId --name $registry `
    --repository muenchen-zwilling-agent -o tsv 2>$null
if ("$tags" -notmatch "(^|\s)$([regex]::Escape($Tag))(\s|$)") {
    throw "Image tag '$Tag' is not in the registry. The build really did fail."
}
"image        : $registry.azurecr.io/muenchen-zwilling-agent:$Tag  (present)"

# --- does it already exist? --------------------------------------------------------------------
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
    # Two-phase, for the same Graph replication reason documented in tools/deploy-relay.ps1.
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
        --cpu 0.5 --memory 1.0Gi `
        --min-replicas 1 --max-replicas 1 `
        --env-vars "ALLOWED_ORIGINS=$appOrigin"
    if ($LASTEXITCODE -ne 0) { throw "containerapp create failed ($LASTEXITCODE)" }
}

$principal = az containerapp show --subscription $subscriptionId --name $appName --resource-group $rg `
    --query 'identity.principalId' -o tsv
if (-not $principal) { throw "No system-assigned identity on '$appName'." }
"identity     : $principal"

# --- AcrPull -----------------------------------------------------------------------------------
$registryId = az acr show --subscription $subscriptionId --name $registry --query id -o tsv
$hasRole = az role assignment list --subscription $subscriptionId --assignee $principal `
    --scope $registryId --role AcrPull --query "[0].id" -o tsv 2>$null
if ($hasRole) {
    "AcrPull      : already assigned"
} else {
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
    Start-Sleep -Seconds 20
}

# --- Foundry access ----------------------------------------------------------------------------
$openAiId = az cognitiveservices account show --subscription $subscriptionId --name $openAiAccount `
    --resource-group $rg --query id -o tsv
$hasOpenAi = az role assignment list --subscription $subscriptionId --assignee $principal `
    --scope $openAiId --role 'Cognitive Services OpenAI User' --query "[0].id" -o tsv 2>$null
if ($hasOpenAi) {
    "OpenAI User  : already assigned"
} else {
    $assigned = $false
    foreach ($attempt in 1..10) {
        az role assignment create --subscription $subscriptionId --assignee-object-id $principal `
            --assignee-principal-type ServicePrincipal --scope $openAiId `
            --role 'Cognitive Services OpenAI User' -o none 2>$null
        if ($LASTEXITCODE -eq 0) { $assigned = $true; break }
        "  waiting for the identity to appear in Graph (attempt $attempt)"
        Start-Sleep -Seconds 10
    }
    if (-not $assigned) { throw "Could not assign 'Cognitive Services OpenAI User' to $principal." }
    "OpenAI User  : assigned"
}

# --- registry, image, configuration ------------------------------------------------------------
"`n--- attaching registry and image ---"
az containerapp registry set --subscription $subscriptionId --name $appName --resource-group $rg `
    --server "$registry.azurecr.io" --identity system -o none
if ($LASTEXITCODE -ne 0) { throw "registry set failed ($LASTEXITCODE)" }

az containerapp update --subscription $subscriptionId --name $appName --resource-group $rg `
    --image $image `
    --set-env-vars `
        "ALLOWED_ORIGINS=$appOrigin" `
        "AZURE_OPENAI_ENDPOINT=$openAiEndpoint" `
        "AZURE_OPENAI_CHAT_DEPLOYMENT=$openAiDeployment" `
        "AZURE_OPENAI_USE_MANAGED_IDENTITY=true" `
        "BACKEND_APP_KEY=$appKey" `
        "ZWILLING_NOTES_ODBC=$notesOdbc" `
        @entraVars `
    -o none
if ($LASTEXITCODE -ne 0) { throw "containerapp update failed ($LASTEXITCODE)" }

# --- verify ------------------------------------------------------------------------------------
"`n--- waiting for a healthy revision ---"
$deadline = (Get-Date).AddMinutes(6)
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
if (-not $ready) { throw "No healthy revision within 6 minutes." }

$fqdn = az containerapp show --subscription $subscriptionId --name $appName --resource-group $rg `
    --query 'properties.configuration.ingress.fqdn' -o tsv
if (-not $fqdn) { throw 'No ingress FQDN.' }

"`n--- endpoint checks ---"
$health = Invoke-RestMethod -Uri "https://$fqdn/health" -TimeoutSec 60
"  /health           -> $($health | ConvertTo-Json -Compress)"

$headers = @{ Origin = $appOrigin; 'X-App-Key' = $appKey; 'Content-Type' = 'application/json' }
$probe = Invoke-WebRequest -Uri "https://$fqdn/api/tools/baustellen_suchen" -Method Post `
    -Headers $headers -Body '{"strasse":"Lothstr","limit":3}' -UseBasicParsing -TimeoutSec 90
$hits = ($probe.Content | ConvertFrom-Json).treffer
"  baustellen_suchen -> HTTP $($probe.StatusCode), $hits Treffer"

try {
    Invoke-WebRequest -Uri "https://$fqdn/api/tools/baustellen_suchen" -Method Post `
        -Headers @{ 'Content-Type' = 'application/json' } -Body '{}' -UseBasicParsing -TimeoutSec 30 | Out-Null
    "  !! no app key     -> ALLOWED, which it must not be"
} catch {
    "  no app key        -> refused ($($_.Exception.Response.StatusCode.value__))"
}

"`nagent: https://$fqdn"
"`nIf the notes store is not ready, run:"
"  pwsh -NoProfile -File tools/grant-sql-identity.ps1"
