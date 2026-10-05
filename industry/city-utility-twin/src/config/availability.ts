/**
 * Which divisions and layers each city really has. See config/availability.json.
 *
 * ⚠️ THE MATRIX DECIDES WHICH LAYERS A CITY OFFERS, NOT A LIST IN CODE. A layer that appears in
 * no city's entry is offered nowhere, and tests/ui/availability.test.tsx fails on it, so a new
 * layer cannot be forgotten silently.
 */
import raw from '../../config/availability.json';
// ⚠️ NOT `availability.mjs`: Vite resolves an extensionless import to .mjs before .ts, so a
// validator of the same base name would shadow this module at runtime while tsc is satisfied.
import { assertAvailability } from './availabilityMatrix.mjs';
import { WORLDS, type WorldId } from './world';
import type { Division } from './activePack';
import { both, type Text } from '../i18n';

export type AvailabilityMode = 'real' | 'synthetic' | 'none';

export interface DivisionAvailability {
  mode: AvailabilityMode;
  source?: { de: string; en: string };
  layers?: string[];
}

export interface CityAvailability {
  divisions: Record<Division, DivisionAvailability>;
  context?: string[];
}

export type AvailabilityMatrix = { cities: Record<WorldId, CityAvailability> };

export function loadAvailability(value: unknown): AvailabilityMatrix {
  return assertAvailability(value, Object.keys(WORLDS)) as AvailabilityMatrix;
}

export const AVAILABILITY: AvailabilityMatrix = loadAvailability(raw);

/** What a city has for one division. */
export function divisionAvailability(
  world: WorldId, division: Division, matrix: AvailabilityMatrix = AVAILABILITY,
): DivisionAvailability {
  return matrix.cities[world].divisions[division];
}

/** The division's source in the current language, or null when there is none. */
export function divisionSource(entry: DivisionAvailability): Text | null {
  return entry.source ? both(entry.source.de, entry.source.en) : null;
}

/** Every layer id this city offers: the layers of its sourced divisions plus its context layers. */
export function layersIn(world: WorldId, matrix: AvailabilityMatrix = AVAILABILITY): ReadonlySet<string> {
  const city = matrix.cities[world];
  const ids = new Set(city.context ?? []);
  for (const entry of Object.values(city.divisions)) {
    if (entry.mode !== 'none') for (const id of entry.layers ?? []) ids.add(id);
  }
  return ids;
}
