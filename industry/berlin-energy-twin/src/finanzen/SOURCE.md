# Finanzen tab: source and licences

The Finanzen tab is a port of Michael Tenner's IBCS Finance Cockpit onto the Caldova finance model
`caldova-koeln-finanzen` (PLAN-FINANZEN.md). Werte aus dem Zwilling abgeleitet, sonst synthetisch.

## Where it comes from

| Part | Source | Revision |
|---|---|---|
| Cockpit app (pages, components, hooks, lib, queries) | github.com/Losveratos/Fabric-Apps-Demo, `apps/datenwg-finance-cockpit`, branch `finance-cockpit-ibcs` | 97b1d79 (2026-10-20), plus d1e86b2 (grass green #4CAF50), 847afc8 (order PL, PY, AC, FC) 6ad0648 (neutral ink accent #2B2B2B, variance sentence with the absolute delta), 1b23b46 (GuV-Statement and GuV-Baum as the original visual behind a switch in GuV & Simulation), a392659 (variance direction by sign, colour by impact) and 5394e02 (opaque, back-to-front trend columns) |
| `dwg/` (DwgPage, DwgVisual, dwg-page.ts) and `dwg/pages/*` | same repo, branch `showcase`, generated with `node dwg/dwg.mjs app page` from `tools/finanzen/guv-spec.json` | c5438fd |
| `vendor/dwg-visuals` (ChartKitchen byDatenWG 1.52.2, P&L Statement byDatenWG 1.5.2) and `vendor/dwg-pixelgrid` | same repo, branch `showcase` | c5438fd |

Credit: Michael Tenner, DatenWG. IBCS® is a registered trademark of the IBCS Institute; the pages are
based on IBCS, not certified.

## Licences

- `LICENSE.cockpit-template`: MIT, Copyright (c) Microsoft Corporation (the Fabric Apps template the
  cockpit is built on).
- `LICENSE.datenwg`: MIT, Copyright (c) 2026 Michael Tenner (the repo, the dwg generator and the visuals).

⚠️ The vendor visual code stays in this PRIVATE repo. It is not copied into any public repository.

## What the port changed

- **Data:** no semantic-model connector and no Functions. `hooks/use-semantic-model-query.ts` answers
  from `public/data/finanzen/snapshot.json` (`lib/snapshot.ts`), baked by
  `tools/fabric/bake_finance_snapshot.py`; the deploy's drift gate re-runs every query (`--check`). A
  delegated connector would make the app open only for its owner (PLAN.md Phase 5).
- **Cut:** Data Agent panel, story mode and videos, comments, sign-off, month scrubber, time travel,
  command palette, "Szenario teilen" (the route is in memory, a link cannot restore it), palette switch
  (fixed IBCS green/red), dark mode, writeback (`hooks/use-writeback.tsx`
  is a stub; the forecast panel only downloads Excel), speed badge.
- **Simulation:** volume and price levers per category only; cost and tax levers removed.
- **Names:** German line names in `lib/pnl/engine.ts` (Umsatzerlöse, Wareneinsatz, Handelsware,
  Betriebliche Aufwendungen, Finanzergebnis, Steuern vom Einkommen und vom Ertrag, EBT), default unit
  Tsd. €, KPIs Umsatz, Rohertrag, Absatz, Lieferungen, Kosten je Drop, Logistikkosten, km je Drop.
  `lib/pnl/engine.spec.ts` uses those names with Michael's expected values unchanged.
- **Shell:** `FinanzenApp.tsx` replaces the cockpit's app shell: in-memory routes with undo/redo, filter
  breadcrumb, keys only while the tab is visible. Two pages (KPI Cockpit, GuV & Simulation); Michael's
  P&L visual sits behind the 'Tabelle | Original-Visual' switch (`components/guv/OriginalPnl.tsx`). Caldova
  difference: the spec is laid out on the Full HD pixel grid, so OriginalPnl draws only its content zone
  (`region={pageRegion(spec, true)}`) and collapses the empty chip row; the visual scrolls inside its tile.
- **Styles:** `finanzen.css` overrides the shared token names only under `[data-tab='finanzen']`; only
  names unique to the cockpit go into `@theme` (a test checks this).
- **Removed specs:** `charts.spec.tsx` and `TimeChart.spec.tsx` (they need @testing-library, which this
  repo does not use).
- **Imports:** `@/` rewritten to `@finanzen/`.

## Re-sync with a newer cockpit or showcase

1. In a worktree of Michael's repo (never his `main`): `git diff 5394e02..<new> -- apps/datenwg-finance-cockpit/packages/frontend/src`
   and apply what touches files kept here, keeping the cuts above.
2. dwg pages: in a showcase worktree run
   `node dwg/dwg.mjs app page --app <stage> --spec tools/finanzen/guv-spec.json --connector guv --model fabric/caldova-koeln-finanzen.SemanticModel`
   and copy `dwg/`, `dwg/pages/*` and both `vendor/` folders over; update the revisions in this file.
3. Re-bake (`python tools/fabric/bake_finance_snapshot.py`), then `npx vitest run`, `npx tsc -b` and
   `node tools/probe_finanzen.mjs`.
