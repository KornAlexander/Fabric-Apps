# Airport IQ chat/voice backend (thin, Foundry-powered)

Self-contained backend for the embedded **Airport IQ** Fabric app. It hosts only
the services the app needs and is grounded in the airport operations snapshot
(the same `snapshot.json` the Live-Ops 3D view renders — gates, flights, delays,
cascading gate conflicts). Ported from `digital-twin-fabric-app/server`.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/assistant/stream` | Streaming chat (NDJSON token deltas) |
| `POST /api/assistant` | One-shot chat |
| `POST /api/realtime/session` | Realtime voice session plan |
| `POST /api/realtime/client-secret` | Ephemeral voice secret (browser WebRTC) |
| `POST /api/tools/:name` | Deterministic airport-ops tools |
| `GET /healthz` | Liveness + config summary |

## Grounded tools

All answers are grounded via deterministic tools over `data/<AP>/snapshot.json`
(vendored copies of `views/liveops/data/<AP>/snapshot.json`, DUS + BER):

- `get_ops_summary` — flight counts, delays, occupied gates, active conflicts, now
- `list_delayed_flights` — most-delayed flights with reason + minutes
- `get_gate_conflicts` — cascading gate conflicts with root cause + impacted flight
- `get_flight` — full detail for one flight number (gate, delay, status)
- `get_gate_status` — which flight occupies a gate now / at a time
- `list_flights` — filter by direction / status / carrier

The request `airport` field (or `?airport=`) selects DUS or BER; unsupported
codes fall back to `AIRPORT_IQ_DEFAULT_AIRPORT`.

## Run locally

```pwsh
cd apps/live-approach/server
npm install
Copy-Item .env.example .env   # points at the Foundry endpoint
npm start                      # listens on :8080 (uses az CLI token locally)
```

Chat + voice require Azure OpenAI in Foundry: set `AZURE_OPENAI_ENDPOINT` and an
auth source (`AZURE_OPENAI_USE_AZURE_CLI_TOKEN=true` locally, or managed identity
in Azure). Without it the endpoints return a clear `503`.

## Azure resource (deployed)

- **Foundry account:** `aif-airportiq-swc` (kind AIServices) in `rg-airportiq-swc`,
  Sweden Central. Endpoint `https://aif-airportiq-swc.cognitiveservices.azure.com/`.
- **Chat model:** `gpt-5.2` deployment (Responses API, reasoning effort `low`).
- **Voice model:** `gpt-realtime` deployment.

The backend runs as its own Azure Container App with a system-assigned managed
identity granted **Cognitive Services OpenAI User** on the account (no key in the
image). Set `CORS_ALLOW_ORIGINS` to the Fabric app hosting origin in production.

## Container image

```pwsh
docker build -t airport-iq-chat-backend .
docker run -p 8080:8080 --env-file .env airport-iq-chat-backend
```

## Frontend wiring

The frontend widget (`views/assistant/`) reads the backend base URL from
`window.AIRPORT_IQ_API_BASE` (set in `views/assistant/config.js`). Update that to
the deployed Container App URL and rebuild/redeploy the Rayfin app. Locally,
`?api=http://localhost:8080` overrides it (where the app doesn't rewrite the URL).
