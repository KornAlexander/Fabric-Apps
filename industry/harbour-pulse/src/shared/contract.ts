/**
 * Data contract shared by the KQL query layer and the 3D frontend.
 * Mirrors the SydneyFerries / ReferenceLocation tables in the Eventhouse.
 */

/** One ferry's latest known position. `id` is the ferry_name business key. */
export interface Ferry {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Free-text schedule, e.g. "01:25pm Mosman Bay - Circular Quay". */
  destination: string;
  /** Epoch milliseconds of the sample. */
  ts: number;
}

/** A wharf / landmark from ReferenceLocation, used to dress the scene. */
export interface ReferenceLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** A ferry as presented in the UI: its position plus whatever we know about it. */
export interface HeroFerry {
  id: string;
  name: string;
  destination: string;
  headingDeg?: number;
  speedKn?: number;
  lastSeenMs?: number;
}

/** Payload returned by GET /api/ferries/live. */
export interface FerryFeed {
  asOf: string;
  ferries: Ferry[];
}

export interface ReferenceFeed {
  locations: ReferenceLocation[];
}

/** One vessel in the fleet roster (every ferry ever seen, not just active ones). */
export interface FleetVessel {
  name: string;
  /** Epoch ms of the most recent position report for this vessel. */
  lastSeen: number;
}

/** Payload returned by GET /api/ferries/fleet. */
export interface FleetRoster {
  vessels: FleetVessel[];
}

/** One scheduled ferry departure from its origin wharf (TfNSW GTFS timetable). */
export interface FerryDeparture {
  /** Scheduled departure time, `HH:MM:SS` in Sydney local time. May exceed 24h for after-midnight trips. */
  time: string;
  /** Route code, e.g. "F1". */
  route: string;
  /** Trip headsign / destination, e.g. "Manly". */
  headsign: string;
  /** Origin wharf name. */
  from: string;
  /** GTFS trip_id. */
  tripId: string;
}

/** A single deck of a ferry in the digital twin. */
export type DeckId = 'lower' | 'upper' | 'bridge';

/** Latest passenger occupancy for one deck, from the digital-twin telemetry. */
export interface DeckOccupancy {
  deck: DeckId;
  /** People currently on this deck. */
  occupancy: number;
  /** Deck capacity (from the telemetry attributes). */
  capacity: number;
}

/**
 * Per-ferry digital-twin snapshot: how many passengers are on each deck right
 * now. Sourced from the `FerryTwinTelemetry` OpenTelemetry metrics in Fabric.
 */
export interface FerryTwin {
  vesselId: string;
  asOf: string;
  decks: DeckOccupancy[];
}

/** Payload returned by GET /api/ferries/schedule. */
export interface FerryScheduleFeed {
  /** Service date the schedule was computed for (`YYYY-MM-DD`, Sydney). */
  date: string;
  /** ISO timestamp the feed was built. */
  asOf: string;
  /** Number of departures in this payload. */
  count: number;
  departures: FerryDeparture[];
}

/**
 * Pre-rendered multi-day timetable shipped with the static build.
 *
 * The TfNSW GTFS feed needs a secret API key, so it cannot be called from the
 * browser. The bundle therefore carries a snapshot generated at build time and
 * the client selects the entry matching the current Sydney service date.
 */
export interface ScheduleSnapshot {
  /** ISO timestamp the snapshot was generated. */
  generatedAt: string;
  /** Origin departures keyed by service date (`YYYY-MM-DD`, Sydney). */
  byDate: Record<string, FerryDeparture[]>;
}

/** A pre-departure / in-service checklist area. */
export type CheckCategory =
  | 'vessel'
  | 'navigation'
  | 'safety'
  | 'crew'
  | 'passenger'
  | 'compliance';

/** Outcome an operator records for a single checklist item. */
export type CheckStatus = 'ok' | 'issue' | 'na';

/** One operator-logged checklist result for a vessel (mirrors VesselCheck). */
export interface VesselCheck {
  id: string;
  /** Vessel business key (ferry_name). */
  ferryName: string;
  category: CheckCategory;
  /** The specific item checked, e.g. "Bilge pumps operational". */
  item: string;
  status: CheckStatus;
  notes?: string;
  inspector?: string;
  /** Epoch milliseconds the check was logged. */
  ts: number;
}

/** Fields supplied when an operator logs a new check. */
export interface NewVesselCheck {
  ferryName: string;
  category: CheckCategory;
  item: string;
  status: CheckStatus;
  notes?: string;
  inspector?: string;
}
