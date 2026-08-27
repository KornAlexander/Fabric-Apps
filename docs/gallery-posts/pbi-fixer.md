---
app: fabric-admin/pbi-fixer
slug: pbi-fixer
title: "Power BI Fixer: a whole Power BI toolbench, running inside Fabric"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/pbi-fixer.webp
  - docs/media/pbi-fixer-demo.gif
  - docs/media/pbi-fixer-demo.mp4
---

# Power BI Fixer: a whole Power BI toolbench, running inside Fabric

Model explorer, report explorer, Best Practice Analyzer with one-click fixes, memory analysis, AI-assisted translations, PBIR prototyping and workspace automation. All of it in the browser, signed in with your Fabric identity. No Power BI Desktop, no Tabular Editor install, nothing to download.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![pbi-fixer demo](docs/media/pbi-fixer-demo.gif)

## What it does

- **Model**: explorer with inline TMDL, Model Diagram, Perspectives, Measure Editor with a DAX formatter, Model Documentation, Metric View migration
- **Best Practice Analyzer** on models and reports, with one-click fixes and a diff preview before anything is written back
- **Memory Analyzer**: column and table size, cardinality, and what is actually costing you
- **Reports**: PBIR tree, source and diff view, a pop-out editor, and reverse / forward prototyping to scaffold and round-trip a layout
- **Translations**: AI-assisted culture translations through GitHub Copilot
- **Cleanup**: unused objects, display folders, descriptions, field parameters, and batch fixers across several models at once
- **Ops**: SemPy runner, workspace editor, Jumpstart catalogue and one-click Workspace Monitoring deployment

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Static web app

## Data

Reads whichever model and report you point it at. The SPA never calls Fabric REST directly: every call goes through a Python User Data Function that holds the on-behalf-of token server-side, which keeps tokens out of the browser.

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
