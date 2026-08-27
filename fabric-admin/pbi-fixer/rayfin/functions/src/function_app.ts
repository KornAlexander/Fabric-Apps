import { UserDataFunctions } from '@microsoft/fabric-user-data-functions';

const udf = new UserDataFunctions();

/* ------------------------------------------------------------------ *
 * Power BI Fixer — Fabric User Data Functions (app / owner identity)
 *
 * The browser only ever holds a Rayfin session token, so all Fabric
 * management writes must happen here, server-side, with the app's own
 * identity. This UDF acquires a Fabric-API token via service-principal
 * client credentials (configured as function app settings) and calls
 * the Fabric REST API directly.
 *
 * Required function app settings (env vars):
 *   FABRIC_SP_TENANT_ID      AAD tenant id
 *   FABRIC_SP_CLIENT_ID      app registration (service principal) client id
 *   FABRIC_SP_CLIENT_SECRET  client secret
 *
 * The service principal must be a Member/Admin of the target workspace
 * and the tenant must allow service principals to use the Fabric APIs.
 * ------------------------------------------------------------------ */

const FABRIC_BASE = 'https://api.fabric.microsoft.com/v1';
const AAD_SCOPE = 'https://api.fabric.microsoft.com/.default';

const TARGET_W = 1280;
const TARGET_H = 720;
const PIE_TYPES = new Set(['pieChart', 'donutChart', 'funnel']);

interface DefinitionPart {
  path: string;
  payload: string; // base64
  payloadType: string; // "InlineBase64"
}
interface Definition {
  parts: DefinitionPart[];
}

interface FixerFinding {
  path: string;
  detail: string;
}
interface FixerResult {
  fixerId: string;
  scanOnly: boolean;
  matched: number;
  changed: number;
  findings: FixerFinding[];
  applied: boolean;
}

/* ----------------------------- auth ------------------------------- */

let cachedToken: { value: string; exp: number } | null = null;

async function getFabricToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.exp - 60_000 > now) return cachedToken.value;

  const tenant = process.env.FABRIC_SP_TENANT_ID;
  const clientId = process.env.FABRIC_SP_CLIENT_ID;
  const clientSecret = process.env.FABRIC_SP_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) {
    throw new Error(
      'Missing service-principal settings. Set FABRIC_SP_TENANT_ID, FABRIC_SP_CLIENT_ID and FABRIC_SP_CLIENT_SECRET in the function app settings.',
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: AAD_SCOPE,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    exp: now + json.expires_in * 1000,
  };
  return json.access_token;
}

/* --------------------------- REST + LRO --------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fabricFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; headers: Headers; json: any }> {
  const token = await getFabricToken();
  const res = await fetch(`${FABRIC_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: any = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (res.status >= 400) {
    throw new Error(`Fabric REST ${path} failed (${res.status}): ${text}`);
  }
  return { status: res.status, headers: res.headers, json };
}

/** Resolve a Fabric long-running operation, returning the final result body. */
async function resolveLro(
  first: { status: number; headers: Headers; json: any },
): Promise<any> {
  if (first.status !== 202) return first.json;

  const token = await getFabricToken();
  const opUrl = first.headers.get('Location');
  if (!opUrl) throw new Error('LRO 202 without Location header');
  let retryAfter = Number(first.headers.get('Retry-After') ?? '2') || 2;

  for (let i = 0; i < 120; i++) {
    await sleep(retryAfter * 1000);
    const st = await fetch(opUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await st.json()) as { status?: string };
    if (body.status === 'Succeeded') {
      const resultUrl = st.headers.get('Location') ?? `${opUrl}/result`;
      const r = await fetch(resultUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 200) return await r.json();
      return body;
    }
    if (body.status === 'Failed') {
      throw new Error(`LRO failed: ${JSON.stringify(body)}`);
    }
    retryAfter = Number(st.headers.get('Retry-After') ?? retryAfter) || retryAfter;
  }
  throw new Error('LRO timed out');
}

/* ------------------------- PBIR helpers --------------------------- */

const b64decode = (s: string): string =>
  Buffer.from(s, 'base64').toString('utf-8');
const b64encode = (s: string): string =>
  Buffer.from(s, 'utf-8').toString('base64');

const isPagePart = (p: DefinitionPart) => p.path.endsWith('/page.json');
const isVisualPart = (p: DefinitionPart) => p.path.endsWith('/visual.json');

/* ----------------------------- fixers ----------------------------- */

function fixPageSize(def: Definition, scanOnly: boolean): FixerResult {
  const findings: FixerFinding[] = [];
  let changed = 0;
  for (const part of def.parts) {
    if (!isPagePart(part)) continue;
    let doc: any;
    try {
      doc = JSON.parse(b64decode(part.payload));
    } catch {
      continue;
    }
    const w = doc.width;
    const h = doc.height;
    if (typeof w !== 'number' || typeof h !== 'number') continue;
    if (w <= 0 || h <= 0) continue;
    if (w === TARGET_W && h === TARGET_H) continue;
    findings.push({
      path: part.path,
      detail: `${w}x${h} -> ${TARGET_W}x${TARGET_H}`,
    });
    if (!scanOnly) {
      doc.width = TARGET_W;
      doc.height = TARGET_H;
      part.payload = b64encode(JSON.stringify(doc));
      changed++;
    }
  }
  return {
    fixerId: 'Fix_PageSize',
    scanOnly,
    matched: findings.length,
    changed,
    findings,
    applied: !scanOnly && changed > 0,
  };
}

function fixPieChart(def: Definition, scanOnly: boolean): FixerResult {
  const findings: FixerFinding[] = [];
  let changed = 0;
  for (const part of def.parts) {
    if (!isVisualPart(part)) continue;
    let doc: any;
    try {
      doc = JSON.parse(b64decode(part.payload));
    } catch {
      continue;
    }
    const vt = doc?.visual?.visualType;
    if (typeof vt !== 'string' || !PIE_TYPES.has(vt)) continue;
    findings.push({ path: part.path, detail: `${vt} -> barChart` });
    if (!scanOnly) {
      doc.visual.visualType = 'barChart';
      part.payload = b64encode(JSON.stringify(doc));
      changed++;
    }
  }
  return {
    fixerId: 'Fix_PieChart',
    scanOnly,
    matched: findings.length,
    changed,
    findings,
    applied: !scanOnly && changed > 0,
  };
}

const FIXERS: Record<string, (def: Definition, scanOnly: boolean) => FixerResult> = {
  Fix_PageSize: fixPageSize,
  Fix_PieChart: fixPieChart,
};

/* --------------------------- functions ---------------------------- */

/** List workspaces visible to the app identity. */
udf.func('listWorkspaces', async (): Promise<{ id: string; displayName: string }[]> => {
  const res = await fabricFetch('/workspaces');
  const value = (res.json?.value ?? []) as { id: string; displayName: string }[];
  return value.map((w) => ({ id: w.id, displayName: w.displayName }));
}, []);

/** List Power BI reports in a workspace. */
udf.func('listReports', async (workspaceId: string): Promise<{ id: string; displayName: string }[]> => {
  const res = await fabricFetch(`/workspaces/${workspaceId}/reports`);
  const value = (res.json?.value ?? []) as { id: string; displayName: string }[];
  return value.map((r) => ({ id: r.id, displayName: r.displayName }));
}, []);

/**
 * Scan or apply a report fixer.
 * @param fixerId one of "Fix_PageSize" | "Fix_PieChart"
 * @param scanOnly when true, only report findings; when false, write changes back.
 */
udf.func('applyReportFixer', async (
  workspaceId: string,
  reportId: string,
  fixerId: string,
  scanOnly: boolean,
): Promise<{
  fixerId: string;
  scanOnly: boolean;
  matched: number;
  changed: number;
  findings: { path: string; detail: string }[];
  applied: boolean;
}> => {
  const fixer = FIXERS[fixerId];
  if (!fixer) throw new Error(`Unknown fixerId: ${fixerId}`);

  // 1. getDefinition (PBIR)
  const getRes = await fabricFetch(
    `/workspaces/${workspaceId}/reports/${reportId}/getDefinition?format=PBIR`,
    { method: 'POST' },
  );
  const defEnvelope = await resolveLro(getRes);
  const definition: Definition = defEnvelope.definition ?? defEnvelope;
  if (!definition?.parts) throw new Error('No PBIR definition parts returned');

  // 2. scan / mutate
  const result = fixer(definition, scanOnly);

  // 3. updateDefinition when applying and something changed
  if (!scanOnly && result.changed > 0) {
    const updRes = await fabricFetch(
      `/workspaces/${workspaceId}/reports/${reportId}/updateDefinition`,
      { method: 'POST', body: { definition } },
    );
    await resolveLro(updRes);
  }

  return result;
}, []);
