---
app: industry/harbour-pulse
slug: harbour-pulse
title: "Harbour Pulse: live Sydney ferries on a photoreal harbour"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/harbour-pulse.webp
---

# Harbour Pulse: live Sydney ferries on a photoreal harbour

A photorealistic 3D map of Sydney Harbour rendering live ferry positions out of a Fabric Eventhouse, with a voxel digital twin of any vessel you click.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![harbour-pulse](docs/previews/harbour-pulse.webp)

## What it does

- Live positions polled from Real-Time Intelligence every few seconds
- Google Photorealistic 3D Tiles and Cesium OSM buildings
- Click a ferry for a full-screen voxel twin with decks
- Pre-departure operator checklists in Fabric SQL

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app

## Data

Transport for NSW open real-time feed.

## Credits

- **Harbour Pulse is Fran Genoa's project.** The upstream repository is [FranGenoa/fabric-harbour-pulse](https://github.com/FranGenoa/fabric-harbour-pulse) and the design, the voxel vessel twins and the Real-Time Intelligence architecture are his work. This entry exists with his name on it, not instead of it.
- **Ferry photographs** come from Wikimedia Commons and remain under their original licences. Every image is credited individually, author, licence and source page, in [ATTRIBUTION.md](../../industry/harbour-pulse/ATTRIBUTION.md), because those licences require it.
- **Live vessel positions**: Transport for NSW open real-time feed.
- **Base map**: Google Photorealistic 3D Tiles and Cesium OSM Buildings.
- Licence: MIT. Copyright (c) 2026 HarbourPulse contributors.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/industry/harbour-pulse
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/industry/harbour-pulse

**How it is built:** https://kornalexander.github.io/Fabric-Apps/apps/harbour-pulse/

It is part of an open-source gallery of Fabric Apps: 3D twins, live maps, admin tools and a few games. https://kornalexander.github.io/Fabric-Apps/

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
