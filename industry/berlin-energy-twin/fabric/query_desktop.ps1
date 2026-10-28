# Run TMSL or DAX against the model open in Power BI Desktop (local engine), for the checks in check_model.py.
# Usage: pwsh fabric/query_desktop.ps1 -Port 56163 -Dax "EVALUATE ..."   |   -Refresh
param(
    [Parameter(Mandatory)] [int] $Port,
    [string] $Dax,
    [string] $DaxFile,
    [switch] $Refresh
)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot "..\..\.venv\Lib\site-packages\sempy\lib\Microsoft.AnalysisServices.AdomdClient.dll")

# Desktop keeps an empty default catalog next to the real one; take the one that holds tables.
$c = [Microsoft.AnalysisServices.AdomdClient.AdomdConnection]::new("Data Source=localhost:$Port")
$c.Open()
$cmd = $c.CreateCommand()
$cmd.CommandText = 'SELECT [CATALOG_NAME] FROM $SYSTEM.DBSCHEMA_CATALOGS'
$r = $cmd.ExecuteReader(); $cats = @(); while ($r.Read()) { $cats += $r.GetString(0) }; $r.Close(); $c.Close()
$catalog = $null
foreach ($cat in $cats) {
    $t = [Microsoft.AnalysisServices.AdomdClient.AdomdConnection]::new("Data Source=localhost:$Port;Initial Catalog=$cat"); $t.Open()
    $k = $t.CreateCommand(); $k.CommandText = 'SELECT [Name] FROM $SYSTEM.TMSCHEMA_TABLES'
    $rr = $k.ExecuteReader(); $n = 0; while ($rr.Read()) { $n++ }; $rr.Close(); $t.Close()
    if ($n -gt 1) { $catalog = $cat }
}
if (-not $catalog) { throw "no catalog with tables on port $Port" }

$conn = [Microsoft.AnalysisServices.AdomdClient.AdomdConnection]::new("Data Source=localhost:$Port;Initial Catalog=$catalog")
$conn.Open()
try {
    if ($Refresh) {
        $q = $conn.CreateCommand()
        $q.CommandText = "{ ""refresh"": { ""type"": ""full"", ""objects"": [ { ""database"": ""$catalog"" } ] } }"
        $q.CommandTimeout = 600
        [void] $q.ExecuteNonQuery()
        "refreshed $catalog"
        return
    }
    if ($DaxFile) { $Dax = Get-Content $DaxFile -Raw -Encoding utf8 }
    $q = $conn.CreateCommand(); $q.CommandText = $Dax
    $rd = $q.ExecuteReader()
    $rows = @()
    while ($rd.Read()) {
        $o = [ordered]@{}
        for ($i = 0; $i -lt $rd.FieldCount; $i++) { $o[$rd.GetName($i)] = if ($rd.IsDBNull($i)) { $null } else { $rd.GetValue($i) } }
        $rows += [pscustomobject]$o
    }
    $rd.Close()
    $rows | ConvertTo-Json -Depth 3
} finally { $conn.Close() }
