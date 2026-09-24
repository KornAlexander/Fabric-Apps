# Umsetzung im eigenen Mandanten

Diese Anleitung bringt den München Zwilling in euren eigenen Fabric-Mandanten. Alle Werte, die
auf einen bestimmten Mandanten zeigen, kommen aus Umgebungsvariablen. Im Code stehen bewusst
**keine Vorgabewerte**: ein Wert, der „meistens passt“, schreibt sonst in fremde Ressourcen.

## 1. Voraussetzungen

**Region.** Fabric Apps sind in der Vorschau und nicht in jeder Azure-Region verfügbar,
aktuell zum Beispiel **nicht in Germany West Central** und nicht in North Europe. In Europa
unterstützt sind unter anderem West Europe, Sweden Central, France Central, Italy North,
Norway East und Switzerland North. Liegt euer Mandant in einer Region ohne Fabric Apps, reicht
eine Fabric-Kapazität in einer unterstützten Region (Multi-Geo).

- Regionen: <https://learn.microsoft.com/fabric/admin/region-availability>
- Kapazität in anderer Region: <https://learn.microsoft.com/fabric/admin/service-admin-premium-multi-geo>
- Fabric Apps: <https://learn.microsoft.com/fabric/apps/overview>

**Außerdem:**

- Fabric-Arbeitsbereich auf dieser Kapazität, Fabric Apps im Admin-Portal aktiviert.
- Azure-Abonnement für zwei Container Apps (Assistent und Relay), eine Container Registry und
  Azure OpenAI mit einem Chat-Modell (Deployment-Name frei wählbar, als
  `AZURE_OPENAI_DEPLOYMENT` angeben).
- Eine Fabric SQL-Datenbank für die Koordinationsnotizen.
- Optional: eine Entra-App-Registrierung, damit der Autor einer Notiz geprüft statt nur
  gemeldet wird (Abschnitt 6).
- Lokal: Node.js 22.12 oder neuer, Python 3.11 oder neuer, Azure CLI, PowerShell 7. Für
  `tools/run_sql.py` zusätzlich `pip install pyodbc` und der „ODBC Driver 18 for SQL Server“.

⚠️ **Drei Eigenschaften, die man vorher kennen sollte:**

1. Die App-Hülle und alles unter `public/` sind nach der Bereitstellung **anonym abrufbar**.
   Hier liegen nur offene Daten, das ist also unkritisch, gilt aber für jede Erweiterung.
2. **Die Koordinationsnotizen sind in diesem Stand nicht vertraulich.** Lesen kann sie jeder, der
   die App aufruft: der App-Schlüssel steht im ausgelieferten JavaScript. Das Zurückziehen einer
   Notiz prüft nicht, wer sie geschrieben hat, auch nicht mit Anmeldung. Das ist ein
   Demonstrationsstand. Bitte keine personenbezogenen oder vertraulichen Inhalte in Notizen
   schreiben; für echte Koordinationsdaten braucht es zuerst Berechtigungen für Lesen und
   Zurückziehen.
3. Eine App braucht eine **laufende Kapazität**. Eine pausierte Kapazität liefert die App nicht
   aus.

## 2. Konfiguration

Setzt die Variablen in der PowerShell-Sitzung, aus der ihr baut und bereitstellt
(`$env:NAME = 'wert'`). Die `VITE_*`-Werte können auch in einer `.env.local` stehen, siehe
`.env.example`; für die Build-Prüfung in `tools/` müssen sie aber als Umgebungsvariablen gesetzt
sein.

| Variable | Wofür | Beispiel |
|---|---|---|
| `AZURE_SUBSCRIPTION_ID` | Abonnement für Container Apps und Registry | GUID |
| `AZURE_TENANT_ID` | euer Entra-Mandant | GUID |
| `AZURE_RESOURCE_GROUP` | Ressourcengruppe | `rg-muenchen-zwilling` |
| `CONTAINERAPPS_ENVIRONMENT` | Container-Apps-Umgebung | `cae-muenchen-zwilling` |
| `ACR_NAME` | Container Registry (ohne `.azurecr.io`) | `acrzwilling` |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_ACCOUNT` | Azure OpenAI | `https://<name>.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT` | Name eures Chat-Modell-Deployments | frei gewählt |
| `FABRIC_SQL_SERVER`, `FABRIC_SQL_DATABASE` | Verbindung der Fabric SQL-Datenbank | aus den Verbindungsdetails |
| `FABRIC_TENANT_ID`, `FABRIC_WORKSPACE_ID` | Ziel der Fabric App | GUID |
| `FABRIC_FOLDER_ID` | optional: Ordner im Arbeitsbereich | GUID |
| `APP_ORIGIN` | Adresse der bereitgestellten App, bekannt nach Schritt 4.2 | `https://<name>-<region>.webapp.fabricapps.net` |
| `ZWILLING_APP_KEY` | gemeinsamer Schlüssel zwischen App und Assistent, frei wählen | lange Zufallszeichenkette |
| `VITE_AGENT_ORIGIN` | Adresse des Assistenten (Container App) | `https://ca-muenchen-zwilling.<env>.<region>.azurecontainerapps.io` |
| `VITE_AGENT_APP_KEY` | derselbe Wert wie `ZWILLING_APP_KEY` | |
| `VITE_RELAY_ORIGIN` | Adresse des Relays (Container App) | `https://ca-adsb-relay.<env>.<region>.azurecontainerapps.io` |
| `VITE_ENTRA_CLIENT_ID`, `VITE_ENTRA_TENANT_ID` | optional: Entra-Anmeldung für geprüfte Autoren | GUID |
| `ENTRA_TENANT_ID`, `ENTRA_API_AUDIENCE`, `REQUIRE_AUTH` | optional: dieselbe Anmeldung im Assistenten prüfen | siehe Abschnitt 6 |
| `APPROVED_FABRIC_IDS` | kommagetrennt: Mandant, Arbeitsbereich, Kapazität, App-Element | siehe Schritt 4.1 |

ℹ️ Der App-Schlüssel ist eine **Bremsschwelle, keine Anmeldung**: er steht im ausgelieferten
JavaScript. Er verhindert nur, dass jemand mit der bloßen Adresse des Assistenten Tokens
verbraucht. Zusätzlich begrenzt der Assistent die Aufrufe pro Stunde.

## 3. Notizenspeicher

1. Fabric SQL-Datenbank im Arbeitsbereich anlegen.
2. `server/sql/koordination.sql` darin ausführen.
3. Nach Schritt 4.3: der verwalteten Identität des Assistenten Zugriff geben,
   `pwsh tools/grant-sql-identity.ps1`.

## 4. Bereitstellen, in dieser Reihenfolge

App, Assistent und Relay brauchen gegenseitig ihre Adressen. Die erste Bereitstellung läuft
deshalb in vier Schritten. Danach genügt jeweils der Schritt, der sich geändert hat.

### 4.1 App-Element anlegen

```powershell
npm ci
pwsh tools/deploy-fabric.ps1    # rayfin up in euren Arbeitsbereich
```

Dieser erste Lauf legt das App-Element an und schreibt dessen Kennungen nach
`rayfin/.deployments.json`. **Der Build bricht danach erwartungsgemäß ab** („Unapproved
application text“): die Build-Prüfung (`tools/check-assets.mjs`) lässt keine GUID ins Bundle, die
nicht ausdrücklich freigegeben ist, und die Fabric-Client-Bibliothek braucht genau diese
Kennungen. Tragt deshalb aus `rayfin/.deployments.json` Mandant, Arbeitsbereich, App-Element und
die Kapazitäts-ID aus `fabricApiUrl` kommagetrennt in `APPROVED_FABRIC_IDS` ein, nachdem ihr
geprüft habt, dass es eure eigenen sind. Nur GUIDs, sonst bricht die Prüfung mit einer Meldung ab.

### 4.2 App ausliefern, Adresse ermitteln

```powershell
pwsh tools/deploy-fabric.ps1
```

Jetzt läuft der Build durch und `rayfin up` meldet die Adresse der App. Diese als `APP_ORIGIN`
setzen. Assistent und Flugverkehr funktionieren in diesem Zwischenstand noch nicht, weil ihre
Adressen noch fehlen.

### 4.3 Assistent und Relay in Azure

```powershell
pwsh tools/deploy-agent.ps1     # baut das Image in der Registry (az acr build) und startet die Container App
pwsh tools/deploy-relay.ps1     # dasselbe für das ADS-B-Relay
```

Beide Skripte bauen in der Cloud (`az acr build`), ein lokales Docker ist nicht nötig, und beide
erlauben nur `APP_ORIGIN` als Ursprung. Die Adressen der beiden Container Apps sind danach
`VITE_AGENT_ORIGIN` und `VITE_RELAY_ORIGIN`. Dann Schritt 3.3 (SQL-Zugriff) ausführen.

Vor jeder Bereitstellung des Assistenten lohnt sich `cd server; python -c "import app"`: ein
Importfehler fällt dort in einer Sekunde auf statt nach dem Neustart des Containers.

### 4.4 App mit allen Adressen neu ausliefern

```powershell
pwsh tools/deploy-fabric.ps1
```

`rayfin/rayfin.yml` enthält danach auch die bereitgestellte Adresse als Redirect-URI; das
schreibt `rayfin up` selbst hinein. Die `VITE_*`-Werte als Umgebungsvariablen setzen, nicht nur
in `.env.local`: `rayfin up` schreibt `.env.local` vor jedem Build neu.

## 5. Notizen ohne und mit Anmeldung

Ohne weitere Einrichtung werden Notizen mit dem gemeldeten, **ungeprüften** Namen gespeichert.

## 6. Entra-Anmeldung für geprüfte Autoren (optional)

1. App-Registrierung anlegen (Single Tenant). Plattform **Single-Page-Anwendung** mit den
   Redirect-URIs `<APP_ORIGIN>/auth.html` und für die lokale Entwicklung
   `http://127.0.0.1:5190/auth.html`. Genau `/auth.html`, nicht die Startseite.
2. **Eine API verfügbar machen:** Anwendungs-ID-URI `api://<client-id>`, Bereich
   `Notizen.Write` (delegiert). Zustimmung für die Nutzenden erteilen, zum Beispiel als
   Administrator für den Mandanten.
3. App: `VITE_ENTRA_CLIENT_ID=<client-id>`, `VITE_ENTRA_TENANT_ID=<mandant>`, dann Schritt 4.4.
4. Assistent: `ENTRA_TENANT_ID=<mandant>`, `ENTRA_API_AUDIENCE=api://<client-id>`, dann
   `deploy-agent.ps1`. Der Assistent prüft Signatur, Aussteller, Audience und den Bereich
   `Notizen.Write`; ein bloßes ID-Token reicht nicht.
5. Erst wenn die Anmeldung einmal vollständig funktioniert hat: `REQUIRE_AUTH=true` setzen und
   `deploy-agent.ps1` erneut ausführen. Dann werden ungeprüfte Schreibzugriffe abgelehnt. Das
   Lesen und das Zurückziehen von Notizen schützt auch diese Einstellung nicht (siehe oben).

## 7. Gelände neu bauen (optional)

Das Paket enthält Gelände, Luftbild, Gebäude und Bäume fertig gebaut. Neu bauen muss man nur für
ein anderes Gebiet oder neuere Daten:

```powershell
python -m pip install -r tools/requirements.txt
pwsh tools/build-flughafen.ps1          # Flughafen-Kern, rund sechs Minuten
```

Die Schritte laufen in einer festen Reihenfolge (Gebäude **vor** dem Teilen des Luftbilds). Das
Stadtgebiet ist in `config/aoi/munich.json` beschrieben; die einzelnen Schritte stehen in
`tools/build-flughafen.ps1` und lassen sich mit `--aoi munich` genauso aufrufen.

## 8. Prüfen

```powershell
npm test                 # Einheitentests: Karte, Geometrie, Relay, Fahrplan
```

Vor dem Termin mit Publikum: App einmal öffnen und ganz laden lassen (der erste Aufruf holt
Gelände und Luftbild), die Ebene **Koordinationsnotizen** einschalten **bevor** eine Notiz
gespeichert wird, und im Assistenten jede Frage mit der Straße stellen, denn er merkt sich
nichts zwischen zwei Fragen.
