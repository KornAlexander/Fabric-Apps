export const BINARY_FILES = [
  'heightmap.u16', 'heightmap_nodata.u8', 'landuse_2m.u8z', 'shell.u16',
  'drape.jpg', 'shell-drape.jpg', 'buildings_lod2.bin', 'buildings_colour.bin',
  'buildings_roof_spans.bin', 'vegetation.bin',
];
export const JSON_FILES = [
  'heightmap.json', 'landuse.json', 'shell.json', 'drape.json',
  'shell-drape.json', 'buildings_lod2.json', 'vegetation.json',
];
export const ASSET_FILES = [...BINARY_FILES, ...JSON_FILES].sort();
const fields = {
  'heightmap.json': ['width', 'height', 'resolutionM', 'crs', 'verticalDatum', 'origin', 'heightMinM', 'heightMaxM', 'heightScale', 'encoding', 'boundsWgs84', 'coveragePct', 'source', 'sourceAcquisition', 'attribution', 'licence', 'file', 'nodataFile'],
  'landuse.json': ['file', 'compression', 'bytes', 'compressedBytes', 'width', 'height', 'resolutionM', 'origin', 'classes', 'coveragePct', 'sharePct', 'attribution'],
  'shell.json': ['width', 'height', 'resolutionM', 'crs', 'origin', 'heightMinM', 'heightMaxM', 'heightScale', 'encoding', 'boundsWgs84', 'core', 'transitionBandM', 'seamOffsetM', 'verticalDatum', 'source', 'licence', 'attribution', 'surface', 'sourceAcquisition', 'file'],
  'drape.json': ['file', 'width', 'height', 'resolutionM', 'crs', 'origin', 'spanM', 'source', 'service', 'layer', 'licence', 'attribution', 'acquisition'],
  'vegetation.json': ['count', 'stride', 'encoding', 'minHeightM', 'spacingM', 'formKnown', 'crownRadiusMeasured', 'crownRatio', 'source', 'licence', 'attribution'],
  'buildings_lod2.json': ['count', 'vertexCount', 'quantisation', 'attribution'],
};
fields['shell-drape.json'] = fields['drape.json'];

export function cleanDescriptor(name, input) {
  if (!fields[name]) throw new Error(`Unexpected map descriptor: ${name}`);
  const output = Object.fromEntries(fields[name].filter(key => key in input).map(key => [key, input[key]]));
  if (name === 'heightmap.json') output.focusPlaces = [];
  if (name === 'buildings_lod2.json') {
    output.perVillage = { Munich: input.count };
    output.buildings = input.buildings.map(building => ({
      village: 'Munich',
      ...Object.fromEntries(['groundElevM', 'vertexStart', 'vertexCount', 'roofVertexStart', 'wall', 'easting', 'northing']
        .filter(key => key in building).map(key => [key, building[key]])),
    }));
  }
  if (name === 'drape.json' || name === 'shell-drape.json') {
    output.resolutionNote = `Source DOP20 imagery resampled to ${input.resolutionM} metres per pixel. Photograph only, not a geometry measurement.`;
  }
  return output;
}

export const inheritedName = /campus|schedul|timetable|planner|occupancy|fakultät|universit|\brooms?\b|calendar|uConditionMix|aRenovation|aGrade|glider/i;
export const privateCoordinate = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|Bearer\s+[A-Za-z0-9._-]+|https:\/\/[^\s"']*(?:azurecontainerapps\.(?:net|io)|fabricapps\.net|azurecr\.io)/i;

// Strip only complete URL occurrences for the exact selected public origin.
// Never blank a line, skip arbitrary files, or exempt a hostname suffix.
export function withoutApprovedOrigin(text, origin, releaseId) {
  if (!origin) return text;
  return text.replace(/https?:\/\/[^\s"'<>`\\)]+/g, value => {
    try {
      const url = new URL(value);
      if (url.origin !== origin || url.username || url.password || url.search || url.hash) return value;
      if (url.pathname !== '/' && url.pathname !== `/releases/${releaseId}/munich`) return value;
      return '[approved-public-asset-origin]';
    } catch { return value; }
  });
}

// Rayfin writes its hosting origin here after deployment. Permit only a bare HTTPS
// Fabric hosting origin in this exact list, never elsewhere or in the shipped app.
export function configWithoutHostingRedirect(text) {
  let inRedirects = false;
  return text.split(/\r?\n/).map(line => {
    if (/^    allowedRedirectUris:\s*$/.test(line)) { inRedirects = true; return line; }
    if (inRedirects && /^      - https:\/\/[a-z0-9-]+\.webapp\.fabricapps\.net\/?\s*$/.test(line)) return '';
    if (inRedirects && !/^      - /.test(line)) inRedirects = false;
    return line;
  }).join('\n');
}

/**
 * The deployment hosts this app is allowed to name in its own source.
 *
 * ⚠️ AN EXCEPTION, NOT A RELAXATION, AND THE DISTINCTION MATTERS. `privateCoordinate` flags any
 * azurecontainerapps.io / fabricapps.net / azurecr.io URL because those are normally private
 * deployment coordinates that have no business in a shipped bundle. These two are the opposite
 * case: they are deliberately public endpoints the browser cannot call without knowing their
 * address, so they MUST be in the bundle.
 *
 * The exception is written as narrowly as it can be:
 *
 *  * exact hosts, not a suffix and not a pattern over the whole domain;
 *  * only when they appear as a bare origin with no credentials, query or fragment;
 *  * only on the specific paths each service actually exposes;
 *  * nothing else about the guard changes, so a stray registry URL or a third container app
 *    still fails the build.
 *
 * If either service is renamed or retired, this table must change with it — a stale entry here
 * would silently permit a host that no longer belongs to this app.
 */
export const APPROVED_RELAY_ORIGIN =
  (process.env.VITE_RELAY_ORIGIN || 'https://relay.invalid').replace(/\/$/, '');

/** The agent backend: Foundry tool loop and the coordination notes. */
export const APPROVED_AGENT_ORIGIN =
  (process.env.VITE_AGENT_ORIGIN || 'https://agent.invalid').replace(/\/$/, '');

/**
 * Microsoft Entra, for the access token that makes a note's author verifiable.
 *
 * ⚠️ THE AUTHORITY, NOT A WILDCARD. Only the bare origin and the demo tenant's authority path
 * are permitted; anything else on this host still fails the gate.
 */
export const APPROVED_LOGIN_ORIGIN = 'https://login.microsoftonline.com';

const APPROVED_ORIGINS = new Map([
  [APPROVED_RELAY_ORIGIN, ['/', '/adsb/point', '/health']],
  // ⚠️ The agent's paths are built at runtime (`${base()}/api/...`), so only the bare origin and
  // the health path ever appear as literals. Listing the API paths as well would widen the
  // exception to cover strings this source has no reason to contain.
  [APPROVED_AGENT_ORIGIN, ['/', '/health']],
  [APPROVED_LOGIN_ORIGIN, ['/', `/${process.env.VITE_ENTRA_TENANT_ID || 'common'}`]],
]);

export function withoutApprovedRelay(text) {
  return text.replace(/https?:\/\/[^\s"'<>`\\)]+/g, value => {
    try {
      const url = new URL(value);
      const allowedPaths = APPROVED_ORIGINS.get(url.origin);
      if (!allowedPaths) return value;
      if (url.username || url.password || url.search || url.hash) return value;
      if (!allowedPaths.includes(url.pathname)) return value;
      // ⚠️ THE RAW STRING MUST ALREADY BE CANONICAL, AND CHECKING ONLY THE PARSED PATH WAS A HOLE.
      // `new URL()` NORMALISES, so `https://<approved-origin>/<some-guid>/../health` parses with
      // pathname `/health` — the exception then matched and erased the WHOLE original string,
      // taking the unapproved GUID with it, before the scanner ever saw it. Requiring the literal
      // to equal the canonical form closes that: anything with dot segments, encoded dots or any
      // other decoration is left in place and judged on its merits.
      //
      // The bare origin is written without a trailing slash in source, while `url.pathname` is
      // `/`, so that spelling is accepted explicitly rather than by accident.
      const canonical = `${url.origin}${url.pathname}`;
      const bareOrigin = url.pathname === '/' && value === url.origin;
      if (value !== canonical && !bareOrigin) return value;
      return '[approved-public-origin]';
    } catch { return value; }
  });
}

/**
 * Identifiers from third-party dependencies that happen to contain a guarded word.
 *
 *
 * Measured: `@microsoft/rayfin-client` contains **`scheduleSessionExpiration`**, seven times, and
 * nothing else that matches. That is session-expiry bookkeeping, unrelated to the scheduling
 * project whose name the guard is watching for.
 *
 * ⚠️ EXACT SYMBOLS, NOT A VENDOR-CHUNK EXEMPTION. Skipping "the dependency chunk" would be the
 * easy fix and a bad one: Vite decides what lands in which chunk, so our own strings can end up
 * there, and the guard would stop protecting them. Naming the identifier means a genuine leak
 * still fails the build, and a new dependency that trips the guard has to be looked at.
 */
const VENDOR_SYMBOLS = [
  'scheduleSessionExpiration',
  'clearSessionExpirationTimer',
  // ⚠️ MSAL'S PUBLIC MSA TENANT CONSTANT, NOT ONE OF OURS. `@azure/msal-browser` hard-codes
  // 9188040d-… to recognise a personal Microsoft account (`tid === MSA` ⇒ account type "MSA").
  // It is documented by Microsoft and identical in every MSAL build, so it carries no
  // information about this deployment. Listed as an exact value for the same reason as the
  // symbols above: a GUID-shaped exemption would retire the coordinate check entirely.
  '9188040d-6c67-4c5b-b112-36a304b66dad',
  // ⚠️ ALSO MSAL, ALSO FIXED. `NativeConstants.CHANNEL_ID` in BrowserConstants.mjs, the channel
  // used to reach the native-broker browser extension. Verified in node_modules rather than
  // assumed, because approving a GUID nobody can explain would defeat the whole check.
  '53ee284d-920a-4b59-9d30-a60315b26836',
];

export function withoutVendorSymbols(text) {
  let out = text;
  for (const symbol of VENDOR_SYMBOLS) {
    out = out.split(symbol).join('[vendor-symbol]');
  }
  return out;
}

/**
 * Place names the Landeshauptstadt and the MVV publish that happen to contain a guarded word.
 *
 *
 * The two honest options were to exempt the exact published string, or to rewrite somebody
 * else's open data so a regular expression would pass. The second is not an option: the standing
 * rule for this app is that it shows what the source says.
 *
 */
const APPROVED_PLACE_NAMES = ['Universität'];

/** The only artefact whose published place names are exempt, as source and as built output. */
const PLACE_NAME_ASSET = /(^|[\\/])(public[\\/])?data[\\/]fahrplan\.json$/;

export function withoutApprovedPlaceNames(text, path = '') {
  if (!PLACE_NAME_ASSET.test(path)) return text;
  let out = text;
  for (const name of APPROVED_PLACE_NAMES) {
    out = out.replace(new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, 'gu'), '[approved-place-name]');
  }
  return out;
}

/**
 * Fabric identifiers this bundle is explicitly allowed to carry.
 *
 * ⚠️ A DELIBERATE EXCEPTION, NOT A GENERAL RELAXATION.
 * `privateCoordinate` rejects GUIDs in a shipped bundle because a tenant or workspace id in a
 * public artefact is normally an accident. These four are not an accident: `@microsoft/rayfin-client`
 * cannot obtain the signed-in user without its API URL (which embeds the workspace and capacity)
 * and the Fabric item and tenant ids, and note attribution cannot work without that.
 *
 * ⚠️ FOUR EXACT VALUES, NOT A GUID-SHAPED PATTERN. Allowing "GUIDs in general" would retire the
 * check entirely and let the next stray identifier through in silence. Any other GUID still
 * fails the build, and if this app is ever redeployed to another workspace these must change
 * with it — a stale entry would permit an id that no longer belongs to this app.
 */
const APPROVED_FABRIC_IDS = [
  // Die eigenen Werte: Mandant, Arbeitsbereich, Kapazität, App-Element und Entra-Client-ID,
  // kommagetrennt in APPROVED_FABRIC_IDS (siehe UMSETZUNG.md). Die Client-ID einer SPA steht
  // absichtlich im Bundle; die Grenze sind Redirect-URIs und Token-Audience, nicht ihr Geheimsein.
  ...(process.env.APPROVED_FABRIC_IDS || '').split(',').map((v) => v.trim()).filter(Boolean),
  ...[process.env.VITE_ENTRA_CLIENT_ID, process.env.VITE_ENTRA_TENANT_ID].filter(Boolean),
];
// ⚠ ONLY EXACT GUIDs. Each entry becomes a replacement pattern below; a free-form value such as
// `.*` would otherwise erase all text before the privacy checks run and switch the gate off.
for (const id of APPROVED_FABRIC_IDS) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`APPROVED_FABRIC_IDS / VITE_ENTRA_*: kein GUID: ${id}`);
  }
}
export const APPROVED_FABRIC_ID_LIST = APPROVED_FABRIC_IDS;

export function withoutApprovedFabricIds(text) {
  let out = text;
  for (const id of APPROVED_FABRIC_IDS) {
    // Case-insensitive, because the platform emits these in both cases.
    out = out.replace(new RegExp(id, 'gi'), '[approved-fabric-id]');
  }
  return out;
}