import * as THREE from 'three';

import { toWorld, type WorldExtent } from '@/geo/world';

/**
 * The shuttle between an AOI's campuses.
 *
 * OTH Regensburg teaches on two sites 3 km apart and LMU on two more; "which cohorts have to cross
 * town between two lectures" is a question both of them asked out loud. The walk lens already
 * answers it as a number. This answers it as a thing you can watch: a vehicle on the actual road,
 * leaving one campus and arriving at the other.
 *
 * ⚠️ **THE ROUTE IS THE ROAD, NOT THE FOOTPATH.** `walk-routes.json` already contains a measured
 * 3.5 km path between OTH's campuses, and reusing it would have saved a build step. It runs over
 * footways and through a park. A bus driving down it, in a photoreal twin, in front of people who
 * know that ground, would discredit everything else on the screen. `drive-route.json` is built
 * from the OSM road network for exactly this reason — see `tools/geodata/build_drive_route.py`.
 *
 * ⚠️ **THE CROSSING RUNS AT THE MEASURED DRIVING TIME, AND THE FIRST VERSION DID NOT.** That one
 * crossed in a fixed twelve seconds, chosen so a whole journey could be watched end to end from a
 * wide shot. Measured on screen, that works out at 250 m/s — about 900 km/h — and the moment the
 * camera came down to street level the bus was a streak that crossed the frame between two frames.
 * A twin whose vehicles move at nine hundred kilometres an hour is a cartoon, and the caveat it
 * needed in the panel ("the animation is not to scale") was a sign the design was wrong rather
 * than a thing worth explaining. It now drives the time the road actually takes, which is honest
 * at every zoom and needs no footnote. The cost is real and accepted: a full crossing takes about
 * five minutes, so you watch a bus that is under way rather than a whole journey.
 *
 * ⚠️ **AND THEN A COMPRESSED CROSSING CAME BACK, ON PURPOSE, AS A SEPARATE THING.** Watching a bus
 * that is merely under way does not answer "can this cohort actually make it", which is the
 * question the walk list asks. `playJourney()` runs ONE crossing in a handful of wall-clock seconds
 * so the whole trip can be watched on demand, triggered by clicking a transfer that needs the bus.
 *
 * That is the speed the paragraph above rejects, so it is worth being exact about what changed:
 *
 *   - The AMBIENT shuttle is UNTOUCHED. While the week plays it still drives `leg.driveSeconds`,
 *     because that one presents itself as the campus as it is.
 *   - A JOURNEY is asked for, is over in seconds, and reports its own compression through
 *     `journey()` so the interface can put the factor on screen. ⚠️ The original mistake was not
 *     the speed, it was a vehicle moving at 900 km/h while presenting itself as a real one. A
 *     replay that says "5.2 min in 10 s, 31x" makes no such claim, and the panel is required to
 *     show that factor: `journey()` exists so the number cannot be quietly dropped.
 *   - ⚠️ NOTHING HERE MAY BE USED TO COMPUTE A TRAVEL TIME. The figure a planner acts on comes from
 *     `walk-routes.json` and is unaffected by how fast the picture moves. This module animates.
 */

const BUS_LENGTH_M = 12;
const BUS_WIDTH_M = 2.55;
const BUS_HEIGHT_M = 3.2;

/** Lifted clear of the road surface so the terrain does not z-fight through the wheels. */
const LIFT_M = 1.2;

/**
 * How long it waits at each end before turning round.
 *
 * The crossing itself is not a constant: it is `leg.driveSeconds`, straight from the road network.
 */
const STOP_SECONDS = 8;

export const BUS_PART = {
  body: 0,
  glass: 1,
  tyre: 2,
  light: 3,
} as const;

/**
 * A city bus, procedurally.
 *
 * ⚠️ BUILT ALONG +X AND THEN ROTATED SO +Z IS FORWARD. The heading below is
 * `atan2(dir.x, dir.z)`, which measures from +Z; a body modelled along +X without this rotation
 * drives sideways down every street. PHOENIX's van model records the same one-line fix, and it is
 * cheaper to copy the lesson than to re-derive it from a bus crabbing along the Galgenbergstraße.
 */
export function createBusGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const wheelR = 0.5;
  const floor = wheelR * 1.6;

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, part: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const tag = new Float32Array(g.attributes.position.count).fill(part);
    g.setAttribute('aPart', new THREE.BufferAttribute(tag, 1));
    parts.push(g);
  };

  // Body, sitting on the axles rather than on the ground.
  const bodyH = BUS_HEIGHT_M - floor;
  box(BUS_LENGTH_M, bodyH, BUS_WIDTH_M, 0, floor + bodyH / 2, 0, BUS_PART.body);

  // Windows: one band per side, plus the windscreen. Inset a hair so they read as glass rather
  // than as paint.
  const bandH = bodyH * 0.42;
  const bandY = floor + bodyH * 0.62;
  box(BUS_LENGTH_M * 0.9, bandH, BUS_WIDTH_M + 0.06, 0, bandY, 0, BUS_PART.glass);
  box(0.12, bandH * 1.05, BUS_WIDTH_M * 0.92, BUS_LENGTH_M / 2, bandY, 0, BUS_PART.glass);

  // Four wheels on two axles.
  for (const x of [BUS_LENGTH_M * 0.34, -BUS_LENGTH_M * 0.3]) {
    for (const z of [BUS_WIDTH_M / 2 - 0.12, -BUS_WIDTH_M / 2 + 0.12]) {
      const g = new THREE.CylinderGeometry(wheelR, wheelR, 0.28, 12);
      g.rotateX(Math.PI / 2);
      g.translate(x, wheelR, z);
      const tag = new Float32Array(g.attributes.position.count).fill(BUS_PART.tyre);
      g.setAttribute('aPart', new THREE.BufferAttribute(tag, 1));
      parts.push(g);
    }
  }

  // Headlights, so the front is readable at a distance and the heading is obvious.
  for (const z of [BUS_WIDTH_M / 2 - 0.45, -BUS_WIDTH_M / 2 + 0.45]) {
    box(0.14, 0.3, 0.5, BUS_LENGTH_M / 2, floor + 0.3, z, BUS_PART.light);
  }

  const merged = mergeGeometries(parts);
  merged.rotateY(-Math.PI / 2);
  return merged;
}

const CAR_LENGTH_M = 4.7;
const CAR_WIDTH_M = 1.98;
const CAR_HEIGHT_M = 1.21;

/**
 * ⚠️ AN EASTER EGG. Reachable only by typing the cheat word; nothing in the interface offers it.
 *
 * A mid-engine sports car, procedurally, in the same part-tagged style as the bus so it drops into
 * the identical shader and the identical journey code. Real proportions rather than cartoon ones:
 * 4.70 x 1.98 x 1.21 m is roughly an F8, and it stays under the "objects are never exaggerated"
 * rule that the rest of this project holds to. The joke is the SPEED and the noise, not a
 * twelve-metre Ferrari.
 *
 * Same +X-then-rotate convention as `createBusGeometry`, and for the same reason: the heading is
 * `atan2(dir.x, dir.z)`, so a body modelled along +X without the final rotation drives sideways.
 */
export function createCarGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const wheelR = 0.34;
  const halfL = CAR_LENGTH_M / 2;

  // ⚠️ ALL PARTS ARE FLATTENED TO NON-INDEXED BEFORE MERGING. `mergeGeometries` refuses a mix,
  // and the profiles below are ExtrudeGeometry (non-indexed) while boxes and cylinders are
  // indexed. Without this the merge returns null and the cheat draws nothing at all.
  const push = (g: THREE.BufferGeometry, part: number) => {
    const flat = g.index ? g.toNonIndexed() : g;
    const tag = new Float32Array(flat.attributes.position.count).fill(part);
    flat.setAttribute('aPart', new THREE.BufferAttribute(tag, 1));
    parts.push(flat);
  };

  /** Extrude a side-on silhouette across the car's width, centred on z. */
  const profile = (points: [number, number][], width: number, part: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    g.translate(0, 0, -width / 2);
    push(g, part);
  };

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, part: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    push(g, part);
  };

  // ⚠️ THE SILHOUETTE IS THE WHOLE JOB, AND STACKED BOXES CANNOT DO IT. The first attempt was a
  // low sill plus a set-back upper box, with a comment asserting that a dropped nose "makes it
  // read as a Ferrari rather than a van". Rendered and looked at, it read as a red PICKUP TRUCK:
  // a square cab set forward over a flat load bed. Every test still passed, because bounding
  // boxes only prove it is car-SIZED. What separates a sports car from a truck is the profile
  // curve, so the body is now an extruded side view: low splitter, fender crest over the front
  // wheel, a dropped cowl, and a rising rear haunch.
  //
  // ⚠️ AND THE SECOND ATTEMPT HAD NO VISIBLE WHEELS, WHICH ALSO ONLY SHOWED UP IN A SCREENSHOT.
  // A solid extrusion has no wheel arches cut into it, and the tyres sit INBOARD of the body
  // sides (z = ±0.82 against a half-width of 0.99). So a tyre can only ever be seen through the
  // gap BELOW the rocker line, and that gap was 12 cm: the car looked like a slot-car body lying
  // flat on the road. `ROCKER_Y` is therefore load-bearing rather than styling. The overhangs
  // still dip lower than it, at the splitter and the diffuser, because nothing is under them.
  const ROCKER_Y = 0.27;
  const body: [number, number][] = [
    [halfL, 0.14],          // front splitter, almost on the road
    [halfL - 0.05, 0.50],   // low nose
    [1.58, 0.66],           // front fender crest, over the front wheel
    [1.00, 0.63],           // cowl, dipped: the base of the windscreen
    [0.52, 0.71],           // beltline begins
    [-1.42, 0.77],          // beltline under the cabin
    [-1.94, 0.85],          // rear haunch, the high point of the tail
    [-halfL, 0.72],         // tail
    [-halfL, 0.40],         // ── underside, running back to front ──
    [-2.02, 0.30],          // rear diffuser
    [-1.72, ROCKER_Y],
    [1.72, ROCKER_Y],       // the rocker: this gap is what makes the tyres visible
    [2.06, 0.24],
    [halfL, 0.14],
  ];
  profile(body, CAR_WIDTH_M, BUS_PART.body);

  // The greenhouse: a fastback wedge, narrower than the body so it sits inboard the way a real
  // cabin does. `CAR_HEIGHT_M` is the roof, so the stated height is the drawn height.
  const cabin: [number, number][] = [
    [0.52, 0.70],           // foot of the windscreen
    [-0.34, CAR_HEIGHT_M],  // top of a steeply raked screen
    [-0.98, CAR_HEIGHT_M - 0.02],
    [-1.42, 0.76],          // rear screen, falling away to the engine deck
    [0.52, 0.70],
  ];
  profile(cabin, CAR_WIDTH_M * 0.82, BUS_PART.glass);

  // Four fat tyres on a 2.90 m wheelbase, kept inside the body width so the car stays 1.98 m wide.
  for (const x of [1.45, -1.45]) {
    for (const z of [CAR_WIDTH_M / 2 - 0.17, -CAR_WIDTH_M / 2 + 0.17]) {
      const g = new THREE.CylinderGeometry(wheelR, wheelR, 0.3, 14);
      g.rotateX(Math.PI / 2);
      g.translate(x, wheelR, z);
      push(g, BUS_PART.tyre);
    }
  }

  // Headlights and tail lights, so the heading reads at a glance.
  for (const z of [CAR_WIDTH_M / 2 - 0.36, -CAR_WIDTH_M / 2 + 0.36]) {
    box(0.1, 0.13, 0.34, halfL - 0.14, 0.44, z, BUS_PART.light);
    box(0.08, 0.12, 0.26, -halfL + 0.05, 0.62, z, BUS_PART.light);
  }

  const merged = mergeGeometries(parts);
  merged.rotateY(-Math.PI / 2);
  return merged;
}

/** Minimal merge: every part is a non-indexed box/cylinder with the same attribute set. */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'aPart']) {
    const arrays = nonIndexed.map((g) => g.attributes[name].array as Float32Array);
    const size = nonIndexed[0].attributes[name].itemSize;
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const merged = new Float32Array(total);
    let at = 0;
    for (const a of arrays) {
      merged.set(a, at);
      at += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, size));
  }
  for (const g of nonIndexed) g.dispose();
  return out;
}

const VERTEX = /* glsl */ `
in float aPart;
out float vPart;
out vec3 vNormal;
void main() {
  vPart = aPart;
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
in float vPart;
in vec3 vNormal;
out vec4 outColour;
uniform vec3 uBody;

void main() {
  vec3 colour = uBody;
  float emissive = 0.0;
  if (vPart > 2.5)      { colour = vec3(1.0, 0.95, 0.82); emissive = 1.0; }
  else if (vPart > 1.5) { colour = vec3(0.07, 0.07, 0.08); }
  else if (vPart > 0.5) { colour = vec3(0.10, 0.14, 0.18); }

  // A single fixed key light. The campus is lit by an environment this vehicle does not sample,
  // and matching it exactly matters far less than the shape reading as solid from every angle.
  float lambert = max(dot(normalize(vNormal), normalize(vec3(0.4, 0.9, 0.2))), 0.0);
  outColour = vec4(colour * mix(0.45 + 0.75 * lambert, 1.0, emissive), 1.0);
}
`;

export interface DriveLeg {
  from: string;
  to: string;
  distanceM: number;
  driveSeconds: number;
  points: [number, number][];
}

/** What is driving the road. `sportscar` is reachable only through the cheat word. */
export type VehicleKind = 'bus' | 'sportscar';

/** ⚠️ Not a licensed anything. A saturated red that reads as "sports car" at 200 m. */
const SPORTSCAR_COLOUR = 0xd8121a;

/**
 * How tall the cheat car is DRAWN. A two-storey house.
 *
 * ⚠⚠ THE ONE EXAGGERATED OBJECT IN THIS SCENE, AND THE ONLY ONE THAT MAY EVER BE. The standing
 * rule is that objects are never exaggerated, because a twin's whole claim is that what you see is
 * the site. This is the documented exception, and it follows `FIGURE_SCALE` in `walkRoute.ts`
 * exactly: PLAN §57.3 allows a size to be inflated when **the size carries no claim** and only
 * decides whether you can see the thing at all.
 *
 * The cheat car qualifies more cleanly than the walking figures do:
 *   - it is a JOKE behind a hidden word, not a statement about OTH's shuttle;
 *   - every claim the layer makes — 2 990 m, 312 s, the compression factor, the routed road — is
 *     carried by numbers and by the path, none of which this touches;
 *   - at the framing this app opens on, ~2.3 m per pixel, a real 4.7 m car is TWO PIXELS. The
 *     honest version of this easter egg is invisible, which is the same failure `FIGURE_SCALE`
 *     exists to fix.
 *
 * ⚠️ THE BUS IS NEVER SCALED, AND THAT IS THE LINE. The bus is the honest vehicle on the honest
 * road; it is what a customer sees and it stays 12 m. If this constant ever reaches the bus, the
 * demo is lying about the site rather than telling a joke. `cheatCar.test.ts` asserts it.
 *
 * ⚠️ AND IT IS APPLIED TO THE MESH, NOT BAKED INTO THE GEOMETRY. `createCarGeometry()` stays a
 * real 4.7 x 1.98 x 1.21 m car, so the model remains checkable against reality and the size
 * assertions on it keep their meaning. Presentation is scaled; the model is not.
 */
const SPORTSCAR_CHEAT_HEIGHT_M = 8;

/**
 * Derived, never hand-typed — so changing the target height above cannot leave a stale factor
 * behind, which is the mistake `CAR_HEIGHT_M` itself was written to prevent (see the 1.10-vs-1.21
 * note on `createCarGeometry`).
 *
 * At 8 m tall the car is drawn roughly 31 m long and 13 m wide: a house-sized object, and about
 * thirteen pixels at the opening camera instead of two.
 */
export const SPORTSCAR_CHEAT_SCALE = SPORTSCAR_CHEAT_HEIGHT_M / CAR_HEIGHT_M;

export interface ShuttleLayer {
  group: THREE.Group;
  /** Advance the animation. `seconds` is wall clock, not the week. */
  tick(seconds: number): void;
  setVisible(visible: boolean): void;
  visible(): boolean;
  /** Scene position, for tests and for anything that wants to follow it. */
  position(): { x: number; z: number } | null;
  legs(): DriveLeg[];
  /**
   * Run ONE crossing in `wallClockSeconds`, then hand back to the ambient loop.
   *
   * ⚠️ `reverse` matters and is not cosmetic. The walk list is read per transfer, and a cohort
   * going Prüfening to Seybothstraße watching a bus drive the other way would be shown the right
   * road and the wrong journey, which is the kind of nearly-right that nobody reports as a bug.
   */
  playJourney(wallClockSeconds: number, reverse?: boolean): void;
  /**
   * Swap the vehicle. ⚠️ `sportscar` is an easter egg behind a cheat word and nothing else.
   *
   * The journey code, the road and the compression are identical either way: only the mesh and
   * the paint change. That is deliberate. A cheat that also altered the route or the reported
   * factor would be a second code path capable of lying, and this one is a joke about a car.
   */
  setVehicle(kind: VehicleKind): void;
  vehicle(): VehicleKind;
  /**
   * The journey in progress, or null.
   *
   * ⚠️ THE INTERFACE IS EXPECTED TO RENDER `factor`. This returns it rather than just a progress
   * bar precisely so the compression cannot be shown without its scale, which is the whole reason
   * a fast crossing is acceptable here at all. See the module header.
   */
  journey(): {
    progress: number;
    factor: number;
    realSeconds: number;
    shownSeconds: number;
    reverse: boolean;
  } | null;
  dispose(): void;
}

export async function loadShuttle(
  aoiId: string,
  base: string,
  ext: WorldExtent,
  groundAt: (x: number, z: number) => number | null,
  bodyColour = 0xc9532b
): Promise<ShuttleLayer | null> {
  let doc: { legs?: DriveLeg[] };
  try {
    const response = await fetch(`${base}/${aoiId}/drive-route.json`);
    if (!response.ok) return null;
    doc = await response.json();
  } catch {
    // A site with one campus has no route file, and that is not an error — it has nowhere to
    // drive to. Returning null keeps the scene identical to what it was before this layer existed.
    return null;
  }
  const legs = (doc.legs ?? []).filter((l) => l.points.length > 1);
  if (!legs.length) return null;

  const group = new THREE.Group();
  group.name = 'shuttle';

  // One leg for now — the AOIs have two campuses each. More legs would need a schedule to decide
  // which one is running, and inventing a timetable is exactly what this layer must not do.
  const leg = legs[0];
  const points = leg.points.map(([lon, lat]) => {
    const flat = toWorld(lon, lat, ext, 0);
    const ground = groundAt(flat.x, flat.z);
    return new THREE.Vector3(flat.x, (ground ?? 0) + LIFT_M, flat.z);
  });

  // Cumulative length, so the vehicle moves at a constant speed rather than at a constant number
  // of points per second — OSM digitises corners densely and straights sparsely, and stepping by
  // index makes a bus crawl round bends and rocket down the straight bits.
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const total = cumulative[cumulative.length - 1];

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uBody: { value: new THREE.Color(bodyColour) } },
  });
  const mesh = new THREE.Mesh(createBusGeometry(), material);
  mesh.frustumCulled = false;
  group.add(mesh);

  let kind: VehicleKind = 'bus';

  let elapsed = 0;
  let here: { x: number; z: number } | null = null;
  const up = new THREE.Vector3(0, 1, 0);

  /**
   * A crossing the user asked to watch, compressed into wall-clock seconds.
   *
   * ⚠️ HELD SEPARATELY FROM `elapsed`, AND THE HANDOVER BACK IS THE HARD PART. The obvious
   * implementation fast-forwards `elapsed`, which leaves the ambient cycle five minutes ahead the
   * instant the replay ends. The second-most obvious one, written first here, leaves `elapsed`
   * running untouched: the bus then drives the whole road in ten seconds and TELEPORTS BACK to
   * wherever the ambient clock had crept to, about 100 m from where it started. It looked like the
   * replay had not happened at all.
   *
   * So a finished replay RESETS the ambient clock to the moment of arrival: standing at the far
   * campus at the start of its dwell. The bus arrives, waits, and drives back in its own time,
   * which is what it would have done had you watched the whole five minutes.
   */
  let journey: { wall: number; at: number; real: number; reverse: boolean } | null = null;

  const at = (distance: number): { pos: THREE.Vector3; dir: THREE.Vector3 } => {
    const clamped = Math.min(Math.max(distance, 0), total);
    let i = 1;
    while (i < cumulative.length - 1 && cumulative[i] < clamped) i += 1;
    const span = cumulative[i] - cumulative[i - 1] || 1;
    const local = (clamped - cumulative[i - 1]) / span;
    const pos = new THREE.Vector3().lerpVectors(points[i - 1], points[i], local);
    const dir = new THREE.Vector3().subVectors(points[i], points[i - 1]);
    if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
    return { pos, dir: dir.normalize() };
  };

  const apply = () => {
    // The road's own time, so the vehicle moves at the speed the network says it can.
    const crossing = Math.max(leg.driveSeconds, 30);

    let distance: number;
    let reverse = false;

    if (journey) {
      // ⚠️ CLAMPED, NOT WRAPPED. A replay that ran past its end and looped would put the bus back
      // at the start line looking like it had never left, one frame after arriving.
      const progress = Math.min(Math.max(journey.at / journey.wall, 0), 1);
      distance = (journey.reverse ? 1 - progress : progress) * total;
      reverse = journey.reverse;
    } else {
      const cycle = 2 * (crossing + STOP_SECONDS);
      const phase = ((elapsed % cycle) + cycle) % cycle;

      if (phase < crossing) {
        distance = (phase / crossing) * total;
      } else if (phase < crossing + STOP_SECONDS) {
        distance = total;
      } else if (phase < 2 * crossing + STOP_SECONDS) {
        const back = (phase - crossing - STOP_SECONDS) / crossing;
        distance = (1 - back) * total;
        reverse = true;
      } else {
        distance = 0;
        reverse = true;
      }
    }

    const { pos, dir } = at(distance);
    if (reverse) dir.negate();
    mesh.position.copy(pos);
    mesh.quaternion.setFromAxisAngle(up, Math.atan2(dir.x, dir.z));
    here = { x: pos.x, z: pos.z };
  };

  apply();

  return {
    group,
    tick(seconds) {
      if (journey) {
        journey.at += seconds;
        if (journey.at >= journey.wall) {
          // ⚠️ HAND BACK AT THE ARRIVAL, NOT AT WHATEVER THE AMBIENT CLOCK SAYS. Setting the
          // ambient phase to the start of the dwell at the end just reached is what stops the bus
          // snapping back across town one frame after it arrives. Forward journeys finish at the
          // far campus (phase == crossing); reverse ones finish at home.
          const crossing = Math.max(leg.driveSeconds, 30);
          elapsed = journey.reverse ? 2 * crossing + STOP_SECONDS : crossing;
          journey = null;
        }
      } else {
        elapsed += seconds;
      }
      apply();
    },
    playJourney(wallClockSeconds, reverse = false) {
      // A zero or negative duration would divide by zero and put the bus at NaN, which renders as
      // nothing at all and reads as "the feature is broken" rather than "you asked for 0 seconds".
      const wall = Math.max(0.5, wallClockSeconds);
      journey = { wall, at: 0, real: Math.max(leg.driveSeconds, 30), reverse };
      apply();
    },
    setVehicle(next) {
      if (next === kind) return;
      kind = next;
      // ⚠️ THE OLD GEOMETRY IS DISPOSED, NOT ORPHANED. Swapping `mesh.geometry` without disposing
      // leaks a GPU buffer on every toggle, and a cheat word is exactly the thing somebody types
      // twenty times in a row to watch it again.
      const previous = mesh.geometry;
      mesh.geometry = next === 'sportscar' ? createCarGeometry() : createBusGeometry();
      previous.dispose();
      // ⚠️ SET BOTH WAYS, NEVER TOGGLED. Scaling on the way in and forgetting to reset on the way
      // out leaves a 79 m bus on the road, which is the exact failure the standing no-exaggeration
      // rule exists to prevent — and it would arrive by accident, in the honest vehicle, after the
      // joke was over. Both geometries sit on y = 0, so a uniform scale keeps the wheels on the
      // road rather than sinking the car into the terrain.
      mesh.scale.setScalar(next === 'sportscar' ? SPORTSCAR_CHEAT_SCALE : 1);
      (material.uniforms.uBody.value as THREE.Color).set(
        next === 'sportscar' ? SPORTSCAR_COLOUR : bodyColour
      );
      apply();
    },
    vehicle() {
      return kind;
    },
    journey() {
      if (!journey) return null;
      const progress = Math.min(Math.max(journey.at / journey.wall, 0), 1);
      return {
        progress,
        factor: journey.real / journey.wall,
        realSeconds: journey.real,
        shownSeconds: journey.wall,
        reverse: journey.reverse,
      };
    },
    setVisible(visible) {
      group.visible = visible;
    },
    visible() {
      return group.visible;
    },
    position() {
      return group.visible ? here : null;
    },
    legs() {
      return legs;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
