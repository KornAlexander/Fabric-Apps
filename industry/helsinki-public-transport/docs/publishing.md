# Publishing this app to awesome-rayfin

This repository is laid out as an **awesome-rayfin template** so that contributing it to the
public gallery is a copy, not a rewrite. It is **not published today** - it lives in the
Microsoft EMU enterprise with `internal` visibility. This document is the checklist that
would have to be completed first.

## What already matches the gallery contract

| Requirement | Where |
| --- | --- |
| `template.name` / `displayName` / `description` / `category` | [`package.json`](../package.json) |
| Capability manifest | [`manifest.json`](../manifest.json) |
| Leaf manifest | [`rayfin-template.yml`](../rayfin-template.yml) |
| Rayfin service config | [`rayfin/rayfin.yml`](../rayfin/rayfin.yml) |
| README with Getting started / Project structure / Scripts | [`README.md`](../README.md) |
| Preview image, 1280x800 | [`previews/hsl-realtime-insights.webp`](previews/hsl-realtime-insights.webp) |
| Attribution for third-party data | [`NOTICE.md`](../NOTICE.md) |
| `npm run lint` / `build` / `test` all green | see [Scripts](../README.md#scripts) |
| Files that must not ship | [`.templateignore`](../.templateignore) |

The template directory name in the gallery would be `templates/hsl-realtime-insights/`, and
the preview would move to the gallery's own `docs/previews/hsl-realtime-insights.webp`.

## What has to change first

Run the audit and work the list it prints:

```powershell
python tools/verify_publishable.py --verbose
```

### 1. Tenant identifiers

The standalone sign-in path falls back to hard-coded demo defaults so the app works without
any local configuration. Those defaults name a specific tenant, app registration and
semantic model:

- `src/services/powerBiDirect.ts` - `VITE_PBI_CLIENT_ID`, `VITE_PBI_TENANT_ID`,
  `VITE_PBI_DATASET_ID` fallbacks
- `src/services/daxGateway.ts` - the default dataset id
- `rayfin/rayfin.yml` - `connectors.hslModel.config.workspaceId` / `itemId`, and the deployed
  Fabric App origin in `allowedRedirectUris`

Replace each with a placeholder, keep [`.env.example`](../.env.example) as the reference, and
reduce `allowedRedirectUris` to `http://localhost:5173` the way the other gallery templates
do. Anyone scaffolding the template supplies their own values.

### 2. The `fabric/` folder

`fabric/` holds the definitions of the back end - Eventhouse KQL schema, Eventstream, ingestion
notebook, and the DirectQuery semantic model as TMDL - together with `fabric/deploy/`, which
provisions them into any workspace.

The definitions still carry the identifiers of the workspace they were last deployed to (the
Kusto cluster and database in the TMDL, the eventstream ids in the notebook). That is not a
blocker: every one of them is rewritten by the deploy scripts at provisioning time, and the
eventstream definition is already a pure placeholder template. Decide whether you want to leave
them as working defaults or blank them; either way the folder should ship, because without the
Eventhouse the app has nothing to query.

### 3. Data licensing

Already handled in [`NOTICE.md`](../NOTICE.md): the HSL GTFS-RT feed and the City of Helsinki
3D data are both CC BY 4.0, both are fetched live from the publisher, and neither is
redistributed here. The 3D view shows the required attribution on screen. Re-check that this
is still true if new sources are added.

### 4. Gallery mechanics

1. Fork `awesome-rayfin`, copy this repository into `templates/hsl-realtime-insights/`
   (minus `.git`, and honouring `.templateignore`).
2. Move the preview to `docs/previews/hsl-realtime-insights.webp` in the gallery.
3. Run `node scripts/generate-manifest.mjs` at the gallery root - the root
   `rayfin-template.yml` is generated, never hand-edited. CI enforces this with `--check`.
4. Open the PR with a conventional title, e.g.
   `feat(hsl-realtime-insights): add Helsinki real-time transport template`.
5. CI will lint, build, test and scaffold the template with
   `rayfin init -t . --template-name "hsl-realtime-insights"`.
