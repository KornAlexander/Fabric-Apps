---
app: industry/dwd-klimaspirale
slug: dwd-klimaspirale
title: "Climate Spiral: a century of German weather in five views"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/dwd-klimaspirale.webp
  - docs/media/dwd-klimaspirale-demo.gif
  - docs/media/dwd-klimaspirale-demo.mp4
---

# Climate Spiral: a century of German weather in five views

An interactive climate viewer rendered entirely in Canvas 2D, no custom visual, no WebGL, so it drops straight into a Fabric App, an iframe or any web page.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![dwd-klimaspirale demo](docs/media/dwd-klimaspirale-demo.gif)

## What it does

- A tilted climate spiral of yearly temperature anomaly
- The same series as a stacked funnel, as anomaly bars, and as warming stripes
- An interpolated heat map of Germany clipped to the federal-state outline
- Five views sharing one playback timeline

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Static web app

## Data

Deutscher Wetterdienst open climate data.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/industry/dwd-klimaspirale
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/industry/dwd-klimaspirale

**How it is built:** https://kornalexander.github.io/Fabric-Apps/apps/dwd-klimaspirale/

It is part of an open-source gallery of Fabric Apps: 3D twins, live maps, admin tools and a few games. https://kornalexander.github.io/Fabric-Apps/

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
