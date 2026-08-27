# Jump & Run (Rayfin)

<!-- TODO(phase-1e): no preview yet. Once `docs/previews/jump-and-run.webp` exists, replace this comment with:
     ![Jump and Run](../../docs/previews/jump-and-run.webp) -->

The single-file HTML5 Canvas platformer
([`jump_and_run_v2.html`](public/game/jump_and_run_v2.html)) embedded in a
Fabric-authenticated Rayfin app. It runs in an `<iframe>` and reports each
finished play-through to the host, which persists it to a typed `GameStats`
entity through the Rayfin data client.

## What it does

- Ten themed stages, 100 levels, built from layout archetypes
- Stage select with progress saved per player
- Responsive canvas with on-screen controls, so it works on a phone
- Every finished run is written to a typed entity through the Rayfin data client

## Gameplay features

- **10 main stages, 100 levels.** Levels are grouped into ten themed main
  stages (Meadows, Forest, Desert, Skies, Swamp, Caverns, Volcano, Glacier,
  Ocean and the Twilight Expanse), ten levels each. The flat `LEVELS` table is
  generated from a `STAGES` model (see the `buildLevels` function), so difficulty
  ramps smoothly across and within stages instead of scaling one template.
- **Varied layouts.** Each level is built from one of several layout archetypes
  (`stairs`, `pits`, `islands`, `tower`, `gauntlet`, `river`), cycled within each
  stage so the levels differ in structure.
- **Stage select with saved progress.** After entering your name you choose a
  stage to start from. Stage 1 is always available; clearing a stage's last
  level unlocks the next one. Unlocked stages are persisted per-browser in
  `localStorage`, so progress survives reloads. (Tying progress to the
  signed-in account via the Rayfin data model is a possible follow-up.)
- **Mobile / landscape support.** The canvas scales responsively, on-screen
  touch buttons appear automatically on touch devices, and a "rotate to
  landscape" overlay is shown in portrait. Keyboard controls still work on
  desktop. Stages are picked by tapping/clicking a cell, or with the arrow keys
  / number keys plus Enter.
- **Cheat codes.** Type `leben` during play to toggle infinite lives (German
  *Leben* = lives). Press `L` then a number to jump to that level
  (`L9` → level 9, `L12` → level 12).

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173, sign in, and play. When a run ends (win or game
over), the game posts its stats to the React host and the header shows
"Run saved".

> This app is fully self-contained — it depends only on the published
> `@microsoft/rayfin-*` packages (v1.33.x) from the public npm registry, so it
> installs and runs on its own without the `project-rayfin` monorepo.

## How the migration works

| Original (Fabric notebook) | This app |
|---|---|
| Game played via `displayHTML()` in a notebook cell | Game served from `public/game/` and rendered in an `<iframe>` |
| Game-over JSON hand-pasted into a Save cell | `stats.publish()` posts the JSON via `window.parent.postMessage` |
| JSON appended to a `game_stats` Delta table | `GamePage` calls `client.data.GameStats.create(...)` |

The `stats.publish()` bridge `postMessage`s the payload to the parent window so
the host can persist it. The game also adds 10 themed stages (100 levels) with
varied layouts, a stage-select screen with saved progress, mobile/touch
controls, and cheat codes (see [Gameplay features](#gameplay-features)).

## Project structure

```text
├── public/game/jump_and_run_v2.html  # The game (Canvas platformer + stats bridge)
├── rayfin/
│   ├── rayfin.yml                    # Fabric service config (auth + data + hosting)
│   └── data/
│       ├── GameStats.ts              # One row per play-through
│       └── schema.ts                 # Registers GameStats
├── src/
│   ├── main.tsx                      # Entry point + Rayfin client bootstrap
│   ├── App.tsx                       # Routes and auth gate
│   ├── pages/GamePage.tsx            # Embeds the game + saves stats
│   ├── hooks/AuthContext.tsx         # Auth context
│   ├── components/AuthPage.tsx       # Sign-in UI
│   └── services/                     # Auth + typed Rayfin client wiring
└── package.json
```

## The data model

`GameStats` (`rayfin/data/GameStats.ts`) mirrors the game's `stats.toJSON()`
payload (score, deaths by cause, coins, jumps, attacks, forms collected, final
form, level reached, duration). Each record is scoped to the signed-in player
via `user_id` (from the JWT `sub` claim), so a player only sees their own runs.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Deploy app to Fabric and start local dev server |
| `npm run build` | Production build |
| `npm run build:fabric` | Build for Fabric deployment |
| `npm run lint` | Lint with ESLint |
| `npm run test` | Run unit tests with Vitest |
| `npm run rayfin:up` | Deploy app to Fabric (no local dev server) |

## Fabric architecture

`npx rayfin up` provisions:

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app

## Credits

Part of [Fabric-Apps](../../README.md), MIT licensed.

## Data

Generated level data. No external source.
