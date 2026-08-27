// Managed identity token acquisition for Azure Container Apps / App Service.
// Falls back to Azure CLI for local development.
// (Copied verbatim from digital-twin-fabric-app/server/lib/identity.mjs.)

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const tokenCache = new Map();

function managedIdentityClientSelector() {
  const clientId = process.env.AZURE_CLIENT_ID || process.env.MANAGED_IDENTITY_CLIENT_ID || process.env.MSI_CLIENT_ID;
  const resourceId = process.env.MANAGED_IDENTITY_RESOURCE_ID || process.env.MSI_RESOURCE_ID;
  if (resourceId) return { name: "mi_res_id", value: resourceId };
  if (clientId) return { name: "client_id", value: clientId, fallbackName: "clientid" };
  return null;
}

function managedIdentitySource() {
  if (process.env.IDENTITY_ENDPOINT && process.env.IDENTITY_HEADER) {
    return {
      endpoint: process.env.IDENTITY_ENDPOINT,
      apiVersion: "2019-08-01",
      headers: { "X-IDENTITY-HEADER": process.env.IDENTITY_HEADER }
    };
  }
  if (process.env.MSI_ENDPOINT && process.env.MSI_SECRET) {
    return {
      endpoint: process.env.MSI_ENDPOINT,
      apiVersion: "2017-09-01",
      headers: { secret: process.env.MSI_SECRET }
    };
  }
  return null;
}

function cacheKey(resource) {
  const selector = managedIdentityClientSelector();
  return selector ? `${resource}|${selector.name}:${selector.value}` : resource;
}

function isExpired(entry) {
  if (!entry) return true;
  return Date.now() >= entry.expiresAt - 60_000; // refresh 1 min early
}

async function getManagedIdentityToken(resource) {
  const source = managedIdentitySource();
  if (!source) return null;

  const selector = managedIdentityClientSelector();
  const selectorNames = selector
    ? [selector.name, selector.fallbackName].filter(Boolean)
    : [null];
  const failures = [];

  for (const selectorName of selectorNames) {
    const params = new URLSearchParams({
      resource,
      "api-version": source.apiVersion
    });
    if (selector && selectorName) params.set(selectorName, selector.value);

    const url = `${source.endpoint}?${params.toString()}`;
    const response = await fetch(url, { headers: source.headers });
    if (response.ok) {
      const data = await response.json();
      return {
        accessToken: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in ?? 3600) * 1000)
      };
    }

    const text = await response.text().catch(() => "");
    failures.push(`${selectorName ?? "system-assigned"}: ${response.status} ${text}`.trim());
  }

  throw new Error(`Managed identity token request failed for ${resource}: ${failures.join("; ")}`);
}

async function getAzureCliToken(resource) {
  const args = ["account", "get-access-token", "--resource", resource, "--output", "json"];
  const command = process.platform === "win32"
    ? { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", ["az", ...args].join(" ")] }
    : { file: "az", args };
  const { stdout } = await execFileAsync(command.file, command.args, { timeout: 30000 });
  const parsed = JSON.parse(stdout);
  return {
    accessToken: parsed.accessToken,
    expiresAt: new Date(parsed.expiresOn).getTime()
  };
}

/**
 * Get a token for the given resource. Tries managed identity first,
 * falls back to Azure CLI if running locally.
 */
export async function getToken(resource) {
  const key = cacheKey(resource);
  const cached = tokenCache.get(key);
  if (!isExpired(cached)) return cached.accessToken;

  // Try managed identity first (available in Container Apps / App Service)
  const miToken = await getManagedIdentityToken(resource);
  if (miToken) {
    tokenCache.set(key, miToken);
    return miToken.accessToken;
  }

  // Fall back to Azure CLI
  const cliToken = await getAzureCliToken(resource);
  tokenCache.set(key, cliToken);
  return cliToken.accessToken;
}

/**
 * Returns true if running in an environment with managed identity.
 */
export function hasManagedIdentity() {
  return Boolean(managedIdentitySource());
}
