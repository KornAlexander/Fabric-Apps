# Navigation Experience Plan — PBI Fixer App

Status: **implemented**
Scope: left-nav information architecture in [`src/pages/HomePage.tsx`](src/pages/HomePage.tsx) (`NAV_GROUPS`), plus relabel/move of Model Documentation.

## Goal

Introduce a **second tier — subtopics grouped by intent (verb)** — inside the existing
Model / Report / Workspace groups, without breaking the existing design rule:

> Left nav = distinct tools/destinations. Top tabs = lenses on the one already-loaded object.

## Decisions taken

1. **Memory Analyzer & Model BPA are promoted to left-nav subtopic items** (option b). They
   become first-class nav entries under a **Model › Analyze** subtopic that deep-link into the
   existing Model Explorer lens (same pattern the Report sub-tabs already use via `sub`). The
   underlying top-tab lenses stay; the nav items just select them. This leaves room for a future
   **Model Performance** tool in the same cluster.
2. **Model Documentation → Report › Add Page**, relabeled **"Add Documentation Page"**, sitting
   beside Landing Page. Both inject a ready-made page into the report
   (`addDocumentationPage` mirrors `landingPage` injection). The `addDocumentationTables` step
   stays a model write; the surfaced action is the page-add.

3. **Subtopic rendering: third collapsible tier.** Each subtopic (Explore, Analyze, Build/Add,
   Maintain, Source/Advanced, etc.) is its own collapsible section nested inside the
   Model / Report / Workspace group. Tier hierarchy: **Group (tier 1) › Subtopic (tier 2,
   collapsible) › Tool item (tier 3)**. Expanded/collapsed state per subtopic persists in
   `localStorage` like the existing group state. A group may **mix** direct tool items (no
   subtopic expander) with collapsible subtopics — e.g. Workspace keeps Sempy Runner and
   Workspace Editor as direct items and only clusters Deploy.

---

## Current inventory

**MODEL group** (left nav) + Model Explorer top-tab lenses:
- Left nav: Model Explorer · Unused Cleanup · Descriptions · Field Parameters · Add to Model ·
  Perspectives · Model Diagram · Metric View Migration · TMDL Runner · Model Documentation ·
  History & Undo
- Lenses (top tabs on the loaded model): Explorer · TMDL · Translations · Memory Analyzer · Model BPA

**REPORT group** + Report Explorer sub-tabs:
- Left nav: Report Explorer · IBCS · Fixers · Report BPA · Reverse Prototype · Landing Page ·
  PBIR Source · Forward Prototype
- Sub-tabs (lenses on the loaded report): Explorer · IBCS · Fixers · BPA · Reverse Prototype ·
  Landing Page · PBIR Source

**WORKSPACE group:** Sempy Runner · Workspace Editor · Jumpstart · Rayfin Apps · Monitoring
**Footer:** Guidelines · About

---

## Proposed IA — grouped by verb/intent

### MODEL

| Subtopic | Tools | Notes |
|---|---|---|
| **Explore** | Model Explorer (lenses: Explorer · TMDL), Model Diagram | The anchor. Diagram is visual exploration. |
| **Analyze** (health & performance) | Memory Analyzer, Model BPA, *Model Performance (future)* | Promoted to left-nav items deep-linking into the Model Explorer lens. |
| **Build / Add** (the "model adder") | Add to Model, Field Parameters, Metric View Migration, Translations, Perspectives | All create new model objects (calendar, measure table, calc groups, field params, metric views, translations, perspectives). Translations promoted from the Model Explorer lens, deep-linking into its `viewTab` `'translations'`. |
| **Maintain** | Unused Cleanup, Descriptions | Cleanup + metadata curation. |
| **Source / Advanced** | TMDL Runner, History & Undo | Raw editing + undo trail. |

Model Documentation leaves this group → see Report › Add Page.

### REPORT

| Subtopic | Tools | Notes |
|---|---|---|
| **Explore** | Report Explorer (lens: Explorer), PBIR View | Anchor + raw JSON lens. |
| **Analyze** | Report BPA | Mirrors Model › Analyze. |
| **Improve** | Fixers, IBCS | Restyle/fix existing visuals. |
| **Add Page** (the "page adder") | Landing Page, **Add Documentation Page** (was Model Documentation) | Both inject a ready-made page into the report. |
| **Prototype** | Reverse Prototype, Forward Prototype | Round-trip in/out of portable format. |

### WORKSPACE

| Subtopic | Tools | Notes |
|---|---|---|
| *(none — direct items)* | Sempy Runner, Workspace Editor | Stay as top-level items directly under the Workspace group — no subtopic expander. |
| **Deploy** | Jumpstart, Rayfin Apps, Monitoring | Scaffold, ship & observe. |

---

## Key moves (the diff)

1. **Model Documentation → Report › Add Page**, relabeled "Add Documentation Page", beside Landing Page.
2. **Memory Analyzer + Model BPA** promoted to left-nav items under **Model › Analyze** (deep-link
   into the lens). Reserve a slot for future **Model Performance**.
3. **Field Parameters + Add to Model + Metric View Migration + Translations + Perspectives → Build / Add** subtopic
   (Translations promoted from the Model Explorer lens, deep-linking into its `viewTab` `'translations'`).
4. **Forward + Reverse Prototype → Prototype** subtopic (Forward moves beside Reverse).
5. **PBIR Source → renamed "PBIR View"** (label only; same raw-JSON lens).

---

## Implementation notes (for when approved)

- Edit `NAV_GROUPS` in [`src/pages/HomePage.tsx`](src/pages/HomePage.tsx) to add a `subtopics`
  layer: each group holds an ordered list of subtopics, each with an id, label, and its tool
  items. Render the subtopic as a third collapsible tier (Group › Subtopic › Tool), persisting
  per-subtopic open/closed state in `localStorage` alongside the existing `pbiFixer.navGroups.v2`
  key (e.g. `pbiFixer.navSubtopics.v1`).
- Memory Analyzer / Model BPA / Translations nav items need a deep-link mechanism into the Model
  Explorer `viewTab` (`'memory'` / `'bpa'` / `'translations'`) analogous to the Report `sub`
  deep-link (see `ModelExplorer.tsx` `viewTab` state).
- Relabel + relocate Model Documentation: nav item `value: 'documentation'` moves into the
  Report group's Add Page subtopic with label "Add Documentation Page".
- No service/logic changes required — this is IA/labels only.
