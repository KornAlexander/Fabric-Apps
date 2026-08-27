import * as THREE from 'three';

import type { DeckId, DeckOccupancy } from '@/shared/contract';
import { DEFAULT_FERRY_SPEC } from '@/three/ferries/types';
import type { FerryModelSpec } from '@/three/ferries/types';

/**
 * A blocky, voxel-style ferry built entirely from boxes — a lower enclosed
 * saloon, an optional set-back upper deck, and a wheelhouse (the "driving"
 * capital section) — populated with little voxel passengers that walk around
 * each deck. Hull proportions, livery colours, deck count and hull type (twin
 * catamaran pontoons vs. a single monohull) come from a `FerryModelSpec` so
 * each real vessel (see `src/three/ferries/`) renders with its own look.
 * Passenger counts are driven by the Fabric digital-twin occupancy so the
 * scene mirrors what the telemetry reports. Voxel look and character
 * construction follow the design of qkfang/zava-claims-agent.
 *
 * Bow points +Z. Local units are roughly metres.
 */

/** One walkable deck: its floor height and the rectangle passengers roam in. */
interface DeckArea {
  deck: DeckId;
  y: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Cap on rendered figures so a full ferry stays performant. */
  cap: number;
}

/** Deck walk areas scaled to the vessel's hull length/beam; `upper` is omitted
 * for single-deck vessels so no passengers spawn on a deck that doesn't exist. */
function buildDeckAreas(spec: FerryModelSpec): Partial<Record<DeckId, DeckArea>> {
  const { length: lengthScale, beam: beamScale } = spec.scale;
  const areas: Partial<Record<DeckId, DeckArea>> = {
    lower: {
      deck: 'lower',
      y: 2.1,
      minX: -6.0 * beamScale,
      maxX: 6.0 * beamScale,
      minZ: -17 * lengthScale,
      maxZ: 12 * lengthScale,
      cap: 12,
    },
  };
  const bridgeY = spec.decks === 2 ? 7.0 : 4.6;
  if (spec.decks === 2) {
    areas.upper = {
      deck: 'upper',
      y: 7.0,
      minX: -4.8 * beamScale,
      maxX: 4.8 * beamScale,
      minZ: -13 * lengthScale,
      maxZ: 5 * lengthScale,
      cap: 8,
    };
  }
  // The wheelhouse block sits forward on double-decked ferries but amidships on
  // single-deck catamarans; centre the captain's walk box on the actual block
  // (same z as `wheelhouseCenter`) so the figure never floats off the hull.
  const bridgeZ = (spec.wheelhouse === 'forward' ? 14.5 : -2) * lengthScale;
  areas.bridge = {
    deck: 'bridge',
    y: bridgeY,
    minX: -2.0 * beamScale,
    maxX: 2.0 * beamScale,
    minZ: bridgeZ - 1.5 * lengthScale,
    maxZ: bridgeZ + 1.5 * lengthScale,
    cap: 1,
  };
  return areas;
}

/** A few voxel-character colour packs (skin / shirt / trousers). */
const PALETTES: { skin: number; shirt: number; trousers: number }[] = [
  { skin: 0xf1c9a5, shirt: 0x2f6fb0, trousers: 0x2b2f36 },
  { skin: 0xd9a06b, shirt: 0xcf4b3a, trousers: 0x37414a },
  { skin: 0x8d5a3c, shirt: 0x2f9e6b, trousers: 0x3b3f47 },
  { skin: 0xf3d1b0, shirt: 0xe0a020, trousers: 0x394150 },
  { skin: 0xc98a5e, shirt: 0x7a4fb0, trousers: 0x2b2f36 },
  { skin: 0xe8b892, shirt: 0x40a0c0, trousers: 0x333a42 },
];

/** A whimsical, fictional travel card shown when a passenger is clicked. */
export interface PassengerTicket {
  ticketNo: string;
  name: string;
  from: string;
  to: string;
  journeyMin: number;
  mood: string;
  wantsToSee: string;
  drink: string;
  deck: string;
}

const WHARVES = [
  'Circular Quay',
  'Manly',
  'Taronga Zoo',
  'Watsons Bay',
  'Darling Harbour',
  'Barangaroo',
  'Balmain',
  'Cockatoo Island',
  'Mosman Bay',
  'Double Bay',
  'Rose Bay',
  'Neutral Bay',
];
const NAMES = [
  'Ava',
  'Leo',
  'Mia',
  'Noah',
  'Zoe',
  'Kai',
  'Ivy',
  'Ezra',
  'Lily',
  'Finn',
  'Isla',
  'Otis',
];
const MOODS = [
  'Relaxed',
  'Excited',
  'Sleepy',
  'Cheerful',
  'Pensive',
  'Awe-struck',
  'Chatty',
  'Content',
];
const SIGHTS = [
  'the Opera House',
  'the Harbour Bridge',
  'the city skyline at dusk',
  'passing sailboats',
  'Fort Denison',
  'the Manly shoreline',
  'a pod of dolphins',
  'the ferry wake',
];
const DRINKS = [
  'Flat white',
  'Long black',
  'Sparkling water',
  'Cold beer',
  'Chai latte',
  'Lemonade',
  'Iced tea',
  'Ginger ale',
];
const DECK_NAME: Record<DeckId, string> = {
  lower: 'Lower saloon',
  upper: 'Upper deck',
  bridge: 'Wheelhouse',
};

/** A uniformed crew member shown when a staff figure is clicked. */
export interface StaffCard {
  role: string;
  name: string;
  station: string;
  duty: string;
}

/** Optional overrides that turn a plain figure into a uniformed crew member. */
interface FigureStyle {
  shirt: number;
  trousers: number;
  cap?: number;
  vest?: number;
  apron?: number;
}

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

function makeTicket(deck: DeckId): PassengerTicket {
  const from = pick(WHARVES);
  let to = pick(WHARVES);
  while (to === from) to = pick(WHARVES);
  return {
    ticketNo: 'SF-' + Math.floor(1000 + Math.random() * 9000),
    name: pick(NAMES),
    from,
    to,
    journeyMin: 8 + Math.floor(Math.random() * 38),
    mood: pick(MOODS),
    wantsToSee: pick(SIGHTS),
    drink: pick(DRINKS),
    deck: DECK_NAME[deck],
  };
}

interface Passenger {
  group: THREE.Group;
  area: DeckArea;
  target: THREE.Vector3;
  speed: number;
  phase: number;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  ticket: PassengerTicket;
}

export class VoxelFerry {
  readonly group = new THREE.Group();
  protected readonly spec: FerryModelSpec;
  private readonly deckAreas: Partial<Record<DeckId, DeckArea>>;
  private readonly passengers: Passenger[] = [];
  private readonly perDeck = new Map<DeckId, Passenger[]>();
  private readonly crew: THREE.Group[] = [];

  // Enclosing surfaces (hull, cabin walls, glazing, roof) are rendered as a
  // translucent "cutaway" shell so the decks and passengers inside stay
  // visible from any outside angle. Structural pieces (floors, rails, trim,
  // funnel) stay opaque so the vessel still reads as solid. Colours come from
  // the ferry's livery spec so each real vessel matches its own reference photo.
  protected readonly mat: Record<
    | 'hull'
    | 'boot'
    | 'cabin'
    | 'deck'
    | 'glass'
    | 'trim'
    | 'roof'
    | 'rail'
    | 'funnel'
    | 'seat'
    | 'frame'
    | 'wood'
    | 'sheer'
    | 'mullion'
    | 'chrome'
    | 'goldGlass'
    | 'sign',
    THREE.MeshStandardMaterial
  >;

  constructor(spec: FerryModelSpec = DEFAULT_FERRY_SPEC) {
    this.spec = spec;
    this.deckAreas = buildDeckAreas(spec);
    const { livery } = spec;
    this.mat = {
      hull: new THREE.MeshStandardMaterial({
        color: livery.hull,
        roughness: 0.55,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      boot: new THREE.MeshStandardMaterial({ color: livery.boot, roughness: 0.8 }),
      cabin: new THREE.MeshStandardMaterial({
        color: livery.cabin,
        roughness: 0.7,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      deck: new THREE.MeshStandardMaterial({ color: 0xb3ab94, roughness: 0.9 }),
      glass: new THREE.MeshStandardMaterial({
        color: livery.glass,
        roughness: 0.2,
        metalness: 0.6,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      trim: new THREE.MeshStandardMaterial({ color: livery.trim, roughness: 0.5 }),
      roof: new THREE.MeshStandardMaterial({
        color: livery.roof,
        roughness: 0.7,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      rail: new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.6 }),
      funnel: new THREE.MeshStandardMaterial({ color: livery.funnel, roughness: 0.6 }),
      seat: new THREE.MeshStandardMaterial({ color: 0xb23a3a, roughness: 0.75 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.5, metalness: 0.4 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.7 }),
      // Opaque exterior detailing that gives the vessel its real silhouette:
      // the yellow bulwark/superstructure, window mullions, mast/radar metal,
      // the gold wheelhouse windscreen and the lit destination sign.
      sheer: new THREE.MeshStandardMaterial({ color: livery.cabin, roughness: 0.55 }),
      mullion: new THREE.MeshStandardMaterial({ color: 0x21262a, roughness: 0.5, metalness: 0.3 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xdfe4e7, roughness: 0.35, metalness: 0.55 }),
      goldGlass: new THREE.MeshStandardMaterial({
        color: 0xc9a53c,
        roughness: 0.12,
        metalness: 0.85,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      sign: new THREE.MeshStandardMaterial({
        color: 0x12161b,
        emissive: 0xffb020,
        emissiveIntensity: 0.5,
        roughness: 0.4,
      }),
    };
    this.buildFerry();
    this.buildCrew();
    for (const d of Object.keys(this.deckAreas) as DeckId[]) this.perDeck.set(d, []);
  }

  /** Match the number of rendered figures on each deck to the twin occupancy. */
  setOccupancy(decks: DeckOccupancy[]): void {
    for (const d of decks) {
      const area = this.deckAreas[d.deck];
      if (!area) continue;
      const want = Math.min(area.cap, Math.round((d.occupancy / Math.max(1, d.capacity)) * area.cap));
      const list = this.perDeck.get(d.deck)!;
      while (list.length < want) this.spawnPassenger(area, list);
      while (list.length > want) this.removePassenger(list);
    }
  }

  /** Walk every passenger toward its target with a simple two-legged gait. */
  update(dt: number): void {
    for (const p of this.passengers) {
      const pos = p.group.position;
      const dir = p.target.clone().sub(pos);
      dir.y = 0;
      if (dir.length() < 0.4) {
        p.target = this.randomPoint(p.area);
      } else {
        dir.normalize();
        pos.addScaledVector(dir, p.speed * dt);
        p.group.rotation.y = Math.atan2(dir.x, dir.z);
      }
      // Little leg swing so figures read as "walking".
      p.phase += dt * 8;
      const swing = Math.sin(p.phase) * 0.5;
      p.legL.rotation.x = swing;
      p.legR.rotation.x = -swing;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const mat of Object.values(this.mat)) mat.dispose();
  }

  /** Walk up from a raycast-hit object to the passenger group it belongs to. */
  passengerFor(obj: THREE.Object3D | null): THREE.Object3D | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      if (o.userData?.ticket || o.userData?.staff) return o;
      o = o.parent;
    }
    return null;
  }

  /** Walk up from a raycast-hit object to the passenger it belongs to. */
  ticketFor(obj: THREE.Object3D | null): PassengerTicket | null {
    const p = this.passengerFor(obj);
    return p ? (p.userData.ticket as PassengerTicket) : null;
  }

  // --- Ferry hull + superstructure -------------------------------------------

  protected box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    // Translucent cutaway panels don't cast shadows, so the interior decks and
    // passengers stay lit and readable through the shell.
    mesh.castShadow = !(mat as THREE.Material).transparent;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** Centre of the wheelhouse block: forward on classic double-decked ferries,
   * built into the single saloon's roof on modern single-deck catamarans. */
  protected wheelhouseCenter(): { y: number; z: number } {
    const { decks, wheelhouse, scale } = this.spec;
    return {
      y: decks === 2 ? 8.5 : 6.0,
      z: (wheelhouse === 'forward' ? 14.5 : -2) * scale.length,
    };
  }

  /** Assemble the whole vessel in ordered stages. Each stage is a `protected`
   * hook so a per-class model (see `src/three/models/`) can override just the
   * part that differs for its fleet class while reusing the rest. */
  protected buildFerry(): void {
    this.buildHull();
    this.buildSuperstructure();
    this.buildFittings();
    this.furnish();
  }

  /** Hull, boot-top, rubbing strake, main deck floor and bulwark, plus the
   * detailed bow and stern. Catamarans get twin pontoons; a monohull (e.g.
   * Freshwater class) gets a single hull. */
  protected buildHull(): void {
    const m = this.mat;
    const { hullType, scale } = this.spec;
    const L = scale.length;
    const B = scale.beam;
    const beam = 13 * B;
    const hullLen = 40 * L;
    const bowZ = 21.5 * L;
    const hullFront = hullLen / 2;

    const bow = (w: number, x: number) =>
      this.prismX(m.hull, w, x, [
        [hullFront - 1, -0.4],
        [hullFront - 1, 2.0],
        [bowZ + 2, 2.0],
      ]);
    if (hullType === 'catamaran') {
      const pontoonW = beam * 0.36;
      const half = (pontoonW + beam * 0.1) / 2;
      for (const side of [-1, 1] as const) {
        const x = side * half;
        this.box(m.hull, pontoonW, 2.4, hullLen, x, 0.8, 0);
        this.box(m.boot, pontoonW + 0.2, 0.7, hullLen + 0.2, x, -0.35, 0);
        bow(pontoonW, x);
      }
    } else {
      this.box(m.hull, beam, 2.4, hullLen, 0, 0.8, 0);
      this.box(m.boot, beam + 0.2, 0.7, hullLen + 0.2, 0, -0.35, 0);
      bow(beam * 0.85, 0);
    }

    // Bright rubbing strake along the green/yellow join.
    for (const side of [-1, 1] as const)
      this.box(m.trim, 0.3, 0.28, hullLen, side * beam * 0.5, 1.7, 0);

    // Main deck floor + a low yellow bulwark ringing the open fore/aft decks.
    this.box(m.deck, beam * 0.97, 0.3, hullLen * 0.9, 0, 2.0, -1 * L);
    for (const side of [-1, 1] as const)
      this.box(m.sheer, 0.5, 1.1, hullLen * 0.92, side * beam * 0.475, 2.55, -1 * L);
    this.buildBowStern();
  }

  /** Enclosed saloon(s): the lower saloon with its signature forward-raked
   * window wall, and — on double-decked vessels — the set-back upper saloon. */
  protected buildSuperstructure(): void {
    const m = this.mat;
    const { scale, decks } = this.spec;
    const L = scale.length;
    const B = scale.beam;
    const beam = 13 * B;
    const hullLen = 40 * L;

    this.saloon(beam * 0.885, 3.4, hullLen * 0.75, -2 * L, 2.15);
    const fZ = -2 * L + (hullLen * 0.75) / 2;
    this.prismX(m.glass, beam * 0.82, 0, [
      [fZ - 2 * L, 2.7],
      [fZ + 2 * L, 5.7],
      [fZ - 2 * L, 5.7],
    ]);

    if (decks === 2) {
      // Upper deck floor bridges down onto the lower saloon roof so the two
      // decks read as one connected structure instead of a floating upper box.
      this.box(m.deck, beam * 0.83, 1.0, hullLen * 0.62, 0, 6.5, -4 * L);
      this.saloon(beam * 0.73, 2.8, hullLen * 0.5, -5 * L, 7.0);
      this.railRect(-beam * 0.385, beam * 0.385, 2.5 * L, 4.5 * L, 7.0);
    }
  }

  /** Deck fittings: forward wheelhouse and gold windscreen, signal mast, life
   * rings, and a funnel on the larger ocean-going classes (e.g. Freshwater). */
  protected buildFittings(): void {
    const m = this.mat;
    const { scale, hasFunnel } = this.spec;
    const L = scale.length;
    const B = scale.beam;
    const beam = 13 * B;

    this.buildWheelhouse();
    this.buildMast();
    this.lifeRing(beam * 0.46, 3.7, 6 * L);
    this.lifeRing(-beam * 0.46, 3.7, 6 * L);

    if (hasFunnel) {
      this.box(m.funnel, 2.2 * B, 3.4, 2.4 * B, 0, 8.6, -13 * L);
      this.box(m.boot, 2.5 * B, 0.5, 2.6 * B, 0, 10.4, -13 * L);
    }
  }

  /** One enclosed saloon: a translucent cutaway shell (so the passengers stay
   * visible) dressed with opaque yellow sill/header bands, a dark wraparound
   * glazing band with vertical mullions, and a green roof with a drip edge. */
  protected saloon(w: number, h: number, len: number, z: number, baseY: number): void {
    const m = this.mat;
    const glassH = h * 0.5;
    const glassY = baseY + h * 0.56;
    this.box(m.cabin, w, h, len, 0, baseY + h / 2, z);
    this.box(m.glass, w + 0.06, glassH, len * 0.99, 0, glassY, z);
    // Sill and header are thin perimeter frames (not solid slabs) so the seats
    // and moving passengers inside stay visible from outside.
    this.wallBand(w + 0.04, h * 0.22, len, baseY + h * 0.16, z);
    this.wallBand(w + 0.04, h * 0.16, len, baseY + h * 0.9, z);
    this.box(m.roof, w * 1.03, 0.5, len * 1.03, 0, baseY + h + 0.25, z);
    this.box(m.trim, w * 1.05, 0.14, len * 1.05, 0, baseY + h, z);
    this.glazingMullions(w / 2 + 0.05, glassY, glassH, z, len * 0.99);
  }

  /** A thin opaque perimeter band (four walls) around a deck, leaving the
   * interior open so seats and passengers stay visible from outside. */
  private wallBand(w: number, h: number, len: number, y: number, z: number): void {
    const m = this.mat.sheer;
    const t = 0.22;
    this.box(m, t, h, len, -w / 2, y, z);
    this.box(m, t, h, len, w / 2, y, z);
    this.box(m, w, h, t, 0, y, z - len / 2);
    this.box(m, w, h, t, 0, y, z + len / 2);
  }

  /** Evenly spaced vertical window mullions down both sides of a glazing band. */
  private glazingMullions(halfW: number, y: number, h: number, z: number, len: number): void {
    const n = Math.max(4, Math.round(len / 2.4));
    for (let i = 0; i <= n; i++) {
      const zz = z - len / 2 + (len * i) / n;
      for (const s of [-1, 1] as const) this.box(this.mat.mullion, 0.16, h, 0.16, s * halfW, y, zz);
    }
  }

  /** Raised forward wheelhouse: yellow block, gold forward-raked windscreen,
   * side glazing and a green roof with a small overhang. */
  protected buildWheelhouse(): void {
    const m = this.mat;
    const B = this.spec.scale.beam;
    const L = this.spec.scale.length;
    const beam = 13 * B;
    const wh = this.wheelhouseCenter();
    const w = beam * 0.52;
    this.box(m.sheer, w, 2.6, 6 * L, 0, wh.y, wh.z);
    this.box(m.glass, w + 0.05, 1.3, 6.05 * L, 0, wh.y + 0.5, wh.z);
    this.prismX(m.goldGlass, w, 0, [
      [wh.z + 1.2 * L, wh.y - 0.6],
      [wh.z + 3 * L, wh.y + 1.2],
      [wh.z + 1.2 * L, wh.y + 1.2],
    ]);
    this.box(m.roof, w * 1.08, 0.4, 6.4 * L, 0, wh.y + 1.6, wh.z);
    this.box(m.trim, w * 1.1, 0.12, 6.5 * L, 0, wh.y + 1.4, wh.z);
    this.box(m.mullion, 2.4 * B, 0.8, 0.8 * L, 0, wh.y - 0.9, wh.z + 1.9 * L);
  }

  /** Signal mast above the wheelhouse: pole and yardarm, a white radar dome,
   * searchlight, antenna whip, a halyard of flags and a lit destination sign. */
  protected buildMast(): void {
    const m = this.mat;
    const L = this.spec.scale.length;
    const wh = this.wheelhouseCenter();
    const baseY = wh.y + 1.8;
    const z = wh.z - 1.5 * L;
    this.box(m.sheer, 0.3, 5.5, 0.3, 0, baseY + 2.75, z);
    this.box(m.sheer, 4.2, 0.22, 0.22, 0, baseY + 3.4, z);
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.5, 16), m.chrome);
    dome.position.set(0, baseY + 1.4, z + 0.4);
    dome.castShadow = true;
    this.group.add(dome);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      m.chrome,
    );
    cap.position.set(0, baseY + 1.65, z + 0.4);
    this.group.add(cap);
    this.box(m.chrome, 0.5, 0.5, 0.5, 1.4, baseY + 1.4, z + 0.4);
    this.box(m.chrome, 0.06, 3.2, 0.06, 0, baseY + 5.9, z);
    this.box(m.seat, 1.1, 0.7, 0.08, 0.9, baseY + 4.6, z);
    this.box(m.rail, 1.1, 0.7, 0.08, 0.9, baseY + 3.9, z);
    this.box(m.trim, 1.1, 0.7, 0.08, 0.9, baseY + 3.2, z);
    this.box(m.sign, 3.6, 0.7, 0.3, 0, 6.15, -2 * L + (13 * L));
  }

  /** A red-and-white life ring hung flat against the saloon side. */
  protected lifeRing(x: number, y: number, z: number): void {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.16, 8, 18), this.mat.seat);
    ring.position.set(x, y, z);
    ring.rotation.y = Math.PI / 2;
    ring.castShadow = true;
    this.group.add(ring);
  }

  /** Detailed ends: a pointed foredeck with a V-bulwark, windlass, bollards and
   * a jackstaff forward, and a closed transom with mooring bollards and a raked
   * ensign staff aft — so the bow and stern read as a real ferry, not a box. */
  protected buildBowStern(): void {
    const m = this.mat;
    const L = this.spec.scale.length;
    const B = this.spec.scale.beam;
    const beam = 13 * B;
    const edge = beam * 0.46;

    // Bow: foredeck plates narrowing toward the stem, framed by a V-bulwark.
    this.box(m.deck, beam * 0.62, 0.3, 3.4 * L, 0, 2.0, 18.6 * L);
    this.box(m.deck, beam * 0.34, 0.3, 3.0 * L, 0, 2.0, 21.4 * L);
    this.angled(m.sheer, -edge, 17.4 * L, 0, 22.6 * L, 2.55, 1.1, 0.45);
    this.angled(m.sheer, edge, 17.4 * L, 0, 22.6 * L, 2.55, 1.1, 0.45);
    // Windlass, mooring bollards and a stowed anchor on the foredeck.
    this.box(m.mullion, 1.8, 0.9, 1.4, 0, 2.45, 17 * L);
    for (const s of [-1, 1] as const)
      this.box(m.mullion, 0.5, 1.2, 0.5, s * beam * 0.24, 2.6, 15.5 * L);
    this.box(m.chrome, 1.3, 0.3, 0.7, 0, 2.65, 21.4 * L);
    // Jackstaff with a small flag at the stem head.
    this.box(m.chrome, 0.16, 3.2, 0.16, 0, 4.1, 22.4 * L);
    this.box(m.seat, 1.0, 0.6, 0.08, 0.6, 5.2, 22.4 * L);

    // Stern: a closed transom, a low bulwark cap and a boarding-gate opening.
    this.box(m.hull, beam * 0.98, 2.4, 0.5, 0, 0.8, -20 * L);
    for (const s of [-1, 1] as const)
      this.box(m.sheer, beam * 0.34, 1.1, 0.6, s * beam * 0.3, 2.55, -19.5 * L);
    for (const s of [-1, 1] as const)
      this.box(m.mullion, 0.5, 1.2, 0.5, s * beam * 0.24, 2.6, -18 * L);
    // Raked ensign staff and flag at the taffrail.
    const staff = this.box(m.chrome, 0.16, 3.6, 0.16, 0, 4.3, -19.6 * L);
    staff.rotation.x = -0.32;
    this.box(m.seat, 1.2, 0.7, 0.08, 0.7, 5.7, -20.3 * L);
    this.box(m.rail, 1.2, 0.22, 0.08, 0.7, 6.05, -20.3 * L);
  }

  /** A box rotated about Y to run between two deck points (angled bulwarks). */
  protected angled(
    mat: THREE.Material,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    h: number,
    t: number,
  ): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const b = this.box(mat, t, h, Math.hypot(dx, dz), (x0 + x1) / 2, y, (z0 + z1) / 2);
    b.rotation.y = Math.atan2(dx, dz);
  }

  /** A triangular prism (raked bow, sloped window walls, gold windscreen).
   * `pts` are three `[z, y]` corners; the prism is extruded width `w` along X. */
  protected prismX(mat: THREE.Material, w: number, x: number, pts: [number, number][]): THREE.Mesh {
    const [a, b, c] = pts;
    const hw = w / 2;
    const v = new Float32Array([
      x - hw, a[1], a[0],
      x - hw, b[1], b[0],
      x - hw, c[1], c[0],
      x + hw, a[1], a[0],
      x + hw, b[1], b[0],
      x + hw, c[1], c[0],
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
    geo.setIndex([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5]);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !(mat as THREE.Material).transparent;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** Seats, bar, captain's pit and open-air benches that dress each deck. */
  protected furnish(): void {
    const { decks, scale } = this.spec;
    const L = scale.length;
    const B = scale.beam;

    // Lower saloon: forward-facing seat rows either side of a central aisle.
    for (const z of [7, 3, -1, -5]) {
      this.chair(-5.0 * B, 2.15, z * L, -1);
      this.chair(-3.6 * B, 2.15, z * L, -1);
      this.chair(3.6 * B, 2.15, z * L, -1);
      this.chair(5.0 * B, 2.15, z * L, -1);
    }
    // Lower saloon bar with stools, against the aft bulkhead.
    this.bar(0, 2.15, -12 * L);

    if (decks === 2) {
      // Upper saloon: a lounge of seats plus a small refreshment kiosk aft.
      for (const z of [1, -3, -7]) {
        this.chair(-3.8 * B, 7.0, z * L, -1);
        this.chair(3.8 * B, 7.0, z * L, -1);
      }
      this.bar(0, 7.0, -12 * L, 0.7);
    }

    // Captain's pit in the wheelhouse.
    this.captainPit();

    // Open-air benches on the bow and stern decks.
    this.bench(-3.2 * B, 2.3, 15.5 * L);
    this.bench(3.2 * B, 2.3, 15.5 * L);
    this.bench(-3.2 * B, 2.3, -15 * L);
    this.bench(3.2 * B, 2.3, -15 * L);
  }

  /** A single voxel seat; dir = -1 backrest aft, +1 backrest forward. */
  protected chair(x: number, y: number, z: number, dir: 1 | -1): void {
    const s = this.mat.seat;
    const f = this.mat.frame;
    this.box(s, 0.9, 0.16, 0.9, x, y + 0.5, z);
    this.box(s, 0.9, 0.9, 0.16, x, y + 0.95, z + dir * 0.42);
    for (const sx of [-0.35, 0.35])
      for (const sz of [-0.35, 0.35]) this.box(f, 0.12, 0.5, 0.12, x + sx, y + 0.25, z + sz);
  }

  /** A bar counter with a bottle shelf and stools. `scale` shrinks a kiosk. */
  protected bar(x: number, y: number, z: number, scale = 1): void {
    const w = 5 * scale;
    const wood = this.mat.wood;
    this.box(wood, w, 1.1, 1.4, x, y + 0.55, z);
    this.box(this.mat.trim, w + 0.4, 0.14, 1.7, x, y + 1.18, z);
    this.box(wood, w, 1.6, 0.4, x, y + 0.8, z - 1.6);
    const bottles = Math.round(w);
    for (let i = 0; i < bottles; i++)
      this.box(this.mat.glass, 0.16, 0.5, 0.16, x - w / 2 + 0.5 + i, y + 1.75, z - 1.6);
    const stools = Math.max(2, Math.round(w / 1.4));
    for (let i = 0; i < stools; i++) {
      const sx = x - (w / 2 - 0.6) + (i * (w - 1.2)) / Math.max(1, stools - 1);
      this.box(this.mat.frame, 0.5, 0.16, 0.5, sx, y + 0.75, z + 1.2);
      this.box(this.mat.frame, 0.1, 0.75, 0.1, sx, y + 0.37, z + 1.2);
    }
  }

  /** An open-air bench for the outdoor decks. */
  protected bench(x: number, y: number, z: number): void {
    const wood = this.mat.wood;
    const f = this.mat.frame;
    this.box(wood, 3, 0.16, 0.7, x, y + 0.5, z);
    this.box(wood, 3, 0.7, 0.16, x, y + 0.85, z - 0.3);
    this.box(f, 0.12, 0.5, 0.12, x - 1.3, y + 0.25, z);
    this.box(f, 0.12, 0.5, 0.12, x + 1.3, y + 0.25, z);
  }

  /** The captain's driving pit: console, wheel and seat in the wheelhouse.
   * Faces the bow, whether the wheelhouse sits forward or amidships. */
  protected captainPit(): void {
    const { wheelhouse, scale } = this.spec;
    const L = scale.length;
    const wh = this.wheelhouseCenter();
    const y = wh.y - 1.5;
    const dir: 1 | -1 = wheelhouse === 'forward' ? 1 : -1;
    this.box(this.mat.boot, 3.4, 1.0, 1.0, 0, y + 0.5, wh.z + dir * 1.3 * L);
    this.box(this.mat.glass, 3.2, 0.5, 0.25, 0, y + 1.15, wh.z + dir * 0.9 * L);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 8, 20), this.mat.frame);
    wheel.position.set(0, y + 1.15, wh.z + dir * 0.6 * L);
    wheel.castShadow = true;
    this.group.add(wheel);
    this.chair(0, y, wh.z - dir * 1.1 * L, dir === 1 ? -1 : 1);
  }

  /** A simple voxel railing around a rectangular open deck at height `y`. */
  protected railRect(x0: number, x1: number, z0: number, z1: number, y: number): void {
    const H = 1.1;
    const post = (x: number, z: number) => this.box(this.mat.rail, 0.14, H, 0.14, x, y + H / 2, z);
    const rail = (w: number, d: number, x: number, z: number) =>
      this.box(this.mat.rail, w, 0.1, d, x, y + H, z);
    rail(x1 - x0, 0.1, (x0 + x1) / 2, z0);
    rail(x1 - x0, 0.1, (x0 + x1) / 2, z1);
    rail(0.1, z1 - z0, x0, (z0 + z1) / 2);
    rail(0.1, z1 - z0, x1, (z0 + z1) / 2);
    const n = Math.max(2, Math.round((z1 - z0) / 2.5));
    for (let i = 0; i <= n; i++) {
      const z = z0 + ((z1 - z0) * i) / n;
      post(x0, z);
      post(x1, z);
    }
  }

  // --- Voxel passengers ------------------------------------------------------

  private buildFigure(style?: FigureStyle): { group: THREE.Group; legL: THREE.Mesh; legR: THREE.Mesh } {
    const p = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: p.skin, roughness: 0.8 });
    const shirt = new THREE.MeshStandardMaterial({ color: style?.shirt ?? p.shirt, roughness: 0.8 });
    const trousers = new THREE.MeshStandardMaterial({
      color: style?.trousers ?? p.trousers,
      roughness: 0.8,
    });

    const part = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };

    // Legs are pivoted at the hip so they can swing while walking.
    const leg = (side: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.16, 0.7, 0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.28), trousers);
      mesh.position.set(0, -0.35, 0);
      mesh.castShadow = true;
      pivot.add(mesh);
      g.add(pivot);
      return pivot as unknown as THREE.Mesh;
    };
    const legL = leg(-1);
    const legR = leg(1);

    part(shirt, 0.62, 0.7, 0.36, 0, 1.05); // torso
    part(skin, 0.16, 0.5, 0.16, -0.4, 1.05); // arms
    part(skin, 0.16, 0.5, 0.16, 0.4, 1.05);
    part(skin, 0.42, 0.42, 0.42, 0, 1.65); // head

    // Uniform extras that make each crew role recognisable.
    if (style?.vest !== undefined) {
      const vest = new THREE.MeshStandardMaterial({ color: style.vest, roughness: 0.6 });
      part(vest, 0.68, 0.6, 0.42, 0, 1.05); // hi-vis vest over the torso
    }
    if (style?.apron !== undefined) {
      const apron = new THREE.MeshStandardMaterial({ color: style.apron, roughness: 0.7 });
      part(apron, 0.5, 0.6, 0.42, 0, 0.85); // bar apron across the front
    }
    if (style?.cap !== undefined) {
      const cap = new THREE.MeshStandardMaterial({ color: style.cap, roughness: 0.6 });
      part(cap, 0.46, 0.16, 0.46, 0, 1.92); // crown
      part(cap, 0.5, 0.06, 0.22, 0, 1.86, 0.28); // peak
    }

    g.scale.setScalar(1.0);
    return { group: g, legL, legR };
  }

  /** Uniformed crew posted at their stations: captain, bar staff, deckhands. */
  private buildCrew(): void {
    const post = (
      style: FigureStyle,
      x: number,
      y: number,
      z: number,
      ry: number,
      card: StaffCard,
    ) => {
      const { group } = this.buildFigure(style);
      group.position.set(x, y, z);
      group.rotation.y = ry;
      group.userData.staff = card;
      this.crew.push(group);
      this.group.add(group);
    };

    const NAVY = 0x16294d;
    const DARK = 0x24272c;

    // Crew stations are derived from the hull scale, wheelhouse position and
    // deck count so every model keeps its crew on the actual deck floor.
    const { decks, scale } = this.spec;
    const L = scale.length;
    const B = scale.beam;
    const wh = this.wheelhouseCenter();
    const bridgeY = decks === 2 ? 7.0 : 4.6;

    // Captain at the wheelhouse helm — navy uniform + white peaked cap. Tracks
    // the actual wheelhouse block, whether forward or amidships.
    post({ shirt: NAVY, trousers: NAVY, cap: 0xf3f4f6 }, 1.0 * B, bridgeY, wh.z, 0, {
      role: 'Captain',
      name: pick(NAMES),
      station: 'Wheelhouse',
      duty: 'Driving the vessel',
    });

    // Bar attendant — white shirt + burgundy apron — behind the lower bar.
    post({ shirt: 0xf5f5f5, trousers: DARK, apron: 0x8a1c1c }, 0, 2.15, -12.8 * L, 0, {
      role: 'Bar attendant',
      name: pick(NAMES),
      station: 'Lower saloon bar',
      duty: 'Serving drinks',
    });

    // Deckhand — navy uniform + hi-vis vest — on the bow open deck.
    post({ shirt: NAVY, trousers: DARK, vest: 0xff7a1a }, 0, 2.15, 15 * L, Math.PI, {
      role: 'Deckhand',
      name: pick(NAMES),
      station: 'Bow deck',
      duty: 'Assisting passengers',
    });

    // Upper-deck crew only exist on double-decked ferries.
    if (decks === 2) {
      post({ shirt: 0xf5f5f5, trousers: DARK, apron: 0x8a1c1c }, 0, 7.0, -12.8 * L, 0, {
        role: 'Bar attendant',
        name: pick(NAMES),
        station: 'Upper deck kiosk',
        duty: 'Serving drinks',
      });
      post({ shirt: NAVY, trousers: DARK, vest: 0xff7a1a }, 3.8 * B, 7.0, 0, -Math.PI / 2, {
        role: 'Deckhand',
        name: pick(NAMES),
        station: 'Upper deck',
        duty: 'Assisting passengers',
      });
    }
  }

  private spawnPassenger(area: DeckArea, list: Passenger[]): void {
    const { group, legL, legR } = this.buildFigure();
    const start = this.randomPoint(area);
    group.position.copy(start);
    const ticket = makeTicket(area.deck);
    group.userData.ticket = ticket;
    this.group.add(group);
    const p: Passenger = {
      group,
      area,
      target: this.randomPoint(area),
      speed: 1.1 + Math.random() * 1.1,
      phase: Math.random() * Math.PI * 2,
      legL,
      legR,
      ticket,
    };
    list.push(p);
    this.passengers.push(p);
  }

  private removePassenger(list: Passenger[]): void {
    const p = list.pop();
    if (!p) return;
    const i = this.passengers.indexOf(p);
    if (i >= 0) this.passengers.splice(i, 1);
    this.group.remove(p.group);
    p.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }

  private randomPoint(area: DeckArea): THREE.Vector3 {
    return new THREE.Vector3(
      area.minX + Math.random() * (area.maxX - area.minX),
      area.y,
      area.minZ + Math.random() * (area.maxZ - area.minZ),
    );
  }
}
