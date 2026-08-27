# IBCS SUCCESS — Alternative Game Ideas to Train the Rules

> Companion to **IBCS-Rules-and-Trainer-Plan.md**. These are alternative or complementary game concepts that teach the same IBCS® SUCCESS rule set (SIMPLIFY · UNIFY · CHECK · CONDENSE · EXPRESS · STRUCTURE · SAY). Each entry notes the format, core loop, which pillars it best trains, and effort to build.

---

## Quick comparison

| # | Game | Format | Best-trained pillars | Build effort | Multiplayer |
|---|------|--------|----------------------|--------------|-------------|
| 1 | Spot the Violation | Web quiz / hidden-object | All 7 | Low | Solo |
| 2 | Chart Doctor | Drag-and-drop "fix it" | Simplify, Check, Express | Medium | Solo |
| 3 | Before / After Swipe | Swipe-style judgment | All 7 | Low | Solo |
| 4 | Notation Match | Memory / pairs | Unify | Low | Solo / 2p |
| 5 | The Variance Builder | Puzzle / assembly | Express, Check | Medium | Solo |
| 6 | MECE Sorter | Sorting / bucket game | Structure | Low | Solo |
| 7 | Pyramid Climber | Card-stacking | Structure, Say | Medium | Solo |
| 8 | Boardroom Battle | Quiz duel / trivia | Say, Express | Medium | 2–6p |
| 9 | Reporting Tycoon | Idle / management sim | All 7 | High | Solo |
| 10 | Chart Type Speed-Run | Reaction / sorting | Express | Low | Leaderboard |
| 11 | IBCS Escape Room | Puzzle-room | All 7 | High | 1–4p |
| 12 | Tabletop / Card Deck | Physical card game | All 7 | Low (print) | 2–6p |

---

## 1. Spot the Violation
**Format:** Hidden-object / "find the flaw" quiz.
**Loop:** A report page is shown. The player taps every rule violation (truncated axis, 3D bar, pie chart, wandering legend…). Each correct tap reveals the rule code (e.g. *CH 1.1*); wrong taps cost time.
**Trains:** All pillars — great for a daily-challenge mode.
**Why it works:** Builds the diagnostic "IBCS eye" — the single most valuable real-world skill.
**Build:** Low — static images + click hotspots + rule lookup.

## 2. Chart Doctor
**Format:** Drag-and-drop repair bench.
**Loop:** A "sick" chart arrives. Toolbar offers fixes: *remove gridlines, set axis to zero, swap pie→bar, round numbers, add variance, place legend*. Apply the right operations to discharge the patient. Score on minimal correct moves.
**Trains:** Simplify, Check, Express (and Condense via "embed bars in table").
**Build:** Medium — needs a small chart-render engine that reacts to operations.

## 3. Before / After Swipe
**Format:** Swipe-style judgment.
**Loop:** Show a single chart. Swipe **left = violates IBCS**, **right = compliant**. Fast rounds, combo multiplier, lives. After a miss, the rule card is shown.
**Trains:** All pillars; excellent onboarding / mobile.
**Build:** Low — a labeled image bank + swipe UI.

## 4. Notation Match (Memory)
**Format:** Concentration / pairs.
**Loop:** Flip cards to pair a **concept** with its **IBCS notation** — Actual↔solid fill, Plan↔outline, Forecast↔hatched, Previous↔light, ΔPY↔green/red bar, time↔horizontal axis.
**Trains:** Unify (UN 3 scenarios, UN 4 analyses, UN 5 markers).
**Build:** Low.

## 5. The Variance Builder
**Format:** Assembly puzzle.
**Loop:** Given AC and PL values, the player constructs the correct variance chart: pick absolute (ΔPL) vs relative (ΔPL%), color the sign (green good / red bad), attach the integrated variance column. Validates against IBCS variance notation.
**Trains:** Express (EX 4), Unify (UN 4), Check (CH 4 scaling).
**Build:** Medium.

## 6. MECE Sorter
**Format:** Bucket-sorting game.
**Loop:** Items fall from the top; the player sorts them into category buckets. Win only if buckets are **Mutually Exclusive** (no item fits two) **and Collectively Exhaustive** (a "Rest/Other" bucket catches the remainder). Overlaps flash red; gaps leave the total short.
**Trains:** Structure (ST 2 + ST 3).
**Build:** Low–Medium.

## 7. Pyramid Climber
**Format:** Card-stacking / tower builder.
**Loop:** Build a Minto-style pyramid: place *statements* on the base, synthesize into *comments*, top with the *message*. Two modes: **deductive** (statement→conclusion chain) and **inductive** (many statements→one message). The tower collapses if reasoning is out of order.
**Trains:** Structure (ST 4), Say (SA 3 "message first").
**Build:** Medium.

## 8. Boardroom Battle
**Format:** Quiz duel (Kahoot-style), 2–6 players.
**Loop:** Players race to answer: *"Which chart presents this message best?"*, *"Name the violated rule"*, *"Pick the precise wording"* (SA 4.2). Live leaderboard; steal-points for fastest correct.
**Trains:** Say, Express, plus recall of all rules.
**Build:** Medium — good for workshops/training sessions.

## 9. Reporting Tycoon
**Format:** Idle / management sim.
**Loop:** Run a reporting team. Each delivered report earns "clarity points" scaled by IBCS compliance; sloppy reports lose stakeholder trust. Spend points to "research" pillars (unlock Condense, then Express…), automate fixes, and upgrade the team. Anti-patterns appear as recurring "tech debt" to clean up.
**Trains:** All pillars, with long-term retention and the *why* (business value of clarity).
**Build:** High.

## 10. Chart Type Speed-Run
**Format:** Reaction sorter, leaderboard.
**Loop:** A message scrolls by ("compare 5 regions", "show a time trend", "decompose profit"). The player slaps the correct chart type before it leaves the screen. Penalty for choosing pie/gauge/radar ever.
**Trains:** Express (EX 1, EX 2).
**Build:** Low.

## 11. IBCS Escape Room
**Format:** Puzzle-room (digital or physical), 1–4 players.
**Loop:** Each locked door needs an IBCS puzzle solved — decode a truncated-axis cipher, reassemble a MECE structure to reveal a code, fix a chart so its corrected values form the combination. Final room: present the board message to escape.
**Trains:** All pillars, collaborative.
**Build:** High — strong as a flagship workshop experience.

## 12. Tabletop / Card Deck
**Format:** Physical (or print-and-play) card game, 2–6 players.
**Loop:** A deck of **Violation cards** (each = one bad chart) and **Fix cards** (each = a rule). Players race to play the matching Fix on revealed Violations; correct match wins the trick. Variant: "IBCS Dobble" — spot the shared violation between two chart cards.
**Trains:** All pillars; pairs naturally with the printed SUCCESS poster.
**Build:** Low (design + print). Great giveaway at events.

---

## Recommended rollout

1. **Start lightweight to seed awareness:** *Before/After Swipe* (#3) + *Spot the Violation* (#1) — cheap, mobile, viral, daily-challenge friendly.
2. **Deepen with the platformer** (the existing **IBCS Trainer**, see companion plan) for structured pillar-by-pillar learning.
3. **Add a hands-on repair skill** with *Chart Doctor* (#2) and *The Variance Builder* (#5).
4. **Make it social** at workshops with *Boardroom Battle* (#8), the *Card Deck* (#12), or the *Escape Room* (#11).
5. **Reward retention** long-term with *Reporting Tycoon* (#9).

All concepts can share one backend: a single **rule registry** (the table in *IBCS-Rules-and-Trainer-Plan.md*) plus a labeled **chart asset bank** tagged with the rule code each asset violates or satisfies.
