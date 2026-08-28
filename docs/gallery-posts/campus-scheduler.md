---
app: industry/education/campus-twin
slug: campus-scheduler
title: "Campus Twin: a timetable planner's cockpit on a photoreal 3D campus"
galleryUrl:            # filled in by Phase 5a once the post is live
status: draft
assetsReady: true
assets:
  - docs/previews/campus-scheduler.webp
---

# Campus Twin: a timetable planner's cockpit on a photoreal 3D campus

Every teaching session placed in a real room, in a photoreal 3D model of the campus built from official state survey data, so an over-full lecture hall is something you can see rather than infer from a table.

![campus-scheduler demo](docs/previews/campus-scheduler.webp)

## What it does

- **The campus is not a picture of a campus.** 1 m state terrain under a 20 cm orthophoto, LoD2 buildings that open into their own floors, and real trees, at true scale
- **Eleven sites in one build**, from Bavaria to North Rhine-Westphalia and Baden-Wuerttemberg, each through its own state survey portal but the same pipeline
- **Conflict detection on hard constraints**: a room too small for its cohort, a lecturer in two places, a walk between consecutive sessions nobody can make
- **Cascade what-if**: move a session and watch what else moves, before committing anything
- **A CP-SAT solver** (OR-Tools) proposing the smallest set of moves that repairs the week, rather than a rebuilt timetable nobody recognises
- **An assistant** that answers in the planner's language and hands back a proposal you confirm, never an action it took on its own
- Lenses for **occupancy, staffing and quality**, each answering a different person's question

## What it deploys into your workspace

- An **Entra app registration** for sign-in
- A **Fabric SQL database** holding the plan: proposals, confirmations and per-lecturer availability
- A **static web app** for the client

## The data, and what is deliberately not here

Terrain, orthophotos, LoD2 buildings and trees come from the German state survey authorities as open data: **LDBV Bavaria**, **LGL Baden-Wuerttemberg** and **Geobasis NRW**, all CC BY 4.0. Building footprints and room geometry come from **OpenStreetMap** under ODbL, and elevation from **Copernicus WorldDEM-30**. The exact attribution each licence requires is reproduced verbatim in NOTICE.md.

**No university's own timetable export is included, and that is enforced rather than promised.** `config/release.json` is a single switch read by both the app and the Python pipeline, so a site cannot be withheld from one and survive in the other. In this repository it stands at `realCustomerData: exclude` and `navigatumData: synthetic`, which means every timetable you see is generated from an academic profile and reproducible from configuration. Two checks fail the build if that stops being true: `npm run check:release` and `python tools/verify_publishable.py`.

The lecturers are invented too, from a per-site pool of ordinary regional surnames, because a demo dataset must never read as a roster of real staff.

## Credits

The survey authorities prescribe the wording of their attribution, so it is reproduced exactly as they require, not paraphrased:

> Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de [Daten bearbeitet]

> Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0

> Datenquelle: Land NRW (Geobasis NRW), dl-de/zero-2-0

> Datenquelle: Geoportal Berlin, Land Berlin, dl-de/zero-2-0

Bavaria under CC BY 4.0; Baden-Wuerttemberg under Datenlizenz Deutschland Namensnennung 2.0; North Rhine-Westphalia and Berlin under Datenlizenz Deutschland Zero 2.0. The horizon shell at every site is Copernicus DEM GLO-30 under the Copernicus free licence. Building footprints and room geometry are OpenStreetMap contributors, ODbL. Full per-site detail is in NOTICE.md.

Everything else here is mine. It is a personal project, not a Microsoft product, and not affiliated with or endorsed by Microsoft.

## Try it

```
git clone https://github.com/KornAlexander/Fabric-Apps.git
cd Fabric-Apps/industry/education/campus-twin
npm install
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

**Source, and always the latest version:** https://github.com/KornAlexander/Fabric-Apps/tree/main/industry/education/campus-twin

**How it is built:** https://kornalexander.github.io/Fabric-Apps/apps/campus-scheduler/

It is part of an open-source gallery of Fabric Apps: 3D twins, live maps, admin tools and a few games. https://kornalexander.github.io/Fabric-Apps/
