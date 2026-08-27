# IBCS Rule → Do/Don’t Image Mapping

Single source of truth that maps every one of the **98 IBCS rule-levels** to the
two pictures the mini-games display: the **Do** chart (the compliant example to
collect / swipe-right / pick) and the **Don’t** chart (the violation to stomp /
swipe-left / avoid). Rule codes, titles and Do/Don’t text come from
[`public/game/ibcs_rules.js`](../public/game/ibcs_rules.js) (`window.IBCS.RULES`),
the registry shared by all three games (Rule Platformer, Chart Swipe, IBCS Escape Room).

## How to supply the images

1. Export each rule’s Do and Don’t chart from the source PDF as its own file.
2. **Remove the diagonal strike-through line** that the PDF draws across every
   “Don’t” chart — the game marks violations itself, so the image must show the
   chart *without* the crossing-out line. (Do charts are used as-is.)
3. Save them under [`public/game/img/`](../public/game/img/) using the exact paths
   in the table below. Recommended: square-ish PNG with a transparent background,
   ~512×512, no surrounding caption text.
4. Missing files fall back to the procedural chart glyph (`ibcs_charts.js`), so the
   games keep working while the bank is filled in incrementally.

## Filename convention

- Do image:    `img/do/<CODE>.png`
- Don’t image: `img/dont/<CODE>.png`

`<CODE>` is the rule code with spaces and dots replaced by hyphens
(e.g. `SI 1.1` → `SI-1-1`). Paths are relative to `public/game/`.

## The 98 rules


### Stage 1 — SIMPLIFY (Notation) · The Cluttered Office

| # | Code | Title | Do | Don’t | Do image | Don’t image |
|---|------|-------|----|--------|----------|-------------|
| 1 | `SI 1.1` | Avoid cluttered layouts | Remove anything that carries no information | Crowd the page with meaningless elements | `img/do/SI-1-1.png` | `img/dont/SI-1-1.png` |
| 2 | `SI 1.2` | Avoid colored or filled backgrounds | Use a plain white background | Fill backgrounds with color or gradients | `img/do/SI-1-2.png` | `img/dont/SI-1-2.png` |
| 3 | `SI 1.3` | Avoid animation and transition effects | Keep visuals static | Add movement that distracts from data | `img/do/SI-1-3.png` | `img/dont/SI-1-3.png` |
| 4 | `SI 2.1` | Avoid frames, shades, and 3D without meaning | Use flat 2D shapes | Add drop shadows, 3D, or borders for looks | `img/do/SI-2-1.png` | `img/dont/SI-2-1.png` |
| 5 | `SI 2.2` | Avoid decorative colors | Use color only to carry meaning | Use color as decoration | `img/do/SI-2-2.png` | `img/dont/SI-2-2.png` |
| 6 | `SI 2.3` | Avoid decorative fonts | Use one neutral, legible typeface | Use decorative or mixed fonts | `img/do/SI-2-3.png` | `img/dont/SI-2-3.png` |
| 7 | `SI 3.1` | Replace grid lines and value axes with data labels | Label data directly | Keep gridlines/axes when labels suffice | `img/do/SI-3-1.png` | `img/dont/SI-3-1.png` |
| 8 | `SI 3.2` | Avoid vertical lines by right-aligning data | Right-align numbers in tables | Add vertical separator lines | `img/do/SI-3-2.png` | `img/dont/SI-3-2.png` |
| 9 | `SI 4.1` | Avoid superfluous words | Cut filler words in titles/labels | Pad text with unnecessary words | `img/do/SI-4-1.png` | `img/dont/SI-4-1.png` |
| 10 | `SI 4.2` | Avoid obvious terms | Drop words the reader already infers | State the obvious | `img/do/SI-4-2.png` | `img/dont/SI-4-2.png` |
| 11 | `SI 4.3` | Avoid repeated terms | Say it once (legend or axis) | Repeat the same term in legend and axis | `img/do/SI-4-3.png` | `img/dont/SI-4-3.png` |
| 12 | `SI 5.1` | Avoid labels for small values | Label only values that matter | Label values too small to matter | `img/do/SI-5-1.png` | `img/dont/SI-5-1.png` |
| 13 | `SI 5.2` | Avoid long numbers | Round/rescale (kEUR, mEUR) | Show overly long numbers | `img/do/SI-5-2.png` | `img/dont/SI-5-2.png` |
| 14 | `SI 5.3` | Avoid unnecessary labels | Label only what supports the message | Label everything | `img/do/SI-5-3.png` | `img/dont/SI-5-3.png` |

### Stage 2 — UNIFY (Notation) · The Tower of Babel

| # | Code | Title | Do | Don’t | Do image | Don’t image |
|---|------|-------|----|--------|----------|-------------|
| 15 | `UN 1.1` | Unify terms and abbreviations | Use the same word for a concept everywhere | Mix synonyms or abbreviations | `img/do/UN-1-1.png` | `img/dont/UN-1-1.png` |
| 16 | `UN 1.2` | Unify numbers, units, and dates | Use one format for numbers, units, dates | Mix number/unit/date formats | `img/do/UN-1-2.png` | `img/dont/UN-1-2.png` |
| 17 | `UN 2.1` | Unify key messages | Use a consistent style for headline messages | Style key messages differently each time | `img/do/UN-2-1.png` | `img/dont/UN-2-1.png` |
| 18 | `UN 2.2` | Unify titles and subtitles | Use the same title structure everywhere | Vary title structure | `img/do/UN-2-2.png` | `img/dont/UN-2-2.png` |
| 19 | `UN 2.3` | Unify the position of legends and labels | Place legends/labels in the same spot | Move legends around | `img/do/UN-2-3.png` | `img/dont/UN-2-3.png` |
| 20 | `UN 3.1` | Unify measures | Use the same look for the same measure | Render the same measure differently | `img/do/UN-3-1.png` | `img/dont/UN-3-1.png` |
| 21 | `UN 3.2` | Unify scenarios | Standard fills: AC solid, PY light, PL outline, FC hatched | Invent scenario fills | `img/do/UN-3-2.png` | `img/dont/UN-3-2.png` |
| 22 | `UN 3.3` | Unify time periods, use horizontal axes | Run time left-to-right on the horizontal axis | Put time on the vertical axis | `img/do/UN-3-3.png` | `img/dont/UN-3-3.png` |
| 23 | `UN 3.4` | Unify structure dimensions, use vertical axes | Run structures top-down on a vertical axis | Put structures on the horizontal axis | `img/do/UN-3-4.png` | `img/dont/UN-3-4.png` |
| 24 | `UN 4.1` | Unify scenario analyses | Use standard variance notation (dPY, dPL, %) | Use ad-hoc variance marks | `img/do/UN-4-1.png` | `img/dont/UN-4-1.png` |
| 25 | `UN 4.2` | Unify time series analyses | Use standard time-series symbols | Invent time-series symbols | `img/do/UN-4-2.png` | `img/dont/UN-4-2.png` |
| 26 | `UN 5.1` | Unify highlighting markers | Use standard highlight/trend/reference marks | Use random highlight marks | `img/do/UN-5-1.png` | `img/dont/UN-5-1.png` |
| 27 | `UN 5.2` | Unify scaling markers | Use standard marks when scales change | Hide scale changes | `img/do/UN-5-2.png` | `img/dont/UN-5-2.png` |
| 28 | `UN 5.3` | Unify outlier markers | Use standard triangle marks for outliers | Clip outliers without marking | `img/do/UN-5-3.png` | `img/dont/UN-5-3.png` |

### Stage 3 — CHECK (Notation) · The Hall of Mirrors

| # | Code | Title | Do | Don’t | Do image | Don’t image |
|---|------|-------|----|--------|----------|-------------|
| 29 | `CH 1.1` | Avoid truncated axes | Start value axes at zero | Truncate the value axis | `img/do/CH-1-1.png` | `img/dont/CH-1-1.png` |
| 30 | `CH 1.2` | Avoid logarithmic axes | Use linear scales | Use log axes that distort comparisons | `img/do/CH-1-2.png` | `img/dont/CH-1-2.png` |
| 31 | `CH 1.3` | Avoid different class sizes | Use equal class widths in distributions | Mix class sizes | `img/do/CH-1-3.png` | `img/dont/CH-1-3.png` |
| 32 | `CH 2.1` | Avoid clipped visual components | Show full bars/columns | Cut bars to fit | `img/do/CH-2-1.png` | `img/dont/CH-2-1.png` |
| 33 | `CH 2.2` | Use creative solutions for scaling issues | Handle extremes with overlap/outlier indicators | Distort visuals to fit extremes | `img/do/CH-2-2.png` | `img/dont/CH-2-2.png` |
| 34 | `CH 3.1` | Use correct area comparisons | Scale area honestly; prefer bars | Mis-scale areas | `img/do/CH-3-1.png` | `img/dont/CH-3-1.png` |
| 35 | `CH 3.2` | Use correct volume comparisons | Prefer linear (1D) comparisons | Scale 3D volume to a 1D value | `img/do/CH-3-2.png` | `img/dont/CH-3-2.png` |
| 36 | `CH 3.3` | Avoid misleading colored areas in maps | Pair map color with size | Equate map color with magnitude | `img/do/CH-3-3.png` | `img/dont/CH-3-3.png` |
| 37 | `CH 4.1` | Use identical scale for the same unit | Use the same mm-per-unit across charts | Change scale for the same unit | `img/do/CH-4-1.png` | `img/dont/CH-4-1.png` |
| 38 | `CH 4.2` | Size charts to given data | Fit the chart frame to the data range | Pad frames arbitrarily | `img/do/CH-4-2.png` | `img/dont/CH-4-2.png` |
| 39 | `CH 4.3` | Use scaling indicators if necessary | Mark where a shared scale is broken | Break a scale silently | `img/do/CH-4-3.png` | `img/dont/CH-4-3.png` |
| 40 | `CH 4.4` | Use outlier indicators if necessary | Flag values exceeding the frame | Let outliers distort the frame unmarked | `img/do/CH-4-4.png` | `img/dont/CH-4-4.png` |
| 41 | `CH 5.1` | Show the impact of inflation | Reveal real vs nominal | Show nominal only when inflation matters | `img/do/CH-5-1.png` | `img/dont/CH-5-1.png` |
| 42 | `CH 5.2` | Show the currency impact | Reveal currency-adjusted figures | Hide currency effects | `img/do/CH-5-2.png` | `img/dont/CH-5-2.png` |

### Stage 4 — CONDENSE (Composition) · The Cramped Warehouse

| # | Code | Title | Do | Don’t | Do image | Don’t image |
|---|------|-------|----|--------|----------|-------------|
| 43 | `CO 1.1` | Use small fonts | Use smaller type to fit more content | Oversize fonts | `img/do/CO-1-1.png` | `img/dont/CO-1-1.png` |
| 44 | `CO 1.2` | Use small components | Use compact chart elements | Bloat components | `img/do/CO-1-2.png` | `img/dont/CO-1-2.png` |
| 45 | `CO 1.3` | Use small visuals | Prefer many small charts | Use one huge chart | `img/do/CO-1-3.png` | `img/dont/CO-1-3.png` |
| 46 | `CO 2.1` | Use narrow page margins | Reclaim the margins | Waste page edges | `img/do/CO-2-1.png` | `img/dont/CO-2-1.png` |
| 47 | `CO 2.2` | Reduce empty space | Tighten gaps in visuals/tables | Leave large empty gaps | `img/do/CO-2-2.png` | `img/dont/CO-2-2.png` |
| 48 | `CO 3.1` | Show data | Add data points that add insight | Omit informative data | `img/do/CO-3-1.png` | `img/dont/CO-3-1.png` |
| 49 | `CO 3.2` | Show details | Add the supporting detail level | Hide useful detail | `img/do/CO-3-2.png` | `img/dont/CO-3-2.png` |
| 50 | `CO 4.1` | Show overlay charts | Layer related series (line over column) | Separate naturally-overlaid series | `img/do/CO-4-1.png` | `img/dont/CO-4-1.png` |
| 51 | `CO 4.2` | Show multi-tier charts | Stack tiers of related measures | Split related tiers | `img/do/CO-4-2.png` | `img/dont/CO-4-2.png` |
| 52 | `CO 4.3` | Show extended charts | Add benchmarks / reference rows | Drop useful references | `img/do/CO-4-3.png` | `img/dont/CO-4-3.png` |
| 53 | `CO 4.4` | Embed chart components in tables | Add sparkline-style bars in tables | Keep tables purely numeric when bars help | `img/do/CO-4-4.png` | `img/dont/CO-4-4.png` |
| 54 | `CO 4.5` | Embed explanations | Add inline comments next to data | Separate explanations from data | `img/do/CO-4-5.png` | `img/dont/CO-4-5.png` |
| 55 | `CO 5.1` | Show small multiples | Use a grid of comparable mini-charts | Merge incomparable series | `img/do/CO-5-1.png` | `img/dont/CO-5-1.png` |
| 56 | `CO 5.2` | Show related charts on one page | Group linked charts together | Scatter related charts | `img/do/CO-5-2.png` | `img/dont/CO-5-2.png` |

### Stage 5 — EXPRESS (Composition) · The Chart Zoo

| # | Code | Title | Do | Don’t | Do image | Don’t image |
|---|------|-------|----|--------|----------|-------------|
| 57 | `EX 1.1` | Use appropriate chart types | Match chart to message | Pick the wrong chart type | `img/do/EX-1-1.png` | `img/dont/EX-1-1.png` |
| 58 | `EX 1.2` | Use appropriate table types | Use time / variance / cross tables as fit | Misuse table types | `img/do/EX-1-2.png` | `img/dont/EX-1-2.png` |
| 59 | `EX 2.1` | Replace pie and ring charts | Use bars / columns | Use pie / ring charts | `img/do/EX-2-1.png` | `img/dont/EX-2-1.png` |
| 60 | `EX 2.2` | Replace gauges, speedometers | Use bars with reference lines | Use gauges / speedometers | `img/do/EX-2-2.png` | `img/dont/EX-2-2.png` |
| 61 | `EX 2.3` | Replace radar and funnel charts | Use bar charts | Use radar / funnel charts | `img/do/EX-2-3.png` | `img/dont/EX-2-3.png` |
| 62 | `EX 2.4` | Replace spaghetti charts | Use small multiples / highlighted line | Overplot many lines | `img/do/EX-2-4.png` | `img/dont/EX-2-4.png` |
| 63 | `EX 2.5` | Replace traffic lights | Use signed values + variance bars | Use traffic-light symbols | `img/do/EX-2-5.png` | `img/dont/EX-2-5.png` |
| 64 | `EX 3.1` | Prefer quantitative representations | Use numbers over icons / symbols | Replace numbers with icons | `img/do/EX-3-1.png` | `img/dont/EX-3-1.png` |
| 65 | `EX 3.2` | Avoid text slides in presentations | Show data, not bullet text | Read bullet slides | `img/do/EX-3-2.png` | `img/dont/EX-3-2.png` |
| 66 | `EX 4.1` | Add scenarios | Compare AC vs PY vs PL vs FC | Show a single scenario alone | `img/do/EX-4-1.png` | `img/dont/EX-4-1.png` |
| 67 | `EX 4.2` | Add variances | Show absolute + relative variance | Omit variances | `img/do/EX-4-2.png` | `img/dont/EX-4-2.png` |
| 68 | `EX 5.1` | Show tree structures | Decompose totals (profit = sales - costs) | Leave totals unexplained | `img/do/EX-5-1.png` | `img/dont/EX-5-1.png` |
| 69 | `EX 5.2` | Show clusters | Reveal groupings in scatter data | Ignore clustering | `img/do/EX-5-2.png` | `img/dont/EX-5-2.png` |
| 70 | `EX 5.3` | Show correlations | Pair sorted bars to expose relationships | Hide correlations | `img/do/EX-5-3.png` | `img/dont/EX-5-3.png` |

### Stage 6 — STRUCTURE (Composition) · The Architect's Blueprint

| # | Code | Title | Do | Don’t | Do image | Don’t image |
|---|------|-------|----|--------|----------|-------------|
| 71 | `ST 1.1` | Use consistent items | Use the same items in the same order | Reorder/omit items between visuals | `img/do/ST-1-1.png` | `img/dont/ST-1-1.png` |
| 72 | `ST 1.2` | Use consistent types of statements | Use parallel grammar (all verbs/all nouns) | Mix statement types | `img/do/ST-1-2.png` | `img/dont/ST-1-2.png` |
| 73 | `ST 1.3` | Use consistent wording | Use the same wording for the same thing | Vary wording | `img/do/ST-1-3.png` | `img/dont/ST-1-3.png` |
| 74 | `ST 1.4` | Use consistent visualizations | Use the same visual for the same concept | Change visuals for one concept | `img/do/ST-1-4.png` | `img/dont/ST-1-4.png` |
| 75 | `ST 2.1` | Build non-overlapping report structures | Keep each item in one bucket | Let an item appear in two buckets | `img/do/ST-2-1.png` | `img/dont/ST-2-1.png` |
| 76 | `ST 2.2` | Build non-overlapping business measures | Keep calculation steps disjoint | Double-count | `img/do/ST-2-2.png` | `img/dont/ST-2-2.png` |
| 77 | `ST 2.3` | Build non-overlapping structure dimensions | Use clean, disjoint groupings | Overlap dimensions | `img/do/ST-2-3.png` | `img/dont/ST-2-3.png` |
| 78 | `ST 3.1` | Build exhaustive arguments | Cover all options | Leave gaps in arguments | `img/do/ST-3-1.png` | `img/dont/ST-3-1.png` |
| 79 | `ST 3.2` | Build exhaustive structures | Add "Rest"/"Other" so parts sum to the whole | Omit the remainder | `img/do/ST-3-2.png` | `img/dont/ST-3-2.png` |
| 80 | `ST 4.1` | Use deductive reasoning | Statement -> comment -> conclusion -> message | Bury the deduction | `img/do/ST-4-1.png` | `img/dont/ST-4-1.png` |
| 81 | `ST 4.2` | Use inductive reasoning | Synthesize many statements into one message | Leave statements unsynthesized | `img/do/ST-4-2.png` | `img/dont/ST-4-2.png` |
| 82 | `ST 5.1` | Visualize structure in reports | Use indentation/emphasis to show hierarchy | Flatten the hierarchy | `img/do/ST-5-1.png` | `img/dont/ST-5-1.png` |
| 83 | `ST 5.2` | Visualize structure in tables | Bold sums, indent members | Render tables flat | `img/do/ST-5-2.png` | `img/dont/ST-5-2.png` |
| 84 | `ST 5.3` | Visualize structure in notes | Use numbered, hierarchical note lists | Leave notes unstructured | `img/do/ST-5-3.png` | `img/dont/ST-5-3.png` |

### Stage 7 — SAY (Composition) · The Boardroom

| # | Code | Title | Do | Don’t | Do image | Don’t image |
|---|------|-------|----|--------|----------|-------------|
| 85 | `SA 1.1` | Know own goals | Be clear on what you want to achieve | Start without a goal | `img/do/SA-1-1.png` | `img/dont/SA-1-1.png` |
| 86 | `SA 1.2` | Know target audience | Tailor to the reader/listener | Ignore the audience | `img/do/SA-1-2.png` | `img/dont/SA-1-2.png` |
| 87 | `SA 2.1` | Map situation | State the agreed starting situation | Skip the setup | `img/do/SA-2-1.png` | `img/dont/SA-2-1.png` |
| 88 | `SA 2.2` | Explain problem | Name the complication / gap | Hide the problem | `img/do/SA-2-2.png` | `img/dont/SA-2-2.png` |
| 89 | `SA 2.3` | Raise question | Pose the question the message answers | Leave the question implicit | `img/do/SA-2-3.png` | `img/dont/SA-2-3.png` |
| 90 | `SA 3.1` | Detect, explain, or suggest | Observation -> cause -> recommendation | Stop at observation | `img/do/SA-3-1.png` | `img/dont/SA-3-1.png` |
| 91 | `SA 3.2` | Say message first | Lead with the conclusion (top-down) | Bury the conclusion | `img/do/SA-3-2.png` | `img/dont/SA-3-2.png` |
| 92 | `SA 4.1` | Provide evidence | Back claims with data | Make unsupported claims | `img/do/SA-4-1.png` | `img/dont/SA-4-1.png` |
| 93 | `SA 4.2` | Use precise words | Say "Cut of 3.5 mEUR" | Say "significant" vaguely | `img/do/SA-4-2.png` | `img/dont/SA-4-2.png` |
| 94 | `SA 4.3` | Highlight message | Visually mark the point in the chart | Leave the message unmarked | `img/do/SA-4-3.png` | `img/dont/SA-4-3.png` |
| 95 | `SA 4.4` | Name sources | Cite where the data came from | Omit sources | `img/do/SA-4-4.png` | `img/dont/SA-4-4.png` |
| 96 | `SA 4.5` | Link comments | Use numbered annotations tied to data | Float comments unlinked | `img/do/SA-4-5.png` | `img/dont/SA-4-5.png` |
| 97 | `SA 5.1` | Repeat message | Restate the conclusion at the end | End without a recap | `img/do/SA-5-1.png` | `img/dont/SA-5-1.png` |
| 98 | `SA 5.2` | Explain consequences | Spell out next steps / decisions | Leave consequences unstated | `img/do/SA-5-2.png` | `img/dont/SA-5-2.png` |
