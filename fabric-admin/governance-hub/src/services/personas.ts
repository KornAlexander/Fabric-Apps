/**
 * Persona persistence (PLAN.md §11.1, decision D28).
 *
 * Reads merge the shipped seed with stored overrides; writes only ever store
 * the delta. Resetting a seeded persona is therefore a delete, not a restore —
 * which means a customer who reset in v1 automatically gets v2's corrections.
 *
 * Every operation degrades to "seed only" when the backend is unreachable, so
 * the editor still renders something truthful at T0.
 */
import {
  mergePersonas,
  SEED_PERSONAS,
  type Persona,
  type PersonaOverride,
  type RiskTier,
} from '@/domain/personas';

import { getRayfinClient } from './rayfinClient';

interface GovPersonaRow {
  id: string;
  persona_id: string;
  name?: string;
  description?: string;
  risk_tier?: string;
  capability_ids_json?: string;
  is_active?: boolean;
  is_custom: boolean;
  updated_by: string;
  updated_at: Date;
}

type Db = ReturnType<typeof getRayfinClient>['data'];
function rows(): Db['GovPersona'] {
  return getRayfinClient().data.GovPersona;
}

function toOverride(row: GovPersonaRow): PersonaOverride {
  let capabilityIds: string[] | undefined;
  if (row.capability_ids_json) {
    try {
      const parsed: unknown = JSON.parse(row.capability_ids_json);
      if (Array.isArray(parsed)) capabilityIds = parsed.map(String);
    } catch {
      // A corrupt override must not take the editor down; the seed still applies.
      capabilityIds = undefined;
    }
  }
  return {
    id: row.persona_id,
    name: row.name,
    description: row.description,
    riskTier: row.risk_tier as RiskTier | undefined,
    capabilityIds,
    isActive: row.is_active,
    isCustom: row.is_custom,
  };
}

export interface LoadPersonasResult {
  personas: Persona[];
  /** False when overrides could not be read — the list is seed-only. */
  backendReachable: boolean;
}

export async function loadPersonas(): Promise<LoadPersonasResult> {
  try {
    const stored = (await rows().findMany({})) as GovPersonaRow[];
    return { personas: mergePersonas(stored.map(toOverride)), backendReachable: true };
  } catch {
    return { personas: mergePersonas([]), backendReachable: false };
  }
}

export interface SavePersonaInput {
  id: string;
  name: string;
  description: string;
  riskTier: RiskTier;
  capabilityIds: string[];
  isActive: boolean;
}

/** Upsert an override. Returns false when the backend is unreachable. */
export async function savePersona(
  input: SavePersonaInput,
  actor: string
): Promise<boolean> {
  const isCustom = !SEED_PERSONAS.some((p) => p.id === input.id);
  const payload = {
    name: input.name,
    description: input.description,
    risk_tier: input.riskTier,
    capability_ids_json: JSON.stringify(input.capabilityIds),
    is_active: input.isActive,
    is_custom: isCustom,
    updated_by: actor,
    updated_at: new Date(),
  };

  try {
    const existing = (await rows().findMany({
      persona_id: { eq: input.id },
    })) as GovPersonaRow[];

    if (existing.length > 0) {
      await rows().update({ id: existing[0].id }, payload);
    } else {
      await rows().create({ persona_id: input.id, ...payload });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset a seeded persona by deleting its override, or delete a custom one.
 *
 * Deliberately the same operation: "reset to shipped" and "remove" are both
 * "forget what we stored", and modelling them separately invites the two to
 * drift apart.
 */
export async function resetPersona(personaId: string): Promise<boolean> {
  try {
    const existing = (await rows().findMany({
      persona_id: { eq: personaId },
    })) as GovPersonaRow[];
    for (const row of existing) {
      await rows().delete({ id: row.id });
    }
    return true;
  } catch {
    return false;
  }
}

export function isSeedPersona(personaId: string): boolean {
  return SEED_PERSONAS.some((p) => p.id === personaId);
}
