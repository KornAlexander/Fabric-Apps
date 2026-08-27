// Azure OpenAI (Foundry) endpoint URL resolution. Handles both the
// `*.cognitiveservices.azure.com` and `*.services.ai.azure.com` hostnames and
// the /openai/v1 Responses + Realtime routes.
// (Copied from digital-twin-fabric-app/server/lib/foundryEndpoints.mjs.)

export function normalizeFoundryEndpoint(endpoint) {
  return String(endpoint ?? "").replace(/\/$/, "");
}

export function resolveOpenAiV1Base(configOrEndpoint) {
  const endpoint = typeof configOrEndpoint === "string"
    ? configOrEndpoint
    : configOrEndpoint?.endpoint;
  const base = normalizeFoundryEndpoint(endpoint);
  if (!base) return "";
  if (base.endsWith("/openai/v1/responses")) return base.slice(0, -"/responses".length);
  if (base.endsWith("/openai/v1/realtime/client_secrets")) return base.slice(0, -"/realtime/client_secrets".length);
  if (base.endsWith("/openai/v1/realtime/calls")) return base.slice(0, -"/realtime/calls".length);
  if (base.endsWith("/openai/v1")) return base;
  return `${base}/openai/v1`;
}

export function resolveResponsesUrl(config) {
  return `${resolveOpenAiV1Base(config)}/responses`;
}

export function resolveRealtimeClientSecretUrl(config) {
  return `${resolveRealtimeOpenAiV1Base(config)}/realtime/client_secrets`;
}

export function resolveRealtimeCallsUrl(config) {
  return `${resolveRealtimeOpenAiV1Base(config)}/realtime/calls`;
}

export function resolveRealtimeOpenAiV1Base(config) {
  if (config.realtimeEndpoint) return resolveOpenAiV1Base(config.realtimeEndpoint);
  const endpoint = normalizeFoundryEndpoint(config.endpoint);
  if (endpoint.includes(".services.ai.azure.com/")) {
    const url = new URL(endpoint);
    const resourceName = url.hostname.split(".")[0];
    return `https://${resourceName}.cognitiveservices.azure.com/openai/v1`;
  }
  return resolveOpenAiV1Base(config);
}

export function resolveTokenResource(config) {
  if (config.tokenResource) return normalizeFoundryEndpoint(config.tokenResource);
  if (!config.endpoint) return "https://cognitiveservices.azure.com";
  const host = new URL(config.endpoint).hostname.toLowerCase();
  return host.endsWith(".services.ai.azure.com")
    ? "https://ai.azure.com"
    : "https://cognitiveservices.azure.com";
}
