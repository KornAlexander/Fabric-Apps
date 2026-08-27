# PBI Fixer — Performance Analysis

Why the app feels slow on **loading** and **editing**, what causes it, and what
can be done about it — backed by empirical before/after Playwright measurements
against the live deployed app.

> Test rig: `<your-app-host>.webapp.fabricapps.net`
> Model: Demo › *Personalplanung Model (Import)*, 8 tables.
> Method: Playwright lane A, `PerformanceResourceTiming` filtered on
> `fabric_proxy/invoke` calls (the only network egress that matters).

---

## TL;DR

| Operation | Before | After (this change) | Δ |
|---|---|---|---|
| **Load model (warm)** | ~27–32 s, 5 proxy calls | **30.5 s, 5 proxy calls** | unchanged (by design) |
| **Load model (cold)** | ~33–55 s, 5 proxy calls | unchanged | — |
| **Edit one property** | **78.9 s, 2 proxy calls** | **27.5 s, 1 proxy call** | **−65 %** |

- **Is the double hop the fault?** **Yes.** Every Fabric/PBI REST call is a
  browser → Python Fabric UDF (`fabric_proxy`) → PBI/Fabric REST **double hop**,
  and each hop has a **~25 s floor** (long-running-operation poll + UDF
  per-invocation cost + no real concurrency). The per-call latency dominates
  everything; the single biggest lever is **reducing the number of calls**.
- **Can the UDF be avoided?** **Not fully** — CORS blocks the browser from
  calling PBI/Fabric REST directly, so *some* server-side relay is mandatory.
  But it can be made **dramatically cheaper** (fewer invocations, warmer host).
- **Can the Rayfin team unblock this?** They **cannot** change PBI/Fabric REST
  CORS (that is the Power BI / Fabric product team's surface, not Rayfin's).
  They **could** replace the cold, low-concurrency Fabric Python UDF with a
  **warm, co-located CORS relay** (Azure Function / container / APIM) — that is
  the highest-impact backend change available.

---

## The architecture that creates the cost

The PBI Fixer is a **static SPA**. It holds a Power BI `.default` access token,
but the browser **cannot** call `api.powerbi.com` / `api.fabric.microsoft.com`
directly because those endpoints **do not send CORS headers** for browser
origins. So every read and write is relayed:

```
Browser (SPA)
   │  POST .../fabric_proxy/invoke   (one HTTP round trip)
   ▼
Fabric User Data Function  (Python, fabric_proxy)
   │  server-side fetch (no CORS)    (one or more REST round trips,
   ▼                                  incl. long-running-operation polling)
Power BI / Fabric REST
```

Two consequences:

1. **The token is *not* the blocker.** The SPA already has a valid PBI token.
   The blocker is purely **CORS** — a browser-origin restriction.
2. **Every logical operation pays the full double hop**, plus whatever
   long-running-operation (LRO) polling the underlying REST call needs.

---

## Why loading is slow

Loading a model fans out **5 separate `fabric_proxy` invocations**, fired
concurrently (`Promise.allSettled` in `loadModelViaInfoView`, fabricRest.ts):

| # | Call | What it does | Typical warm duration |
|---|---|---|---|
| 1 | `getDefinition` (TMDL) | Full-model TMDL export — a **202 LRO** | ~27 s (long pole) |
| 2 | INFO.VIEW `executeQueries` | TABLES | ~25–27 s |
| 3 | INFO.VIEW `executeQueries` | COLUMNS | ~25–27 s |
| 4 | INFO.VIEW `executeQueries` | MEASURES | ~4–9 s (lightest) |
| 5 | INFO.VIEW `executeQueries` | RELATIONSHIPS | ~24–25 s |

Measured durations:

- **Cold** (first load after sign-in): `33.4 / 9.8 / 33.4 / 33.4 / 31.0 s` —
  wall ≈ **33–55 s** (cold start adds ~6 s).
- **Warm**: `26.7 / 27.1 / 3.8 / 26.7 / 24.1 s` — wall ≈ **27–32 s**.

**Why isn't 5 concurrent ≈ the slowest single call (~27 s)?** Because the
Fabric Python UDF does **not** give us real parallelism — concurrent
invocations queue/serialize on the function host, so the wall time sits at the
**tail** of the batch (~30 s) rather than its max. Even warm, **4 of 5 calls
take ~25–33 s each**; only the lightest DAX query (`MEASURES`) returns in ~4 s.
A single warm proxy call floor is ~3.8 s; the `getDefinition` LRO is the long
pole at ~31 s.

**Root causes of slow load**

1. **5 invocations** where the host won't parallelize them → ~30 s tail.
2. **Double hop + UDF per-invocation cost**, plus ~6 s cold start.
3. **`_resolve_lro` sleeps `Retry-After` (default 2 s) *before* the first
   poll** (function_app.py) → a ≥2 s floor on every LRO, on top of the work.

---

## Why editing is slow (the worst offender)

Before this change, **one property toggle** (e.g. Hidden on `cost_center[name]`)
took **78.9 s**, because each property setter in `modelPropertyEditor.ts` ran:

```
loadDefinitionParts('model', …)   →  getDefinition  202 LRO   (~31 s)
                                      ↓
saveDefinitionParts('model', …)   →  updateDefinition 202 LRO (~24 s)
```

That is **two sequential ~25–31 s double-hop LROs for a single checkbox**.
The toolbar sat on *"Updating isHidden…"* for ~79 s. Every edit re-fetched the
entire model TMDL it had **just** downloaded at load time, then wrote it back.

---

## The fix in this change — session-scoped definition cache

The full-model TMDL fetched at **load** time is exactly what each **edit** was
re-fetching. So we cache it.

`fabricRest.ts`:

```ts
const DEFINITION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — effectively session-scoped
const definitionCache = new Map<string, { parts: DefinitionPart[]; ts: number }>();
```

- On **load**, `loadModelViaInfoView` already fetches the definition parts; they
  are written through into `definitionCache`.
- On **edit**, `loadDefinitionParts('model', …)` now hits the cache instead of
  firing a fresh `getDefinition` LRO. Only the **unavoidable**
  `updateDefinition` write goes out.
- Cache is **invalidated** on explicit (re)load (`invalidateDefinitionCache`)
  and **write-through updated** after each save, so subsequent edits stay
  consistent without re-reading.
- `saveDefinitionParts` only calls `updateDefinition` when something actually
  changed (`changed > 0`), so no-op saves cost nothing.

**Measured result (deployed, same model):**

- **Edit**: **1 `fabric_proxy` call, 25.1 s** (was 2 calls / **78.9 s**) —
  **−65 %**. The `getDefinition` LRO is eliminated; only the ~25 s
  `updateDefinition` remains. The edit applied correctly (column un-hidden).
- **Load**: unchanged at 30.5 s / 5 calls — **expected**, the cache only
  removes the *redundant re-read* during edits, not the initial fan-out.

This is a **safe, frontend-only** win: no UDF redeploy, build stays green.

---

## What's left — and the bigger backend changes

The session cache fixes **editing**. **Loading** (~30 s) and the **~25 s
per-call floor** require server-side changes. In ROI order:

### A. Server-side batch loader (biggest load win) — *requires UDF redeploy*

Add a UDF entry point, e.g. `load_model_batch(fabricToken, workspaceId,
datasetId)`, that runs the 4 INFO.VIEW DAX queries **+** `getDefinition`
**server-side with threads** and returns one combined payload.

- **5 browser→UDF invocations → 1.** Removes 4 double-hop round trips and the
  host's invocation-queuing tail.
- Expected load **~30 s → ~6–10 s** (bounded by the slowest single REST call,
  now actually parallelized inside one warm Python process).

### B. Faster LRO polling in the UDF — *requires UDF redeploy*

`_resolve_lro` currently sleeps the server's `Retry-After` (default **2 s**)
**before** the first poll. Change to a **short first poll (~0.4 s) + exponential
backoff**. Shaves a fixed floor off **every** `getDefinition` and
`updateDefinition`.

### C. Debounce / batch multiple edits — *frontend*

When a user flips several properties quickly, coalesce them into **one**
`updateDefinition` instead of one-per-property. Turns N edits' N writes into 1.

### D. Replace the Fabric Python UDF with a warm, co-located CORS relay — *Rayfin/platform*

The Fabric Python UDF is **cold-starting** and **concurrency-limited** — that is
the structural reason a single relay call floors at ~25 s. A purpose-built relay
(Azure Function on a warm plan, a small container, or APIM) **co-located** with
the PBI/Fabric region would:

- keep the process warm (no ~6 s cold start),
- handle real concurrency (the 5 load calls truly parallel),
- still satisfy CORS (it adds the headers the browser needs).

This does **not** require any change from the Power BI / Fabric REST team — it's
a relay Rayfin/the app owner controls.

---

## Answers to the specific questions

- **Is the double hop the fault?** **Yes.** The per-invocation double-hop
  latency (~25 s floor, ~31 s for the `getDefinition` LRO) dominates. Measured:
  cold load ~33–55 s, warm load ~27–32 s, edit ~79 s (before), single-call floor
  ~3.8 s. Reducing **call count** is the dominant lever — which is exactly what
  the cache (edits) and the batch loader (load) do.
- **Can the UDF be avoided?** **Not entirely** — CORS forces a server-side
  relay; the SPA's token is fine, the browser just can't call PBI/Fabric
  cross-origin. It can be made far cheaper (batch, warm host, fast LRO poll).
- **Can I push the Rayfin team to allow this?** Rayfin **cannot** enable direct
  browser→PBI/Fabric calls (CORS is owned by the PBI/Fabric product team). What
  Rayfin **can** do is provide a **warm, co-located CORS relay** to replace the
  cold Fabric Python UDF (option D) — the single highest-impact platform change.

---

## Status

- ✅ **Implemented & deployed:** session-scoped definition cache → **editing
  78.9 s → 27.5 s**.
- 🔜 **Recommended (needs UDF redeploy):** batch loader (A), fast LRO poll (B).
- 🔜 **Recommended (frontend):** edit debounce/batch (C).
- 🔜 **Platform:** warm co-located CORS relay (D).
