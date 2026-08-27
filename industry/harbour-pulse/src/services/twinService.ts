import type { DeckId, DeckOccupancy, FerryTwin } from '@/shared/contract';

import { colIndex, isDirectKustoConfigured, queryKusto } from './kustoClient';

/**
 * Digital-twin data path. The .NET simulator ingests per-deck passenger
 * occupancy into the Fabric Eventhouse table `FerryTwinTelemetry` using the
 * OpenTelemetry metrics data model (MetricName `ferry.deck.occupancy`). The
 * deployed app reads the latest value per deck directly via KQL; local dev has
 * no Eventhouse, so a lightweight client-side simulation stands in so the voxel
 * ferry view still shows passengers walking around.
 */

// Deck capacities mirror the .NET simulator (TwinSimulatorService.DeckCapacities)
// so the client-side fallback matches the values ingested into Fabric.
const DECKS: { deck: DeckId; capacity: number }[] = [
  { deck: 'lower', capacity: 120 },
  { deck: 'upper', capacity: 90 },
  { deck: 'bridge', capacity: 12 },
];

const useDirectKusto = isDirectKustoConfigured();

function twinKql(vesselId: string): string {
  const id = vesselId.replace(/'/g, "''");
  return `
FerryTwinTelemetry
| where MetricName == 'ferry.deck.occupancy' and VesselId == '${id}'
| summarize arg_max(Timestamp, MetricValue, Attributes) by DeckId
| project DeckId, MetricValue, Attributes
`;
}

async function fetchTwinDirect(vesselId: string, signal?: AbortSignal): Promise<FerryTwin | null> {
  const t = await queryKusto(twinKql(vesselId), signal);
  // The table is deployed by DatabaseSchema.kql but is only populated when the
  // .NET simulator is running, so an empty result is the normal case rather
  // than an error. Report it as "no data" so the caller can fall back.
  if (t.Rows.length === 0) return null;
  const iDeck = colIndex(t, 'DeckId');
  const iVal = colIndex(t, 'MetricValue');
  const iAttr = colIndex(t, 'Attributes');
  const byDeck = new Map<string, DeckOccupancy>();
  for (const r of t.Rows) {
    const deck = String(r[iDeck]) as DeckId;
    const attr = parseAttributes(r[iAttr]);
    byDeck.set(deck, {
      deck,
      occupancy: Math.max(0, Math.round(Number(r[iVal]) || 0)),
      capacity: Number(attr['deck.capacity']) || defaultCapacity(deck),
    });
  }
  return {
    vesselId,
    asOf: new Date().toISOString(),
    decks: DECKS.map((d) => byDeck.get(d.deck) ?? { deck: d.deck, occupancy: 0, capacity: d.capacity }),
  };
}

function parseAttributes(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function defaultCapacity(deck: DeckId): number {
  return DECKS.find((d) => d.deck === deck)?.capacity ?? 100;
}

// --- Client-side fallback simulation (local dev / no Eventhouse) -------------

/** Stable per-vessel seed so each ferry has its own occupancy profile. */
function seedFor(vesselId: string): number {
  let h = 0;
  for (let i = 0; i < vesselId.length; i++) h = (h * 31 + vesselId.charCodeAt(i)) >>> 0;
  return h;
}

function simulateTwin(vesselId: string): FerryTwin {
  const seed = seedFor(vesselId);
  // A slow tide of boarding/alighting over ~a few minutes, unique per vessel.
  const phase = (Date.now() / 90_000 + (seed % 100) / 100) * Math.PI * 2;
  return {
    vesselId,
    asOf: new Date().toISOString(),
    decks: DECKS.map((d, i) => {
      const swing = (Math.sin(phase + i) + 1) / 2; // 0..1
      const load = d.deck === 'bridge' ? 0.6 : 0.25 + swing * 0.6;
      return { deck: d.deck, capacity: d.capacity, occupancy: Math.round(d.capacity * load) };
    }),
  };
}

/** Latest per-deck passenger occupancy for one ferry. */
export async function fetchFerryTwin(vesselId: string, signal?: AbortSignal): Promise<FerryTwin> {
  if (useDirectKusto) {
    try {
      // Falls back below when the twin table is absent (throws) or unpopulated
      // (returns null) — both mean "no telemetry", not "zero passengers".
      const twin = await fetchTwinDirect(vesselId, signal);
      if (twin) return twin;
    } catch {
      /* fall through to the simulation */
    }
  }
  return simulateTwin(vesselId);
}
