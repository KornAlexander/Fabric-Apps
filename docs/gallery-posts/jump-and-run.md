---
app: games-and-learn/jump-and-run
slug: jump-and-run
title: "Jump and Run — 100 levels, and every run lands in Fabric"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: false
assets:
  - docs/previews/jump-and-run.webp
  - games-and-learn/jump-and-run/media/jump-and-run-demo.gif
  - games-and-learn/jump-and-run/media/jump-and-run-demo.mp4
---

# Jump and Run — 100 levels, and every run lands in Fabric

A single-file HTML5 Canvas platformer embedded in a Fabric-authenticated app. Each finished play-through is written to a typed entity through the Rayfin data client.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![jump-and-run demo](games-and-learn/jump-and-run/media/jump-and-run-demo.gif)

## What it does

- Ten themed stages, 100 levels, built from layout archetypes
- Stage select with progress saved per player
- Responsive canvas with on-screen controls for mobile
- Every run persisted to Fabric SQL

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app

## Data

Generated level data. No external source.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/games-and-learn/jump-and-run
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/games-and-learn/jump-and-run

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
