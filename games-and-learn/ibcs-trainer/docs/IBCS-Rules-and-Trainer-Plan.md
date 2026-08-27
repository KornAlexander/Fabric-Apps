# IBCS SUCCESS — Rules Reference & Trainer Game Plan

> Source: IBCS® SUCCESS poster *"Compose Compelling Business Reporting Based on Standard Notation"* (ISO 24896), © IBCS Institute.
> This document (1) catalogues the **complete rule set** as a single master table, and (2) maps **every rule** onto a **7-stage / multi-substage, ~98-level** plan for the **IBCS Trainer** platformer (`ibcs-trainer-rayfin`).

---

## Overview & scale

The SUCCESS framework groups all rules into **7 pillars**, split across two domains (areas):

| Area | Pillars (topics) | Purpose |
|------|------------------|---------|
| **NOTATION** | SIMPLIFY · UNIFY · CHECK | *How* to draw — a standard visual language |
| **COMPOSITION** | CONDENSE · EXPRESS · STRUCTURE · SAY | *What* to draw — a compelling message |

> The acronym **SUCCESS** = **S**ay · **U**nify · **C**ondense · **C**heck · **E**xpress · **S**implify · **S**tructure.

Every **sub-rule becomes its own level**. There are **98 sub-rules** → **98 rule-levels**, organised as:

- **7 Stages** = the 7 pillars (topics).
- **35 Substages** = the rule groups (subtopics), 5 per Stage.
- **98 Levels** = the individual sub-rules (2–5 levels per substage).
- **+1 Final Boss** (the *Board Report* capstone) and **+1 ISO 24896 Memory Room** = **100 rooms** total.

**Checkpoint rule:** when a player **clears a substage**, that substage is **unlocked in the level-select** and can be used as a starting point on later runs. Progress is saved at substage granularity, not just per level.

---

## Part 1 — Master Rule Table

The authoritative catalogue. **ID** doubles as the in-game level number. The universal game convention is: **stomp the "Don't" chart-monster, collect the "Do" chart**.

| ID | Area | Topic | Subtopic | Rule | Do | Don't |
|----|------|-------|----------|------|----|-------|
| 1 | Notation | SIMPLIFY | SI 1 Avoid unnecessary elements | SI 1.1 Avoid cluttered layouts | Remove anything that carries no information | Crowd the page with meaningless elements |
| 2 | Notation | SIMPLIFY | SI 1 Avoid unnecessary elements | SI 1.2 Avoid colored or filled backgrounds | Use a plain white background | Fill backgrounds with color or gradients |
| 3 | Notation | SIMPLIFY | SI 1 Avoid unnecessary elements | SI 1.3 Avoid animation and transition effects | Keep visuals static | Add movement/transitions that distract from data |
| 4 | Notation | SIMPLIFY | SI 2 Avoid decorative styles | SI 2.1 Avoid frames, shades, and 3D without meaning | Use flat 2D shapes | Add drop shadows, 3D, or borders for looks |
| 5 | Notation | SIMPLIFY | SI 2 Avoid decorative styles | SI 2.2 Avoid decorative colors | Use color only to carry meaning | Use color as decoration |
| 6 | Notation | SIMPLIFY | SI 2 Avoid decorative styles | SI 2.3 Avoid decorative fonts | Use one neutral, legible typeface | Use decorative or mixed fonts |
| 7 | Notation | SIMPLIFY | SI 3 Replace with cleaner layout | SI 3.1 Replace grid lines and value axes with data labels | Label data directly | Keep gridlines/value axes when labels suffice |
| 8 | Notation | SIMPLIFY | SI 3 Replace with cleaner layout | SI 3.2 Avoid vertical lines by right-aligning data | Right-align numbers in tables | Add vertical separator lines |
| 9 | Notation | SIMPLIFY | SI 4 Avoid redundancies | SI 4.1 Avoid superfluous words | Cut filler words in titles/labels | Pad text with unnecessary words |
| 10 | Notation | SIMPLIFY | SI 4 Avoid redundancies | SI 4.2 Avoid obvious terms | Drop words the reader already infers | State the obvious |
| 11 | Notation | SIMPLIFY | SI 4 Avoid redundancies | SI 4.3 Avoid repeated terms | Say it once (legend or axis) | Repeat the same term in legend and axis |
| 12 | Notation | SIMPLIFY | SI 5 Avoid distracting details | SI 5.1 Avoid labels for small values | Label only values that matter | Label values too small to matter |
| 13 | Notation | SIMPLIFY | SI 5 Avoid distracting details | SI 5.2 Avoid long numbers | Round/rescale (kEUR, mEUR) | Show overly long numbers |
| 14 | Notation | SIMPLIFY | SI 5 Avoid distracting details | SI 5.3 Avoid unnecessary labels | Label only what supports the message | Label everything |
| 15 | Notation | UNIFY | UN 1 Unify terminology | UN 1.1 Unify terms and abbreviations | Use the same word/abbreviation for a concept everywhere | Mix synonyms or abbreviations |
| 16 | Notation | UNIFY | UN 1 Unify terminology | UN 1.2 Unify numbers, units, and dates | Use one format for numbers, units, dates | Mix number/unit/date formats |
| 17 | Notation | UNIFY | UN 2 Unify text elements | UN 2.1 Unify key messages | Use a consistent style for headline messages | Style key messages differently each time |
| 18 | Notation | UNIFY | UN 2 Unify text elements | UN 2.2 Unify titles and subtitles | Use the same title structure everywhere | Vary title structure |
| 19 | Notation | UNIFY | UN 2 Unify text elements | UN 2.3 Unify the position of legends and labels | Place legends/labels in the same spot every time | Move legends around |
| 20 | Notation | UNIFY | UN 3 Unify dimensions | UN 3.1 Unify measures | Use the same look for the same measure | Render the same measure differently |
| 21 | Notation | UNIFY | UN 3 Unify dimensions | UN 3.2 Unify scenarios | Use standard fills (AC solid, PY light, PL outline, FC hatched) | Invent scenario fills |
| 22 | Notation | UNIFY | UN 3 Unify dimensions | UN 3.3 Unify time periods, use horizontal axes | Run time left→right on the horizontal axis | Put time on the vertical axis |
| 23 | Notation | UNIFY | UN 3 Unify dimensions | UN 3.4 Unify structure dimensions, use vertical axes | Run structures top→down on a vertical axis | Put structures on the horizontal axis |
| 24 | Notation | UNIFY | UN 4 Unify analyses | UN 4.1 Unify scenario analyses | Use standard variance notation (ΔPY, ΔPL, %) | Use ad-hoc variance marks |
| 25 | Notation | UNIFY | UN 4 Unify analyses | UN 4.2 Unify time series analyses | Use standard symbols (difference, span, YTD, rolling, average, first/last) | Invent time-series symbols |
| 26 | Notation | UNIFY | UN 5 Unify markers | UN 5.1 Unify highlighting markers | Use standard marks for highlight/trend/difference/comment/reference | Use random highlight marks |
| 27 | Notation | UNIFY | UN 5 Unify markers | UN 5.2 Unify scaling markers | Use standard marks when scales are compressed/expanded | Hide scale changes |
| 28 | Notation | UNIFY | UN 5 Unify markers | UN 5.3 Unify outlier markers | Use standard triangle marks for clipped outliers | Clip outliers without marking |
| 29 | Notation | CHECK | CH 1 Avoid manipulated axes | CH 1.1 Avoid truncated axes | Start value axes at zero | Truncate the value axis |
| 30 | Notation | CHECK | CH 1 Avoid manipulated axes | CH 1.2 Avoid logarithmic axes | Use linear scales | Use log axes that distort comparisons |
| 31 | Notation | CHECK | CH 1 Avoid manipulated axes | CH 1.3 Avoid different class sizes | Use equal class widths in distributions | Mix class sizes |
| 32 | Notation | CHECK | CH 2 Avoid manipulated visual components | CH 2.1 Avoid clipped visual components | Show full bars/columns | Cut bars to fit |
| 33 | Notation | CHECK | CH 2 Avoid manipulated visual components | CH 2.2 Use creative solutions for challenging scaling issues | Handle extremes honestly with overlap/outlier indicators | Distort visuals to fit extremes |
| 34 | Notation | CHECK | CH 3 Avoid misleading representations | CH 3.1 Use correct area comparisons, prefer linear ones | Scale area honestly; prefer bars | Mis-scale areas |
| 35 | Notation | CHECK | CH 3 Avoid misleading representations | CH 3.2 Use correct volume comparisons, prefer linear ones | Prefer linear (1D) comparisons | Scale 3D volume to a 1D value |
| 36 | Notation | CHECK | CH 3 Avoid misleading representations | CH 3.3 Avoid misleading colored areas in maps | Pair map color with size | Equate map color with magnitude |
| 37 | Notation | CHECK | CH 4 Use the same scales | CH 4.1 Use identical scale for the same unit | Use the same mm-per-unit across charts | Change scale for the same unit |
| 38 | Notation | CHECK | CH 4 Use the same scales | CH 4.2 Size charts to given data | Fit the chart frame to the data range | Pad frames arbitrarily |
| 39 | Notation | CHECK | CH 4 Use the same scales | CH 4.3 Use scaling indicators if necessary | Mark where a shared scale is broken | Break a scale silently |
| 40 | Notation | CHECK | CH 4 Use the same scales | CH 4.4 Use outlier indicators if necessary | Flag values exceeding the frame | Let outliers distort the frame unmarked |
| 41 | Notation | CHECK | CH 5 Show data adjustments | CH 5.1 Show the impact of inflation | Reveal real vs nominal | Show nominal only when inflation matters |
| 42 | Notation | CHECK | CH 5 Show data adjustments | CH 5.2 Show the currency impact | Reveal currency-adjusted figures | Hide currency effects |
| 43 | Composition | CONDENSE | CO 1 Use small elements | CO 1.1 Use small fonts | Use smaller type to fit more content | Oversize fonts |
| 44 | Composition | CONDENSE | CO 1 Use small elements | CO 1.2 Use small components | Use compact chart elements | Bloat components |
| 45 | Composition | CONDENSE | CO 1 Use small elements | CO 1.3 Use small visuals | Prefer many small charts | Use one huge chart |
| 46 | Composition | CONDENSE | CO 2 Maximize use of space | CO 2.1 Use narrow page margins | Reclaim the margins | Waste page edges |
| 47 | Composition | CONDENSE | CO 2 Maximize use of space | CO 2.2 Reduce empty space | Tighten gaps in visuals/tables | Leave large empty gaps |
| 48 | Composition | CONDENSE | CO 3 Add data | CO 3.1 Show data | Add data points that add insight | Omit informative data |
| 49 | Composition | CONDENSE | CO 3 Add data | CO 3.2 Show details | Add the supporting detail level | Hide useful detail |
| 50 | Composition | CONDENSE | CO 4 Add elements | CO 4.1 Show overlay charts | Layer related series (line over column) | Separate naturally-overlaid series |
| 51 | Composition | CONDENSE | CO 4 Add elements | CO 4.2 Show multi-tier charts | Stack tiers of related measures | Split related tiers |
| 52 | Composition | CONDENSE | CO 4 Add elements | CO 4.3 Show extended charts | Add benchmarks/reference rows | Drop useful references |
| 53 | Composition | CONDENSE | CO 4 Add elements | CO 4.4 Embed chart components in tables | Add sparkline-style bars in tables | Keep tables purely numeric when bars help |
| 54 | Composition | CONDENSE | CO 4 Add elements | CO 4.5 Embed explanations | Add inline comments next to data | Separate explanations from data |
| 55 | Composition | CONDENSE | CO 5 Add visuals | CO 5.1 Show small multiples | Use a grid of comparable mini-charts | Merge incomparable series |
| 56 | Composition | CONDENSE | CO 5 Add visuals | CO 5.2 Show related charts on one page | Group linked charts together | Scatter related charts |
| 57 | Composition | EXPRESS | EX 1 Use appropriate visuals | EX 1.1 Use appropriate chart types | Match chart to message (time/structure/specialty) | Pick the wrong chart type |
| 58 | Composition | EXPRESS | EX 1 Use appropriate visuals | EX 1.2 Use appropriate table types | Use time/variance/cross tables as fit | Misuse table types |
| 59 | Composition | EXPRESS | EX 2 Replace inappropriate chart types | EX 2.1 Replace pie and ring charts | Use bars/columns | Use pie/ring charts |
| 60 | Composition | EXPRESS | EX 2 Replace inappropriate chart types | EX 2.2 Replace gauges, speedometers | Use bars with reference lines | Use gauges/speedometers |
| 61 | Composition | EXPRESS | EX 2 Replace inappropriate chart types | EX 2.3 Replace radar and funnel charts | Use bar charts | Use radar/funnel charts |
| 62 | Composition | EXPRESS | EX 2 Replace inappropriate chart types | EX 2.4 Replace spaghetti charts | Use small multiples / highlighted line | Overplot many lines |
| 63 | Composition | EXPRESS | EX 2 Replace inappropriate chart types | EX 2.5 Replace traffic lights | Use signed values + variance bars | Use traffic-light symbols |
| 64 | Composition | EXPRESS | EX 3 Replace inappropriate representations | EX 3.1 Prefer quantitative representations | Use numbers over icons/symbols | Replace numbers with icons |
| 65 | Composition | EXPRESS | EX 3 Replace inappropriate representations | EX 3.2 Avoid text slides in presentations | Show data, not bullet text | Read bullet slides |
| 66 | Composition | EXPRESS | EX 4 Add comparisons | EX 4.1 Add scenarios | Compare AC vs PY vs PL vs FC | Show a single scenario alone |
| 67 | Composition | EXPRESS | EX 4 Add comparisons | EX 4.2 Add variances | Show absolute + relative variance | Omit variances |
| 68 | Composition | EXPRESS | EX 5 Explain causes | EX 5.1 Show tree structures | Decompose totals (profit = sales − costs) | Leave totals unexplained |
| 69 | Composition | EXPRESS | EX 5 Explain causes | EX 5.2 Show clusters | Reveal groupings in scatter data | Ignore clustering |
| 70 | Composition | EXPRESS | EX 5 Explain causes | EX 5.3 Show correlations | Pair sorted bars to expose relationships | Hide correlations |
| 71 | Composition | STRUCTURE | ST 1 Use consistent elements | ST 1.1 Use consistent items | Use the same items in the same order | Reorder/omit items between visuals |
| 72 | Composition | STRUCTURE | ST 1 Use consistent elements | ST 1.2 Use consistent types of statements | Use parallel grammar (all verbs/all nouns) | Mix statement types |
| 73 | Composition | STRUCTURE | ST 1 Use consistent elements | ST 1.3 Use consistent wording | Use the same wording for the same thing | Vary wording |
| 74 | Composition | STRUCTURE | ST 1 Use consistent elements | ST 1.4 Use consistent visualizations | Use the same icon/visual for the same concept | Change visuals for one concept |
| 75 | Composition | STRUCTURE | ST 2 Build non-overlapping elements (Mutually Exclusive) | ST 2.1 Build non-overlapping report structures | Keep each item in one bucket | Let an item appear in two buckets |
| 76 | Composition | STRUCTURE | ST 2 Build non-overlapping elements (Mutually Exclusive) | ST 2.2 Build non-overlapping business measures | Keep calculation steps disjoint | Double-count |
| 77 | Composition | STRUCTURE | ST 2 Build non-overlapping elements (Mutually Exclusive) | ST 2.3 Build non-overlapping structure dimensions | Use clean, disjoint groupings | Overlap dimensions |
| 78 | Composition | STRUCTURE | ST 3 Build collectively exhaustive elements (Exhaustive) | ST 3.1 Build exhaustive arguments | Cover all options | Leave gaps in arguments |
| 79 | Composition | STRUCTURE | ST 3 Build collectively exhaustive elements (Exhaustive) | ST 3.2 Build exhaustive structures | Add "Rest"/"Other" so parts sum to the whole | Omit the remainder |
| 80 | Composition | STRUCTURE | ST 4 Build hierarchical structures | ST 4.1 Use deductive reasoning | Statement → comment → conclusion → message | Bury the deduction |
| 81 | Composition | STRUCTURE | ST 4 Build hierarchical structures | ST 4.2 Use inductive reasoning | Synthesize many statements into one message | Leave statements unsynthesized |
| 82 | Composition | STRUCTURE | ST 5 Visualize structure | ST 5.1 Visualize structure in reports | Use indentation/emphasis to show hierarchy | Flatten the hierarchy |
| 83 | Composition | STRUCTURE | ST 5 Visualize structure | ST 5.2 Visualize structure in tables | Bold sums, indent members | Render tables flat |
| 84 | Composition | STRUCTURE | ST 5 Visualize structure | ST 5.3 Visualize structure in notes | Use numbered, hierarchical note lists | Leave notes unstructured |
| 85 | Composition | SAY | SA 1 Know objectives | SA 1.1 Know own goals | Be clear on what you want to achieve | Start without a goal |
| 86 | Composition | SAY | SA 1 Know objectives | SA 1.2 Know target audience | Tailor to the reader/listener | Ignore the audience |
| 87 | Composition | SAY | SA 2 Introduce message | SA 2.1 Map situation | State the agreed starting situation | Skip the setup |
| 88 | Composition | SAY | SA 2 Introduce message | SA 2.2 Explain problem | Name the complication/gap | Hide the problem |
| 89 | Composition | SAY | SA 2 Introduce message | SA 2.3 Raise question | Pose the question the message answers | Leave the question implicit |
| 90 | Composition | SAY | SA 3 Deliver message | SA 3.1 Detect, explain, or suggest | Observation → cause → recommendation | Stop at observation |
| 91 | Composition | SAY | SA 3 Deliver message | SA 3.2 Say message first | Lead with the conclusion (top-down) | Bury the conclusion |
| 92 | Composition | SAY | SA 4 Support message | SA 4.1 Provide evidence | Back claims with data | Make unsupported claims |
| 93 | Composition | SAY | SA 4 Support message | SA 4.2 Use precise words | Say "Cut of 3.5 mEUR" | Say "significant" vaguely |
| 94 | Composition | SAY | SA 4 Support message | SA 4.3 Highlight message | Visually mark the point in the chart | Leave the message unmarked |
| 95 | Composition | SAY | SA 4 Support message | SA 4.4 Name sources | Cite where the data came from | Omit sources |
| 96 | Composition | SAY | SA 4 Support message | SA 4.5 Link comments | Use numbered annotations tied to data | Float comments unlinked |
| 97 | Composition | SAY | SA 5 Summarize message | SA 5.1 Repeat message | Restate the conclusion at the end | End without a recap |
| 98 | Composition | SAY | SA 5 Summarize message | SA 5.2 Explain consequences | Spell out next steps/decisions | Leave consequences unstated |

> **98 rule-levels.** NOTATION = IDs 1–42 (Stages 1–3); COMPOSITION = IDs 43–98 (Stages 4–7).

---

## Part 2 — IBCS Trainer: Stage / Substage / Level plan

The **IBCS Trainer** is a side-scrolling platformer (`ibcs-trainer-rayfin`, Canvas single-file game). The hero is a **data analyst**; **enemies are "Don't" charts** (stomp to destroy), **collectibles are "Do" charts** (+points). The world is a tree:

```
Area (Notation / Composition)
  └─ Stage  = Topic   (1 of 7 SUCCESS pillars)        → 7 stages
       └─ Substage = Subtopic (rule group)            → 5 per stage = 35
            └─ Level = Rule (sub-rule)                → 2–5 per substage = 98
```

### Stage map (poster reading order)

| Stage | Area | Topic (pillar) | Theme color | World name | Substages | Levels (IDs) |
|-------|------|----------------|-------------|------------|-----------|--------------|
| **1** | Notation | SIMPLIFY | Grey | *The Cluttered Office* | 5 | 14 (1–14) |
| **2** | Notation | UNIFY | Blue | *The Tower of Babel* | 5 | 14 (15–28) |
| **3** | Notation | CHECK | Red | *The Hall of Mirrors* | 5 | 14 (29–42) |
| — | — | *Half-time interlude: "Notation complete — now compose the message."* | — | — | — | — |
| **4** | Composition | CONDENSE | Green | *The Cramped Warehouse* | 5 | 14 (43–56) |
| **5** | Composition | EXPRESS | Orange | *The Chart Zoo* | 5 | 14 (57–70) |
| **6** | Composition | STRUCTURE | Purple | *The Architect's Blueprint* | 5 | 14 (71–84) |
| **7** | Composition | SAY | Gold | *The Boardroom* | 5 | 14 (85–98) |
| **Boss** | All | SUCCESS (all) | Rainbow | *The Board Report* (final boss) | 1 | 1 capstone |
| **Memory** | — | ISO 24896 | White | *The Standards Vault* (memory room) | 1 | 1 puzzle |

> **35 substages + 98 rule-levels + 1 capstone boss + 1 memory room = 100 rooms.**

### Substage checkpoints / level-select

- Each **substage is a checkpoint group**. Clearing the **last level of a substage** unlocks that substage in the **level-select menu** and writes it to the save state.
- A returning player can **start a run from any unlocked substage** (its first level), not only from Stage 1.
- Within a substage, levels are played in order; a level-select dot grid shows cleared (✔), unlocked (▶) and locked (🔒) substages.
- Persisted progress fields (see *Implementation notes*): `unlockedSubstages` (set of subtopic codes, e.g. `SI 1`, `UN 3`), `highestSubstage`, `pillarsCompleted` (0–7), `ibcsCertified`, `isoMemorized`.

### Per-level mechanic convention

For **every** level the rule is the same loop, driven by the master table:

- The **"Don't"** chart-monster walks the level → **stomp / zap** it to clear.
- The **"Do"** chart floats as a **collectible** → **touch** it for bonus points.
- Touching the wrong one (or the animated/3D decoy in SI levels) costs a life.
- The slogan banner reads: `Stage S · <Topic> · <Subtopic> — <Rule code> <Rule title>` and shows the **Do** (green) / **Don't** (red) pair.

The tables below list each substage and its levels. *Enemy* = the "Don't"; *Collectible* = the "Do".

#### Stage 1 — SIMPLIFY · *The Cluttered Office* (Notation)

| Substage | Lvl ID | Rule | Enemy (Don't) | Collectible (Do) |
|----------|--------|------|---------------|------------------|
| SI 1 Avoid unnecessary elements | 1 | SI 1.1 | Cluttered layout monster | Clean chart |
| | 2 | SI 1.2 | Colored-background chart | White-background chart |
| | 3 | SI 1.3 | Flickering/animated chart | Static chart |
| SI 2 Avoid decorative styles | 4 | SI 2.1 | 3D / shadowed / framed chart | Flat 2D chart |
| | 5 | SI 2.2 | Rainbow-decoration chart | Meaning-only-color chart |
| | 6 | SI 2.3 | Decorative-font chart | Neutral-font chart |
| SI 3 Replace with cleaner layout | 7 | SI 3.1 | Gridline + value-axis chart | Data-label chart |
| | 8 | SI 3.2 | Vertical-line table | Right-aligned table |
| SI 4 Avoid redundancies | 9 | SI 4.1 | Superfluous-word title | Trimmed title |
| | 10 | SI 4.2 | Obvious-term label | Inferred-term label |
| | 11 | SI 4.3 | Repeated-term chart | Say-it-once chart |
| SI 5 Avoid distracting details | 12 | SI 5.1 | Small-value label swarm | Major-value-only chart |
| | 13 | SI 5.2 | Long-number chart | Rounded kEUR chart |
| | 14 | SI 5.3 | Over-labeled chart | Message-only-label chart |

#### Stage 2 — UNIFY · *The Tower of Babel* (Notation)

| Substage | Lvl ID | Rule | Enemy (Don't) | Collectible (Do) |
|----------|--------|------|---------------|------------------|
| UN 1 Unify terminology | 15 | UN 1.1 | Mixed-term chart | Standard-term chart |
| | 16 | UN 1.2 | Mixed number/date format | Unified-format chart |
| UN 2 Unify text elements | 17 | UN 2.1 | Inconsistent key message | Unified key message |
| | 18 | UN 2.2 | Varying titles | Unified title block |
| | 19 | UN 2.3 | Wandering legend | Fixed-position legend |
| UN 3 Unify dimensions | 20 | UN 3.1 | Re-styled same measure | Unified measure |
| | 21 | UN 3.2 | Invented scenario fill | Standard AC/PY/PL/FC fills |
| | 22 | UN 3.3 | Time-on-vertical chart | Time→horizontal chart |
| | 23 | UN 3.4 | Structure-on-horizontal chart | Structure→vertical chart |
| UN 4 Unify analyses | 24 | UN 4.1 | Ad-hoc variance marks | Standard ΔPY/ΔPL bars |
| | 25 | UN 4.2 | Invented time-series symbol | Standard time-series symbols |
| UN 5 Unify markers | 26 | UN 5.1 | Random highlight marks | Standard highlight set |
| | 27 | UN 5.2 | Hidden scale change | Standard scaling marker |
| | 28 | UN 5.3 | Unmarked clipped outlier | Standard outlier triangle |

#### Stage 3 — CHECK · *The Hall of Mirrors* (Notation)

| Substage | Lvl ID | Rule | Enemy (Don't) | Collectible (Do) |
|----------|--------|------|---------------|------------------|
| CH 1 Avoid manipulated axes | 29 | CH 1.1 | Truncated-axis chart | Zero-based chart |
| | 30 | CH 1.2 | Log-axis chart | Linear-axis chart |
| | 31 | CH 1.3 | Unequal-class histogram | Equal-class histogram |
| CH 2 Avoid manipulated visual components | 32 | CH 2.1 | Clipped bar | Full bar |
| | 33 | CH 2.2 | Distorted-extreme chart | Honest overlap/outlier chart |
| CH 3 Avoid misleading representations | 34 | CH 3.1 | Mis-scaled area icon | Linear bar |
| | 35 | CH 3.2 | 3D-volume chart | Linear bar |
| | 36 | CH 3.3 | Color-magnitude map | Color+size map |
| CH 4 Use the same scales | 37 | CH 4.1 | Mismatched-scale pair | Same-scale pair |
| | 38 | CH 4.2 | Arbitrary-frame chart | Data-fitted frame |
| | 39 | CH 4.3 | Silently broken scale | Scaling-indicator chart |
| | 40 | CH 4.4 | Unmarked frame outlier | Outlier-indicator chart |
| CH 5 Show data adjustments | 41 | CH 5.1 | Nominal-only chart | Real-vs-nominal chart |
| | 42 | CH 5.2 | Currency-hidden chart | Currency-adjusted chart |

> *Half-time interlude cutscene: "Notation complete — now compose the message."*

#### Stage 4 — CONDENSE · *The Cramped Warehouse* (Composition)

| Substage | Lvl ID | Rule | Enemy (Don't) | Collectible (Do) |
|----------|--------|------|---------------|------------------|
| CO 1 Use small elements | 43 | CO 1.1 | Oversized-font chart | Small-font chart |
| | 44 | CO 1.2 | Bloated component | Compact component |
| | 45 | CO 1.3 | One huge chart | Many small charts |
| CO 2 Maximize use of space | 46 | CO 2.1 | Wide-margin page | Narrow-margin page |
| | 47 | CO 2.2 | Empty-gap layout | Tight layout |
| CO 3 Add data | 48 | CO 3.1 | Sparse chart | Data-rich chart |
| | 49 | CO 3.2 | Detail-hidden chart | Detailed chart |
| CO 4 Add elements | 50 | CO 4.1 | Separated series | Overlay chart |
| | 51 | CO 4.2 | Split tiers | Multi-tier chart |
| | 52 | CO 4.3 | Reference-less chart | Extended/benchmark chart |
| | 53 | CO 4.4 | Numbers-only table | Embedded-bars table |
| | 54 | CO 4.5 | Detached explanation | Inline-comment chart |
| CO 5 Add visuals | 55 | CO 5.1 | Merged incomparable series | Small-multiples grid |
| | 56 | CO 5.2 | Scattered charts | Grouped charts on one page |

#### Stage 5 — EXPRESS · *The Chart Zoo* (Composition)

| Substage | Lvl ID | Rule | Enemy (Don't) | Collectible (Do) |
|----------|--------|------|---------------|------------------|
| EX 1 Use appropriate visuals | 57 | EX 1.1 | Wrong-type chart | Right chart type |
| | 58 | EX 1.2 | Misused table | Right table type |
| EX 2 Replace inappropriate chart types | 59 | EX 2.1 | Pie / ring boss | Bar/column |
| | 60 | EX 2.2 | Gauge / speedometer boss | Bar with reference line |
| | 61 | EX 2.3 | Radar / funnel boss | Bar chart |
| | 62 | EX 2.4 | Spaghetti boss | Small multiples / highlighted line |
| | 63 | EX 2.5 | Traffic-light boss | Signed values + variance bars |
| EX 3 Replace inappropriate representations | 64 | EX 3.1 | Icon/symbol chart | Quantitative chart |
| | 65 | EX 3.2 | Bullet-text slide | Data slide |
| EX 4 Add comparisons | 66 | EX 4.1 | Single-scenario chart | AC vs PY vs PL vs FC |
| | 67 | EX 4.2 | Variance-less chart | Absolute + relative variance |
| EX 5 Explain causes | 68 | EX 5.1 | Unexplained total | Tree decomposition |
| | 69 | EX 5.2 | Cluster-blind scatter | Clustered scatter |
| | 70 | EX 5.3 | Correlation-hidden chart | Sorted-bar correlation |

> Substage **EX 2** is a **mini-boss row** — each bad chart type (pie, gauge, radar/funnel, spaghetti, traffic-light) is its own sub-boss level.

#### Stage 6 — STRUCTURE · *The Architect's Blueprint* (Composition)

| Substage | Lvl ID | Rule | Enemy (Don't) | Collectible (Do) |
|----------|--------|------|---------------|------------------|
| ST 1 Use consistent elements | 71 | ST 1.1 | Reordered item set | Consistent ordered set |
| | 72 | ST 1.2 | Mixed statement types | Parallel statements |
| | 73 | ST 1.3 | Varied wording | Consistent wording |
| | 74 | ST 1.4 | Changed visual for concept | Consistent visual |
| ST 2 Build non-overlapping (MECE) | 75 | ST 2.1 | Overlapping buckets | Disjoint report structure |
| | 76 | ST 2.2 | Double-counted measure | Disjoint measures |
| | 77 | ST 2.3 | Overlapping dimensions | Clean groupings |
| ST 3 Build exhaustive elements | 78 | ST 3.1 | Gap-leaving argument | Exhaustive argument |
| | 79 | ST 3.2 | Missing "Rest" | Exhaustive structure (+Rest) |
| ST 4 Build hierarchical structures | 80 | ST 4.1 | Buried deduction | Deductive pyramid |
| | 81 | ST 4.2 | Unsynthesized statements | Inductive synthesis |
| ST 5 Visualize structure | 82 | ST 5.1 | Flat report | Indented report |
| | 83 | ST 5.2 | Flat table | Bold-sum indented table |
| | 84 | ST 5.3 | Unstructured notes | Numbered hierarchical notes |

#### Stage 7 — SAY · *The Boardroom* (Composition)

| Substage | Lvl ID | Rule | Enemy (Don't) | Collectible (Do) |
|----------|--------|------|---------------|------------------|
| SA 1 Know objectives | 85 | SA 1.1 | Goal-less arrow | Clear-goal flag |
| | 86 | SA 1.2 | Audience-blind chart | Audience-tailored chart |
| SA 2 Introduce message | 87 | SA 2.1 | Missing situation card | Situation card |
| | 88 | SA 2.2 | Hidden-problem card | Problem card |
| | 89 | SA 2.3 | Implicit-question card | Question card |
| SA 3 Deliver message | 90 | SA 3.1 | Observation-only text | Detect→explain→suggest chain |
| | 91 | SA 3.2 | Buried conclusion | Message-first headline |
| SA 4 Support message | 92 | SA 4.1 | Unsupported claim | Evidence-backed claim |
| | 93 | SA 4.2 | Vague "significant" | Precise "3.5 mEUR" |
| | 94 | SA 4.3 | Unmarked message | Highlighted message |
| | 95 | SA 4.4 | Source-less chart | Sourced chart |
| | 96 | SA 4.5 | Floating comment | Numbered linked comment |
| SA 5 Summarize message | 97 | SA 5.1 | Recap-less ending | Repeated message |
| | 98 | SA 5.2 | Consequence-less ending | Next-steps card |

---

### Final Boss — *The Board Report*

A single capstone room that **combines every pillar**. The player assembles one compelling board chart while the **"Bad-Reporting Boss"** (a giant 3D rainbow pie chart with truncated axes) throws every anti-pattern at them.

**Boss phases** map to the SUCCESS letters:
1. **Simplify phase** — strip the boss's decorations to expose its weak point.
2. **Unify phase** — standardize the incoming projectiles' notation.
3. **Check phase** — un-truncate its axis to halve its health.
4. **Condense / Express phase** — replace its pie body with bars.
5. **Structure phase** — break its overlapping armor into MECE segments.
6. **Say phase** — deliver the final "message first" hit.

**Win condition:** present the finished IBCS-compliant chart → boss converts into a clean board report. Sets `ibcsCertified = true` and unlocks the **"IBCS Certified"** badge in the GameStats payload, **and opens the door to the Memory Room.**

---

### Memory Room — *The Standards Vault* (ISO 24896 recall)

A short single-room puzzle placed **immediately after the final boss**, to make the player **memorize the standard's number: ISO 24896.**

**Flow:**
1. **See it once.** On entry, a large plaque/banner displays **"ISO 24896"** for a few seconds (with a soft chime), then fades. The hero can read it only this once.
2. **Walk further.** The player proceeds right across the room; the number is no longer shown anywhere.
3. **The locked door.** At the end stands a **locked vault door** with a **5-digit combination display** reading `0 0 0 0 0`, and a row of **bump-blocks / switches** beneath each digit.
4. **Unlock by jumping.** **Jumping up into a block cycles that digit** `0 → 1 → 2 → … → 9 → 0`. The player must recall and set the digits to **`2 4 8 9 6`** (ISO **24896**).
5. **Correct → door opens.** When the combination equals `24896`, the door **unlocks and opens** (success jingle, green glow); a wrong full combination flashes red and the player keeps trying (no life loss — it is a memory puzzle, not a combat room).
6. **Reward.** Passing the room sets `isoMemorized = true` in GameStats and grants a final **"ISO 24896"** collectible/medal. This is the true end of the game.

**Design notes:** the digit blocks behave like classic platformer `?`-blocks (each bump advances its digit and shows the new value); an optional subtle hint (e.g., the room being the *241st… ⁰* — keep hints minimal so recall is genuine) can be toggled in an "easy" mode. The combination value `24896` and the displayed standard name live in one config constant so they stay in sync.

---

### Implementation notes (engine fit)

- **Rules data:** replace the 9-entry `IBCS_RULES` / `RULE_LEARNED` maps with the full **98-entry** set generated from the Master Rule Table (ID → `{area, topic, subtopic, ruleCode, ruleTitle, do, dont, enemyKind, goodKind}`). Keep the `ibcsRule(lvl)` helper.
- **Stage/substage model:** introduce a `STAGES` structure (7 stages → 5 substages → levels) replacing the flat 16-entry `LEVELS`. Each stage carries its theme color; `FORM_DATA[form].color` tints the hero per stage.
- **Checkpoints / level-select:** persist `unlockedSubstages` (set of subtopic codes), `highestSubstage`, and `pillarsCompleted` (0–7). Add a level-select menu that lets the player start at any unlocked substage's first level. Clearing a substage's last level unlocks the next substage.
- **Banner:** `drawSlogan()` shows `"Stage S · <Topic> · <Subtopic> — <Rule code> <Title>"` plus the green **Do** / red **Don't** pair.
- **Enemy `kind` enum** gains the "Don't" families: `pie, ring, gauge, radar, funnel, spaghetti, trafficlight, truncated, log, 3d, clipped, cluttered, decorated, gridlined, longnumber, mixedterm, wanderlegend, timeVertical, structHorizontal, adhocVariance, colorMap, nominalOnly, overlapBucket, missingRest, flatHierarchy, buriedConclusion, vagueWord, sourceless`.
- **Collectible `goodKind` enum** gains the "Do" families: `column, bar, line, smallmultiple, table, tree, scatter, pyramid, cleanChart, dataLabel, standardFill, zeroBased, overlay, multitier, variance, meceSet, exhaustiveSet, indented, messageFirst, sourcedChart`.
- **GameStats payload:** add `pillarsCompleted` (0–7), `unlockedSubstages` (string), `ibcsCertified` (bool), and `isoMemorized` (bool). Emit a `rayfin-game-stats` postMessage per level/substage cleared. Update `rayfin/data/GameStats.ts` and `src/pages/GamePage.tsx` accordingly.
- **Memory Room:** add an `isoRoom` state after the boss with the `ISO 24896` reveal, 5 bump-blocks cycling digits, and a combination check against the config constant `ISO_CODE = "24896"`.

---

*End of plan. See **IBCS-Game-Ideas.md** for alternative game concepts that train the same rule set.*
