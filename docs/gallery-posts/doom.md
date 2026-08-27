---
app: games-and-learn/doom
slug: doom
title: "Doom: yes, it runs on Microsoft Fabric"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/doom.webp
  - docs/media/doom-demo.gif
  - docs/media/doom-demo.mp4
---

# Doom: yes, it runs on Microsoft Fabric

The traditional proof that a platform has matured. Shareware DOOM boots in the browser through js-dos, wrapped in a Fabric-authenticated app, with scores written to a Fabric SQL database.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![doom demo](docs/media/doom-demo.gif)

## What it does

- Sign in with your Fabric identity and it boots straight into a playable loop
- Scores and saves persist to a typed entity in Fabric SQL
- A port of Sander van de Velde's original concept

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app

## Data

Freedoom, BSD-licensed. Retail WADs are not included and must not be.

## Credits

- **This app is Sander van de Velde's work.** The original concept and the Fabric/Rayfin integration are his: [sandervandevelde/Play-Doom-On-Microsoft-Fabric](https://github.com/sandervandevelde/Play-Doom-On-Microsoft-Fabric). This is a port of it into the gallery, with his name on it.
- DOOM in the browser via js-dos / DOSBox: [thedoggybrad/doom_on_js-dos](https://github.com/thedoggybrad/doom_on_js-dos).
- **id Software**, the DOOM engine and the shareware game data.
- [Freedoom](https://freedoom.github.io/), the BSD-licensed free game data set.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/games-and-learn/doom
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/games-and-learn/doom

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
