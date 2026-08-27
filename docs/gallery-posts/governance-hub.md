---
app: fabric-admin/governance-hub
slug: governance-hub
title: "Governance Hub — who may create what, where, and why"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/governance-hub.webp
---

# Governance Hub — who may create what, where, and why

Tenant settings, capacity posture and access rules collected on a schedule and put in one place, so the answer to a governance question is a page rather than an archaeology project.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![governance-hub demo](docs/media/governance-hub-demo.gif)

## What it does

- Tenant settings and their propagation delay, collected on a schedule
- Capacity and workspace posture in one view
- Power Platform environment coverage alongside Fabric
- Collector notebooks that hold no secrets

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app

## Data

Your own tenant, read with your own identity. Nothing is bundled.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/fabric-admin/governance-hub
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/fabric-admin/governance-hub

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
