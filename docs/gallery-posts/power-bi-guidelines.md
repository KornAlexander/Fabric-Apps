---
app: fabric-admin/power-bi-guidelines
slug: power-bi-guidelines
title: "Power BI Guidelines: one reference, tailored to your team"
galleryUrl: https://community.fabric.microsoft.com/discussions/pbi_fabricappsgallery/power-bi-guidelines-one-reference-tailored-to-your-team/5377650
status: published
assetsReady: true
assets:
  - docs/previews/power-bi-guidelines.webp
  - docs/media/power-bi-guidelines-demo.gif
---

<!-- Demo recorded on 2026-10-27 from the deployed app. Published to the gallery on 2026-10-27.
     To stage it: python tools/build_submissions.py power-bi-guidelines  -> submissions/power-bi-guidelines/ -->

# Power BI Guidelines: one reference, tailored to your team

Every Power BI team has its rules for models and reports. Most of them live in a wiki page nobody opens. This app puts them where people build: a guide for data integration, data modeling and data visualization, with your team's own conventions filled into the text.

![power-bi-guidelines demo](docs/media/power-bi-guidelines-demo.gif)

## What it does

- 169 rules in 19 topics, the most important rule first, with drawings that show the good and the bad version side by side
- Fifty optional questions record your team's conventions; the answers appear in the rules, marked as yours
- Answers stay in the browser and travel as a file: export once, import everywhere
- A plain HTML version of the whole guide: one file, no script, opens offline and prints
- English and German

## What it deploys into your workspace

One static web app. No database, no lakehouse, no functions, no sign-in inside the app. Nothing a person types leaves their browser unless they export it.

## Get it

Source and setup: https://github.com/KornAlexander/Fabric-Apps/tree/main/fabric-admin/power-bi-guidelines
