---
app: games-and-learn/paragliding-insights
slug: paragliding-insights
title: "Paragliding Insights: the airspace over Oberstdorf in 3D"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/paragliding-insights.webp
  - docs/media/paragliding-insights-demo.gif
  - docs/media/paragliding-insights-demo.mp4
---

# Paragliding Insights: the airspace over Oberstdorf in 3D

9 by 8 km of the Allgäu Alps at true scale, from official 1 m terrain, with real flight tracks and live glider traffic drawn over it.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![paragliding-insights demo](docs/media/paragliding-insights-demo.gif)

## What it does

- Photoreal 3D terrain built from official 1 m elevation data
- Real IGC flight tracks, anonymised at import
- Live traffic from the Open Glider Network
- Notebooks and pipelines behind it, the Fabric App in front

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Static web app

## Data

Official Bavarian elevation data and the Open Glider Network. Demonstration and training only, not flight preparation.

## Credits

- **Terrain and buildings**: Bayerische Vermessungsverwaltung (LDBV), CC BY 4.0. Required attribution, verbatim: *Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de [Daten bearbeitet]*
- **Coarse terrain shell**: *© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014, 2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.*
- *© OpenStreetMap contributors (ODbL)*
- **Live glider traffic**: Open Glider Network (ODbL). ⚠️ Data older than 24 hours is not redistributed, and OGN privacy choices are honoured.
- Full detail: [NOTICE.md](../../games-and-learn/paragliding-insights/NOTICE.md).

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/games-and-learn/paragliding-insights
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/games-and-learn/paragliding-insights

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
