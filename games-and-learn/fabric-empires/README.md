# Fabric Empires

**A turn-based 4X strategy game whose tech tree is a certification syllabus.**

![Fabric Empires](../../docs/previews/fabric-empires.webp)

You explore a procedurally generated hex map, found cities, work tiles for four
resources, research a technology tree and fight rivals over it. That is the 4X
genre: *explore, expand, exploit, exterminate*, a form that has existed since
the early 1990s and that dozens of commercial and open-source games share.

The one thing this does differently: **the technology tree is the published
skills outline of a real exam, and researching a node means answering a real
question about it.** Get it right and your army is stronger this turn. Get it
wrong and you lose the battle, and the game tells you what you did not know.

> **This is a personal project.** It is not a Microsoft product, and it is not
> affiliated with, endorsed by, or sponsored by Microsoft.
>
> **Every question is original.** They are written from the publicly published
> skills-measured outline and public documentation. No exam content is
> reproduced, and none is derived from having sat the exam.

---

## What it does

- Turn-based 4X strategy: cities, armies, tech trees and sieges
- The entire game state lives in Fabric - every turn is a transaction
- Map, factions and save games are rows, not files

## What kind of game is this

A conventional 4X, built out of the genre's ordinary vocabulary:

| | |
| --- | --- |
| Map | Procedurally generated hex tiles, from a seed you type |
| Cities | Founded by a settler unit, work the tiles inside their border, grow on a food-equivalent resource |
| Economy | Four resources: one local and three pooled into a treasury |
| Research | A prerequisite graph of nodes, unlocking units |
| Units | Twelve types across settler, worker, scout, melee, ranged, siege, defensive, transport and support roles |
| Combat | Strength against hit points, with terrain and fortification modifiers |
| Fog of war | Explored and visible tracked separately |
| Rivals | Seven opposing factions with their own settlements |
| Victory | Military, technological, or by sitting the exam |

None of that is unusual, and none of it is meant to be. **The genre furniture is
deliberately conventional so that the one unusual idea is the only thing you
have to learn.** Somebody who has played any 4X can start here without reading
instructions, which is the entire point: the novelty budget is spent on the
questions, not on reinventing how a settler works.

If you want the world explained properly, including why each rule is the way it
is, read **[STORY.md](STORY.md)**.

## What makes it a study tool rather than a game with a quiz in it

Four design decisions, each recorded with its reasoning in
PLAN.md:

- **A city cannot reach its highest rank on population alone.** It needs topics
  you have *retained*, graded by a spaced-repetition model. A settlement grown
  purely on food stalls.
- **Research and soldiers come out of the same resource**, so every unit built
  is a topic not learned.
- **Reviews are a bonus, never a punishment.** Nothing accrues while you are
  away, and no city can ever be lost to neglected revision.
- **Your enemies are misconceptions**, not companies. Each quizzes you on a
  different branch of the outline, so the direction a war is coming from tells
  you what to revise.

## Running it

```bash
npm install
npm run verify      # types, content checks, and the test suite
npm run build
npm run serve:standalone
```

That is the whole game, hosted from static files. There is a second edition
that adds an AI study coach and question drafting; it is the same bundle with a
host that holds an API credential, and it is described in section 38 of the
plan.

## Bring your own subject

The exam outline is supplied to the engine as an opaque graph. The engine never
learns what a topic *means*, so any syllabus works: download the sample
spreadsheet in the setup screen, replace the rows, and the game builds a tech
tree out of your questions instead.

## What is in here

| | |
| --- | --- |
| [STORY.md](STORY.md) | The world, and why every rule is the way it is |
| PLAN.md | The full design log, decision by decision |
| [NOTICE.md](NOTICE.md) | What ships, what deliberately does not, and why |
| [MUSIC-LICENSING.md](MUSIC-LICENSING.md) | The licence position on the generated music |

The repository is source only. The terrain, water, sky and every object on the
map are generated at runtime from the world seed, so a clone is a few megabytes
rather than a few hundred. The music is the one exception and is not included;
the game runs silently without it and nothing breaks.

## Licence

The source is MIT. See [LICENSE](LICENSE).

The audio and video are **not** in this repository and are not covered by that
licence: see [NOTICE.md](NOTICE.md) and [MUSIC-LICENSING.md](MUSIC-LICENSING.md).

"Microsoft Fabric" and "DP-600" are Microsoft names, used here descriptively to
say what the study material is about. No Microsoft logo, product logo or
certification badge appears anywhere in this project.

## Fabric architecture

`npx rayfin up` provisions:

- Entra sign-in (Fabric identity)
- Static web app

## Getting started

```bash
npm install
npm run dev
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

Any workspace or item id this app needs is read from the environment, with no default.

## Project structure

```
app/            the application shell
engine/         game / simulation engine
learn/          learning content
rayfin/         deployment config - redirect URIs are loopback only
tools/          data pipeline and build helpers
```

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | production build |
| `npm run content:build` |  |
| `npm run content:check` |  |
| `npm run deploy` |  |
| `npm run dev` | dev server on http://localhost:5173 |
| `npm run lint` | lint |
| `npm run publishable` |  |
| `npm run record:intro` |  |
| `npm run serve:capacity` |  |
| `npm run serve:standalone` |  |
| `npm run smoke` |  |
| `npm run test` | unit tests |
| `npm run test:watch` |  |
| `npm run typecheck` |  |
| `npm run verify` |  |

## Data

Sources and their licences are listed in [NOTICE.md](NOTICE.md).

## Credits

Third-party data and licences: [NOTICE.md](NOTICE.md).
Licence: [LICENSE](LICENSE). Copyright (c) 2026 Alexander Korn.
