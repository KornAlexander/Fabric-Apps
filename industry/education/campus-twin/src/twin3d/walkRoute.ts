import * as THREE from 'three';

import { toWorld, type WorldExtent } from '@/geo/world';

/**
 * The walk between two buildings, drawn on the ground it actually crosses.
 *
 * A number in a panel ("6 Minuten") is unverifiable — the reader has no way to tell a routed answer
 * from a straight line times a fudge factor. Drawing the line is what makes it checkable: anyone who
 * knows the campus can see at a glance whether the route goes round the building or through it,
 * which is the whole reason a campus map exists.
 *
 * ⚠️ ONE ROUTE AT A TIME, ON PURPOSE. This is not the flow layer: that one answers "where does the
 * load fall" for the whole week and needs its own aggregation. This answers "can I get from my
 * lecture to my next one", which is a question about one person and one gap, and drawing every
 * possible walk at once would answer neither.
 */

const VERTEX = /* glsl */ `
in float aSide;
in float aAlong;

out float vSide;
out float vAlong;

uniform float uWidth;

void main() {
  vSide = aSide;
  vAlong = aAlong;

  // The normal attribute carries the ribbon's sideways direction, computed on the CPU where the
  // neighbouring points are known. Widening here rather than in the buffer keeps the line legible
  // when the camera pulls back without rebuilding geometry.
  vec3 p = position + normal * aSide * uWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

in float vSide;
in float vAlong;
out vec4 outColour;

uniform float uTime;
uniform vec3 uColour;
uniform float uOpacity;
uniform float uLength;

void main() {
  // Soft edges so the route reads as a painted line rather than a strip of tape.
  float across = 1.0 - abs(vSide);
  float edge = smoothstep(0.0, 0.35, across);

  // A dash travelling from origin to destination. It carries the DIRECTION of the walk, which a
  // static line cannot, and direction is what tells you which end is the lecture you are leaving.
  float dashes = uLength / 14.0;
  float travel = fract(vAlong * dashes - uTime * 0.8);
  float dash = smoothstep(0.15, 0.45, travel) * smoothstep(1.0, 0.75, travel);

  outColour = vec4(uColour * (0.65 + 0.6 * dash), uOpacity * edge * (0.55 + 0.45 * dash));
}
`;

export interface WalkRouteLayer {
  group: THREE.Group;
  /**
   * Draw one route. Points are [lon, lat] pairs in order of travel.
   *
   * `people` is the cohort making the transfer. Pass it ONLY when the timetable actually states
   * one — see `crowd()` — and the single figure is replaced by that many. Omit it and the lone
   * walker is drawn exactly as before.
   */
  show(points: [number, number][], colour?: THREE.ColorRepresentation, people?: number | null): void;
  clear(): void;
  /** How many points are on screen right now. Zero means nothing is drawn. */
  drawn(): number;
  /** Centre and extent of the drawn route, so a camera can frame it. Null when nothing is drawn. */
  bounds(): { centre: THREE.Vector3; spanM: number } | null;
  /**
   * Where the walking figure is, and how far along. Null when no route is drawn.
   *
   * `seconds` is the whole walk at `WALK_SPEED_MS`, which is what makes this checkable: the
   * figure is not a decoration moving at an arbitrary rate, it takes the time the panel claims.
   *
   * ⚠️ Still reported when a CROWD is drawn, and it then describes the person at the FRONT.
   * Tests that time the walk keep working unchanged whether one figure or two hundred are on
   * screen, because the leader moves at the same 1.35 m/s the lone walker always did.
   */
  walker(): { x: number; z: number; progress: number; seconds: number } | null;
  /**
   * The crowd on the route, or null when the walk is drawn with the single figure.
   *
   * `people` is what the timetable says; `drawn` is how many are actually on screen. They differ
   * only when a cohort is larger than `CROWD_CAP`, and the difference is reported rather than
   * hidden so a caller can say "240" while showing fewer.
   */
  crowd(): { people: number; drawn: number } | null;
  update(elapsed: number): void;
  dispose(): void;
}

/**
 * ⚠️ THE SAME 1.35 m/s THE DATASET USED, and it has to stay that way.
 *
 * `walk-routes.json` records `walkSpeedMs: 1.35` and derives every `minutes` figure in the walk
 * panel from it. A figure animated at any other speed would contradict the number printed beside
 * it — and of the two, the moving one is the one people believe. If the dataset's assumption ever
 * changes, this changes with it.
 */
const WALK_SPEED_MS = 1.35;

/**
 * How large a figure is drawn, as a multiple of life size.
 *
 * ⚠️ THE ONE DELIBERATE EXAGGERATION IN THIS LAYER, AND IT IS THE ONLY ONE ALLOWED. A real person
 * is 1.75 m on a site 2 km across: at the framing this app actually uses that is well under a
 * pixel, so a true-scale crowd is an empty path and the feature does not exist. The figures are
 * therefore drawn deliberately oversized and deliberately cartoonish, which is the honest way to
 * do it — nobody mistakes a comic figure four times human height for a survey of where people
 * stand.
 *
 * ⚠️ WHAT IS *NOT* EXAGGERATED, AND MUST NEVER BE: the SPEED (1.35 m/s, the dataset's own), the
 * ROUTE (the real routed footpath), and the COUNT (`expectedAttendance` from the timetable). Those
 * three carry every claim this layer makes. Size carries none — it only decides whether you can
 * see them. If somebody later wants the crowd bigger, this constant is the only thing to touch,
 * and it must not acquire a friend: two multipliers in different files is how a 6.4 m house ends
 * up drawn as a 38 m tower elsewhere in this project.
 */
const FIGURE_SCALE = 4;

/**
 * The most figures drawn at once.
 *
 * ⚠️ MEASURED ACROSS EVERY DATASET, AND THE FIRST VERSION OF THIS COMMENT WAS WRONG. It said "the
 * largest cohort is 240, so at 320 nothing is ever truncated" — true of `data/synthetic`, which was
 * the only dataset actually looked at. TUM's real TUMonline export runs to **1 073** in a single
 * session, so that cap would have silently drawn less than a third of the biggest lecture on the
 * site the walk routing was rebuilt for. Measured maxima, per scheduler site:
 *
 *   tum 1073 · tuebingen 236 · aachen 233 · lmu 232 · muenster 232 · fau 230 · koeln 206
 *   oth-real — none stated at all
 *
 * 1200 clears every one of them. The cost of a high cap is small: this is one `InstancedMesh`, so
 * the figures are a single draw call and the per-frame work is a matrix compose each, which is
 * nothing next to the terrain. When the cap does bite, `crowd().drawn` reports the smaller number
 * instead of pretending.
 */
const CROWD_CAP = 1200;

/**
 * How many people get out of the door per second, used to work out how far the crowd stretches.
 *
 * ⚠️ AN ASSUMPTION, AND THE ONLY ONE HERE THAT AFFECTS THE PICTURE'S SHAPE. A cohort does not
 * leave a lecture hall in one instant — it filters out over a minute or two, so the tail of 240
 * people is a long way behind the head. The pedestrian-flow figure usually quoted for a doorway is
 * about 1.2–1.5 people per second per metre of clear width; 1.5 is the low-drama end of that for a
 * hall with more than one exit.
 *
 * The alternative, which was tried first, was a FIXED 60 m trail for everybody. It made 28 people
 * look right and 240 people look like a marching column — a solid block of bodies moving in step,
 * because the same length of path had to hold eight times as many of them. Deriving the trail from
 * a rate fixes the density at both ends and is the more defensible model anyway: a bigger cohort
 * really does take longer to clear the room.
 */
const DOOR_FLOW_PER_S = 1.5;

/**
 * The most of the route the crowd may occupy.
 *
 * Without this a large cohort on a short walk would have its tail still inside the building when
 * the leader arrived, which is true to life but reads as "the animation is broken" when the loop
 * restarts. Held to four fifths so there is always visible movement along the path.
 */
const CROWD_TRAIL_SHARE = 0.8;

/**
 * How far to either side of the path the crowd spreads, in metres, for a SMALL cohort.
 *
 * ⚠️ A FLOOR, NOT THE WIDTH — see `bandWidth()`. It was a fixed 7 m until 1 073 figures were drawn
 * for the first time and turned into a solid striped rope: at `FIGURE_SCALE`, each figure covers
 * about sixteen times its real footprint, so a corridor that reads well for a seminar of 28 has
 * physically no room for a full lecture hall and the figures end up standing inside one another.
 */
const CROWD_WIDTH_M = 7;

/**
 * Ground a walking figure needs to itself, in metres, before its neighbour starts overlapping it.
 *
 * A person is roughly half a metre across; at `FIGURE_SCALE = 4` that is drawn as two metres, and
 * 2.5 leaves a little air. This is the number that makes the crowd read as individuals rather than
 * as a mass, so it is expressed against the drawn size rather than the real one.
 */
const FIGURE_FOOTPRINT_M = 2.5;

/**
 * How wide the crowd fans out, given how many there are and how far back they trail.
 *
 * Keeps areal density roughly constant instead of the count: a cohort twice the size needs twice
 * the ground, and a real crowd of a thousand crossing a campus does fan across a plaza rather than
 * queueing down a seven-metre corridor.
 *
 * ⚠️ FLOORED AT `CROWD_WIDTH_M` SO THE SMALL CASES DO NOT MOVE. 28 and 240 figures were rendered
 * and looked at while tuning this layer (PLAN §57.4); widening them now would be changing pictures
 * that were already checked in order to fix one that was not.
 */
function bandWidth(people: number, trailM: number): number {
  const needed = (FIGURE_FOOTPRINT_M * FIGURE_FOOTPRINT_M * people) / Math.max(trailM, 1);
  return Math.max(CROWD_WIDTH_M, needed);
}

/**
 * Comic colours, so the crowd reads as people rather than as a smear.
 *
 * Deliberately saturated and deliberately not the route's own blue: the ribbon underneath stays
 * legible only if the figures on it are a different hue.
 */
const CROWD_COLOURS = [0xf4b23e, 0xe4572e, 0x38a3a5, 0x9b5de5, 0xf15bb5, 0x57cc99];

/** Roughly a person: 1.75 m to the top of the head. */
function createWalkerMesh(colour: THREE.ColorRepresentation): THREE.Group {
  const figure = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: colour });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.85, 4, 8), material);
  body.position.y = 0.42 + 0.55;
  figure.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), material);
  head.position.y = 1.58;
  figure.add(head);

  return figure;
}

/**
 * One comic figure, built once and drawn many times.
 *
 * Proportions are pushed on purpose: the head is more than twice life proportion, which is what
 * makes a shape read as "a person" at a distance where a correctly-proportioned head is a couple
 * of pixels. Everything is modelled at life size here and scaled by `FIGURE_SCALE` at the
 * instance, so this geometry stays a comprehensible 1.75 m tall in the source.
 *
 * Origin is at the FEET, so an instance matrix places the ground position directly.
 */
function createFigureGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  /*
    ⚠️ PROPORTIONS ARE DRAWN FROM A SIDE VIEW, NOT FROM A LIST OF SIZES. The first version was a
    capsule with a sphere on top and two 0.34 m stubs, and every test passed on it. Rendered at eye
    level it was a coloured pill with drips: the head fused into the shoulders because both were the
    same colour with no gap, and the legs were too short to register at all. What follows is the
    corrected shape — a clear neck gap, legs that are a third of the body, and arms, which together
    are what make a silhouette read as a person rather than as a marker.
  */

  // Legs, wide enough apart to show daylight between them.
  for (const side of [-1, 1]) {
    const leg = new THREE.CapsuleGeometry(0.085, 0.58, 3, 6);
    leg.translate(side * 0.15, 0.085 + 0.29, 0);
    parts.push(leg);
  }

  // Torso.
  const body = new THREE.CapsuleGeometry(0.23, 0.5, 4, 10);
  body.translate(0, 1.05, 0);
  parts.push(body);

  // Arms, swung out a little so they clear the body and break the pill outline.
  for (const side of [-1, 1]) {
    const arm = new THREE.CapsuleGeometry(0.07, 0.42, 3, 6);
    arm.rotateZ(side * 0.22);
    arm.translate(side * 0.29, 1.03, 0);
    parts.push(arm);
  }

  // ⚠️ THE NECK GAP IS THE POINT. A big head is what keeps the figure readable at distance, but
  // sitting it directly on the shoulders in the same colour turns the whole thing into one blob.
  const head = new THREE.SphereGeometry(0.26, 12, 10);
  head.translate(0, 1.62, 0);
  parts.push(head);

  // `mergeGeometries` refuses a mix of indexed and non-indexed, and the primitives above are
  // indexed, so flatten every part first. Same rule as `src/twin3d/shuttle.ts`.
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = new THREE.BufferGeometry();
  const total = flat.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  let at = 0;
  for (const g of flat) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    position.set(p.array as Float32Array, at * 3);
    normal.set(n.array as Float32Array, at * 3);
    at += p.count;
    g.dispose();
  }
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  return merged;
}

/**
 * Where each member of the crowd walks, relative to the leader.
 *
 * Fixed at `show` time rather than re-rolled per frame, because a crowd whose lateral offsets
 * changed every frame would shimmer rather than walk.
 */
interface CrowdMember {
  /** Metres behind the leader. */
  trail: number;
  /** Metres to the side of the centre line, signed. */
  lateral: number;
  /** Radians, so the bobbing is out of step between neighbours. */
  phase: number;
}

/**
 * Deterministic pseudo-random, so a given route always produces the same crowd.
 *
 * ⚠️ NOT `Math.random()`. Two calls to `show` with the same walk must lay the crowd out
 * identically, or a test that measures a figure's position becomes a coin toss and the picture
 * flickers when React re-renders.
 */
function spread(index: number, count: number, trailM: number, widthM: number): CrowdMember {
  const golden = 0.618033988749895;
  const jitter = (index * golden) % 1;
  const jitter2 = (index * golden * 3) % 1;
  return {
    // Evenly through the trail, plus a little scatter so the ranks are not drawn up in rows.
    trail: ((index + jitter * 0.8) / Math.max(count, 1)) * trailM,
    lateral: (jitter2 - 0.5) * widthM,
    phase: jitter * Math.PI * 2,
  };
}

/**
 * Which colour a given figure wears.
 *
 * ⚠️ NOT `index % COLOURS.length`, AND NOT `(index * k) % COLOURS.length` EITHER. Position along the
 * trail is assigned in index order too, so anything that walks the palette in step with the path
 * paints the crowd as regular candy-cane bands — invisible at 28 figures, unmistakable at 1 073.
 *
 * ⚠️ THE OBVIOUS REPAIR DOES NOT WORK, AND FAILS SILENTLY. `(index * 7) % 6` was the first attempt
 * here, on the grounds that 7 is coprime with 6. Coprimality only means the multiplier permutes the
 * residues; 7 ≡ 1 (mod 6), so it permutes them by the IDENTITY and emits the exact same sequence.
 * The re-render looked unchanged and it took a second look to notice nothing had happened. In
 * general every `(index * k) % 6` has period 6, so no choice of k removes the banding — the
 * periodicity is the defect, not the ordering. Hence a mixing hash, which has no short period.
 *
 * Deterministic, because `spread()` relies on the layout being reproducible and this layer may not
 * call `Math.random()`.
 */
function colourFor(index: number): number {
  let h = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return CROWD_COLOURS[(h >>> 0) % CROWD_COLOURS.length];
}

export function createWalkRouteLayer(
  extent: WorldExtent,
  groundAt: (x: number, z: number) => number | null
): WalkRouteLayer {
  const group = new THREE.Group();
  group.name = 'walk-route';
  // Drawn after the terrain and buildings so the line stays readable where it passes beside a wall.
  group.renderOrder = 12;

  const uniforms = {
    uTime: { value: 0 },
    uWidth: { value: 2.6 },
    uColour: { value: new THREE.Color('#38bdf8') },
    uOpacity: { value: 0.95 },
    uLength: { value: 100 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
  });

  let mesh: THREE.Mesh | null = null;
  let drawnPoints = 0;
  let extentOfRoute: { centre: THREE.Vector3; spanM: number } | null = null;

  // The walking figure, and the polyline it walks. Kept alongside the ribbon rather than inside
  // it because the ribbon is one static mesh and this moves every frame.
  let walkerMesh: THREE.Group | null = null;
  let walkerPath: { x: number; y: number; z: number }[] = [];
  let walkerLengths: number[] = [];
  let walkerTotal = 0;
  let walkerAt: { x: number; z: number; progress: number; seconds: number } | null = null;

  // The crowd, when the timetable said how many people make this transfer. Mutually exclusive with
  // `walkerMesh`: one figure or many, never both on the same route.
  let crowdMesh: THREE.InstancedMesh | null = null;
  let crowdPlan: CrowdMember[] = [];
  let crowdPeople = 0;

  const drop = () => {
    drawnPoints = 0;
    extentOfRoute = null;
    walkerPath = [];
    walkerLengths = [];
    walkerTotal = 0;
    walkerAt = null;
    if (crowdMesh) {
      group.remove(crowdMesh);
      crowdMesh.geometry.dispose();
      (crowdMesh.material as THREE.Material).dispose();
      crowdMesh.dispose();
      crowdMesh = null;
    }
    crowdPlan = [];
    crowdPeople = 0;
    if (walkerMesh) {
      group.remove(walkerMesh);
      walkerMesh.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          (node.material as THREE.Material).dispose();
        }
      });
      walkerMesh = null;
    }
    if (!mesh) return;
    group.remove(mesh);
    mesh.geometry.dispose();
    mesh = null;
  };

  return {
    group,

    show(points, colour = '#38bdf8', people = null) {
      drop();
      if (points.length < 2) return;

      // Project once, and lift onto the terrain. A route drawn at a constant height crosses the
      // Galgenberg embankment in mid-air, which looks like a bug even when the distance is right.
      const world = points.map(([lon, lat]) => {
        const flat = toWorld(lon, lat, extent, 0);
        return { x: flat.x, z: flat.z, y: (groundAt(flat.x, flat.z) ?? 0) + 1.2 };
      });

      const segments = world.length - 1;
      const positions = new Float32Array(segments * 4 * 3);
      const normals = new Float32Array(segments * 4 * 3);
      const side = new Float32Array(segments * 4);
      const along = new Float32Array(segments * 4);
      const indices = new Uint32Array(segments * 6);

      // Cumulative distance drives the dash, so the dashes stay the same size on the ground rather
      // than stretching over long segments.
      let travelled = 0;
      const lengths: number[] = [0];
      for (let i = 0; i < segments; i += 1) {
        travelled += Math.hypot(world[i + 1].x - world[i].x, world[i + 1].z - world[i].z);
        lengths.push(travelled);
      }
      uniforms.uLength.value = Math.max(travelled, 1);

      for (let i = 0; i < segments; i += 1) {
        const a = world[i];
        const b = world[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz) || 1;
        const nx = -dz / length;
        const nz = dx / length;

        const corners = [
          [a.x, a.y, a.z, -1, lengths[i]],
          [a.x, a.y, a.z, 1, lengths[i]],
          [b.x, b.y, b.z, 1, lengths[i + 1]],
          [b.x, b.y, b.z, -1, lengths[i + 1]],
        ] as const;

        corners.forEach(([x, y, z, s, t], c) => {
          const v = i * 4 + c;
          positions[v * 3] = x;
          positions[v * 3 + 1] = y;
          positions[v * 3 + 2] = z;
          normals[v * 3] = nx;
          normals[v * 3 + 1] = 0;
          normals[v * 3 + 2] = nz;
          side[v] = s;
          along[v] = t / Math.max(travelled, 1);
        });

        const base = i * 4;
        indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i * 6);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));

      uniforms.uColour.value = new THREE.Color(colour);
      mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 12;
      group.add(mesh);
      drawnPoints = world.length;

      // The box the walk occupies, used to frame it. `spanM` is the longer horizontal side rather
      // than the walked distance: a route that doubles back covers less ground than it walks, and
      // framing by distance would put the camera much too far away.
      const xs = world.map((p) => p.x);
      const zs = world.map((p) => p.z);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      extentOfRoute = {
        centre: new THREE.Vector3(
          (minX + maxX) / 2,
          world.reduce((sum, p) => sum + p.y, 0) / world.length,
          (minZ + maxZ) / 2
        ),
        spanM: Math.max(maxX - minX, maxZ - minZ),
      };

      /*
        Somebody actually walking it.

        The dashed ribbon already carries the direction of travel; what it cannot carry is how LONG
        the walk takes, and that is the question the walk lens exists to answer — "have I got time
        between these two lectures". A figure moving at the dataset's own 1.35 m/s turns the
        printed "6 Minuten" into something a viewer can watch and disbelieve if it looks wrong.

        ⚠️ ONE FIGURE, not a crowd, and that is the same restraint the ribbon was built with. This
        layer answers a question about one person and one gap. A stream of walkers would imply a
        number of people, and nobody has published one — the flow lens is where crowds belong, and
        it has the timetable behind it to say how many.
      */
      walkerPath = world;
      walkerLengths = lengths;
      walkerTotal = Math.max(travelled, 1);

      /*
        ⚠️ ONE FIGURE UNLESS THE TIMETABLE SAYS OTHERWISE, and the condition below is the whole
        point. The restraint above still holds: a crowd asserts a number of people, so it may only
        be drawn when a number has actually been published. `expectedAttendance` is the size of the
        cohort group sitting in the origin room — the people who really do get up and leave — and on
        a real Untis export it is null, because Untis publishes classes and not their sizes. When it
        is null this falls through to the single walker exactly as before, rather than inventing a
        plausible-looking crowd, which would be the one failure this layer was built to avoid.
      */
      const stated = typeof people === 'number' && Number.isFinite(people) ? Math.floor(people) : 0;
      if (stated > 0) {
        crowdPeople = stated;
        const count = Math.min(stated, CROWD_CAP);
        // How long the whole cohort takes to get out of the door, turned into metres of path. The
        // trail is what the STATED number earns, not the drawn one, so a capped crowd still
        // stretches as far as that many people would.
        const trailM = Math.min(
          (stated / DOOR_FLOW_PER_S) * WALK_SPEED_MS,
          walkerTotal * CROWD_TRAIL_SHARE
        );
        /*
          ⚠️ WIDTH COMES FROM `count`, THE DRAWN NUMBER — unlike `trailM` just above, which comes
          from `stated`. The trail is a claim about scale, so a capped crowd should still stretch as
          far back as that many people would. The width is a claim about nothing; it exists so the
          figures that ARE drawn do not stand inside each other. Feeding it `stated` would fan 1 200
          figures across the sixty-five metres a 5 000-person cohort deserves and draw a thin
          scattering instead of a crowd.
        */
        crowdPlan = Array.from({ length: count }, (_, i) =>
          spread(i, count, trailM, bandWidth(count, trailM))
        );

        const geometry = createFigureGeometry();
        // Unlit, like the lone walker: the crowd has to stay readable in a building's shadow, and a
        // figure that goes black in shade reads as a hole in the ground.
        const figureMaterial = new THREE.MeshBasicMaterial({ vertexColors: false });
        crowdMesh = new THREE.InstancedMesh(geometry, figureMaterial, count);
        crowdMesh.frustumCulled = false;
        crowdMesh.renderOrder = 13;
        const colour = new THREE.Color();
        for (let i = 0; i < count; i += 1) {
          colour.setHex(colourFor(i));
          crowdMesh.setColorAt(i, colour);
        }
        if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
        group.add(crowdMesh);
        return;
      }

      walkerMesh = createWalkerMesh(colour);
      group.add(walkerMesh);
    },

    clear: drop,

    drawn() {
      return drawnPoints;
    },

    bounds() {
      return extentOfRoute;
    },

    walker() {
      return walkerAt;
    },

    crowd() {
      return crowdMesh ? { people: crowdPeople, drawn: crowdMesh.count } : null;
    },

    update(elapsed) {
      uniforms.uTime.value = elapsed;

      if (walkerPath.length < 2) return;
      if (!walkerMesh && !crowdMesh) return;

      // Absolute time rather than a delta: the caller already passes a monotonic clock, and
      // deriving the position from it means the figure cannot drift out of step with the distance
      // it is supposed to have covered.
      const seconds = walkerTotal / WALK_SPEED_MS;
      const travelledNow = (elapsed * WALK_SPEED_MS) % walkerTotal;

      /*
        Where somebody who has walked `distance` metres is standing.

        Clamped at both ends on purpose. A crowd member is held BACK from the leader, so early in
        the walk its distance is negative — it should be waiting at the door, not extrapolated off
        the start of the path into the building.
      */
      const pointAt = (distance: number) => {
        const d = Math.min(Math.max(distance, 0), walkerTotal);
        let i = 1;
        while (i < walkerLengths.length - 1 && walkerLengths[i] < d) i += 1;
        const span = walkerLengths[i] - walkerLengths[i - 1] || 1;
        const local = (d - walkerLengths[i - 1]) / span;
        const a = walkerPath[i - 1];
        const b = walkerPath[i];
        return {
          x: a.x + (b.x - a.x) * local,
          y: a.y + (b.y - a.y) * local,
          z: a.z + (b.z - a.z) * local,
          dx: b.x - a.x,
          dz: b.z - a.z,
        };
      };

      const lead = pointAt(travelledNow);
      // The ribbon floats 1.2 m up so it clears the ground; a person standing on it would appear
      // to hover, so put the feet back down.
      walkerAt = { x: lead.x, z: lead.z, progress: travelledNow / walkerTotal, seconds };

      if (walkerMesh) {
        walkerMesh.position.set(lead.x, lead.y - 1.2, lead.z);
        walkerMesh.rotation.y = Math.atan2(lead.dx, lead.dz);
        return;
      }

      if (!crowdMesh) return;

      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const positionV = new THREE.Vector3();
      const scaleV = new THREE.Vector3(FIGURE_SCALE, FIGURE_SCALE, FIGURE_SCALE);
      const up = new THREE.Vector3(0, 1, 0);

      for (let i = 0; i < crowdMesh.count; i += 1) {
        const member = crowdPlan[i];
        const here = pointAt(travelledNow - member.trail);
        const heading = Math.atan2(here.dx, here.dz);

        // Sideways offset, perpendicular to the direction of travel, so the crowd fans across the
        // path instead of threading it in single file.
        const length = Math.hypot(here.dx, here.dz) || 1;
        const offX = (-here.dz / length) * member.lateral;
        const offZ = (here.dx / length) * member.lateral;

        /*
          The bob is what turns a sliding model into somebody walking, and it is the ONLY part of
          this that is invented rather than measured. Two steps per second is an ordinary cadence;
          the amplitude is a few centimetres of real height, scaled with the figure so a big one
          does not bounce proportionally less.
        */
        const bob = Math.abs(Math.sin(elapsed * 6 + member.phase)) * 0.06 * FIGURE_SCALE;

        positionV.set(here.x + offX, here.y - 1.2 + bob, here.z + offZ);
        quaternion.setFromAxisAngle(up, heading);
        matrix.compose(positionV, quaternion, scaleV);
        crowdMesh.setMatrixAt(i, matrix);
      }
      crowdMesh.instanceMatrix.needsUpdate = true;
    },

    dispose() {
      drop();
      material.dispose();
    },
  };
}
