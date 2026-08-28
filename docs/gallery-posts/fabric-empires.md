---
app: games-and-learn/fabric-empires
slug: fabric-empires
title: "Fabric Empires: a strategy game you win by knowing Microsoft Fabric"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/fabric-empires.webp
  - docs/media/fabric-empires-demo.gif
  - docs/media/fabric-empires-demo.mp4
---

# Fabric Empires: a strategy game you win by knowing Microsoft Fabric

Certification study has a shape, and the shape is bad. You read an outline, you do
some practice questions, you forget most of it, and a week before the exam you start
again from the top. The material is not hard. Nothing gives you a reason to come back
tomorrow.

So I built one. Fabric Empires is a turn-based 4X strategy game, and the thing it does
differently is that **combat is a question**. A real DP-600 question, on a clock, in
the middle of a fight you started. Answer it well and your army is stronger this turn.
Answer it badly, lose ground, and the game tells you what you did not know.

![fabric-empires demo](docs/media/fabric-empires-demo.gif)

**[Play it in your browser](https://kornalexander.github.io/fabric-empires/)** No
install, no sign-in, runs on a phone.

## Watch it

- The trailer: https://youtu.be/Yi4TUopwTDc
- The opening, rendered entirely in-engine: https://youtu.be/RDww5kNpgeo

The second one is worth a word. The trailer is a mood piece and its scenery is
generated, which the credits say. The opening is the opposite: every frame is the
running app. The terrain is generated at load time, the rivers really did find their
way downhill, and the city being founded is a real city on a real map.

## What it does

- Explore, expand, exploit and exterminate on a procedurally generated 3D map
- **The technology tree is the published DP-600 skills outline.** Forty-one skills
  across three domains, arranged as a tree, because an outline already is one: a list
  of things that unlock other things
- Seven rival factions, each holding a different branch, so who is marching on you
  tells you what you are about to be tested on
- It is not only combat. Founding a city asks, research asks, a council review asks
- **Two players at two different levels, on one keyboard.** The adult answers with
  1 2 3 4, a child answers their own far easier bank with a b c d, and the battle
  result is the average of both, so a six-year-old genuinely rescues a fight you fumbled
- **Bring your own subject.** Hand it an `.xlsx` or `.csv` of your own questions and
  it builds a different tree: another certification, a school curriculum, onboarding
- **Improving the game whenever I have time.** It is public while it is being written

## Why a game rather than a quiz app

Underneath the empire is an SM-2 spaced-repetition scheduler: every answer updates an
easiness factor, a repetition count and an interval, so topics come back when they are
due. That part is not novel, Anki has done it for twenty years and it works.

What does not work is remembering to open Anki. You come back tomorrow because your
empire is mid-war, and the scheduler gets its retrieval practice as a side effect. The
review is not the reason you opened the tab, which is exactly why it happens.

## What it deploys into your workspace

- Entra sign-in (Fabric identity)
- Static web app

The copy I run for myself adds a Fabric SQL database and a Direct Lake report over it,
which answers a question a quiz app cannot: not which topics you get wrong, but where
you get them wrong. The same question under siege with a clock running scores far worse
than during calm research, and "does not know it" and "cannot recall it under pressure"
need completely different remedies. This gallery copy ships without the data service.

## Data

The exam skills outlines are public. This copy deploys without a data service, so no
score and no attempt is stored anywhere: nothing you do leaves your browser.

Every question in the shipped bank is original, written from the publicly published
skills outline and public documentation. No exam content is reproduced. It is a
personal project, not a Microsoft product, and not affiliated with or endorsed by
Microsoft.

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
