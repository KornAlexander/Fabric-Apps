# Grant the agent container's managed identity access to the Fabric SQL Database.
#
# ⚠️ THIS CANNOT BE DONE WITH `az`. Access to a Fabric SQL Database is granted inside the database
# with `CREATE USER ... FROM EXTERNAL PROVIDER`, executed by an Entra identity that is already an
# admin there. Azure RBAC on the Fabric item does not create the database principal.
#
# ⚠️ THE NAME MUST BE THE CONTAINER APP'S NAME, NOT ITS PRINCIPAL GUID. For a system-assigned
# managed identity, `FROM EXTERNAL PROVIDER` resolves the display name of the service principal,
# which is the resource name. Passing the object id produces a principal that exists but never
# matches the token presented at connect time.
#
# Usage
#   pwsh -NoProfile -File tools/grant-sql-identity.ps1

param(
    [string]$AppName = 'ca-muenchen-zwilling'
)

$ErrorActionPreference = 'Stop'


# Konfiguration kommt aus Umgebungsvariablen, siehe UMSETZUNG.md. Es gibt bewusst KEINE
# Vorgabewerte: ein Wert, der "meistens passt", schreibt sonst in einen fremden Mandanten.
function Need([string]$Name) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  if (-not $v) { throw "Umgebungsvariable $Name fehlt (siehe UMSETZUNG.md)." }
  return $v
}
$server   = Need 'FABRIC_SQL_SERVER'
$database = Need 'FABRIC_SQL_DATABASE'
$sub      = Need 'AZURE_SUBSCRIPTION_ID'

$sql = @"
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$AppName')
BEGIN
    CREATE USER [$AppName] FROM EXTERNAL PROVIDER;
END
ALTER ROLE db_datareader ADD MEMBER [$AppName];
ALTER ROLE db_datawriter ADD MEMBER [$AppName];
GRANT CREATE TABLE TO [$AppName];
GRANT ALTER ON SCHEMA::dbo TO [$AppName];
SELECT name, type_desc FROM sys.database_principals WHERE name = '$AppName';
"@

Write-Host "Server   : $server"
Write-Host "Database : $database"
Write-Host "Identity : $AppName"
Write-Host ''

# A user access token for the SQL endpoint, taken from the signed-in Azure CLI identity.
$token = az account get-access-token --subscription $sub `
    --resource https://database.windows.net --query accessToken -o tsv
if (-not $token) { throw 'Could not obtain a SQL access token from the Azure CLI.' }

$python = 'python'
if (-not (Test-Path $python)) { $python = 'python' }

$env:ZWILLING_SQL_TOKEN = $token
$env:ZWILLING_SQL_SERVER = $server
$env:ZWILLING_SQL_DATABASE = $database
$env:ZWILLING_SQL_SCRIPT = $sql

& $python (Join-Path $PSScriptRoot 'run_sql.py')
if ($LASTEXITCODE -ne 0) { throw "Granting access failed ($LASTEXITCODE)" }

Remove-Item Env:ZWILLING_SQL_TOKEN -ErrorAction SilentlyContinue
Write-Host ''
Write-Host 'Done. Restart the container app so it picks the permission up on its next connect:'
Write-Host "  az containerapp revision restart --name $AppName --resource-group $env:AZURE_RESOURCE_GROUP --subscription $sub --revision <name>"
