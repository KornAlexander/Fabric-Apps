# App Name

One line saying what this app does. English, no bilingual header, no marketing.

> **Work in progress.** — delete this line when the app is finished. While it is here the
> app ships in the repo but gets no gallery post and no announcement.

![App Name](../../docs/previews/app-slug.webp)

## What it does

- Three to five bullets, each a capability a user can see
- Not a feature list of the stack
- Say what is real data and what is generated

## Fabric architecture

![Architecture](docs/architecture_light.svg#gh-light-mode-only)
![Architecture](docs/architecture_dark.svg#gh-dark-mode-only)

Deploys into your workspace:

| Item | Why |
|---|---|
| Static web app | the front end |
| SQL database | typed app data |
| Lakehouse | file storage |
| Entra sign-in | Fabric-authenticated users |

## Getting started

```bash
npm install
npm run dev                 # http://localhost:5173
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

Any workspace or item id this app needs is read from the environment. There is no default:
a default that usually works is how a script writes to somebody else's workspace.

## Project structure

```
src/            the app
server/         backend functions, if any
fabric/         Fabric item definitions (report, semantic model, eventhouse)
rayfin/         deployment config - redirect URIs are loopback only
tools/          data pipeline and build helpers
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run test` | unit tests |
| `npm run lint` | lint |

## Data

Where it comes from, under which licence, and — if it is generated — say so plainly and
point at the badge in the UI that says so too.

Licence-prescribed attribution strings are legal text. Reproduce them verbatim; do not
re-word or re-wrap them.

## Credits

Upstream authors, third-party code and data licences.
