# Power BI report — Betroffenheit & Deckung

The PBIR report under `fabric/Flut-Insights.Report/` is **generated, not hand-edited**.
Editing the JSON directly will be silently overwritten the next time anyone runs the
generator. Change [generate_report.py](generate_report.py) instead.

```powershell
python tools/report/generate_report.py          # rebuild fabric/Flut-Insights.Report
powerbi-report-author validate fabric/Flut-Insights.Report
python tools/report/deploy_report.py            # create or update the report in Fabric
```

The report connects live (`byConnection`) to the semantic model
`Flut-Insights — Portfolio & Schaden` in the `Rayfin Apps` workspace. The model itself is
defined in [../../fabric/FlutInsights.SemanticModel](../../fabric/FlutInsights.SemanticModel);
every measure the report binds to lives on the dedicated `Measure` table.

## Why the JSON is written by hand rather than via `pbir add visual`

`pbir add visual --from-json` double-encodes UTF-8 when it writes `visual.json`. That
corrupts not only the German titles but the `queryRef` / `Property` field references
themselves, so the visuals silently fail to bind against the live model. Writing the
JSON straight from Python with `encoding="utf-8"` avoids the bug entirely.

## Two constraints that shape the layout

- **Visual `name` fields must be ASCII.** The Fabric report import rejects any non-ASCII
  character in a visual or page name — hence `visP2Sockel`, not `visP2Sockelhöhe`.
- **The IBCS visual cannot scale its own axis and renders a percentage measure as a
  flat 1.** So the money bars bind to the `… Mio €` measures, and `actual` / `reference`
  are always absolute counts or amounts, never ratios.

## `assets/`

Vendored so the generator has no dependency on any other repository:

- `CustomVisuals/ibcsMultiTierBar…` — the IBCS multi-tier bar, referenced from
  `report.json` → `resourcePackages`.
- `StaticResources/SharedResources/BaseThemes/Fluent2-CY26SU04.json` — the base theme.
