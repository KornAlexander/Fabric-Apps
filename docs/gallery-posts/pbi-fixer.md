---
app: fabric-admin/pbi-fixer
slug: pbi-fixer
title: "Power BI Fixer — inspect and repair a semantic model in the browser"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: false
assets:
  - docs/previews/pbi-fixer.webp
  - fabric-admin/pbi-fixer/media/pbi-fixer-demo.gif
  - fabric-admin/pbi-fixer/media/pbi-fixer-demo.mp4
---

# Power BI Fixer — inspect and repair a semantic model in the browser

A Fabric-authenticated app that reads a semantic model and report straight out of Fabric, runs Best Practice Analyzer rules against them, and applies the fixes. No Power BI Desktop, no Tabular Editor install, nothing to download.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![pbi-fixer demo](fabric-admin/pbi-fixer/media/pbi-fixer-demo.gif)

## What it does

- Model Explorer — tables, columns, measures and relationships, with an inline TMDL view
- Best Practice Analyzer with one-click fixes for the common findings
- Memory Analyzer — column and table size, cardinality, and what is costing you
- Measure Editor with a built-in DAX formatter
- Unused-object cleanup, display folders, descriptions and field parameters

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Static web app

## Data

Reads whichever model and report you point it at, through a server-side Fabric User Data Function proxy.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/fabric-admin/pbi-fixer
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/fabric-admin/pbi-fixer

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
