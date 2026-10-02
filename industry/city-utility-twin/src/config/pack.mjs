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

function bilingual(value, path, errors) {
  if (!value || typeof value !== 'object') { errors.push(`${path} must be an object with de and en`); return; }
  for (const lang of ['de', 'en']) {
    if (typeof value[lang] !== 'string' || !value[lang].trim()) errors.push(`${path}.${lang} must be a non-empty string`);
  }
}

/** Returns a list of problems; an empty list means the pack is valid. */
export function validatePack(pack) {
  const errors = [];
  if (!pack || typeof pack !== 'object') return ['pack must be an object'];
  if (typeof pack.id !== 'string' || !KEBAB.test(pack.id)) errors.push('id must be kebab-case');

  const brand = pack.brand ?? {};
  bilingual(brand.name, 'brand.name', errors);
  if (brand.logo !== null && brand.logo !== undefined && typeof brand.logo !== 'string') errors.push('brand.logo must be a path or null');
  for (const [key, color] of Object.entries(brand.colors ?? {})) {
    if (!HEX.test(color)) errors.push(`brand.colors.${key} must be #RRGGBB`);
  }

  const cities = Array.isArray(pack.cities) ? pack.cities : [];
  if (!cities.length) errors.push('cities must list at least one city');
  const ids = new Set();
  for (const [i, city] of cities.entries()) {
    if (typeof city?.id !== 'string' || !KEBAB.test(city.id)) errors.push(`cities[${i}].id must be kebab-case`);
    else if (ids.has(city.id)) errors.push(`cities[${i}].id "${city.id}" is duplicated`);
    else ids.add(city.id);
    if (!Array.isArray(city?.aois) || !city.aois.length || !city.aois.every(a => typeof a === 'string' && KEBAB.test(a))) {
      errors.push(`cities[${i}].aois must be a non-empty list of kebab-case AOI ids`);
    }
    if (!CITY_STATUS.has(city?.status)) errors.push(`cities[${i}].status must be ready or planned`);
  }
  if (!ids.has(pack.defaultCity)) errors.push('defaultCity must be one of the listed cities');
  else if (cities.find(c => c.id === pack.defaultCity)?.status !== 'ready') errors.push('defaultCity must be ready');

  const divisions = pack.divisions ?? {};
  for (const [key, on] of Object.entries(divisions)) {
    if (!DIVISIONS.includes(key)) errors.push(`divisions.${key} is not a known division`);
    if (typeof on !== 'boolean') errors.push(`divisions.${key} must be true or false`);
  }
  if (!Object.values(divisions).some(Boolean)) errors.push('at least one division must be enabled');

  for (const [key, text] of Object.entries(pack.texts ?? {})) bilingual(text, `texts.${key}`, errors);

  for (const [key, value] of Object.entries(pack.kpiTargets ?? {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`kpiTargets.${key} must be a finite number`);
  }

  const agent = pack.agent ?? {};
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
