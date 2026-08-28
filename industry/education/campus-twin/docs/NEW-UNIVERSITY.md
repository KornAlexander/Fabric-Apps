# Adding a university — the runbook

Written after TU Berlin (site #9) and the generic `campus-demo` (#10) were built on 2026-08-26.
Everything below was actually run, and every trap marked ⚠️ actually happened.

---

## 0. Ask first. Every time.

Do not start building. The set of deliverables is a per-case decision and the answers change the
work by hours.

**Default proposal — all seven, still confirmed each time:**

| # | Item | Rough effort | Notes |
|---|---|---|---|
| 1 | 3D twin | ~30 min, mostly download | geodata pipeline |
| 2 | Planner | ~20 min | academic profile, timetable, solver, lenses |
| 3 | Proof screenshot + hero | ~15 min | ⚠️ needs a **deployed** backend, see §7 |
| 4 | Exec deck (PPTX) | ~10 min | 5 slides, never 6 |
| 5 | PDF export | ~5 min | PowerPoint COM |
| 6 | Short demo film | ~15 min | needs ffmpeg |
| 7 | Teaser film | ~45 min | needs ffmpeg **and** Azure Sora generations |

**MSX / Seismic customer share — default NO.**
Ask explicitly. The standing default is that a new university's files go only into the shared
`_Sales Assets\Campus Twin Executive Pitch` folder. A per-customer share (`alsoCopyTo` in
`tools/deck/sites.json`, or a Seismic WorkSpace) is created **only when asked for**, because a
reusable link loses per-customer read tracking and a per-customer copy multiplies the admin.

Also settle before starting:

- **Which campuses.** Not "the university" — measure first (§2). TU Berlin was planned as
  Charlottenburg + Seestraße; the probe found Seestraße holds exactly **one** building, and the
  real second site was the TIB 1.5 km further east. A single building is not a campus.
- **Which lenses.** `occupancy, staffing, quality` is the OTH/LMU set and the normal answer.
  `flow` is impossible without real consecutive bookings (only Garching has them). `condition`
  exists at Tübingen only and its grades and renovation costs are entirely invented — do not put a
  fabricated maintenance backlog on a named university's real buildings.
- **Box size versus drape sharpness.** These are one decision seen from two sides. `drape.maxPx`
  is capped at 4096 (8192 blows the mipmap chain and renders the campus **black**), so a box wide
  enough for two distant campuses is a softer orthophoto. TU Berlin's 5.1 km box gives 1.25 m/px
  against Garching's 0.61. Put the numbers in front of the user before choosing.

---

## 1. Is a new geobasis authority needed?

Terrain, orthophoto and buildings come from the **federal state**, and each state publishes
differently. Five adapters exist:

| State | Gate in `pipeline.py` | Fetchers |
|---|---|---|
| Bayern (LDBV) | `in_bavaria` | `fetch_bvv.py`, `fetch_dop20.py`, `fetch_trees.py` |
| Baden-Württemberg (LGL) | `in_baden_wuerttemberg` | `fetch_lgl_bw.py`, `fetch_dop20_bw.py` |
| Nordrhein-Westfalen | `in_nordrhein_westfalen` | `fetch_nrw.py`, `fetch_dop20_nrw.py` |
| Hamburg (LGV) | `in_hamburg` | `fetch_hamburg.py`, `fetch_dop20_hamburg.py` |
| Berlin | `in_berlin` | `fetch_berlin.py`, `fetch_dop20_berlin.py`, `fetch_trees_berlin.py` |

A sixth state means a sixth adapter. The shape is always: find the open-data catalogue, find the
download service for DGM1 / DOP20 / LoD2, and learn the tile naming. Berlin's catalogue is at
`datenregister.berlin.de/api/3/action/package_search` — note **not** `daten.berlin.de/api/...`,
which 404s and reads as "this state has no API".

⚠️ **Check the UTM zone.** Everything west of roughly 12°E is EPSG:25832; the eastern states
(Berlin, Brandenburg, Sachsen, Mecklenburg-Vorpommern) are **25833**. This is not a precision
question — the download services index tiles by **zone kilometres**, so TU Berlin is
`DGM1_386_5818` in zone 33 and `DGM1_793_5827`, a file that does not exist, in zone 32.
`utm.py` is zone-parameterised and `load_aoi()` binds the zone from `workingCrs`, so this works —
but the AOI must declare the right CRS.

⚠️ **A zone is not decided by longitude.** Bavaria publishes the whole state in zone 32 although
it reaches 13.8°E, so OTH Regensburg at 12.10°E is correctly EPSG:25832 even though the textbook
zone there is 33. Read the authority, never compute it.

⚠️ **Never download an orthophoto by ATOM if a WMS exists.** Berlin's imagery download is
partitioned by district and `Mitte.zip` alone is **3.2 GB**, for an AOI that needs about 1.5 km².
The WMS answers the same box in ~200 kB.

---

## 2. Measure the site. No coordinate is typed.

The repo's rule, inherited from two earlier projects: **no coordinate enters an AOI config
without being looked up.** An earlier project shipped an AOI built around a place node 4.6 km from
the town it named.

```powershell
# 1. register the university's OSM name patterns
#    -> PROBE_SITES in tools/geodata/probe_site.py
python tools/geodata/probe_site.py --site <id> --stage sites
python tools/geodata/probe_site.py --site <id> --stage ele --west .. --east .. --south .. --north ..
python tools/geodata/probe_site.py --site <id> --stage indoor --west .. --east .. --south .. --north .. --label <campus>
```

⚠️ **The match pattern is where sites go wrong.** Berlin holds FU, HU, TU, UdK, HTW, HWR, BHT and
the Charité; `Universität Berlin` as a substring matches the Freie *and* the Humboldt. Only
`Technische Universität Berlin` identifies this one — exactly as Köln needs its full form to
exclude TH Köln. Acronyms over a German street index need a word-boundary guard, which Overpass's
RE2 cannot express, so the loose pattern goes to Overpass and `strict` (Python `re`) narrows the
printed result.

Then cluster the strictly-matched features by single-link distance to find the real campuses, and
size the candidate boxes **against the existing sites** before choosing.

⚠️ **Triage the elevation control points, do not collect them.** Of 35 `ele` nodes in the TU
Berlin core, most were unusable: six `man_made=surveillance` cameras all read `ele=39.0` (one
nearby says 2.5 m, which gives it away — those are mounting heights), and the bare `ele` nodes
along a railway are embankment and bridge heights. Prefer `natural=peak` with a real source.

Two control points were rejected **by the gate, correctly**:

- an `ele=46` mound sourced only to `wikipedia=de:Berliner Flaktürme`, a city-wide article about
  demolished structures — a round number from a general article is a quotation, not a measurement;
- **Arkenberge**, Berlin's highest point at 121.9 m, off by −15.96 m — because it is a **landfill
  still being raised**, and the Copernicus radar caught it at 105.9 m. A control point has to be
  a fixed thing.

---

## 3. Write `config/aoi/<aoi-id>.json`

Copy the closest existing AOI and replace every measured value. Required blocks: `site`,
`campuses`, `ownership`, `bbox`, `shell`, `workingCrs`, `verticalDatum`, `elevationRangeM`,
`verification`, `drape`, `grids`, `shellGrids`, `focusPlaces`, `lenses`, `geobasis`,
`shellGeobasis`. Optional: `campusSeparation`, `schedulerSite`, `rooms`, `planQuality`,
`staffing`, `indoorProbe`, `tour`.

`load_aoi()` refuses a `workingCrs` whose scale error across the AOI's own span exceeds the
verification tolerance, so a Berlin box left on EPSG:25832 fails on the first line of the first
step rather than producing a build that is quietly metres out.

---

## 4. Run the pipeline

```powershell
python tools/geodata/pipeline.py --aoi <aoi-id>
```

Resumable and cached. Steps are gated on the AOI, not on a hard-coded site list. Expect the
registration gate (`verify`) to stop the run — that is its job.

⚠️ **The drape must be fetched before the buildings.** `build_lod2_mesh.py` measures every roof's
colour from the orthophoto pixels inside its own outline; with no drape on disk it does not fail,
it writes `roofColour.state: "no-drape"` and every building wears its wall colour. Two sites
shipped 0 of 9013 and 0 of 5928 roofs measured and looked plausible. The step order already
handles this — do not reorder it.

Verify the result renders. `temp/render-check.mjs` loads the twin headlessly and reports mean
luma and distinct colours, which catches the black-drape failure that no unit test can.

---

## 5. Build the planner data

```powershell
python tools/data/fetch_buildings.py      --site <site-id>
# write config/<site>-building-letters.json   (see below)
# write config/academic/<site>.json
python tools/geodata/fetch_osm_footpaths.py --aoi <aoi-id>
python tools/data/generate_timetable.py   --site <site-id>   # straight-line fallback, once
python tools/data/build_walk_routes.py    --site <site-id> --matrix
python tools/data/generate_timetable.py   --site <site-id>   # now routed
python tools/data/build_room_geometry.py  --site <site-id>
python tools/data/build_plan_quality.py   --site <site-id>
python tools/data/build_staffing.py       --site <site-id>
python tools/data/validate_dataset.py     --site <site-id>
```

⚠️ **The order matters and the tooling enforces it.** `build_walk_routes.py` reads the
*generated* `building.json`, and `generate_timetable.py` refuses to write when the travel matrix
keys do not match the dataset. If building ids change, delete `travel_routed.json` and run the
three-step bootstrap again.

⚠️ **Ownership rules must match real names.** Rules are evaluated in order, first match wins, and
a rule that matches nothing does **not** fail — it silently sends the building to `other`. An
early LMU rule looked for sensible words that appear nowhere in the data and put every session on
one campus while reporting success. Check every `nameIs` / `nameContains` against the real
`config/buildings-*.json`. Use `nameIs` (exact) for letter codes: TU Berlin has buildings called
`E`, `F`, `W` and `A`, and a `nameContains` rule for "e" matches almost the whole estate.

⚠️ **Cohort ids are `{faculty}-{programme[:4]}-{semester}`.** "Informatik" and
"Informationstechnik im Maschinenwesen" both yield `INFO` and the generator refuses.

⚠️ **`validate_dataset.py` will reject a plausible-looking dataset.** TU Berlin's first run gave
9 % teaching-room utilisation — "outside anything a Hochschule would recognise". Nine per cent is
arithmetically correct and is a picture of a university with no room problem, which is not a
university anyone needs a scheduler for. Both levers are honest: the demand was **under**-modelled
(3 433 students for two faculties of a 34 000-student university) and `teachingShare` assumed far
too much of each building is bookable. Final: 0.11 / 0.065 / 0.022 and seven programmes per
faculty → 30 %.

### Building letters

If the university publishes building codes, use them — they are real identifiers. TU Berlin's are
surveyed into OSM on the outlines themselves (`ref`, or the `name` *is* the code), which is
stronger provenance than OTH's PDF because code and polygon are the same object. Where a building
has no published code the generator assigns a **lower-case** placeholder, and lower case means
exactly that: ours, not the university's.

---

## 6. Register the site — nine places

Adding a site is an entry in each of these, never a fork. The tests enumerate most of them for
you; run both suites and fix what they name.

| Where | What |
|---|---|
| `config/aoi/<aoi>.json` | the AOI |
| `config/academic/<site>.json` | faculties, programmes, subjects, ownership, seed |
| `config/<site>-building-letters.json` | published codes, if any |
| `src/config/aoi.ts` | `import` + `ALL_AOIS` entry |
| `src/api/scheduler.ts` | `SITE_BASES` entry (falls back to the shared multi-site container) |
| `src/config/aoi.ts` → `SCHEDULER_SITES` | must mirror `SITE_BASES` |
| `tools/data/sites.py` | `SITES` entry |
| `server/schedule_store.py` | `_SYNTH_DIRS` + `_SITE_LABELS` |
| `server/foundry.py` | `_SITE_FACTS` — the assistant's site briefing |
| `src/i18n/{de,en}.json` | `rooms.provenance`, `occupancy.provenance`, `tour.<site>.*` |
| `NOTICE.md` | the geobasis authority and licence |
| `tools/verify_deploy.mjs` | `SITES` entry with measured floors |
| `tools/deck/sites.json` | deck text and facts |
| `config/universities.json` | the national-map dot |

⚠️ **`config/campus-index.json` is generated** and says so at the top — but it had been hand
edited, so `uni-regensburg`'s AOI link existed only in the generated file and regenerating
silently dropped its dot. Put links in the registry the generator reads.

⚠️ **A jargon guard scans the i18n catalogue.** "constraint" is on the list; OTH's English tour
caption solves the same sentence with "what the plan has to work around".

---

## 7. Deploy, then capture

⚠️ **Proof shots need the deployed backend.** The evidence slide's numbers are read off the
screenshot, and the local rig has no LLM, so `/api/assistant/stream` never settles and the capture
writes `Antwort=false / Vorschlag=false`. Deploy first.

Deploy target is the **MCAPS tenant, Rayfin app workspace** — update the existing Campus Scheduler
item rather than creating a new one.

⚠️ The three ids are deliberately **not written down here**. They are not secrets, but a runbook is
the wrong place for them: it is the file most likely to be shared or published, and
`tools/verify_publishable.py` flags exactly this. Read them where they already live, which is also
the only copy that stays correct when a deployment moves:

```
workspace  rayfin/.deployments.json  ->  deployments.rayfin-apps.fabricWorkspaceId   (gitignored)
tenant     rayfin/.deployments.json  ->  deployments.rayfin-apps.fabricTenantId      (gitignored)
item       rayfin/.deployments.json  ->  deployments.rayfin-apps.fabricItemId        (gitignored)
```

Or read them straight out of the Fabric URL when the item is open.

**Screenshot rules — these are hard requirements:**

1. Capture **with the Fabric UI** around the app, not the bare app.
2. **Only Campus Scheduler open** in the Fabric navigation — close every other item first.
3. **Never disclose the URL.** No address bar, no share links, nothing that exposes the tenant or
   workspace path in any image that leaves the building.

Then:

```powershell
$env:CAMPUS_PROOF_BASE = '<deployed app>'
node tools/deck/capture-proof.mjs <aoi>
python tools/deck/crop_heroes.py
node tools/deck/build-exec.cjs --site <aoi>
python tools/deck/check-duplicates.py <pptx>
```

⚠️ **`proofStats` in `sites.json` are READ OFF the picture**, per site. They are not a product
property — affected sessions and costs differ per site. Re-capture and you must re-read them.
`capture-proof.mjs` scrapes the chat into `proof-status.json` so they can be read as text.

⚠️ **Close the deck in PowerPoint before every rebuild.** The generator writes into a OneDrive
folder; with the file open, AutoSave merges the stale in-memory copy and silently doubles text
frames. `check-duplicates.py` catches it. Export PDFs with a **fresh COM instance per file**.

---

## 8. What was delivered for TU Berlin

**Twin** — 2554 × 2244 heightmap at 2 m, 100 % coverage, seam offset 0.949 m; drape 4096 × 3599 at
1.25 m/px; **10 202 buildings**, roof colour measured on 100.0 %; **31 566 trees**; registration
verified by five independent checks. ~48 MB in `public/terrain/tu-berlin/`.

**Planner** — 1 325 sessions, 1 309 placed, 0 conflicts; 30 % room and 82 % hall utilisation;
**80 cohort-days cross the 5.00 km corridor**. Valid on 10 checks.

**Files:** `config/aoi/tu-berlin.json`, `config/academic/tuberlin.json`,
`config/buildings-tuberlin.json`, `config/tuberlin-building-letters.json`,
`data/synthetic-tuberlin/`, `public/terrain/tu-berlin/`, plus the registry entries in §6.

**New tooling:** `tools/geodata/fetch_berlin.py`, `fetch_dop20_berlin.py`, `fetch_trees_berlin.py`.

**Two pre-existing bugs fixed on the way:**

1. `build_terrain.py` hard-coded Bavarian attribution and `EPSG:25832` into every
   `heightmap.json`. **Five of ten sites were mis-credited** — Aachen, Köln, Münster (Geobasis
   NRW), Tübingen (LGL) and TU Berlin — while `NOTICE.md` promised the app renders the AOI's own
   string. All five rebuilt; the `.u16` binaries produced **no diff**, proving metadata only.
2. `Site.aoi()` in `tools/data/sites.py` was a bare `json.loads`, a second door past the zone
   binding. `fetch_buildings.py` wrote the Hauptgebäude at easting **793 609** — well-formed, and
   400 km west of Berlin.

---

## 9. The generic site (`campus-demo`)

**Beispiel-Universität** in **Beispielstadt**: real ground, invented institution. Shares TU
Berlin's terrain through `assetsFrom`, writes its own week-derived data. Its own academic profile,
own building codes, own seed.

⚠️ **Four separate leaks, and three of them existed while every test was green.**

1. **Focus-place labels drawn on the twin itself** read "TU Berlin", "MAR Marchstraße",
   "Telefunken-Hochhaus", "Sportzentrum Dovestraße". Only the render check caught this.
2. **Campus ids** `charlottenburg` / `wedding-tib` in API responses → `campusIdMap`.
3. **Building codes** MAR, TIB, HFT-FT, EMH, BEL from the borrowed letters file → its own file.
4. **Building names** reaching the room list → `buildingNameMap`.

Both maps are applied at one point, `Site.buildings_payload()`. Every other site has no maps and
is untouched. ⚠️ `buildingNameMap` is **coupled to the academic profile**: ownership rules match on
name, so renaming without moving the rule sends the building to `other` in silence.

⚠️ **Its own seed (`31415926`), in the profile rather than a CLI flag.** On the shared seed the
demo produced *exactly* TU Berlin's row counts — 1325 / 334 / 42 / 88 — despite zero shared ids.
Identical figures in two decks read as a relabelled copy.

**What legitimately still names a real city, and must:** the `Europe/Berlin` timezone, and the
`geobasis` attribution — the demo renders Berlin's dl-de/zero-2-0 geodata and the app prints that
string verbatim. Hiding it would be a licensing problem dressed up as discretion. The agreed
position is that the basemap is visibly a real city and the university on it is fictional.

A leak scanner lives at `temp/leak_check.py`.

---

## 10. Checklist

```
[ ] asked which of the seven items are wanted
[ ] asked about the MSX / Seismic customer share  (default: NO)
[ ] campuses measured, not assumed
[ ] geobasis authority + UTM zone confirmed
[ ] control points triaged
[ ] pipeline run, registration gate passed
[ ] render check: not black, labels correct
[ ] dataset validated
[ ] all registry entries added; both suites green
[ ] deployed to MCAPS / Rayfin workspace, Campus Scheduler alone in the nav
[ ] proof captured with Fabric UI, no URL visible
[ ] proofStats read off the picture
[ ] deck built, duplicate check passed, PDF exported from a closed file
```
