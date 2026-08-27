// Thin, self-contained backend for the embedded Airport IQ Fabric app.
//
// Hosts exactly the services the app needs and nothing else:
//   POST /api/assistant/stream      -> streaming chat (NDJSON token deltas)
//   POST /api/assistant             -> one-shot chat
//   POST /api/realtime/session      -> realtime voice session plan
//   POST /api/realtime/client-secret-> ephemeral voice secret (browser WebRTC)
//   POST /api/tools/:name           -> deterministic airport-ops tools
//   GET  /healthz                   -> liveness + config summary
//
// All answers are grounded in the vendored ops snapshot (data/<AP>/snapshot.json),
// the same file the Live-Ops 3D view renders. Runs as its own Azure Container App.
// Ported from digital-twin-fabric-app/server.

import cors from "cors";
import express from "express";

import { config, foundryIsConfigured, supportedAirports } from "./lib/runtime.mjs";
import { send } from "./lib/httpHelpers.mjs";
import { assistantRouter } from "./routes/assistant.mjs";
import { realtimeRouter } from "./routes/realtime.mjs";
import { toolsRouter } from "./routes/tools.mjs";

const app = express();
app.disable("x-powered-by");

// Cross-origin access for the Fabric app origin. No credentials are ever sent
// (the browser calls these public prefixes without cookies), so a permissive
// default is safe; lock it down via CORS_ALLOW_ORIGINS in production.
const allowList = config.corsAllowOrigins.split(",").map((v) => v.trim()).filter(Boolean);
const allowAll = allowList.includes("*");
app.use(
  cors({
    origin: allowAll ? true : allowList,
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-app-key"]
  })
);

app.use(express.json({ limit: "1mb" }));

// Optional shared-key gate. When BACKEND_APP_KEY is set, every /api/* request
// must present a matching `x-app-key` header. Combined with the locked CORS
// allow-list this blocks drive-by abuse of the Foundry-backed endpoints.
if (config.appKey) {
  app.use("/api", (req, res, next) => {
    if (req.method === "OPTIONS") return next();
    if (req.get("x-app-key") === config.appKey) return next();
    return send(res, 401, { error: "unauthorized", message: "Missing or invalid app key." });
  });
}

app.get("/healthz", (_req, res) => {
  send(res, 200, {
    status: "ok",
    scenario: "airport-iq",
    foundryConfigured: foundryIsConfigured(config),
    chatDeployment: config.foundry.chatDeployment,
    realtimeDeployment: config.foundry.deployment,
    defaultAirport: config.defaultAirport,
    supportedAirports: supportedAirports()
  });
});

app.use(toolsRouter());
app.use(realtimeRouter());
app.use(assistantRouter());

app.use((_req, res) => send(res, 404, { error: "not_found", message: "No such endpoint." }));

app.use((err, req, res, _next) => {
  const status = err?.details?.status && Number.isInteger(err.details.status) ? err.details.status : 500;
  console.error(
    `[error] ${req.method} ${req.originalUrl} -> ${status}:`,
    err instanceof Error ? err.message : err,
    err?.details ? JSON.stringify(err.details).slice(0, 600) : ""
  );
  send(res, status >= 400 && status < 600 ? status : 500, {
    error: "server_error",
    message: err instanceof Error ? err.message : "Unknown error.",
    details: err?.details ?? undefined
  });
});

app.listen(config.port, () => {
  console.log(
    `[airport-iq backend] listening on :${config.port} ` +
      `(foundry=${foundryIsConfigured(config)}, chat=${config.foundry.chatDeployment}, ` +
      `realtime=${config.foundry.deployment}, airports=${supportedAirports().join("/")})`
  );
});
