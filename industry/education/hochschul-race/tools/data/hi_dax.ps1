param(
  [Parameter(Mandatory=$true)][string]$DaxFile,
  [string]$Out = "",
  # Power BI workspace and semantic model that hold the Hochschul-Insights model.
  # Resolved in this order: these parameters -> HI_WORKSPACE_ID / HI_DATASET_ID
  # -> config/live.json (the same git-ignored file the app reads for live data).
  # Deploy the `hochschul-insights` Fabric Jumpstart first (see README).
  [string]$WorkspaceId = $env:HI_WORKSPACE_ID,
  [string]$DatasetId   = $env:HI_DATASET_ID
)
# Runs an executeQueries DAX query against the Hochschul-Insights Direct Lake
# semantic model and writes the returned rows as JSON.
#
# Prerequisites:
#   az login --tenant <your-fabric-tenant>
#   the Fabric capacity backing the workspace must be Active
if (-not $WorkspaceId -or -not $DatasetId) {
  $cfgPath = Join-Path $PSScriptRoot "..\..\config\live.json"
  if (Test-Path $cfgPath) {
    $cfg = Get-Content $cfgPath -Raw -Encoding utf8 | ConvertFrom-Json
    if (-not $WorkspaceId) { $WorkspaceId = $cfg.workspaceId }
    if (-not $DatasetId)   { $DatasetId   = $cfg.datasetId }
  }
}
if (-not $WorkspaceId -or -not $DatasetId -or $WorkspaceId -like "__*__" -or $DatasetId -like "__*__") {
  throw "WorkspaceId and DatasetId are required. Pass -WorkspaceId/-DatasetId, set HI_WORKSPACE_ID/HI_DATASET_ID, or fill in config/live.json (copy config/live.example.json)."
}

$az = (Get-Command az -ErrorAction SilentlyContinue).Source
if (-not $az) { $az = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd" }
$token = & $az account get-access-token --resource "https://analysis.windows.net/powerbi/api" --query accessToken -o tsv
if (-not $token) { throw "Could not acquire a Power BI token. Run 'az login --tenant <tenant-id>' first." }

$uri = "https://api.powerbi.com/v1.0/myorg/groups/$WorkspaceId/datasets/$DatasetId/executeQueries"
$headers = @{ Authorization = "Bearer $token" }
$dax = [System.IO.File]::ReadAllText($DaxFile, [System.Text.Encoding]::UTF8)
$body = @{ queries = @(@{ query = $dax }); serializerSettings = @{ includeNulls = $true } } | ConvertTo-Json -Depth 6
$resp = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType "application/json" -Body $body
$rows = $resp.results[0].tables[0].rows
$json = $rows | ConvertTo-Json -Depth 8
if ($Out -ne "") {
  [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding $false))
  Write-Output "Wrote $($rows.Count) rows to $Out"
} else {
  Write-Output $json
}
