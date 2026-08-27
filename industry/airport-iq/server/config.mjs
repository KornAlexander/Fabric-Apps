import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(resolve(__dirname, ".env"));
loadEnvFile(resolve(__dirname, ".env.local"));

function bool(value, fallback = false) {
  return String(value ?? fallback).toLowerCase() === "true";
}

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Thin airport-scenario backend config. Only the pieces the chat + voice
 * endpoints need: Azure OpenAI (Foundry) connection, deployments, and CORS.
 */
export function createConfig(env = process.env) {
  return {
    port: int(env.PORT, 8080),
    corsAllowOrigins: env.CORS_ALLOW_ORIGINS ?? "*",
    appKey: (env.BACKEND_APP_KEY ?? "").trim(),
    // Default airport for grounded tools when the request does not specify one.
    defaultAirport: (env.AIRPORT_IQ_DEFAULT_AIRPORT ?? "DUS").toUpperCase(),
    foundry: {
      endpoint: env.AZURE_OPENAI_ENDPOINT ?? "",
      realtimeEndpoint: env.AZURE_OPENAI_REALTIME_ENDPOINT ?? "",
      apiKey: env.AZURE_OPENAI_API_KEY ?? "",
      accessToken: env.AZURE_OPENAI_ACCESS_TOKEN ?? "",
      useAzureCliToken: bool(env.AZURE_OPENAI_USE_AZURE_CLI_TOKEN, true),
      tokenResource: env.AZURE_OPENAI_TOKEN_RESOURCE ?? "",
      // Chat model deployment (a gpt-5.x / gpt-4.x Responses-API model).
      chatDeployment: env.AZURE_OPENAI_CHAT_DEPLOYMENT ?? "gpt-5.2",
      // Realtime (voice) model deployment.
      deployment: env.AZURE_OPENAI_REALTIME_DEPLOYMENT ?? "gpt-realtime",
      apiVersion: env.AZURE_OPENAI_API_VERSION ?? "2025-04-01-preview",
      voice: env.AZURE_OPENAI_REALTIME_VOICE ?? "sage",
      speakingRate:
        env.AZURE_OPENAI_REALTIME_SPEAKING_RATE ??
        "brisk demo pace, about 15% faster than default, with short pauses",
      // gpt-5.x reasoning models: keep latency low for interactive chat. Empty
      // string disables the reasoning field (for non-reasoning models).
      reasoningEffort: (env.AZURE_OPENAI_REASONING_EFFORT ?? "low").trim(),
      // Reasoning tokens count against the output budget, so keep this generous.
      maxOutputTokens: int(env.AZURE_OPENAI_MAX_OUTPUT_TOKENS, 2000)
    }
  };
}

export const config = createConfig();

export function foundryIsConfigured(cfg = config) {
  const f = cfg.foundry;
  return Boolean(
    f.endpoint && (f.apiKey || f.accessToken || f.useAzureCliToken || hasManagedIdentityEnv())
  );
}

function hasManagedIdentityEnv() {
  return Boolean(
    (process.env.IDENTITY_ENDPOINT && process.env.IDENTITY_HEADER) ||
      (process.env.MSI_ENDPOINT && process.env.MSI_SECRET)
  );
}
