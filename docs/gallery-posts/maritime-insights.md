---
app: industry/maritime-insights
slug: maritime-insights
title: "Maritime Insights — the Kiel Fjord as an interactive 3D sea chart"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: false
assets:
  - docs/previews/maritime-insights.webp
  - industry/maritime-insights/media/maritime-insights-demo.gif
  - industry/maritime-insights/media/maritime-insights-demo.mp4
---

# Maritime Insights — the Kiel Fjord as an interactive 3D sea chart

Vessel traffic on a photoreal 3D chart of the Kiel Fjord, with a line-of-sight model that is honest about what a 25 m mast can and cannot see.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![maritime-insights demo](industry/maritime-insights/media/maritime-insights-demo.gif)

## What it does

- A recorded AIS day from the Danish Maritime Authority — 261 vessels
- Photoreal 3D terrain and bathymetry
- A radar line-of-sight grid that reports what it cannot resolve, not just what it can
- An assistant that answers questions about the scene in plain language

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Static web app

## Data

Danish Maritime Authority AIS, open data. The traffic shown is a recorded day, labelled as such in the app.

## Credits

- **Terrain, surface model, buildings and orthophotos**: Landesamt für Vermessung und Geoinformation Schleswig-Holstein (LVermGeo SH), CC BY 4.0. Required attribution, verbatim: *Datenquelle: Landesamt für Vermessung und Geoinformation Schleswig-Holstein (LVermGeo SH), CC BY 4.0 [Daten bearbeitet]*
- **Coarse terrain shell**: *© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.*
- *© OpenStreetMap-Mitwirkende, ODbL*
- **Vessel traffic**: Danish Maritime Authority AIS, open data.
- ⚠️ The German authority and product names are kept deliberately — they are the official names and what you must search for to find the same data. A translated name finds nothing.
- Full detail: [NOTICE.md](../../industry/maritime-insights/NOTICE.md).

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/industry/maritime-insights
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/industry/maritime-insights

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
