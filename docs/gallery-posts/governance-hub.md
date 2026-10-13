---
app: fabric-admin/governance-hub
slug: governance-hub
title: "Fabric User Manager: access to Fabric without a ticket"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/governance-hub.webp
  - docs/media/governance-hub-demo.gif
  - docs/media/governance-hub-demo.mp4
---

<!-- Rewritten on 2026-10-13 as Fabric User Manager, on Alexander's decision; the hold of
     2026-08-28 is lifted with it. The earlier text described the admin collector of the
     Governance Hub. That part still exists in the repository as the "full" profile and is
     mentioned at the end. Slug and folder stay `governance-hub`.

     To stage it: python tools/build_submissions.py governance-hub  -> submissions/governance-hub/ -->

# Fabric User Manager: access to Fabric without a ticket

Owners manage who is in their groups, colleagues ask for access with a reason, and the house rules for Power BI live in the same app. It runs as whoever is signed in: nobody can do more here than they already could in Entra and Fabric.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![governance-hub demo](docs/media/governance-hub-demo.gif)

## Why

Access in Fabric comes in three parts: workspace roles (who may build), app audiences (who may read) and row or object level security (who sees which data). In all three the clean way is the same: the access goes to a group, and people go into the group. So access management is group management, and the person who knows who belongs in a group is its owner, not the administrator.

## What it does

- **Three tabs for the three parts**: Workspaces, Audiences, RLS / OLS. Each shows the groups you manage and the groups that are open for requests
- **Owners add and remove members** of their own groups, with a check that says what the person will get before anything happens
- **Requests and approvals**: ask for a group with a reason, the owner approves, and it is on record who decided and when
- **Power BI Guidelines** as a fourth tab: three areas, 19 topics, 169 rules and 26 drawings, in English and German. A request states that the guidelines were read
- **A questionnaire tailors the guidelines**: an app admin answers up to fifty optional questions and the answers are filled into the text for everyone
- **Read-only until an admin switches changes on**: three separate switches for member changes, role bindings and creating groups

## What it deploys into your workspace

- Entra sign-in (Fabric identity), plus one app registration of your own for Microsoft Graph
- Fabric SQL database for the app's own records
- Static web app

## Data

Your own tenant, read with your own identity. The app has no service account and no backend that holds rights. Nothing is bundled. An offline demo with made-up people and groups is included, so you can walk through the whole story without a tenant.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/fabric-admin/governance-hub
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

Before the first sign-in it needs an app registration and an administrator's consent. The setup guide in the repository walks through both.

**Three-minute video:** https://youtu.be/1NQXngCOqIw

**The longer story:** https://actionablereporting.com/2026/10/13/fabric-user-manager-access-to-fabric-without-a-ticket/

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/fabric-admin/governance-hub

**How it is built:** https://kornalexander.github.io/Fabric-Apps/apps/governance-hub/

The folder is called governance-hub because the app started as the simple profile of a larger Governance Hub, which also collects tenant settings and capacity posture.

It is part of an open-source gallery of Fabric Apps: 3D twins, live maps, admin tools and a few games. https://kornalexander.github.io/Fabric-Apps/

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
