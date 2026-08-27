# Phase 1 — data acquisition research tasks

Open items that must be closed before Phase 2 (terrain/building preprocessing) starts.
Each one is a **blocker**, not a nice-to-have. See PLAN.md §4 and §14.

---

## T1 — Pegel Altenahr time series 🟡 mostly resolved

📄 **Findings: [gauge-data-sources.md](gauge-data-sources.md)** (verified 2026-07-27)

- [x] ~~Check `pegelonline.wsv.de`~~ → ❌ **ruled out.** No Ahr gauge in any of its 786 stations (WSV = federal waterways; the Ahr is a *Landesgewässer*).
- [x] Find the authoritative archive → **LfU Rheinland-Pfalz / HVZ**. `hochwassermanagement.rlp.de` is **live**, not 404.
- [x] Identify the station → **Altenahr `27180403`** (id 393, catchment 747.97 km², elevation 160.522 m, ETRS89 UTM32 357407.4 / 5598011.6). Also Bad Bodendorf `27180607`, Müsch 2 `27180094`.
- [x] Found an **open unauthenticated JSON API** with live 15-min readings: `https://www.hochwasser.rlp.de/api/v1/{config,index,status-report}` → usable for the live-gauge element in Act IV.

Still open:
- [ ] **Historic July 2021 series.** The HVZ API only holds ~48 h. Recover it from `geodaten-wasser.rlp-umwelt.de` — the download endpoint is inside lazy Vue chunks, so **do a Playwright "Mode 1" network capture instead of guessing** (see `/memories/task_recording.md`).
- [ ] Identify the official **post-event reconstruction** of peak stage and discharge (LfU / BfG) and record it **with an uncertainty range** — the gauge failed at ~5.75 m, so the peak is never a measurement. *(overlaps T2)*
- [ ] Confirm the **licence** for both HVZ API payloads and LfU portal downloads; record the attribution string in `NOTICE.md`. Until then: read-only reference, **not redistributable**.

**Rule:** the peak value used by the simulation must be traceable to a named document. No guessed number ever enters the repo.

---

## T1b — Review HydroZwilling RLP ⚠️ prior art, before Phase 3

The Land RLP launched its own 3D flood simulation twin <https://hydrozwilling.rlp.de/> in December 2025.
Review it, and keep the Flut-Insights framing distinct (retrospective + insurance-focused, **not** a rival to an
official state hazard system). Detail in [gauge-data-sources.md](gauge-data-sources.md) Finding 5.

---

## T2 — Act IV source documents ⚠️ BLOCKER for any Act IV copy

Fill the "Post-event reports" table in `NOTICE.md`. Candidates to locate and pin:

- [ ] **BfG** (Bundesanstalt für Gewässerkunde) post-event analysis of the July 2021 flood
- [ ] **LfU Rheinland-Pfalz** Hochwasser-Nachbetrachtung / Ereignisdokumentation
- [ ] **DWD** event report on the rainfall situation 12–15 July 2021
- [x] **Untersuchungsausschuss Rheinland-Pfalz** final report (warning chain, decision timeline) — UA 18/1
      „Flutkatastrophe“, Drucksache 18/10000, adopted 2 August 2024, 2 141 pages:
      <https://dokumente.landtag.rlp.de/landtag/drucksachen/10000-18.pdf>. Cited in `facts.ts` for the death
      toll. **Quote only from section D** („Würdigung der Beweisaufnahme und Ergebnis der Untersuchung“,
      p. 1455–1862) — that is the committee's finding. Everything from p. 1863 on is „Abweichende Meinung“
      annexes by individual factions, which give different numbers (135) and are opinions, not results.
- [ ] **Copernicus EMSR517** product notes (acquisition dates, method, accuracy caveats)
- [ ] Current status of the **Elementarschaden-Pflichtversicherung** legislative debate — with a date
- [ ] Current status of **Cell Broadcast** rollout in Germany — with a date

---

## T0 — Copernicus EMSR517 coverage ✅ CLOSED 2026-07-27

Verified by exact point-in-polygon against the `areaOfInterestA` footprints, not by bounding box —
`tools/geodata/probe_emsr517.py` → `check_emsr517_footprints.py` → `inspect_emsr517_product.py`.

- [x] All three focus villages are covered by **AOI03 Delineation** (+ `MONIT01`) and **AOI15 Grading**.
- [x] AOI15 Grading carries **3 814 graded building points** (336 *Destroyed*) and AOI03 carries **77 flood polygons** — both usable for §6.5.
- [x] The feared partial-coverage limitation **does not apply**; no UI caveat needed for coverage.
- ⚠️ **Lesson worth keeping:** AOI05 passes a bbox test and fails the polygon test. Bounding-box coverage is not coverage.
- ⚠️ **Guardrail:** the grading layer labels real buildings *Destroyed*. Per §2.2 rule 3 it is validation-only, aggregated — never shown per building. Recorded in PLAN §4.3.

---

## T3 — HWRM-RL hazard maps → own "Gefährdungsklasse"
- [ ] Locate downloadable HQ10 / HQ100 / HQextrem extents for the Ahr (WFS or file download)
- [ ] Confirm the licence (expected dl-de/by-2-0) and record it
- [ ] Define and document the GK1–GK4 derivation rule (`docs/hazard-class-method.md`) — must state plainly that it is **not ZÜRS**

---

## T4 — LVermGeo bulk download mechanics

- [ ] Confirm how to pull DGM1 / LoD2 / DOP20 tiles for the AOI (6.96–7.14 E, 50.50–50.58 N) — geoshop order vs. direct tile URLs
- [ ] Identify the **historische Orthophotos / Sonderbefliegung Hochwasser** product for the before/after drape and its acquisition date
- [ ] Record exact tile list in `docs/tile-manifest.md` so the download is reproducible

---

## T5 — RADOLAN slice

- [ ] Pick the correct RADOLAN product (RW hourly vs. YW 5-min) and archive path for 12–16 July 2021
- [ ] Confirm the projection/grid definition needed to warp onto the AOI
