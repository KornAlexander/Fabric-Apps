---
app: games-and-learn/fabric-empires
slug: fabric-empires
title: "Fabric Empires: a 4X strategy game whose tech tree is a certification syllabus"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/fabric-empires.webp
  - docs/media/fabric-empires-demo.gif
  - docs/media/fabric-empires-demo.mp4
---

# Fabric Empires: a 4X strategy game whose tech tree is a certification syllabus

Explore a procedurally generated hex map, found cities, work tiles for four resources, research a technology tree and fight rivals over it. The one thing it does differently: the technology tree is the published skills outline of a real exam, and researching a node means answering a real question about it. Get it right and your army is stronger this turn. Get it wrong, you lose the battle, and the game tells you what you did not know.

<!-- Attach the demo video or GIF here. A screenshot is the minimum; the video is what
     makes someone open the post rather than scroll past it. -->
![fabric-empires demo](docs/media/fabric-empires-demo.gif)

## What it does

- [Playable in the browser right now](https://kornalexander.github.io/fabric-empires/): no install, no sign-in, works on a phone
- A full 4X loop: explore, expand, exploit, exterminate, on a procedural hex map
- **The tech tree is the syllabus.** Research a node, answer a question about it
- Bring your own subject: the question set is data, not code
- **Still being built.** It is public while it is being written, not after

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Fabric SQL database
- App backend, the data API the game writes through
- Direct Lake semantic model over that database
- Power BI report on top of it
- Static web app

## Data

The exam skills outlines are public.

The two builds differ, and the difference matters. The **public playable build** has no
backend and nobody signed in, so nothing leaves your browser. The **workspace deployment**
does record play: a row per finished game and a row per question attempt, including whether
the answer was correct, written to the Fabric SQL database it provisions. That is what feeds
the Power BI report, and it is your own workspace, but it is stored rather than discarded.

## Try it

```bash
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/games-and-learn/fabric-empires
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/games-and-learn/fabric-empires

**How it is built:** https://kornalexander.github.io/Fabric-Apps/apps/fabric-empires/

It is part of an open-source gallery of Fabric Apps: 3D twins, live maps, admin tools and a few games. https://kornalexander.github.io/Fabric-Apps/

---

<!-- Before submitting:
     1. assetsReady must be true.
     2. Run `python tools/verify_publishable.py` - it scans this file too.
     3. Paste into community.fabric.microsoft.com -> Fabric Apps Gallery -> Submit to gallery.
     4. Put the resulting URL into galleryUrl above, then update the LinkedIn draft. -->
