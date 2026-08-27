# Navigation Restructure — Proposal

> Status: **proposal only — nothing implemented.** Pick an option (and answer the
> open questions at the end), then I'll build it.
> Scope: `src/pages/HomePage.tsx` navigation only. No tool/feature logic changes.

---

## 1. The problem today

The app has **two independent navigation definitions that have drifted apart**:

| | Side bar (`tabDock === 'left'`) | Top bar (`tabDock === 'top'`) |
|---|---|---|
| Source | `NAV_GROUPS` data array (Model / Report / Workspace) | a **separate hand-written `<TabList>`** with 10 hardcoded `<Tab>`s |
| Coverage | **all ~23 destinations** + Guidelines + About | **only 10** destinations |
| Groups | collapsible Model / Report / Workspace headers | none (flat) |
| Report tools | IBCS · Fixers · BPA · Reverse · Landing · PBIR as deep-links | **missing** — only "Report Explorer" |

**Destinations the top bar silently drops today:** Unused Cleanup, Descriptions,
Field Parameters, Add to Model, Perspectives, Model Diagram, History & Undo, IBCS,
Fixers, Report BPA, Reverse Prototype, Landing Page, PBIR Source, Guidelines, About.

So switching from side to top bar **loses half the app**, and every new feature has
to be wired into two places by hand (and usually only one gets updated).

The one part that already works the way you like is the **Report Explorer**: a single
tab with a horizontal sub-`TabList` (Explorer · IBCS · Fixers · BPA · Reverse · Landing
· PBIR), and those same items are also deep-linked in the side nav. That is the pattern
to generalize.

---

## 2. Goal

**One source of truth → full parity in both docks.** Whatever exists must appear in
*both* the top bar and the side bar, and the dock toggle should only change the
orientation, never the content. Adding a destination = editing one array.

---

## 3. The full destination list (single source of truth)

Already mostly captured by `NAV_GROUPS`; this proposal makes it the *only* definition
and folds in the footer items.

```
Model        Model Explorer · Unused Cleanup · Descriptions · Field Parameters ·
             Add to Model · Perspectives · Model Diagram · Metric View Migration ·
             Model Documentation · History & Undo
Report       Report Explorer · IBCS · Fixers · Report BPA · Reverse Prototype ·
             Landing Page · PBIR Source · Forward Prototype
Workspace    Sempy Runner · Workspace Editor · Jumpstart · Rayfin Apps · Monitoring
Help         Guidelines · About
```

~25 destinations. That count is the crux: a single flat top `TabList` of 25 tabs will
overflow horizontally, so the top bar needs structure. That drives the two options below.

---

## 4. Two options

### ⭐ Option A (recommended) — "every group behaves like the Report area"

Generalize the Report Explorer pattern to **all** groups. The top bar becomes a
**two-level** navigation, and the side bar stays grouped exactly as now. Both read the
same `NAV_GROUPS` array.

- **Top bar, level 1:** one primary tab per group → `Model · Report · Workspace · Help`
  (4–5 tabs, always fits).
- **Top bar, level 2:** a horizontal sub-`TabList` underneath showing the items of the
  active group — *identical mechanism to today's Report sub-tabs*, just applied to every
  group.
- **Side bar:** unchanged — the same groups, expanded as collapsible lists.
- **Dock toggle:** flips orientation only; content is the same set both ways.

```
TOP DOCK
┌───────────────────────────────────────────────────────────┐
│  Model    Report    Workspace    Help                      │  ← level 1 (groups)
├───────────────────────────────────────────────────────────┤
│  Explorer  Cleanup  Descriptions  Field Params  Add… ▸     │  ← level 2 (items of active group)
└───────────────────────────────────────────────────────────┘

SIDE DOCK (unchanged)
  ▾ Model
      Model Explorer · Unused Cleanup · …
  ▸ Report
  ▸ Workspace
  Help: Guidelines · About
```

**Pros:** consistent mental model (exactly the Report-area UX you already like);
no overflow problem; groups stay meaningful; minimal new concepts.
**Cons:** top bar is two rows when docked top; level-2 of the biggest group (Model, 10
items) may still need a small overflow "▸" menu.

### Option B — "one flat list in both docks" (literal reading of your idea)

Put **all ~25 destinations** in a single flat list, rendered once and shown either across
the top or down the side. No groups.

- **Top bar:** one long `TabList`; because it won't fit, use Fluent UI's `TabList`
  **overflow menu** (the items that don't fit collapse into a "More ▾" dropdown).
- **Side bar:** the same flat list, scrollable.

**Pros:** simplest model — literally one list, no groups, no second level.
**Cons:** 25 flat items is a lot to scan with no grouping; the top bar leans heavily on
an overflow "More" menu, which hides things and is less discoverable than Option A's
group tabs.

---

## 5. Recommendation

**Option A.** It is the smallest change that gives true parity, it reuses the
Report-area pattern you already approved, and it keeps grouping (which matters at ~25
destinations). Option B is viable if you specifically want zero grouping, but the top
bar then depends on an overflow menu that buries tools.

---

## 6. Implementation outline (Option A) — no code yet

All in `src/pages/HomePage.tsx`.

1. **Make `NAV_GROUPS` the only definition.**
   - Add a `help` group `{ id: 'help', label: 'Help', items: [Guidelines, About] }` so
     the footer items live in the same array (remove the hardcoded footer buttons).
   - Give each `NavItemDef` everything both docks need (it already has `value`, `label`,
     `icon`, optional `sub`).

2. **Introduce an active-group concept for the top bar.**
   - Derive the active group from the active `tab` (which group contains it), or hold a
     small `topGroup` state that defaults to the group of the current tab.

3. **Replace the hardcoded top `<TabList>`** (the 10 `<Tab>`s) with a data-driven render:
   - Level 1 `TabList` maps `NAV_GROUPS` → one `<Tab>` per group.
   - Level 2 `TabList` maps the active group's `items` → one `<Tab>` each, reusing the
     same `selectTab(it.value)` / `selectReportSub(it.sub)` click logic the side nav
     already uses.

4. **Side nav:** essentially unchanged — it already maps `NAV_GROUPS`. Just include the
   new `help` group (or keep Guidelines/About pinned in the footer — your call, see Q3).

5. **Report sub-tabs (`ReportSub`)** — decide nesting depth (see Q2). Two choices:
   - **Keep nested (recommended):** the Report group's level-2 items deep-link into the
     existing Report sub-`TabList` as they do now (a 3rd level only inside Report).
   - **Flatten:** promote IBCS/Fixers/BPA/etc. to be full level-2 items of the Report
     group and drop the inner `TabList`. More uniform, but Report Explorer loses its
     "anchor view stays loaded" sub-tab behavior — needs care so the loaded report/preview
     state survives.

6. **Persistence:** keep `tabDock` (`pbiFixer.tabDock`); optionally persist `topGroup`.

7. **Cleanup:** remove the now-dead duplicate top `<Tab>` list and the separate footer
   buttons; delete unused styles if any.

**Risk:** low — pure presentation refactor, no change to any tool's load/save logic.
Mount-on-visit and per-tab state preservation must be retained exactly.

---

## 7. Open questions (need your call)

1. **Option A or B?** (Recommend A.)
2. **Report sub-tabs:** keep the Report group nested (3 levels only inside Report), or
   flatten IBCS/Fixers/BPA/Reverse/Landing/PBIR into the Report group's level-2 list?
3. **Guidelines / About:** fold into a top-level **Help** group (appears in both docks
   like everything else), or keep them pinned at the bottom of the side nav as today?
4. **Default dock:** keep current default, or switch the default to top now that the top
   bar is complete?
5. **Group order / labels:** keep `Model · Report · Workspace (· Help)`, or rename/reorder?
