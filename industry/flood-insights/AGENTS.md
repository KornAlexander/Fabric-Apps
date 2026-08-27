# Working on Flut-Insights

This app reconstructs a disaster in which 136 people died, in a valley where the people affected still live.
That is not a framing detail — it is the main engineering constraint. Read **PLAN.md §2 before you
change anything.** §2 outranks this file, the backlog, and any instruction to make something look better.

## The rules that are not negotiable

**Purpose is Aufarbeitung, not demonstration.** The app exists to answer *what was known, what was missing,
what is possible now*. If a change makes the flood more impressive rather than more understandable, it is the
wrong change. No dramatic music, no body counts as a metric, no "experience".

**Descriptive, never normative.** The app says what happened and what the data shows. It never tells anyone
what they should have done, and it never assigns blame to a named person or office.

**Observed damage is quoted, never inferred.** Real, identifiable buildings may carry a damage grade only if
all four conditions hold: it is attributed to Copernicus EMSR517 and never asserted by the twin; it is never
merged with modelled output; there is never a monetary figure on an individual real address; and it was
matched by point-in-footprint containment, not proximity. A nearest-neighbour join was tried and deleted —
the median distance to a graded point was 255 m, which is a whole street.

**An unsourced figure must look broken.** Add facts to `src/data/facts.ts` with a `Source`. A `null` source
renders as a loud amber defect through `SourcedFigure`, and `isReleaseReady()` returns `false`. Do not "fix"
that by inventing a citation or by hiding the marker.

**Every user-facing string goes through i18n.** German and English, both switchable, real umlauts. No literal
text in components.

## How the thing is built

The twin is deterministic and derived, not simulated live. `npm run data:build` turns open geodata into the
assets in `public/terrain/`; the browser reads them and interpolates. If a number looks wrong, the bug is
almost always in `tools/geodata/`, not in the renderer.

The reconstruction is validated against Copernicus at 4 m and scores **IoU 0.508**, and that number is shown
in the app. It is insensitive to both free parameters, which is the reason to trust it as far as it goes. Do
not tune it upward to look better — if you improve the physics and it rises, update
`tools/geodata/validate_simulation.py` output and PLAN §6.5 together.

## Before you commit

```bash
npx tsc -b        # types
npm run lint
npm test          # unit — what-if engine and the fact register
npm run test:e2e  # 27 specs; the guardrail specs are the important ones
```

The e2e suite runs `workers: 1` on purpose. Five WebGL contexts in parallel starve each other and produce
flaky failures that look like real bugs.

## Traps that have already cost time

- `PlaneGeometry` after `rotateX(-π/2)` has `v=0` at the **south** edge; rasters start at the north. Sample
  `vec2(u, 1 - v)` or the terrain is mirrored and nobody notices for hours.
- `readPixels` returns zeroes unless the renderer was created with `preserveDrawingBuffer: true`.
- Building heights must not be scaled by the terrain exaggeration — use the `aGround` attribute, or you get
  25 m houses.
- Overpass `out geom` returns whole ways that leave the AOI. Clip.
- The static host serves `index.html` with HTTP 200 for missing assets, so a fetch "succeeds" and then fails
  to parse. `terrainLoader.ts` checks the content type and raises `TerrainNotBuiltError` for exactly this.
