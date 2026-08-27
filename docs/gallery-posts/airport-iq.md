---
app: industry/airport-iq
slug: airport-iq
title: "Airport IQ: live approach on a 3D airport twin"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/airport-iq.webp
  - docs/media/airport-iq-demo.gif
  - docs/media/airport-iq-demo.mp4
---

# Airport IQ: live approach on a 3D airport twin

Live aircraft on approach, drawn over a 3D airport model, with the ground operations view alongside it.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![airport-iq demo](docs/media/airport-iq-demo.gif)

## What it does

- Live ADS-B aircraft from the public airplanes.live API
- A 3D airport model with real gate geometry from OpenStreetMap
- Two views behind one landing page

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Static web app

## Data

airplanes.live ADS-B and OpenStreetMap, both public.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/industry/airport-iq
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/industry/airport-iq

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
