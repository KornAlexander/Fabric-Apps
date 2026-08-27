# Open decisions

Three items were carried as "awaiting sign-off". One is now closed, one has a design
direction and one remains open. This file is the record; `PLAN.md` stays the specification.

| # | Item | Status |
|---|---|---|
| 1 | Steinbachtalsperre as a second 3D scenario | **Decided in principle** — design below; one publication question still open |
| 2 | Sinzig on the map | **Closed** — signed off 2026-07-29 |
| 3 | 150 east-bank buildings in the portfolio | **Open** — quantified, not fixed |

---

## 1. Steinbachtalsperre as a second full scenario

### The decision

Not an extension of the Ahr map. Two scenarios of equal depth, with a **deliberately
low-detail overview map between them**: zoom out of the Ahr valley, travel across the
region, drop into the Steinbach valley. A **dropdown switches scenarios**, the way Airport
IQ switches airports.

This supersedes the earlier "panel only" implementation, which stays as the module's
content layer — the timeline, the study figures and the warning-time lever are all still
correct and all still needed. What changes is that the dam gets a map of its own.

### Why the overview map is the right answer, not just a nice one

The original objection to putting the dam on the Ahr map was that it would assert a
hydraulic connection that does not exist: the dam is 8.7 km outside the area of interest
and drains the other way, into the Swist and the Erft. An overview map does not merely
avoid that problem — it **states the fact**. The viewer sees two separate valleys, sees the
distance between them, and sees that the water leaves in opposite directions. The geography
stops being a caveat in a notice and becomes something you look at.

There is a second, harder reason. The Ahr scenario already ships about 124 MB. A second
scenario of comparable detail roughly doubles that, which is not something to hand a browser
on load. The overview is where the application can stand while exactly one scenario is
fetched. **Lazy loading per scenario is a requirement, not an optimisation**, and the
overview is what makes it feel intentional rather than like a wait.

### Measured geography

Everything below is measured, not estimated.

| | Ahr valley | Steinbachtalsperre |
|---|---|---|
| Extent | 23.2 × 8.0 km = **186 km²** | 8.3 × 18.5 km = **153 km²** |
| Shape | wide, shallow, east–west | narrow, deep, south–north |
| State | Rheinland-Pfalz (LVermGeo) | Nordrhein-Westfalen (opengeodata.NRW) |

The dam AOI is **18 % smaller than the Ahr AOI**, so "the same level of detail" is not a
stretch target — it is slightly less work than what already exists.

Distances downstream of the dam, from OpenStreetMap place nodes:

| Place | Distance from the dam | Note |
|---|---|---|
| Kirchheim | 1.6 km | the dam sits directly above it |
| Schweinheim | 3.4 km | 3–5 m in the modelled break, ten minutes after failure |
| Flamersheim | 3.8 km | evacuated |
| Palmersheim | 5.4 km | under 1 m modelled |
| Odendorf | 7.1 km | water one hour after failure |
| Essig | 8.4 km | evacuated |
| Ludendorf | 9.1 km | evacuated |
| Heimerzheim | 15.0 km | model finds **no danger** — the A 61 acts as a dam |

Proposed bbox, covering all of them with a 0.02° margin:
**west 6.817 · east 6.934 · south 50.571 · north 50.737**

### The overview map costs almost nothing

An extent holding **both** scenarios is west 6.817 · east 7.290 · south 50.505 · north
50.737 — **33.5 × 25.8 km, 863 km²**.

| Resolution | Cells | Heightmap as uint16 |
|---|---|---|
| 90 m | 0.11 M | **0.2 MB** |
| 30 m | 0.96 M | 1.9 MB |

At 90 m the whole inter-scenario view is a fifth of a megabyte. Even at 30 m it is smaller
than the land-cover raster the Ahr scenario already loads. This is the cheapest part of the
entire proposal.

Source: Copernicus DEM (GLO-30) covers both states seamlessly under one licence, which
matters because the two scenarios otherwise sit in different state portals with different
terms. A fetcher for it already exists in a sibling repository
(`Gleitschirm-Insights/tools/geodata/fetch_copdem.py`) and is worth lifting rather than
rewriting.

### The pattern to mirror — Airport IQ

Airport IQ's approach view (`airport-iq-rayfin/views/approach/index.html`) does exactly what
is wanted here, and the shape is worth copying rather than reinventing:

- A **manifest** (`data/airports.json`) listing the selectable scenarios plus a `default`.
- A `<select>` populated from that manifest at boot.
- `focusAirport(iata)` — sets the focus, clears the previous scene's entities, loads the new
  data, then flies the camera: `viewer.camera.flyTo({ destination, orientation, duration: 2.2 })`.
- **Deep-linkable and sticky**: `?ap=FRA` in the URL, `localStorage` for the last choice,
  falling back to the manifest default.

Translated to Flut-Insights, that becomes `config/aoi/*.json` as the manifest (the AOI is
already a parameter — PLAN §14 Q2), a scenario dropdown in the header, `?aoi=ahrtal-2021`
for deep links, and a flight that goes **out to the overview and back down** rather than
straight across.

One material difference: Airport IQ renders on **Cesium**, which provides a globe for free.
Flut-Insights renders on **Three.js** with a custom heightmap plane and hand-written GLSL,
and has no globe. Adding Cesium purely for the transition would mean a second renderer,
a second attribution stack and a second set of camera semantics. The cheaper and more
honest route is a **coarse Three.js terrain of the 863 km² extent**, using the shaders that
already exist, with the two areas of interest outlined on it. It is the same scene graph,
the same material, the same camera — just a different heightmap.

### Architecture — what actually has to change

The pipeline is already AOI-parameterised, which is the expensive part and it is done.

1. **`config/aoi/steinbachtalsperre-2021.json`** — new AOI config. The event is not a flood
   wave down a river channel but a dam overtopping, so the `river`/`gauges`/`rating` blocks
   need rethinking rather than copying.
2. **Scenario manifest + dropdown** — list AOIs, switch, deep-link, remember.
3. **Overview scene** — one coarse heightmap, both AOI footprints outlined, used as the
   transition and as the landing state.
4. **Lazy loading per scenario** — the loader already stages and reports progress
   (`StageTracker`), so this is mostly a matter of not fetching until a scenario is chosen,
   and disposing the previous scene's GPU resources on switch.
5. **Geodata for NRW** — `fetch_dgm1.py` / `fetch_lod2.py` are written against the RLP
   Metalink catalogues and will need NRW equivalents. Licence is **dl-de/zero-2-0**, already
   recorded in NOTICE.md and verified live.
6. **The hydraulics are not the Ahr's.** The Ahr scenario solves a water surface along river
   chainage from a rating curve. A dam break is a release from a reservoir into a small
   stream — the existing level-set has no momentum and no duration, which was an acceptable
   simplification for a river peak and is a much weaker one for a wave arriving in ten
   minutes. **This is the real technical risk in the proposal**, and it should be scoped
   before any tile is downloaded.

### Volumes, from the Ahr figures rather than guesses

The Ahr AOI (186 km²) needed 213 DGM1 tiles, 148 DOM1 tiles and 43 LoD2 tiles — roughly
1.9 GB of raw download producing a ~124 MB deployed payload. The dam AOI is 18 % smaller, so
expect the same order: **1.5–2 GB down, ~100 MB deployed**. NRW's tiling scheme and file
sizes differ from RLP's and must be checked before the estimate is trusted.

### What still needs a decision

**The design does not settle the publication question.** Rendering the terrain is
uncontroversial — it is public geodata. What needs an explicit call is how far the *break
scenario* may be drawn on it:

| Option | What is shown | Concern |
|---|---|---|
| **B1** | Terrain, the dam, the documented event of 14–19 July, evacuated places | None. Everything is a reported fact. |
| **B2** | + the modelled break as an **extent and arrival time**, no per-building depth | Publishes a break footprint for a real dam, but at the resolution the study itself published. |
| **B3** | + **per-building depth**, exactly as the Ahr scenario does | Goes materially beyond what Hydrotec published, on identifiable homes. |

**Recommendation: B2.** It matches the granularity of the source — the study gave depths per
place and arrival times per place, not per building — and it keeps the module's central claim
(warning time, not water depth) intact. B3 would be the first thing in this project to assert
more detail than its source, and it concerns a dam whose reconstruction is contested and
delayed to about 2031. If B3 is wanted, it is worth a conversation with e-regio or the
Bezirksregierung Köln first, which PLAN §2.2 rule 7 already anticipates.

---

## 2. Sinzig — closed

**Signed off 2026-07-29**: Sinzig stays on the map and is an important part of the story.

What it earned: with the reach running to the mouth at Kripp, the place list holds both ends
of the journey, and the span between them is now stated —
**Kreuzberg → Kripp, 3 hours 9 minutes** (`twin3d-places-span`, commit `fadbb23`).

What remains forbidden, and is not affected by the sign-off: the twelve care-home deaths at
Sinzig do **not** go on the map. PLAN §2.2 rule 1 permits the death toll exactly once, in the
remembrance screen, as sourced text — no counts on cards, no casualty layer, nothing per
place. Sinzig's story here is that it was three hours downstream, and that the time existed
whether or not it was used.

---

## 3. The 150 east-bank buildings — open

### What it is

When the AOI was extended east to the Rhine, the 2 km river corridor that selects insured
buildings began behaving as a **disc at the ends of the reach** rather than a band along it.
That pulled in buildings on the **east bank of the Rhine** — Linz am Rhein, Leubsdorf — which
the Ahr could not reach under any discharge. All of them were filed under "Kripp".

A half-plane cut at the reach end fixed most of it: **1 531 → 150 buildings**, which is
**0.7 % of 20 346**.

### Why it is still open

150 buildings remain in the synthetic portfolio that should not be. The effect on headline
figures is small and the buildings carry synthetic money, so nothing false is asserted about
anyone. But the portfolio claims to be "the buildings the Ahr could reach", and for 0.7 % of
them that is not true.

### Options

| Option | Effort | Result |
|---|---|---|
| Leave it, documented | none | 0.7 % known error, already recorded |
| **Rhine centreline as an explicit boundary** | moderate — fetch the Rhine from OSM, cut the corridor against it | Correct by construction, not by geometry trick |
| Require hydraulic connectivity to the Ahr chainage | small — the flow field already knows | Removes anything the Ahr cannot reach at any discharge, including these |

The third option is worth measuring first: the connectivity mask already exists, and if it
already excludes these 150 then the fix is a filter rather than new data.

---

## 4. The assistant — infrastructure provisioned, backend still missing

### What now exists

Provisioned in the MCAP subscription `ME-MngEnvMCAP029796-alkorn-1`, following the same shape as
the wind-farm twin and Airport IQ (per-project resource group, one AIServices account):

| | |
|---|---|
| Resource group | `rg-flutinsights-swc` (Sweden Central) |
| Account | `aif-flutinsights-swc`, kind **AIServices** (Azure AI Foundry), S0 |
| Endpoint | `https://aif-flutinsights-swc.cognitiveservices.azure.com/` |
| Chat deployment | `gpt-chat` → gpt-5.2, GlobalStandard, capacity 50 |
| Embeddings | `text-embedding` → text-embedding-3-large, Standard, capacity 50 |
| Vector store | `flut-insights-avb` |
| Identity | system-assigned managed identity on the account |

Authentication is **Entra only** — no API keys are issued, stored or committed. The build script
takes a token from the Azure CLI.

Both model deployments are GlobalStandard, i.e. pay-per-token with **no idle cost**. The account
itself costs nothing when unused; the vector store carries a small storage charge.

### The AVB, and why it exists

`tools/assistant/AVB-Musterschutz-Wohngebaeude-2021.md` is a complete fictional
*Allgemeine Versicherungsbedingungen* for the invented Musterschutz Wohngebäude AG — twenty
paragraphs across seven sections, covering the elementary-cover module, the definitions of
Überschwemmung and Rückstau, the backflow-valve obligation and its 50 % reduction, the waiting
period, deductible tiers, the hazard classes, the flood-adapted-building discount, exclusions and
the claims obligations.

It exists so that `search_policy_wording` (PLAN §11.1 tool 10) can retrieve an actual clause
rather than have the model paraphrase coverage from memory. `tools/assistant/build_vector_store.py`
uploads it and rebuilds the store; re-running replaces rather than appends, so two revisions of
the wording can never answer the same question differently.

**Verified end to end.** Asked the §11.2 showcase question — whether a backflow claim is covered
when the valve has not been serviced for three years — the assistant answered from the document
and cited § 6 Abs. 2, § 4 Abs. 2 lit. b, § 7 Abs. 2, § 7 Abs. 4 and § 6 Abs. 3, distinguished
reduction from forfeiture, and closed by noting the wording is fictional. That is the behaviour
the tool was specified for.

### What is still missing

**A backend.** The browser cannot hold a credential for the Foundry endpoint, so chat and voice
need a server-side hop. The wind-farm twin solved this with an Azure Container App
(`ca-digitaltwin-backend`), and per the Rayfin team that is currently the correct architecture
rather than an interim hack: serving Foundry agents still requires a function or container,
because Rayfin functions are not yet standalone.

So the remaining work is:

1. A thin backend — `/api/assistant/stream` (NDJSON), `/api/realtime/*` for the voice ephemeral
   token, `/api/tools/:name` for the twelve grounded tools — deployed as a Container App with a
   system-assigned identity holding **Cognitive Services OpenAI User** on the account.
2. The **twelve tools** of §11.1. Ten of them are already implemented as pure functions in the
   front end (`whatif.ts`, `hydrograph.ts`, `storyBeats.ts`, `steinbach.ts`, `validation.json`),
   so this is largely exposing what exists rather than writing new logic.
3. The chat and voice UI, carried over from the wind-farm twin.
4. A realtime deployment (`gpt-realtime`) if voice is in scope for the first cut.

Until then the app degrades exactly as the wind-farm twin does without its backend: everything
renders, and the assistant is simply absent.

---

## Sequencing
The dam scenario is a substantial piece of work and the Ahr scenario is complete and
deployed. A sensible order:

1. Settle **B1 / B2 / B3** — it changes what gets built, so it comes first.
2. Scope the **dam-break hydraulics**. If the existing level-set cannot represent a
   ten-minute wave honestly, that constrains everything downstream of it.
3. Build the **overview map and the scenario switch** against the single existing scenario.
   This is cheap, independently useful, and de-risks the architecture before any NRW tile is
   downloaded.
4. Then the NRW geodata pipeline and the second scenario.

Step 3 is the one to do first regardless: it is small, it is reversible, and it proves the
shape of the thing before the expensive part begins.
