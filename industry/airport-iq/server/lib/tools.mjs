// Grounded airport-operations tools. Each tool reads the vendored ops snapshot
// for the requested airport and returns compact, LLM-friendly JSON. These are
// the deterministic tools the Foundry chat + realtime voice call.

import {
  loadSnapshot,
  resolveAirport,
  supportedAirports,
  nowMs,
  airlineName,
  flightsArray,
  delaysMap,
  routeLabel,
  assignmentAt,
  gateByNumber,
  flightByNumber
} from "./snapshot.mjs";

/** Tool definitions in Responses-API function shape. */
export function buildToolDefinitions() {
  return [
    {
      name: "get_ops_summary",
      description:
        "Return the overall operations state for the airport: total flights, arrivals vs departures, number of delayed flights and average delay, occupied gates, count of active (unresolved) gate conflicts, and the current snapshot time.",
      parameters: { type: "object", properties: {} }
    },
    {
      name: "list_delayed_flights",
      description:
        "List the most-delayed flights right now, sorted by delay minutes descending, with flight number, carrier, route, delay minutes, reason, and scope (arrival/departure).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max flights to return. Default 8." }
        }
      }
    },
    {
      name: "get_gate_conflicts",
      description:
        "Return the cascading gate conflicts: gate, home airline, the root delayed flight and its delay, the impacted flight that cannot dock, overlap minutes, and resolution status. This is the airport's headline operational risk.",
      parameters: { type: "object", properties: {} }
    },
    {
      name: "get_flight",
      description:
        "Return full detail for one flight number: carrier, aircraft type, route, scheduled/off-block/on-block times, status, runway, its gate assignment, and any delay.",
      parameters: {
        type: "object",
        properties: {
          flightNumber: { type: "string", description: "Flight number, e.g. U23837 or FL003837." }
        },
        required: ["flightNumber"]
      }
    },
    {
      name: "get_gate_status",
      description:
        "Return which flight occupies a specific gate now (or at a given ISO time), or report the gate is free. Includes the terminal and the occupancy window.",
      parameters: {
        type: "object",
        properties: {
          gateNumber: { type: "string", description: "Gate number, e.g. A03, or gate id like G001." },
          atTime: { type: "string", description: "Optional ISO-8601 UTC time. Defaults to the snapshot 'now'." }
        },
        required: ["gateNumber"]
      }
    },
    {
      name: "list_flights",
      description:
        "List flights filtered by direction (inbound/outbound), status, and/or carrier IATA code. Returns flight number, carrier, route, status, and scheduled time.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", description: "inbound or outbound. Optional." },
          status: { type: "string", description: "Flight status, e.g. arrived, boarding, en_route. Optional." },
          carrier: { type: "string", description: "Carrier IATA code, e.g. LH, U2, FR. Optional." },
          limit: { type: "number", description: "Max flights to return. Default 12." }
        }
      }
    }
  ];
}

function notConfigured(airport) {
  return {
    error: "no_snapshot",
    airport,
    supported: supportedAirports(),
    message: `No operations snapshot is available for ${airport}. Supported airports: ${supportedAirports().join(", ")}.`
  };
}

function flightBrief(snap, f) {
  return {
    flight: f.num,
    carrier: airlineName(snap, f.iata),
    direction: f.dir,
    route: routeLabel(snap, f),
    aircraft: f.actype,
    status: f.status
  };
}

/** Execute an airport tool. Context supplies the airport code. */
export function executeTool(toolName, args = {}, { airport, defaultAirport = "DUS" } = {}) {
  const code = resolveAirport(airport, defaultAirport);
  const snap = loadSnapshot(code);
  if (!snap) return notConfigured(code);
  const t = nowMs(snap);

  switch (toolName) {
    case "get_ops_summary": {
      const flights = flightsArray(snap);
      const inbound = flights.filter((f) => f.dir === "inbound").length;
      const outbound = flights.filter((f) => f.dir === "outbound").length;
      const delays = Object.values(delaysMap(snap));
      const delayMins = delays.map((d) => Number(d.min) || 0).filter((m) => m > 0);
      const avgDelay = delayMins.length
        ? Math.round(delayMins.reduce((a, b) => a + b, 0) / delayMins.length)
        : 0;
      const occupiedGates = new Set(
        (snap.assignments ?? [])
          .filter((a) => t >= Date.parse(a.s) && t <= Date.parse(a.e))
          .map((a) => a.gid)
      ).size;
      const conflicts = snap.conflicts ?? [];
      const unresolved = conflicts.filter((c) => c.resolution_status !== "resolved").length;
      return {
        airport: code,
        name: snap.meta?.name ?? code,
        now: snap.meta?.now,
        totalFlights: flights.length,
        arrivals: inbound,
        departures: outbound,
        delayedFlights: delayMins.length,
        averageDelayMinutes: avgDelay,
        maxDelayMinutes: delayMins.length ? Math.max(...delayMins) : 0,
        totalGates: (snap.gates ?? []).length,
        occupiedGatesNow: occupiedGates,
        gateConflicts: conflicts.length,
        unresolvedGateConflicts: unresolved
      };
    }

    case "list_delayed_flights": {
      const limit = Math.max(1, Math.min(Number(args.limit) || 8, 30));
      const delays = delaysMap(snap);
      const rows = Object.entries(delays)
        .map(([fid, d]) => {
          const f = snap.flights?.[fid];
          if (!f) return null;
          return {
            flight: f.num,
            carrier: airlineName(snap, f.iata),
            route: routeLabel(snap, f),
            delayMinutes: Number(d.min) || 0,
            reason: d.reason,
            scope: d.scope,
            direction: d.dir
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.delayMinutes - a.delayMinutes)
        .slice(0, limit);
      return { airport: code, now: snap.meta?.now, count: rows.length, delayedFlights: rows };
    }

    case "get_gate_conflicts": {
      const conflicts = (snap.conflicts ?? []).map((c) => ({
        gate: c.gate_number,
        terminal: c.terminal_id,
        homeAirline: airlineName(snap, c.home_airline),
        rootFlight: c.root_flight_number,
        rootDelayMinutes: c.root_delay_minutes,
        impactedFlight: c.impacted_flight_number,
        impactedCarrier: airlineName(snap, c.impacted_carrier),
        impactedNeedsGate: c.impacted_needs_gate,
        impactedCanDock: c.impacted_can_dock,
        overlapMinutes: c.overlap_minutes,
        cascadeDepth: c.cascade_depth,
        status: c.resolution_status,
        detectedAt: c.detected_at
      }));
      return { airport: code, now: snap.meta?.now, count: conflicts.length, conflicts };
    }

    case "get_flight": {
      const f = flightByNumber(snap, args.flightNumber);
      if (!f) {
        return { error: "flight_not_found", airport: code, flightNumber: args.flightNumber };
      }
      const assign = (snap.assignments ?? []).find((a) => a.fid === f.id);
      const delay = delaysMap(snap)[f.id] ?? null;
      return {
        airport: code,
        flight: f.num,
        carrier: airlineName(snap, f.iata),
        direction: f.dir,
        aircraft: f.actype,
        seats: f.seats,
        route: routeLabel(snap, f),
        status: f.status,
        runway: f.rwy,
        scheduledDeparture: f.sdep,
        scheduledArrival: f.sarr,
        offBlock: f.ob,
        onBlock: f.onb,
        gate: assign ? { number: assign.gnum, terminal: assign.term, from: assign.s, to: assign.e } : null,
        delay: delay ? { minutes: delay.min, reason: delay.reason, scope: delay.scope } : null
      };
    }

    case "get_gate_status": {
      const gate = gateByNumber(snap, args.gateNumber);
      if (!gate) return { error: "gate_not_found", airport: code, gateNumber: args.gateNumber };
      const atMs = args.atTime ? Date.parse(args.atTime) || t : t;
      const assign = assignmentAt(snap, gate.id, atMs);
      if (!assign) {
        return {
          airport: code,
          gate: gate.num,
          terminal: gate.term,
          at: new Date(atMs).toISOString(),
          occupied: false
        };
      }
      const f = snap.flights?.[assign.fid];
      return {
        airport: code,
        gate: gate.num,
        terminal: gate.term,
        at: new Date(atMs).toISOString(),
        occupied: true,
        flight: f ? flightBrief(snap, f) : { flight: assign.fid },
        window: { from: assign.s, to: assign.e }
      };
    }

    case "list_flights": {
      const limit = Math.max(1, Math.min(Number(args.limit) || 12, 40));
      const dir = args.direction ? String(args.direction).toLowerCase() : null;
      const status = args.status ? String(args.status).toLowerCase() : null;
      const carrier = args.carrier ? String(args.carrier).toUpperCase() : null;
      const rows = flightsArray(snap)
        .filter((f) => (dir ? f.dir === dir : true))
        .filter((f) => (status ? String(f.status).toLowerCase() === status : true))
        .filter((f) => (carrier ? f.iata === carrier : true))
        .sort((a, b) => Date.parse(a.sdep) - Date.parse(b.sdep))
        .slice(0, limit)
        .map((f) => ({
          flight: f.num,
          carrier: airlineName(snap, f.iata),
          direction: f.dir,
          route: routeLabel(snap, f),
          status: f.status,
          scheduledDeparture: f.sdep,
          scheduledArrival: f.sarr
        }));
      return { airport: code, count: rows.length, flights: rows };
    }

    default:
      return { error: "unknown_tool", tool: toolName };
  }
}
