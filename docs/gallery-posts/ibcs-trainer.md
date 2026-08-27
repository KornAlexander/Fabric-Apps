---
app: games-and-learn/ibcs-trainer
slug: ibcs-trainer
title: "IBCS Trainer — learn a charting standard by destroying bad charts"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/ibcs-trainer.webp
---

# IBCS Trainer — learn a charting standard by destroying bad charts

A Canvas platformer that teaches the IBCS notation rules level by level. You play an analyst who conquers bad chart types: pie charts explode, and the wrong chart for a time series has to go.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![ibcs-trainer demo](docs/media/ibcs-trainer-demo.gif)

## What it does

- One IBCS rule per level, taught by playing it rather than reading it
- Progress and scores persisted to Fabric SQL
- Runs fully in the browser inside a Fabric App

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app

## Data

The IBCS notation standard. No external data.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/games-and-learn/ibcs-trainer
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/games-and-learn/ibcs-trainer

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
