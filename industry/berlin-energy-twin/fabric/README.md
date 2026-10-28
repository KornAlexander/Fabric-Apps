# Berliner Stadtwerke Zwilling: import model for Copilot / Fabric IQ

A portable Power BI project (PBIP) with the twin's data embedded in the model: every table is a deflate-compressed CSV inside its Power Query step. It opens, refreshes and publishes in any tenant with no gateway, lakehouse or credential. Decisions are in PLAN.md (D50).

- `pbip/Berliner-Stadtwerke-Zwilling.pbip` contains the model (12 tables, 50 measures, German names and descriptions) and a 4-page report (Stadtwerke, degewo, BVG, Laden) in the Hochschul-Insights style.
- `pbip/...SemanticModel/Copilot/` holds the "Prep data for AI" files: synonyms, AI instructions with figures filled from the data, and example prompts.

## Rebuild after a re-bake

```bash
npm run export:model
```

```bash
python fabric/gen_model.py
```

```bash
python fabric/gen_report.py
```

1. `export:model` writes `fabric/build/*.csv` and `expected.json` from the app's own functions.
2. `gen_report.py` also checks that every field a visual uses exists in the model.

## Check against the app

1. Open the PBIP in Power BI Desktop (`powerbi-desktop open <pbip>`).
2. Read the engine port from `%LOCALAPPDATA%\Microsoft\Power BI Desktop\AnalysisServicesWorkspaces\<newest>\Data\msmdsrv.port.txt`.
3. Run:

```bash
pwsh -NoProfile -File fabric/query_desktop.ps1 -Port <port> -Refresh
```

```bash
python fabric/check_model.py <port>
```

The check covers row counts, every measure, the partner solar sums, charge points, the 9 estates with 464 / 71 points within 300 m, the Himbeersteig gap, district filters and the year identities.

## PBIX and another tenant

1. In Desktop: Refresh, then File > Save as > .pbix.
2. Publish the PBIX to any workspace, or import the PBIP folder through Fabric Git or the REST API. No data source credentials are needed.
3. Copilot reads the descriptions, `Copilot/schema.json` and `Copilot/Instructions/instructions.md`. Check in the Service that "Prep data for AI" shows the instructions after publishing.

## Known limits

- `[Solarleistung kWp]` counts registered plants in every status, like the app. 839 kWp of the BVG's 2,051 kWp is registered as temporarily or permanently shut down; `[Solarleistung in Betrieb kWp]` leaves those out.
- Fokusdach holds degewo roofs only and has no link to Quartier or Partner.
- Ladestrom is a sum over years; 2017 to 2019 are missing in the source.
