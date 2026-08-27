# Gauge data (Pegel) — resolved sources

Closes most of **T1** in [phase1-data-tasks.md](phase1-data-tasks.md). Verified 2026-07-27 by direct HTTP probe.

---

## Finding 1 — PEGELONLINE does **not** carry the Ahr ❌

`https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?waters=AHR` → `[]` (empty).
A full scan of all **786** PEGELONLINE stations returns no Ahr gauge.

**Reason:** PEGELONLINE is the **WSV** (federal waterways) service. The Ahr is a state water body
(*Gewässer II. Ordnung / Landesgewässer*), so the responsible authority is **LfU Rheinland-Pfalz**, not the WSV.

➡️ **Do not use PEGELONLINE for this project.** Remove it from consideration.

## Finding 2 — the authority is the HVZ / LfU Rheinland-Pfalz ✅

| Portal | Role | Status |
|---|---|---|
| `https://www.hochwasser.rlp.de/` | **Hochwasservorhersagezentrale (HVZ) RLP** — live warnings + gauge readings, React SPA | ✅ 200 |
| `https://hochwassermanagement.rlp.de/` | HWRM portal — hazard/risk maps, Sturzflutgefahrenkarten, Wasserspiegellagen | ✅ 200 (the 404 noted in PLAN.md §4 is **stale** — the site is live) |
| `https://geodaten-wasser.rlp-umwelt.de/` | LfU water geodata portal — per-station Wasserstand / Abfluss detail + a Download view | ✅ 200 (Vue SPA) |
| `https://hwrm.rlp-umwelt.de/` | HWRM-Explorer (hazard maps) | to check — **T3** |
| `https://hydrozwilling.rlp.de/` | **HydroZwilling RLP** — the state's own 3D flood simulation/visualisation twin (launched 12/2025) | ⚠️ **see Finding 5** |

## Finding 3 — the HVZ has an open, unauthenticated JSON API ✅

Discovered from the SPA bundle (`/static/js/main.300dcfb1.js`, route config object).
Base: `https://www.hochwasser.rlp.de/api/v1` — `Accept: application/json`, no key, no cookie.

| Endpoint | Returns | Size |
|---|---|---|
| `/config` | **station master data** — name, number, coords, catchment area, elevation, operator, river, alert region, slug; plus alert classes, legends, rivers, riverareas | ~285 KB |
| `/index` | **current readings** — per station a 48 h series at **15-minute** resolution (`measurements[{x: ISO-ts, y: value}]`), plus alert-region states | ~2.9 MB |
| `/status-report` | current textual situation report | ~4 KB |
| `/alert-region/{id}` | alert-region detail | — |

`/river-area` and `/measurement-site` are templated (`/{id}`) and 404 without a parameter.

**Ahr alert region:** `alertregions["31"] = "Ahr-Einzugsgebiet"`. River id `2718000000`, riverArea `8`.

### Ahr gauges

| Gauge | Station no. | Internal id | Notes |
|---|---|---|---|
| **Altenahr** | `27180403` | 393 | catchment **747.97 km²**, elevation **160.522 m**, easting 357407.4 / northing 5598011.6 (ETRS89 UTM32), operator *SGD Nord, Regionalstelle Koblenz*, slug `altenahr`, `hasPrediction: true` |
| **Bad Bodendorf** | `27180607` | — | same operator |
| **Müsch 2** | `27180094` | — | upstream; the original *Müsch* gauge was replaced |

Per-station detail page: `https://geodaten-wasser.rlp-umwelt.de/wasserstand/2718040300`
(**station number + two trailing zeros**), also `/abfluss/{nr}` for discharge.

➡️ This gives Flut-Insights a **real, live Ahr gauge feed** for the "was ist heute anders möglich" act
(PLAN.md §10.3) at zero licensing cost. Poll `/index`, filter to station `27180403`.

## Finding 4 — the LfU data API, recovered ✅ (time series still open ⚠️)

✅ **Recovered 2026-07-27 by Playwright network capture.** Guessing the routes had failed — they live in
lazy-loaded Vue chunks. The portal exposes:

```
https://geodaten-wasser.rlp-umwelt.de/api/data/<dataset>?w=messstellennummer=<nr>
https://geodaten-wasser.rlp-umwelt.de/api/export/<dataset>.csv?w=messstellennummer=<nr>
```

Verified dataset names (**guessing them returns 403** — they are whitelisted server-side):
`messstellen_wasserstand_stammdaten` · `messstellen_wasserstand_hauptwerte` ·
`messstellen_wasserstand_jaehrlichkeiten_alljaehrlichkeiten` ·
`messstellen_wasserstand_aktuellewasserstaende_lastmesswert`

⚠️ **The API returns 403 without browser headers.** Send `Origin` and `Referer` for the portal plus a normal
browser `User-Agent` — it is same-origin enforcement, not authentication.
Implemented in `tools/geodata/fetch_lfu_reference.py`.

### The official figures this gives us

| Value | Figure | Source |
|---|---|---|
| **Peak discharge 2021** | **800 – 1 230 m³/s** | Hauptwerte + top-ten event table |
| **Peak stage 2021** | **980 cm** | top-ten event table, reconstructed |
| Previous record | 236 m³/s (02.06.2016) | Hauptwerte |
| MQ / MHQ | 6.75 / 104 m³/s | Hauptwerte |
| **HQ10 / HQ100** | **175 / 500 m³/s** | Jährlichkeiten, Reihe 1947–2021 |

The LfU states the honesty caveat for us:

> "Wegen unterschiedlicher Rekonstruktionsansätze können für das Hochwasser 2021 nur **Wertebereiche**
> angegeben werden."

The Jährlichkeiten carry their own status note — *vorläufige Neuberechnung unter Berücksichtigung
historischer Hochwasser, Stand 10/2024* — which §4.8 requires us to repeat together with its date.

Also from Stammdaten: Altenahr sits at **river-km 32.04** above the mouth, gauge datum **160.522 m
DHHN2016**, catchment **747.78 km²**, established 01.11.1991, upstream gauge Müsch, downstream Bad Bodendorf.

### Still open ⚠️

❌ **The 15-minute time series for 12–16 July 2021 is not available from this portal.** The download view offers
only: Hauptwerte · current levels (90 days) · current discharge (90 days) · daily means (last 3-year window).
None reaches back to 2021.

Remaining options, in order of preference:
1. `wasserportal.rlp-umwelt.de/auskunftssysteme/analysen-und-messwerte` — the portal's own pointer to *geprüfte
   Daten*. Not yet explored.
2. The BfG / LfU post-event report, which typically publishes the reconstructed hydrograph as a figure.
3. Reconstruct a plausible hydrograph *shape* anchored to the sourced peak range and the known timing,
   **clearly labelled as a modelled shape, not a measurement.**

Option 3 is acceptable for the simulation — §6.2 only needs a hydrograph shape — provided the label is honest.
It is **not** acceptable for any number displayed as fact.

## Finding 5 — prior art: HydroZwilling RLP ⚠️ read before building

The Land Rheinland-Pfalz launched **HydroZwilling RLP** (`https://hydrozwilling.rlp.de/`) in December 2025 —
"Simulation und Visualisierung von Hochwasser- und Sturzflutgefahren für Land und Kommunen", by LfU RP.

This is state-operated prior art in exactly this space. Implications:
- **Review it before Phase 3** so Flut-Insights does not accidentally imitate it or claim novelty it lacks.
- Flut-Insights is *retrospective and insurance-focused* (what happened, what would have helped, what a portfolio
  view enables). HydroZwilling is *prospective and hazard-focused*. Keep that distinction sharp in the framing.
- Never position Flut-Insights as a replacement for or improvement on an official state system.

---

## Licence / attribution

Data from the HVZ and LfU RP portals is **not yet confirmed** as open-licensed for redistribution.
Before any of it is committed or shipped:

- [ ] Confirm the licence for `hochwasser.rlp.de/api/v1` payloads (Impressum / Nutzungsbedingungen)
- [ ] Confirm the licence for `geodaten-wasser.rlp-umwelt.de` downloads
- [ ] Record both in `NOTICE.md` with the exact attribution string

**Until confirmed, treat as "read-only reference, not redistributable."**
