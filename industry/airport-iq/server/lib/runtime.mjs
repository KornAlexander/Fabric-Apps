// Module-level singletons + per-request helpers for the Airport IQ backend.

import { config, foundryIsConfigured } from "../config.mjs";
import { FoundryClient } from "./foundryClient.mjs";
import { buildToolDefinitions, executeTool } from "./tools.mjs";
import { loadSnapshot, resolveAirport, supportedAirports } from "./snapshot.mjs";
import { buildRealtimeInstructions } from "./instructions.mjs";
import { resolveRealtimeCallsUrl } from "./foundryEndpoints.mjs";
import { hasManagedIdentity } from "./identity.mjs";

export { config, foundryIsConfigured, buildToolDefinitions, supportedAirports };

export const foundryClient = new FoundryClient(config.foundry);

/** Resolve the airport + display name for a request (body or ?airport=). */
export function requestContext(req, body = {}) {
  const raw = body.airport ?? req.query?.airport ?? config.defaultAirport;
  const airport = resolveAirport(raw, config.defaultAirport);
  const snap = loadSnapshot(airport);
  return { airport, airportName: snap?.meta?.name ?? airport };
}

/** Bind executeTool to a specific airport context (for chat + voice). */
export function makeToolExecutor({ airport }) {
  return (toolName, args) => executeTool(toolName, args, { airport, defaultAirport: config.defaultAirport });
}

export function realtimeOverrides(body = {}) {
  const overrides = {};
  const voice = String(body.voice ?? "").trim();
  if (voice) {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(voice)) {
      throw new Error("Realtime voice must be 1-40 letters, numbers, hyphens, or underscores.");
    }
    overrides.voice = voice;
  }
  const speakingRate = String(body.speakingRate ?? "").trim();
  if (speakingRate) {
    if (speakingRate.length > 180) throw new Error("Realtime speaking rate must be 180 characters or less.");
    overrides.speakingRate = speakingRate;
  }
  return overrides;
}

/** The realtime voice session plan the browser uses to open a WebRTC call. */
export function createRealtimeSessionPlan(context, overrides = {}) {
  const f = config.foundry;
  const configured = Boolean(f.endpoint && (f.apiKey || f.accessToken || f.useAzureCliToken || hasManagedIdentity()));
  const speakingRate = overrides.speakingRate ?? f.speakingRate;
  return {
    mode: configured ? "azure-openai-realtime-configured" : "not-configured",
    model: f.deployment,
    deployment: f.deployment,
    endpoint: f.endpoint ? f.endpoint.replace(/\/$/, "") : "",
    realtimeEndpoint: f.realtimeEndpoint ? f.realtimeEndpoint.replace(/\/$/, "") : "",
    realtimeCallsUrl: f.endpoint ? resolveRealtimeCallsUrl(f) : "",
    voice: overrides.voice ?? f.voice,
    speakingRate,
    configured,
    instructions: buildRealtimeInstructions({ ...context, speakingRate }),
    tools: buildToolDefinitions(),
    notes: configured
      ? "Foundry realtime client-secret endpoint is available; the Azure OpenAI key is never exposed to the browser."
      : "Set AZURE_OPENAI_ENDPOINT and an auth source to enable realtime voice."
  };
}
