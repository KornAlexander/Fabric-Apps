---
app: industry/flood-insights
slug: flood-insights
title: "Flood Insights: the 2021 Ahr valley flood, reconstructed from open data"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/flood-insights.webp
  - docs/media/flood-insights-demo.gif
  - docs/media/flood-insights-demo.mp4
---

# Flood Insights: the 2021 Ahr valley flood, reconstructed from open data

24.6 km of the Ahr valley in 3D, replaying the flood of 14, 15 July 2021 along a scrubbable timeline, built entirely from publicly available data.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![flood-insights demo](docs/media/flood-insights-demo.gif)

## What it does

- Official 1 m terrain and LoD2 buildings
- A stage-discharge rating built from real cross-sections drives the timeline
- Scored against the Copernicus EMSR517 flood trace, IoU 0.508, shown in the app even when it is unflattering
- A closing view that lets you ask what would have helped, and watch the numbers move

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Static web app

## Data

Open German geodata and Copernicus EMSR517. Demonstration and training only, not a risk assessment.

## Credits

- Required attribution, verbatim: *© GeoBasis-DE / LVermGeoRP 2021–2026, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet]*
- *© European Union, Copernicus Emergency Management Service (EMSR517)*
- *© Deutscher Wetterdienst (DWD)*
- *© OpenStreetMap contributors (ODbL)*
- Flood hazard extents: HWRM-RL Hochwassergefahrenkarten (Rhineland-Palatinate); 3D buildings and elevation from opengeodata.NRW (dl-de/zero-2-0).
- Full detail: [NOTICE.md](../../industry/flood-insights/NOTICE.md).

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/industry/flood-insights
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/industry/flood-insights

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
