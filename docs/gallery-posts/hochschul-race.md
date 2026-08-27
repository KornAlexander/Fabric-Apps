---
app: industry/education/hochschul-race
slug: hochschul-race
title: "Higher Education Race Chart: 20 years of enrolment, animated"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/hochschul-race.webp
  - docs/media/hochschul-race-demo.gif
  - docs/media/hochschul-race-demo.mp4
---

# Higher Education Race Chart: 20 years of enrolment, animated

An animated bar-chart race of enrolment at German universities, running off a Direct Lake semantic model, with a build-time snapshot inlined so the first frame is instant.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![hochschul-race demo](docs/media/hochschul-race-demo.gif)

## What it does

- Students, first-year students and international students, switchable
- University, federal state and city dimensions
- Direct Lake semantic model over DESTATIS GENESIS data
- Report pages that mirror the Power BI report the data comes from

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Static web app

## Data

DESTATIS GENESIS, Datenlizenz Deutschland 2.0.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/industry/education/hochschul-race
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/industry/education/hochschul-race

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
