# Contributing

These are Fabric Apps: full-stack apps that deploy into Microsoft Fabric with the Rayfin CLI.
Each folder under a category directory is a self-contained app with its own `package.json`.

## Layout

```
games-and-learn/    games and learning tools
fabric-admin/       apps for running Fabric itself
industry/           industry scenarios
industry/education/ education scenarios
docs/previews/      one 1280x800 WebP per app
docs/gallery-posts/ Fabric Apps Gallery drafts
docs/linkedin/      LinkedIn drafts
tools/              the checks CI runs
```

## Before you touch anything public

Run the gate:

```bash
python tools/verify_publishable.py
python tools/check_readme_sections.py
python tools/check_media_budget.py
```

### The gate is not a formality

It exists because the two most expensive mistakes in this repo are invisible to a
casual read:

1. **A tenant coordinate.** A workspace id or a `*.webapp.fabricapps.net` host points at
   a real place. Read these from the environment with **no default** - a default that
   usually works is how a script writes to somebody else's workspace.
2. **A relationship.** Withholding a customer's data is not the same as withholding the
   fact that they gave you any. "The university sent its export privately for an
   evaluation" leaks the engagement while leaking zero rows.

If the gate flags something you believe is fine, add a **one-line allowlist entry that
quotes the offending text**. If you cannot quote it, you have not read it, and the entry
is a decision not to look.

## English only

A public README opens in English and stays in English. Do not write a German line and
translate it underneath.

What legitimately stays German: proper nouns (preferring the English form where the app
itself uses one), and licence-prescribed attribution strings, which are legal text and
must appear verbatim. An app's own UI may be German-first; the README describes it in
English.

## Media budget

Demo video and GIFs belong in the repo - they are most of what makes an app folder
readable. They are also permanent.

| Rule | Limit |
|---|---|
| One media file | 25 MB |
| All media in one app | 50 MB |
| Times a media file may be replaced | once |

**The cap is not the real constraint; `commit media once` is.** Binaries are immortal in
git: re-recording a demo five times at 25 MB leaves 125 MB in the pack forever, even
after you delete the file. Iterate renders in a scratch folder outside the repo and
commit only the final. The generous cap is granted on that condition.

If a file is over the limit it is almost always under-compressed rather than too long.

## App README

Ten sections, in this order, enforced by `tools/check_readme_sections.py`:

1. `# App Name` and a one-line pitch
2. `> **Work in progress.**` if it applies
3. Preview image or demo GIF
4. `## What it does`
5. `## Fabric architecture`
6. `## Getting started`
7. `## Project structure`
8. `## Scripts`
9. `## Data` - source, licence, and an explicit synthetic badge where the data is generated
10. `## Credits` - upstream authors and third-party licences, verbatim

## Customer work lives elsewhere

Anything that came out of a customer engagement belongs in the private companion repo,
not here. That boundary is the reason this one can stay open.
