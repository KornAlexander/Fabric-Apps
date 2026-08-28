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
![helsinki-public-transport](docs/previews/helsinki-public-transport.webp)

## What it does

- Live vehicle positions from the public HSL feed
- Eventstream → Eventhouse → semantic model, all inside Fabric
- End-user SSO on the Kusto datasource, so every user queries as themselves
- A 3D city view on the City of Helsinki's textured LoD2 buildings, with a free-flight camera
- An hourly producer notebook that holds no secrets, it resolves the connection at run time

## What I changed, and how this differs from the original

This is a **rebuild of Kevin Thomas's Helsinki real-time transit solution**, not a fork of it.
The idea, the Real-Time Intelligence architecture and the Fabric portal host bridge are his.
So is the vehicle detail panel's layout and focus behaviour, and the per-vehicle operator
notes: I adopted both from his app rather than inventing worse versions.

What is different here:

- **A 3D city twin that needs no keys.** The live fleet on the City of Helsinki's own
  textured LoD2 buildings, with `Ion.defaultAccessToken` left empty and every layer pointed
  at a City of Helsinki endpoint. No Cesium ion account, no Google Maps key. Vehicles are
  clamped to the same terrain the buildings sit on, so at street level they stay on top of
  the roads rather than sinking through them.
- **It also runs outside the portal.** The host bridge is the best path when the app is
  embedded, because the portal runs the query as the signed-in user and nothing asks for a
  second sign-in. But there is no host outside the portal, so DAX now goes through a chain of
  three transports: the host bridge first, then the Rayfin `fabric-semanticmodel` connector,
  then a delegated Power BI token acquired with MSAL calling `executeQueries` directly. The
  middle one is currently an unreleased API that answers *"ConnectorFunction invocation is not
  enabled for this workspace"*, which is exactly why there is a third.
- **A speed-over-time chart** with hover in the vehicle detail panel.
- **Comparing several vehicles at once**, rather than one selection at a time.
- **A scripted, idempotent backend deploy kit**, so the Eventhouse side can be stood up again
  without clicking through it.

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app
- A semantic-model connector (queried as the signed-in user)

## Data

Helsinki Regional Transport Authority (HSL) high-frequency positioning feed, public.

## Credits

- **Kevin Thomas**: the original Helsinki real-time transit solution. This app is a rebuild of that idea, using the same Real-Time Intelligence architecture and the same Fabric portal host bridge for querying the semantic model. The vehicle panel layout and the per-vehicle operator notes are adopted from his app too. What I changed is described above.
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

**How it is built:** https://kornalexander.github.io/Fabric-Apps/apps/helsinki-public-transport/

It is part of an open-source gallery of Fabric Apps: 3D twins, live maps, admin tools and a few games. https://kornalexander.github.io/Fabric-Apps/

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
