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
- Three ways to draw the world: Google Photorealistic 3D Tiles via Cesium ion, NSW Government aerial photography, or plain OpenStreetMap
- A free-flight drone camera over the harbour
- Click a ferry for a full-screen voxel twin with decks
- Pre-departure operator checklists in Fabric SQL

## What I added, and how this differs from the original

Harbour Pulse is Fran Genoa's, and it is a lovely piece of work: the design, the voxel
vessel twins and the Real-Time Intelligence architecture are all his. I forked it because
I liked it enough to want to fly around inside it, and added two things, both of which are
in this copy.

**A drone camera.** The three.js free-flight control model used across the other twins
in this gallery, rewritten against the Cesium camera API rather than copied. It latches
rather than toggles: press W A S D Q E to fly and it hands the camera back after about a
second of idle, so there is no mode button to find. Speed scales with height above
ground, and a heads-up display shows altitude, height above ground, speed and heading.
The fiddly part was a zenith guard: Cesium has no `maxPolarAngle`, so a long drag sails
over the top and leaves the camera silently inverted. A pre-render guard holds the last
legal pose.

**It works without an API key.** Originally the photoreal view needed a Cesium ion token,
and without one you landed on a flat OSM photograph. Sydney publishes no open
photogrammetric mesh, so instead of a mesh the keyless modes get a world baked at build
time: a terrain height grid from AWS Open Data Terrain Tiles behind a custom terrain
provider, **12,529 OpenStreetMap building footprints** with roof colour measured from the
NSW aerial imagery, and **8,795 real mapped street trees** seated on that terrain. It now
defaults to ion when a token exists and to the NSW imagery when it does not.

Two details that took the longest and are invisible when right. Heights are stored above
sea level and offset by the local geoid, roughly 23 m, which is what keeps the ferries
floating on the water rather than 23 m under it. And the buildings and trees render as
batched primitives rather than one entity each, which is fine at 1,700 and hopeless at
12,500.

Nothing is fetched from a third party at run time any more. The Overpass API had failed
this app four separate times, twice mid-demo, each time leaving the city as a flat
photograph, so the runtime lookup is gone and the data is committed to the repository.

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app

## Data

Transport for NSW open real-time feed.

## Credits

- **Harbour Pulse is Fran Genoa's project.** The upstream repository is [FranGenoa/fabric-harbour-pulse](https://github.com/FranGenoa/fabric-harbour-pulse) and the design, the voxel vessel twins and the Real-Time Intelligence architecture are his work. This entry exists with his name on it, not instead of it. What I added on top is described above.
- **Ferry photographs** come from Wikimedia Commons and remain under their original licences. Every image is credited individually, author, licence and source page, in [ATTRIBUTION.md](../../industry/harbour-pulse/ATTRIBUTION.md), because those licences require it.
- **Live vessel positions**: Transport for NSW open real-time feed.
- **Base map**: Google Photorealistic 3D Tiles and Cesium OSM Buildings.
- **Keyless modes**: NSW Government aerial photography (CC BY), terrain from AWS Open Data Terrain Tiles, buildings and trees from OpenStreetMap (ODbL). Attribution for these is always visible in the app.
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
