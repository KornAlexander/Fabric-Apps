---
app: fabric-admin/data-catalog
slug: data-catalog
title: "Data Catalog — everything in your tenant, browsable"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/data-catalog.webp
---

# Data Catalog — everything in your tenant, browsable

A catalogue of every item in your Fabric tenant with lineage and ownership, scanned into a Lakehouse and served as an app.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![data-catalog demo](docs/media/data-catalog-demo.gif)

## What it does

- Every workspace and item, scanned on a schedule
- Lineage and ownership per item
- Search across the whole tenant
- Runs entirely inside your own tenant

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app

## Data

Your own tenant, via the Fabric scanner API. Nothing is bundled.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/fabric-admin/data-catalog
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/fabric-admin/data-catalog

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
