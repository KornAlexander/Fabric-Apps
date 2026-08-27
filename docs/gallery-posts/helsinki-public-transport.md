---
app: industry/helsinki-public-transport
slug: helsinki-public-transport
title: "Helsinki Public Transport: a live map on Real-Time Intelligence"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/helsinki-public-transport.webp
---

# Helsinki Public Transport: a live map on Real-Time Intelligence

Every tram, bus and metro in Helsinki, moving on a 3D map, fed by a Fabric Real-Time Intelligence stack: Eventstream into an Eventhouse, a semantic model over KQL, and the app querying it with the signed-in user's own identity.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![helsinki-public-transport demo](docs/media/helsinki-public-transport-demo.gif)

## What it does

- Live vehicle positions from the public HSL feed
- Eventstream → Eventhouse → semantic model, all inside Fabric
- End-user SSO on the Kusto datasource, so every user queries as themselves
- An hourly producer notebook that holds no secrets, it resolves the connection at run time

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app
- A semantic-model connector (queried as the signed-in user)

## Data

Helsinki Regional Transport Authority (HSL) high-frequency positioning feed, public.

## Credits

- **Kevin Thomas**: the original Helsinki real-time transit solution. This app is a rebuild of that idea, using the same Real-Time Intelligence architecture and the same Fabric portal host bridge for querying the semantic model.
- **Vehicle positions**: Helsingin seudun liikenne / Helsinki Region Transport (HSL), GTFS Realtime, CC BY 4.0. Required attribution, verbatim: *"Contains data from HSL, licensed under CC BY 4.0."*
- **3D city model, terrain and orthophoto**: Helsingin kaupunki / City of Helsinki, CC BY 4.0. Required attribution, verbatim: *"Imagery & 3D models (c) City of Helsinki (CC BY 4.0)."*, shown in the app whenever the 3D view is active.
- Nothing is redistributed here: every tile and every feed is streamed from the publisher at run time, with no API key and no copy stored in the repository.
- **CesiumJS** (Apache-2.0), used deliberately **without a Cesium ion account**, `Ion.defaultAccessToken` is left empty and every layer points at a City of Helsinki endpoint, so there is no commercial basemap dependency.
- Leaflet (BSD-2-Clause) · React, MSAL, Tailwind CSS, Vite (MIT).
- Full detail: [NOTICE.md](../../industry/helsinki-public-transport/NOTICE.md). Licence: MIT, Copyright (c) Microsoft Corporation.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/industry/helsinki-public-transport
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/industry/helsinki-public-transport

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
