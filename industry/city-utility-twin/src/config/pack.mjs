// Config pack: everything a utility can change without touching code.
// A pack picks the cities, switches divisions on or off, and sets brand, texts, KPI targets and
// the assistant's persona. The public repo ships only the neutral `generic` pack; customer packs
// live outside this repository.

export const DIVISIONS = Object.freeze([
  'transit', 'construction', 'water', 'power', 'heat', 'emobility', 'fibre', 'aviation',
]);

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const CITY_STATUS = new Set(['ready', 'planned']);

// ⚠️ THE SAME CONTRACT AS config/packs/pack.schema.json, INCLUDING ITS additionalProperties: false.
// A misspelt key (`divison`, `kpiTarget`) that is silently ignored is a setting the customer
// believes is applied. tests/ui/pack-runtime.test.tsx runs both validators on the same packs.
const TOP_KEYS = new Set(['$schema', 'id', 'brand', 'defaultCity', 'cities', 'divisions', 'texts', 'kpiTargets', 'agent']);
const BRAND_KEYS = new Set(['name', 'logo', 'colors']);
const CITY_KEYS = new Set(['id', 'aois', 'status']);
const AGENT_KEYS = new Set(['persona', 'language']);
const BILINGUAL_KEYS = new Set(['de', 'en']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function known(value, keys, path, errors) {
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`${path}${key} is not a known property`);
}

/** A required object section: reports it and returns {} when missing, so later checks still run. */
function section(pack, key, errors) {
  if (isObject(pack[key])) return pack[key];
  errors.push(`${key} must be an object`);
  return {};
}

function bilingual(value, path, errors) {
  if (!isObject(value)) { errors.push(`${path} must be an object with de and en`); return; }
  known(value, BILINGUAL_KEYS, `${path}.`, errors);
  for (const lang of ['de', 'en']) {
    if (typeof value[lang] !== 'string' || !value[lang].trim()) errors.push(`${path}.${lang} must be a non-empty string`);
  }
}

/** Returns a list of problems; an empty list means the pack is valid. */
export function validatePack(pack) {
  const errors = [];
  if (!isObject(pack)) return ['pack must be an object'];
  known(pack, TOP_KEYS, '', errors);
  if (typeof pack.id !== 'string' || !KEBAB.test(pack.id)) errors.push('id must be kebab-case');

  const brand = section(pack, 'brand', errors);
  known(brand, BRAND_KEYS, 'brand.', errors);
  bilingual(brand.name, 'brand.name', errors);
  if (brand.colors !== undefined && !isObject(brand.colors)) errors.push('brand.colors must be an object');
  if (brand.logo !== null && brand.logo !== undefined && typeof brand.logo !== 'string') errors.push('brand.logo must be a path or null');
  for (const [key, color] of Object.entries(brand.colors ?? {})) {
    if (!HEX.test(color)) errors.push(`brand.colors.${key} must be #RRGGBB`);
  }

  const cities = Array.isArray(pack.cities) ? pack.cities : [];
  if (!cities.length) errors.push('cities must list at least one city');
  const ids = new Set();
  for (const [i, city] of cities.entries()) {
    if (!isObject(city)) { errors.push(`cities[${i}] must be an object`); continue; }
    known(city, CITY_KEYS, `cities[${i}].`, errors);
    if (typeof city.id !== 'string' || !KEBAB.test(city.id)) errors.push(`cities[${i}].id must be kebab-case`);
    else if (ids.has(city.id)) errors.push(`cities[${i}].id "${city.id}" is duplicated`);
    else ids.add(city.id);
    if (!Array.isArray(city?.aois) || !city.aois.length || !city.aois.every(a => typeof a === 'string' && KEBAB.test(a))) {
      errors.push(`cities[${i}].aois must be a non-empty list of kebab-case AOI ids`);
    }
    if (!CITY_STATUS.has(city?.status)) errors.push(`cities[${i}].status must be ready or planned`);
  }
  if (!ids.has(pack.defaultCity)) errors.push('defaultCity must be one of the listed cities');
  else if (cities.find(c => c?.id === pack.defaultCity)?.status !== 'ready') errors.push('defaultCity must be ready');

  const divisions = section(pack, 'divisions', errors);
  for (const [key, on] of Object.entries(divisions)) {
    if (!DIVISIONS.includes(key)) errors.push(`divisions.${key} is not a known division`);
    if (typeof on !== 'boolean') errors.push(`divisions.${key} must be true or false`);
  }
  if (!Object.values(divisions).some((on) => on === true)) errors.push('at least one division must be enabled');

  for (const [key, text] of Object.entries(section(pack, 'texts', errors))) bilingual(text, `texts.${key}`, errors);

  for (const [key, value] of Object.entries(section(pack, 'kpiTargets', errors))) {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`kpiTargets.${key} must be a finite number`);
  }

  const agent = section(pack, 'agent', errors);
  known(agent, AGENT_KEYS, 'agent.', errors);
  if (typeof agent.persona !== 'string' || !agent.persona.trim()) errors.push('agent.persona must be a non-empty string');
  if (!['de', 'en'].includes(agent.language)) errors.push('agent.language must be de or en');

  return errors;
}

/** Throws with every problem listed, so a broken pack fails loudly at startup and in tests. */
export function assertPack(pack) {
  const errors = validatePack(pack);
  if (errors.length) throw new Error(`Invalid config pack:\n- ${errors.join('\n- ')}`);
  return pack;
}

/**
 * Problems between a (valid) pack and the sites this build actually ships.
 *
 * ⚠️ "READY" MEANS SHIPPED. A ready city whose AOI is not in the build would otherwise vanish
 * from the switcher without a word, and a city without its own shell core would load as cores
 * floating in a void. Both are build failures, not fallbacks. Run by vite.config.ts at build time
 * and by the app at startup, so a pack that builds also runs.
 *
 * `siteWorld` maps every shipped core to its world (= city) id; `shells` maps each world to the
 * core that carries its shell. An AOI listed under a city it does not belong to is an error too:
 * it would appear in that city's switcher and fail to load there (review 2026-10-05).
 */
export function packSiteErrors(pack, siteWorld, shells) {
  const errors = [];
  const shipped = Object.keys(siteWorld);
  let selected = 0;
  for (const city of pack.cities.filter((entry) => entry.status === 'ready')) {
    for (const aoi of city.aois) {
      if (!(aoi in siteWorld)) errors.push(`city ${city.id} is ready, but this build does not ship its AOI ${aoi}`);
      else if (siteWorld[aoi] !== city.id) errors.push(`city ${city.id} lists AOI ${aoi}, which belongs to ${siteWorld[aoi]}`);
      else selected += 1;
    }
    const shell = shells[city.id];
    if (!shell) errors.push(`city ${city.id} is ready, but this build has no world for it`);
    else if (!city.aois.includes(shell)) errors.push(`city ${city.id} must include ${shell}, which holds the world shell`);
  }
  if (!selected) errors.push(`selects none of the shipped sites (${shipped.join(', ')})`);
  return errors;
}

export function assertPackSites(pack, siteWorld, shells) {
  const errors = packSiteErrors(pack, siteWorld, shells);
  if (errors.length) throw new Error(`Config pack "${pack.id}" does not fit this build:\n- ${errors.join('\n- ')}`);
}
