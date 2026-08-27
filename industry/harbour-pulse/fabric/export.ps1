<#
.SYNOPSIS
    Export Fabric item definitions from a source workspace into this folder.

.DESCRIPTION
    Pulls the definition of every in-scope item in a Fabric workspace and writes
    it to `fabric/<DisplayName>.<Type>/…` — the layout `fabric-cicd` (deploy.py)
    expects. Run this whenever items are changed in the portal so the repo stays
    the source of truth and a new tenant can be rebuilt from scratch.

    Authentication uses the current `az login` session.

.PARAMETER WorkspaceId
    Source Fabric workspace GUID. Defaults to $env:FABRIC_WORKSPACE_ID.

.PARAMETER Types
    Item types to export. Must be types accepted by fabric-cicd.

.EXAMPLE
    ./export.ps1 -WorkspaceId <source-workspace-id>
#>
[CmdletBinding()]
param(
    [string]$WorkspaceId = $env:FABRIC_WORKSPACE_ID,

    [string[]]$Types = @(
        'Eventhouse',
        'KQLDatabase',
        'KQLQueryset',
        'KQLDashboard',
        'Eventstream',
        'Notebook'
    )
)

$ErrorActionPreference = 'Stop'

if (-not $WorkspaceId) {
    throw 'WorkspaceId is required (pass -WorkspaceId or set FABRIC_WORKSPACE_ID).'
}

$api = 'https://api.fabric.microsoft.com/v1'
$outRoot = $PSScriptRoot

function Get-FabricToken {
    (az account get-access-token --resource 'https://api.fabric.microsoft.com' --query accessToken -o tsv)
}

$token = Get-FabricToken
if (-not $token) { throw 'Could not acquire a Fabric token. Run `az login` first.' }
$headers = @{ Authorization = "Bearer $token" }

Write-Host "Listing items in workspace $WorkspaceId…"
$items = (Invoke-RestMethod -Method Get -Uri "$api/workspaces/$WorkspaceId/items" -Headers $headers).value |
    Where-Object { $Types -contains $_.type }

if (-not $items) {
    Write-Warning 'No in-scope items found.'
    return
}

foreach ($item in $items) {
    $label = "$($item.displayName) [$($item.type)]"
    Write-Host "→ $label"

    try {
        $resp = Invoke-WebRequest -Method Post -Headers $headers `
            -Uri "$api/workspaces/$WorkspaceId/items/$($item.id)/getDefinition" `
            -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck
    }
    catch {
        Write-Warning "  skipped — $($_.Exception.Message)"
        continue
    }

    # Definition export can be a long-running operation (202 + Location header).
    if ($resp.StatusCode -eq 202) {
        $opUrl = $resp.Headers.Location
        if ($opUrl -is [array]) { $opUrl = $opUrl[0] }
        do {
            Start-Sleep -Seconds 2
            $op = Invoke-RestMethod -Method Get -Uri $opUrl -Headers $headers
        } while ($op.status -in @('NotStarted', 'Running'))

        if ($op.status -ne 'Succeeded') {
            Write-Warning "  skipped — operation $($op.status)"
            continue
        }
        $body = Invoke-RestMethod -Method Get -Uri "$opUrl/result" -Headers $headers
    }
    elseif ($resp.StatusCode -ge 400) {
        Write-Warning "  skipped — HTTP $($resp.StatusCode) (item type may not support getDefinition)"
        continue
    }
    else {
        $body = $resp.Content | ConvertFrom-Json
    }

    $parts = $body.definition.parts
    if (-not $parts) {
        Write-Warning '  skipped — no definition parts returned'
        continue
    }

    $dir = Join-Path $outRoot "$($item.displayName).$($item.type)"
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    New-Item -ItemType Directory -Path $dir -Force | Out-Null

    foreach ($part in $parts) {
        $target = Join-Path $dir $part.path
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        [IO.File]::WriteAllBytes($target, [Convert]::FromBase64String($part.payload))
    }

    Write-Host "  wrote $($parts.Count) part(s) to $(Split-Path $dir -Leaf)"
}

Write-Host ''

# Exported definitions can carry secrets that were typed into the portal
# (Event Hub SAS keys, API keys). Never commit those.
$secretPatterns = 'SharedAccessKey=', 'AccountKey=', 'apikey [A-Za-z0-9]', 'Bearer [A-Za-z0-9]{20}'
$hits = Get-ChildItem -Path $outRoot -Recurse -File -Include *.json, *.py, *.kql, *.tmdl |
    Select-String -Pattern $secretPatterns

if ($hits) {
    Write-Warning 'Possible secrets found in exported definitions — externalise before committing:'
    $hits | ForEach-Object { Write-Warning "  $($_.Path):$($_.LineNumber)" }
}

Write-Host 'Export complete. Review changes, then commit.' -ForegroundColor Green
