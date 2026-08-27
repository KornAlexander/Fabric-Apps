/**
 * Units and cities as physical objects.
 *
 * These are built from primitives rather than modelled, which is the honest
 * constraint of having no artist and no asset budget. What makes them read
 * as real is not the silhouette but the material response: metal that is
 * actually metallic, paint that is actually rough, real shadows underneath,
 * and the same environment lighting that the ground gets.
 *
 * The faction colour appears as painted panels and an emissive strip, not as
 * a flat tint over the whole object, because a uniformly coloured object
 * looks like a game token and a painted machine looks like a machine.
 */

import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import {
  cityKind,
  isBreached,
  rankIndex,
  unitType,
  wallIntegrity,
  MAX_WALL_LEVEL,
  type City,
  type Ruin,
  type Unit,
} from '@fabric-empires/engine';

const materialCache = new Map<string, MeshStandardMaterial>();

function material(
  key: string,
  build: () => MeshStandardMaterial,
): MeshStandardMaterial {
  const cached = materialCache.get(key);
  if (cached) return cached;
  const made = build();
  materialCache.set(key, made);
  return made;
}

/*
 * The 1600 palette.
 *
 * ⚠️ **Nothing here is chrome and nothing here glows.** The steel, concrete,
 * glass and emissive materials this file used to carry were deleted rather
 * than left unused, because an unused material is an invitation: the old city
 * read as science fiction precisely because those four were within reach. A
 * fortified town of this period is earth, rubble stone, lime plaster, oak and
 * fired clay, and an army is wool, buff leather and blackened iron.
 *
 * The one exception is the faction band under a stand, and it is documented
 * where it is defined.
 */
const stone = () =>
  material(
    'stone',
    () =>
      new MeshStandardMaterial({ color: new Color('#8d8578'), metalness: 0, roughness: 0.92 }),
  );

const earth = () =>
  material(
    'earth',
    () =>
      new MeshStandardMaterial({ color: new Color('#6b5c46'), metalness: 0, roughness: 1 }),
  );

const plaster = () =>
  material(
    'plaster',
    () =>
      new MeshStandardMaterial({ color: new Color('#cfc4ad'), metalness: 0, roughness: 0.88 }),
  );

const timber = () =>
  material(
    'timber',
    () =>
      new MeshStandardMaterial({ color: new Color('#59422e'), metalness: 0, roughness: 0.9 }),
  );

/** Fired clay roof tile, which is what carries the period from above. */
const tile = () =>
  material(
    'tile',
    () =>
      new MeshStandardMaterial({ color: new Color('#7d4a38'), metalness: 0, roughness: 0.9 }),
  );

/**
 * Turfed earth: the glacis outside the wall and the gun platforms on top of
 * the bastions.
 *
 * Dark on purpose. It is the value that separates the fort from the pale
 * stone of the rampart, and without that separation the whole thing reads as
 * one flat disc.
 */
const sward = () =>
  material(
    'sward',
    () =>
      new MeshStandardMaterial({ color: new Color('#4f5232'), metalness: 0, roughness: 1 }),
  );

/**
 * A trodden dirt track.
 *
 * ⚠️ Its own material, and darker than it looks like it should be. The road
 * was first drawn in the same `earth` as the courtyard, and in direct sun that
 * pale brown read as a bright sand-coloured apron spilling out of the town,
 * far more prominent than the fort it was supposed to be serving. Bare earth
 * in sunlight really is lighter than grass, so the answer is not to make it
 * grey, it is to keep it dark enough that the eye reads it as a line rather
 * than as a surface.
 */
const trackway = () =>
  material(
    'trackway',
    () =>
      new MeshStandardMaterial({ color: new Color('#514434')  , metalness: 0, roughness: 1 }),
  );

/**
 * The wall face, drawn on both sides.
 *
 * A rampart is a ring, so the camera sees the inside of the far wall through
 * the middle of it. With single-sided faces that far wall is simply absent and
 * the fort has a bite taken out of it.
 */
const rubble = () =>
  material(
    'rubble',
    () =>
      new MeshStandardMaterial({
        color: new Color('#8d8578'),
        metalness: 0,
        roughness: 0.94,
        side: DoubleSide,
      }),
  );

const slate = () =>
  material(
    'slate',
    () =>
      new MeshStandardMaterial({ color: new Color('#4a4f57'), metalness: 0, roughness: 0.7 }),
  );

/** Blackened iron: a morion, a breastplate, a gun barrel. Dull, not chrome. */
const iron = () =>
  material(
    'iron',
    () =>
      new MeshStandardMaterial({ color: new Color('#4c4a48'), metalness: 0.65, roughness: 0.62 }),
  );

/**
 * Burnished plate armour.
 *
 * ⚠️ Brighter and smoother than `iron`, and still nowhere near chrome. Harness
 * of this period was often blackened or blued against rust and then polished
 * on the raised surfaces, so it catches light in bands rather than mirroring
 * the sky. A knight has to read as metal at forty pixels; a knight that reads
 * as a mirror is the science fiction this palette was built to get rid of.
 */
const plate = () =>
  material(
    'plate',
    () =>
      new MeshStandardMaterial({ color: new Color('#6e7176'), metalness: 0.78, roughness: 0.42 }),
  );

/** Ash and oak in the pale: pike shafts, cart beds, wheel spokes. */
const ash = () =>
  material(
    'ash',
    () =>
      new MeshStandardMaterial({ color: new Color('#9b7d54'), metalness: 0, roughness: 0.85 }),
  );

/** A buff leather coat, which is what most of an army is wearing. */
const buff = () =>
  material(
    'buff',
    () =>
      new MeshStandardMaterial({ color: new Color('#b8a077'), metalness: 0, roughness: 0.94 }),
  );

const skin = () =>
  material(
    'skin',
    () =>
      new MeshStandardMaterial({ color: new Color('#b98f6d'), metalness: 0, roughness: 1 }),
  );

const horsehide = () =>
  material(
    'horsehide',
    () =>
      new MeshStandardMaterial({ color: new Color('#5a4130'), metalness: 0, roughness: 0.95 }),
  );

/** Wicker filled with earth. The most 1600 object on a battlefield. */
const wicker = () =>
  material(
    'wicker',
    () =>
      new MeshStandardMaterial({ color: new Color('#7d6a44'), metalness: 0, roughness: 1 }),
  );

const turf = () =>
  material(
    'turf',
    () =>
      new MeshStandardMaterial({ color: new Color('#6d6552'), metalness: 0, roughness: 1 }),
  );

/**
 * Dyed cloth in the faction's colour: sashes, coat facings, and the colours
 * the ensign carries.
 *
 * Rough and unlit-looking on purpose. Cloth is the period-correct place for a
 * faction to put its identity, and it is the only place it goes now.
 */
function cloth(colour: string): MeshStandardMaterial {
  return material(
    `cloth:${colour}`,
    () =>
      new MeshStandardMaterial({
        color: new Color(colour),
        metalness: 0,
        roughness: 0.95,
      }),
  );
}

/**
 * The faction band around a stand's tray.
 *
 * ⚠️ **This is the one thing on a unit that is allowed to cheat, and it is
 * deliberate.** It replaces the emissive strip, which was the single most
 * science-fiction object on the map and also the only reason a unit could be
 * found in shadow, in forest or under fog. A glowing hull is a lie about the
 * seventeenth century; a painted counter under a wargame stand is not
 * pretending to be a physical object at all, so it can carry a little emission
 * without claiming anything false. Kept low enough that bloom never blows it
 * out: the old strip was at 2.4.
 */
function trayBand(colour: string): MeshStandardMaterial {
  return material(
    `trayBand:${colour}`,
    () =>
      new MeshStandardMaterial({
        color: new Color(colour),
        emissive: new Color(colour),
        emissiveIntensity: 0.22,
        metalness: 0,
        roughness: 0.85,
      }),
  );
}

function part(geometry: BufferGeometry, mat: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(geometry, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------------ *
 * The figure vocabulary, around 1600
 * ------------------------------------------------------------------------ */

/**
 * ⚠️ **A man is this tall, and nothing makes him taller.**
 *
 * Set against the settlement, not against the camera. A village house stands
 * about 0.35 with its roof, and a house of this period is roughly seven
 * metres to the ridge, so a metre is about 0.05 and a man is 0.09. Everything
 * below is measured from that one number, which is what stops a soldier
 * quietly growing until he is taller than the houses he is marching past.
 *
 * A stronger unit therefore gets MORE FIGURES, never bigger ones. That is
 * also what strength meant: a tercio was not made of larger men.
 */
const MAN = 0.092;
/** Metres, in the settlement scale that `MAN` is derived from. */
const M = MAN / 1.75;

/**
 * Where a melee unit stops walking and starts riding.
 *
 * ⚠️ Strength rather than a list of unit ids, so a campaign that invents its
 * own roster gets the same hierarchy for free. The engine's `melee` role
 * covers everything from a line unit at 20 to a Direct Lake Titan at 60, and
 * drawing all of them as one pike block meant the best units a player owned
 * looked exactly like the one they started with.
 */
const HORSE_FROM_STRENGTH = 40;
/** And where the horse gets armour of its own. */
const BARDING_FROM_STRENGTH = 55;

/**
 * One soldier: coat, head, hat, and whatever he is carrying.
 *
 * No arms and no legs, on purpose. At the zoom this game is played at the
 * limbs are never more than a smear, and the eye is expert enough on anatomy
 * that a bad arm reads worse than no arm. What identifies a figure at
 * distance is the hat and the line of the weapon, so those are what exist.
 */
function figure(colour: string, opts: { helmet?: boolean; sash?: boolean } = {}): Group {
  const g = new Group();

  // The coat: wider at the hem, which is the period line and also stops the
  // figure reading as a peg.
  const coat = part(new CylinderGeometry(MAN * 0.17, MAN * 0.26, MAN * 0.62, 6), buff());
  coat.position.y = MAN * 0.31;
  g.add(coat);

  if (opts.sash !== false) {
    const sash = part(new CylinderGeometry(MAN * 0.2, MAN * 0.21, MAN * 0.1, 6), cloth(colour));
    sash.position.y = MAN * 0.46;
    g.add(sash);
  }

  const head = part(new SphereGeometry(MAN * 0.1, 8, 6), skin());
  head.position.y = MAN * 0.72;
  g.add(head);

  if (opts.helmet) {
    // A morion: a brimmed steel cap with a comb along the crown.
    const brim = part(new CylinderGeometry(MAN * 0.19, MAN * 0.19, MAN * 0.03, 8), iron());
    brim.position.y = MAN * 0.78;
    g.add(brim);
    const crown = part(new SphereGeometry(MAN * 0.12, 8, 5), iron());
    crown.position.y = MAN * 0.81;
    crown.scale.y = 0.8;
    g.add(crown);
  } else {
    // A broad felt hat, which is the other half of what an army looked like.
    const brim = part(new CylinderGeometry(MAN * 0.22, MAN * 0.22, MAN * 0.025, 8), timber());
    brim.position.y = MAN * 0.79;
    g.add(brim);
    const crown = part(new CylinderGeometry(MAN * 0.1, MAN * 0.12, MAN * 0.1, 8), timber());
    crown.position.y = MAN * 0.85;
    g.add(crown);
  }

  return g;
}

/** A pike: five and a half metres of ash with a small steel head. */
function pike(): Group {
  const g = new Group();
  const length = 5.5 * M;
  const shaft = part(new CylinderGeometry(M * 0.03, M * 0.04, length, 5), ash());
  shaft.position.y = length / 2;
  g.add(shaft);
  const head = part(new ConeGeometry(M * 0.07, M * 0.35, 4), iron());
  head.position.y = length + M * 0.17;
  g.add(head);
  return g;
}

/** A matchlock musket, carried level on its forked rest. */
function musket(): Group {
  const g = new Group();
  const barrel = part(new CylinderGeometry(M * 0.035, M * 0.035, 1.4 * M, 5), iron());
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0, MAN * 0.52, 0);
  g.add(barrel);
  const stock = part(new BoxGeometry(0.7 * M, 0.12 * M, 0.1 * M), timber());
  stock.position.set(-0.35 * M, MAN * 0.5, 0);
  g.add(stock);
  // The rest. A musket of 1600 is too heavy to aim without one, and the
  // forked stick is the thing that says "musketeer" rather than "man".
  const rest = part(new CylinderGeometry(M * 0.03, M * 0.03, 1.3 * M, 4), ash());
  rest.position.set(0.5 * M, MAN * 0.37, 0);
  rest.rotation.z = 0.16;
  g.add(rest);
  return g;
}

/** The colours. What a unit is actually recognised by on the map. */
function standard(colour: string): Group {
  const g = new Group();
  const height = 3.4 * M;
  const pole = part(new CylinderGeometry(M * 0.035, M * 0.045, height, 5), ash());
  pole.position.y = height / 2;
  g.add(pole);
  const flag = part(new BoxGeometry(1.5 * M, 1.05 * M, M * 0.05), cloth(colour));
  flag.position.set(0.75 * M, height - 0.62 * M, 0);
  g.add(flag);
  return g;
}

/** A horse, seen from above and from twenty metres. */
function horse(): Group {
  const g = new Group();
  const body = part(new CapsuleGeometry(0.34 * M, 1.1 * M, 4, 8), horsehide());
  body.rotation.z = Math.PI / 2;
  body.position.y = 1.25 * M;
  g.add(body);
  const neck = part(new CylinderGeometry(0.16 * M, 0.24 * M, 0.8 * M, 6), horsehide());
  neck.position.set(0.85 * M, 1.6 * M, 0);
  neck.rotation.z = -0.5;
  g.add(neck);
  const head = part(new BoxGeometry(0.5 * M, 0.22 * M, 0.22 * M), horsehide());
  head.position.set(1.2 * M, 1.85 * M, 0);
  g.add(head);
  for (const x of [0.55, -0.55]) {
    for (const z of [0.24, -0.24]) {
      const leg = part(new CylinderGeometry(0.07 * M, 0.06 * M, 1.25 * M, 4), horsehide());
      leg.position.set(x * M, 0.62 * M, z * M);
      g.add(leg);
    }
  }
  return g;
}

/**
 * A man in three-quarter harness: the *Ritter* of this century.
 *
 * ⚠️ **Knights and 1600 are not in conflict, which is why this exists.** The
 * armoured horseman did not vanish with the Middle Ages; he became the
 * cuirassier, and in German he was still a Ritter. Three-quarter plate down to
 * the knee, a closed helm, a lance or a pair of wheel-lock pistols. The
 * Thirty Years' War is full of them. So the roster gets its knights without
 * touching the period the forts and the siege are built on (D145).
 *
 * Built on the same `MAN` as everyone else. Armour does not make a man taller.
 */
function knight(colour: string): Group {
  const g = new Group();

  // Cuirass over a padded arming coat, flaring into tassets at the thigh.
  const cuirass = part(new CylinderGeometry(MAN * 0.19, MAN * 0.23, MAN * 0.4, 8), plate());
  cuirass.position.y = MAN * 0.44;
  g.add(cuirass);

  const tassets = part(new CylinderGeometry(MAN * 0.23, MAN * 0.2, MAN * 0.2, 8), plate());
  tassets.position.y = MAN * 0.2;
  g.add(tassets);

  // Pauldrons. The one silhouette cue that says "armour" rather than "coat".
  for (const side of [-1, 1]) {
    const pauldron = part(new SphereGeometry(MAN * 0.11, 8, 6), plate());
    pauldron.position.set(0, MAN * 0.6, side * MAN * 0.17);
    pauldron.scale.y = 0.7;
    g.add(pauldron);
  }

  // A sash across the breastplate: in a war where both sides wore the same
  // harness, a coloured scarf was how you knew who to shoot at. It is also
  // where this stand's faction colour lives.
  const sash = part(new BoxGeometry(MAN * 0.42, MAN * 0.09, MAN * 0.42), cloth(colour));
  sash.position.y = MAN * 0.5;
  sash.rotation.y = Math.PI / 4;
  g.add(sash);

  // Closed helm: skull, and a visor projecting forward over the face.
  const skull = part(new SphereGeometry(MAN * 0.115, 8, 6), plate());
  skull.position.y = MAN * 0.73;
  g.add(skull);
  const visor = part(new BoxGeometry(MAN * 0.13, MAN * 0.1, MAN * 0.16), plate());
  visor.position.set(MAN * 0.07, MAN * 0.71, 0);
  g.add(visor);

  // The crest. Reads before anything else does from above, and it is the
  // reason a knight is findable in a crowd of pikemen.
  const crest = part(new ConeGeometry(MAN * 0.05, MAN * 0.26, 5), cloth(colour));
  crest.position.y = MAN * 0.93;
  g.add(crest);

  return g;
}

/**
 * A lance, couched.
 *
 * Shorter than a pike at about four metres, and carried level under the arm
 * rather than upright: a hedge of vertical shafts says infantry, and a row of
 * horizontal ones says a charge. That contrast is the whole point of drawing
 * both.
 */
function lance(): Group {
  const g = new Group();
  const length = 4 * M;
  const shaft = part(new CylinderGeometry(M * 0.035, M * 0.055, length, 6), ash());
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(length * 0.28, MAN * 0.52, 0);
  g.add(shaft);

  const head = part(new ConeGeometry(M * 0.07, M * 0.4, 5), plate());
  head.rotation.z = -Math.PI / 2;
  head.position.set(length * 0.28 + length / 2 + M * 0.2, MAN * 0.52, 0);
  g.add(head);

  // The grapper: the flared ring that stops the lance sliding back on impact.
  const vamplate = part(new CylinderGeometry(M * 0.16, M * 0.09, M * 0.18, 8), plate());
  vamplate.rotation.z = Math.PI / 2;
  vamplate.position.set(length * 0.28 - length * 0.3, MAN * 0.52, 0);
  g.add(vamplate);

  return g;
}

/**
 * Barding: armour for the horse.
 *
 * Reserved for the heaviest stand on the field. A barded horse was ruinously
 * expensive and by 1600 already rare, which makes it exactly the right way to
 * say "this is the most frightening thing you own" without drawing it bigger
 * than everything else (D244).
 */
function barding(colour: string): Group {
  const g = new Group();

  // Chanfron over the face.
  const chanfron = part(new BoxGeometry(0.55 * M, 0.26 * M, 0.26 * M), plate());
  chanfron.position.set(1.2 * M, 1.87 * M, 0);
  g.add(chanfron);

  // Peytral across the chest.
  const peytral = part(new CylinderGeometry(0.36 * M, 0.4 * M, 0.5 * M, 8), plate());
  peytral.rotation.z = Math.PI / 2;
  peytral.position.set(0.7 * M, 1.25 * M, 0);
  g.add(peytral);

  // A caparison hanging over the flank, in the faction's colour.
  for (const side of [-1, 1]) {
    const cloth_ = part(new BoxGeometry(1.5 * M, 0.75 * M, 0.05 * M), cloth(colour));
    cloth_.position.set(-0.15 * M, 1.0 * M, side * 0.36 * M);
    g.add(cloth_);
  }

  return g;
}

/** A gabion: a wicker cylinder packed with earth, the sandbag of its day. */
function gabion(): Group {
  const g = new Group();
  const basket = part(new CylinderGeometry(0.45 * M, 0.48 * M, 1.1 * M, 8), wicker());
  basket.position.y = 0.55 * M;
  g.add(basket);
  const fill = part(new CylinderGeometry(0.42 * M, 0.42 * M, 0.16 * M, 8), earth());
  fill.position.y = 1.14 * M;
  g.add(fill);
  return g;
}

/** A two-wheeled cart. Scale reference and the reason a settler reads as one. */
function cart(): Group {
  const g = new Group();
  const bed = part(new BoxGeometry(1.9 * M, 0.45 * M, 1.1 * M), ash());
  bed.position.y = 0.95 * M;
  g.add(bed);
  for (const z of [0.62, -0.62]) {
    const wheel = part(new CylinderGeometry(0.62 * M, 0.62 * M, 0.1 * M, 10), timber());
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(0, 0.62 * M, z * M);
    g.add(wheel);
  }
  const shaft = part(new CylinderGeometry(0.05 * M, 0.05 * M, 1.5 * M, 4), ash());
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(1.6 * M, 0.85 * M, 0);
  g.add(shaft);
  return g;
}

/** A cannon on a field carriage. */
function fieldPiece(): Group {
  const g = new Group();
  const barrel = part(new CylinderGeometry(0.16 * M, 0.22 * M, 2.6 * M, 10), iron());
  barrel.rotation.z = Math.PI / 2;
  barrel.rotation.y = 0;
  barrel.position.set(0, 1.0 * M, 0);
  barrel.rotation.x = 0;
  g.add(barrel);
  // Trail and cheeks: the wooden carriage the barrel is strapped into.
  const trail = part(new BoxGeometry(2.6 * M, 0.22 * M, 0.85 * M), timber());
  trail.position.set(-0.7 * M, 0.72 * M, 0);
  trail.rotation.z = 0.12;
  g.add(trail);
  for (const z of [0.62, -0.62]) {
    const wheel = part(new CylinderGeometry(0.85 * M, 0.85 * M, 0.12 * M, 12), ash());
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(0.35 * M, 0.85 * M, z * M);
    g.add(wheel);
  }
  return g;
}

/** A small single-masted hoy, for the one unit that travels by water. */
function hoy(colour: string): Group {
  const g = new Group();
  const hull = part(new CapsuleGeometry(1.05 * M, 3.4 * M, 4, 10), timber());
  hull.rotation.z = Math.PI / 2;
  hull.position.y = 0.75 * M;
  hull.scale.y = 0.55;
  g.add(hull);
  const deck = part(new BoxGeometry(4.2 * M, 0.14 * M, 1.5 * M), ash());
  deck.position.y = 1.15 * M;
  g.add(deck);
  const mast = part(new CylinderGeometry(0.07 * M, 0.09 * M, 4.4 * M, 6), ash());
  mast.position.y = 3.3 * M;
  g.add(mast);
  const sail = part(new BoxGeometry(0.08 * M, 2.6 * M, 2.4 * M), plaster());
  sail.position.set(0, 3.6 * M, 0);
  g.add(sail);
  const pennant = part(new BoxGeometry(0.9 * M, 0.4 * M, 0.04 * M), cloth(colour));
  pennant.position.set(0.45 * M, 5.3 * M, 0);
  g.add(pennant);
  return g;
}

/**
 * A unit: a wargame stand.
 *
 * ⚠️ **The tray is a map symbol and the figures on it are not.** That split is
 * how this scene stays honest about a contradiction it cannot escape. A
 * fortified town fills a hex, so a hex is a few hundred metres, so a man drawn
 * to scale would be a twentieth of a pixel at the zoom the game opens at. The
 * old answer was to draw the man twenty times too big. The answer here is the
 * one a tabletop has used for a century: a printed counter, which never
 * claimed to be an object, carries the recognition, and the miniatures
 * standing on it keep their real proportions against the buildings.
 *
 * So `MAN` is fixed, and a stronger unit is a bigger CROWD.
 */
export function buildUnit(unit: Unit, factionColour: string): Group {
  const type = unitType(unit.typeId);
  const group = new Group();

  // Deterministic scatter, so a stand looks formed up rather than stamped and
  // looks the same every time the same game is loaded.
  const seed = unit.id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  const rand = (n: number): number => {
    const x = Math.sin(seed * 0.017 + n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };

  const TRAY = 0.46;
  /** Height of the plinth's top face above the hex's nominal ground. */
  const DECK = 0.028;

  /*
   * The stand's base, as a shallow plinth rather than a plate.
   *
   * ⚠️ **A flat disc laid on a hex sinks into it.** The ground inside one hex
   * is not level: it is subdivided, displaced and eroded, so a flat ring at a
   * fixed height had its far side buried and drew as a broken arc. Exactly the
   * failure the fog lid hit (D229). The fix is the same shape a wargame base
   * already is: a block that stands slightly proud and is mostly underground,
   * so the top face is always flat, always visible, and the terrain it is
   * standing in is hidden rather than fought.
   */
  const tray = part(new CylinderGeometry(TRAY, TRAY * 1.03, 0.2, 6), turf());
  tray.position.y = DECK - 0.1;
  tray.rotation.y = Math.PI / 6;
  group.add(tray);

  /*
   * ⚠️ **The colour has to be an annulus, not a rim.**
   *
   * The first attempt put a slightly wider disc under the tray so a sliver
   * showed round the edge. Measured against the camera that sliver is three
   * pixels at close zoom and nothing at all at the zoom the game opens at, so
   * the stand read as a dark hole in the ground with specks on it. A broad
   * flat ring on the deck is what a player actually sees from above, and it is
   * the same device every strategy game has used for thirty years to say whose
   * piece this is.
   */
  const ring = part(new RingGeometry(TRAY * 0.76, TRAY * 0.99, 6, 1), trayBand(factionColour));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = DECK + 0.002;
  ring.castShadow = false;
  group.add(ring);

  const men = new Group();
  men.position.y = DECK;
  group.add(men);

  /** Place something on the tray, in ranks, facing forward. */
  const place = (
    object: Object3D,
    x: number,
    z: number,
    yaw = 0,
  ): Object3D => {
    object.position.set(x, 0, z);
    object.rotation.y = yaw;
    men.add(object);
    return object;
  };

  /*
   * How many men. Strength buys bodies, and only bodies.
   *
   * A pike block of 3 and one of 8 are recognisably the same thing at
   * different weights, which is what a strength number should look like.
   */
  const bodies = Math.max(2, Math.min(9, Math.round(2 + type.strength / 8)));

  /** Two ranks, dressed, with a little deterministic slop. */
  const ranks = (n: number, build: (i: number) => Group, spread = 0.24): void => {
    const perRank = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const rank = i < perRank ? 0 : 1;
      const inRank = i < perRank ? i : i - perRank;
      const count = rank === 0 ? perRank : n - perRank;
      const x = (inRank - (count - 1) / 2) * spread + (rand(i) - 0.5) * 0.03;
      const z = rank * 0.2 - 0.1 + (rand(i + 30) - 0.5) * 0.03;
      place(build(i), x, z, (rand(i + 60) - 0.5) * 0.3);
    }
  };

  switch (type.role) {
    case 'melee': {
      /*
       * ⚠️ **Two very different things share this role, and used to share one
       * drawing.** Pipeline Runner at strength 20, Semantic Colossus at 45 and
       * Direct Lake Titan at 60 were all rendered as the same pike block with
       * more men in it, so a player's two most powerful units looked exactly
       * like their starter. Strength is the split: the line unit fights on
       * foot, the heavy units ride.
       *
       * That is also how these armies really worked. Infantry held ground with
       * the pike; the decisive arm was armoured horse.
       */
      if (type.strength >= HORSE_FROM_STRENGTH) {
        // A wedge, which is the formation that made the charge worth making.
        const riders = Math.max(3, Math.min(5, Math.round(type.strength / 13)));
        const barded = type.strength >= BARDING_FROM_STRENGTH;
        for (let i = 0; i < riders; i++) {
          const mount = horse();
          if (barded) mount.add(barding(factionColour));

          const rider = knight(factionColour);
          rider.add(lance());
          rider.position.y = 1.45 * M;
          mount.add(rider);

          // Front rank of one or two, the rest fanned out behind it.
          const front = riders >= 5 ? 2 : 1;
          const inFront = i < front;
          const idx = inFront ? i : i - front;
          const count = inFront ? front : riders - front;
          const x = (idx - (count - 1) / 2) * 0.2 + (rand(i) - 0.5) * 0.02;
          const z = (inFront ? -0.14 : 0.12) + (rand(i + 30) - 0.5) * 0.04;
          place(mount, x, z, (rand(i + 60) - 0.5) * 0.16);
        }
        break;
      }

      // A pike block. The hedge of shafts all leaning the same way is the
      // most recognisable silhouette of the century, and it survives being
      // small better than anything else here does.
      ranks(bodies, (i) => {
        const g = figure(factionColour, { helmet: i % 3 !== 0 });
        const p = pike();
        p.rotation.x = -1.05 + (rand(i + 90) - 0.5) * 0.12;
        p.position.set(MAN * 0.16, MAN * 0.3, 0);
        g.add(p);
        return g;
      });
      break;
    }

    case 'ranged': {
      // Shot, in a line rather than a block: musketeers fought in wide
      // shallow ranks so that every barrel had somewhere to point.
      ranks(Math.max(3, bodies - 1), () => {
        const g = figure(factionColour, { helmet: false });
        g.add(musket());
        return g;
      }, 0.19);
      break;
    }

    case 'siege': {
      place(fieldPiece(), 0, 0.02, 0.25);
      place(figure(factionColour, { helmet: false }), -0.2, -0.16, 0.8);
      place(figure(factionColour, { helmet: false }), 0.21, -0.17, -0.7);
      place(gabion(), -0.26, 0.2);
      place(gabion(), 0.27, 0.22);
      break;
    }

    case 'defensive': {
      // A post, not a formation: gabions in front and helmeted men behind.
      for (const [i, x] of [-0.26, 0, 0.26].entries()) {
        place(gabion(), x, 0.26 + (rand(i) - 0.5) * 0.04);
      }
      ranks(Math.max(2, bodies - 2), (i) => {
        const g = figure(factionColour, { helmet: true });
        const halberd = pike();
        halberd.scale.y = 0.62;
        halberd.rotation.x = -0.12 + (rand(i + 12) - 0.5) * 0.1;
        halberd.position.set(MAN * 0.17, MAN * 0.3, 0);
        g.add(halberd);
        return g;
      }, 0.2);
      break;
    }

    case 'scout': {
      // Light horse. Two riders read as cavalry; a squadron does not fit.
      for (const [i, x] of [-0.15, 0.17].entries()) {
        const mount = horse();
        const rider = figure(factionColour, { helmet: false });
        rider.position.y = 1.45 * M;
        rider.scale.setScalar(0.92);
        mount.add(rider);
        place(mount, x, (rand(i) - 0.5) * 0.12, -0.12 + (rand(i + 5) - 0.5) * 0.4);
      }
      break;
    }

    case 'transport': {
      place(hoy(factionColour), 0, 0, 0.3);
      break;
    }

    case 'settler': {
      // A surveyor with his staff, and the cart that carries the town with him.
      const surveyor = figure(factionColour, { helmet: false });
      const staff = part(new CylinderGeometry(M * 0.03, M * 0.03, 2.2 * M, 4), ash());
      staff.position.set(MAN * 0.2, MAN * 0.55, 0);
      surveyor.add(staff);
      place(surveyor, -0.16, -0.1, 0.4);
      place(cart(), 0.12, 0.08, -0.5);
      break;
    }

    case 'worker': {
      // Pioneers: the men who dig, which in 1600 is most of what wins a siege.
      for (const [i, x] of [-0.18, 0.14].entries()) {
        const g = figure(factionColour, { helmet: i === 0 });
        const spade = part(new CylinderGeometry(M * 0.03, M * 0.03, 1.5 * M, 4), ash());
        spade.rotation.z = 0.6;
        spade.position.set(MAN * 0.22, MAN * 0.42, 0);
        g.add(spade);
        const blade = part(new BoxGeometry(0.35 * M, 0.42 * M, 0.05 * M), iron());
        blade.position.set(MAN * 0.62, MAN * 0.02, 0);
        g.add(blade);
        place(g, x, (rand(i) - 0.5) * 0.14, rand(i + 3) * 2);
      }
      place(gabion(), 0.24, 0.22);
      break;
    }

    case 'support': {
      // Drummer and powder cart: the noise and the supply.
      const drummer = figure(factionColour, { helmet: false });
      const drum = part(new CylinderGeometry(0.42 * M, 0.42 * M, 0.5 * M, 10), ash());
      drum.rotation.x = Math.PI / 2;
      drum.position.set(MAN * 0.22, MAN * 0.38, MAN * 0.1);
      drummer.add(drum);
      place(drummer, -0.2, -0.12, 0.2);
      place(cart(), 0.14, 0.1, -0.4);
      break;
    }
  }

  /*
   * The colours, on every stand that has feet.
   *
   * ⚠️ **This is the findability affordance, and it has to be universal.**
   * Only the fighting roles carried a standard at first, which meant the two
   * units a game actually opens with, the Architect and the Profiler, were
   * the two with nothing above knee height. On a photograph of the opening
   * position they were invisible. A flag is period-correct, it is the tallest
   * thing on the stand, and it is the faction's colour against the sky rather
   * than against the ground, which is what makes it hold up in shadow.
   */
  if (type.domain !== 'water') {
    place(standard(factionColour), -0.04, -0.3);
  }

  group.userData.kind = 'unit';
  group.userData.id = unit.id;
  return group;
}

/**
 * Where a town's wall is, in world units.
 *
 * ⚠️ **Exported because the siege has to hit it.** These began as three
 * locals inside `buildCity`, which was fine while the city was the only thing
 * that knew where its own stonework was. `siege.ts` rears ladders against the
 * wall head and parks a ram at its foot, so it needs the same three numbers,
 * and a copy of them there would have drifted the first time a rampart was
 * made taller: the copy has no reason to be edited in the same change, and
 * nothing would report ladders ending in mid-air.
 */
export const WALL_RADIUS = 0.74;

/**
 * How tall the rampart stands above the town's platform.
 *
 * Each level is a taller work than the last, so 1, 2 and 3 are told apart
 * at a glance without needing a number on screen.
 */
export const wallHeight = (wallLevel: number): number =>
  0.16 + 0.04 * Math.min(wallLevel, MAX_WALL_LEVEL);

/**
 * The height a defender stands at, measured from the tile's ground.
 *
 * An open town has no wall, so its "head" is just the lip of the platform its
 * buildings sit on. Returning something sensible for level 0 is what lets the
 * siege stage an assault on an unwalled place without a special case.
 */
export const wallTop = (wallLevel: number): number =>
  wallLevel >= 1 ? 0.07 + wallHeight(wallLevel) : 0.05;

/**
 * A settlement.
 *
 * Grows with population: the same city at size 1 and size 6 should not be
 * the same object with a different number painted on it.
 */
/**
 * A fortified town, around 1600.
 *
 * ⚠️ **This replaces concrete towers with glass windows and a glowing beacon.**
 * The old city was science fiction standing in a landscape that aims at
 * plausibility, next to units and terrain from no particular century, and it
 * looked exactly as mixed up as that description sounds.
 *
 * The period is chosen, not decorative. Around 1600 is when the *trace
 * italienne* had made the high medieval curtain wall obsolete: cannon flattened
 * tall stone, so ramparts went low, thick and earthen, and corners grew angled
 * **bastions** so that every face could be covered by fire from another. That
 * is the shape being drawn here, and it is the same shape the siege is built
 * to attack: a bastioned front is a thing you have to reduce, not climb.
 *
 * All geometry, no assets. A pyramid is a four-sided cone, a bastion is a
 * three-sided cylinder, and a roof is the same trick at a different scale.
 */
export function buildCity(city: City, factionColour: string): Group {
  const group = new Group();
  const kind = cityKind(city.kind);

  // Deterministic jitter, so a town looks built rather than stamped, and looks
  // the same every time the same game is loaded.
  const seed = city.hex.q * 73856093 + city.hex.r * 19349663;
  const rand = (n: number): number => {
    const x = Math.sin(seed + n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };

  /*
   * ⚠️ **The fortress is earned, and used to be free.**
   *
   * Every settlement got the full bastioned trace the moment it was founded,
   * which was wrong twice over. Historically it is absurd: a *trace italienne*
   * was the most expensive thing a state could build, years of work and the
   * reason early modern treasuries went bankrupt, and one did not appear
   * around a hut. And in play it wasted the whole vocabulary, because if a
   * one-citizen camp already looks like a fortress there is nothing left for a
   * real city to look like.
   *
   * ⚠️ **It was then earned by the wrong thing.** Rank decided what stood
   * here, and rank is population and retained knowledge. Once walls became a
   * production item (section 54) that left two unrelated notions of
   * fortification in the same game: a Siedlung with three wall levels showed
   * no wall at all, and a Großstadt that had never spent a single Compute on
   * defence looked like a fortress and fought like an open town. **What you
   * see is now what you built.**
   *
   * So the two axes are separated, and each says what it actually means:
   *
   *   rank       how developed the place is: houses, church, cathedral,
   *              a second storey on everything
   *   wallLevel  what fortification stands: rampart and gate, then bastions
   */
  const tier = rankIndex(city.rank);
  const walled = city.wallLevel >= 1;
  const bastioned = city.wallLevel >= MAX_WALL_LEVEL;
  const great = tier >= 4;

  /**
   * How much of the wall is still standing, 0 to 1.
   *
   * A wall that has been battered loses its turfed rampart walk, so a breached
   * fort reads as raw earth from the map camera rather than as a finished one.
   * That matters now that walls take damage: a siege has to be visible from
   * outside the city panel, or the player only learns about it by reading.
   */
  const integrity = walled ? wallIntegrity(city) : 0;
  const breached = isBreached(city);

  const RAMPART_RADIUS = WALL_RADIUS;
  const RAMPART_HEIGHT = wallHeight(city.wallLevel);
  /** Where the buildings stand. Inside the walls once there are walls. */
  const GROUND = walled ? 0.14 : 0.02;

  if (walled) {
  /*
   * ⚠️ **Value separation, which is what this town was actually missing.**
   *
   * The glacis, the rampart and the courtyard were all built from the same two
   * near-white materials, so from the map camera they merged into one pale
   * disc: a beige pancake with roofs on it. Nothing was wrong with the shapes.
   * The bastions were there and simply could not be seen, because a silhouette
   * needs a value difference at its edges and there was none.
   *
   * So each ring is now a different lightness as well as a different shape:
   * grassed earth on the glacis (dark), rubble stone on the rampart (light),
   * trodden dirt in the courtyard (mid). That ordering is not arbitrary
   * either. It is what a real one looked like, because the earth slope was
   * turfed to stop it washing away and the wall face was revetted in stone.
   */
  const glacis = part(new CylinderGeometry(0.94, 1.02, 0.07, 6), sward());
  glacis.position.y = 0.035;
  glacis.rotation.y = Math.PI / 6;
  group.add(glacis);

  // The rampart itself: low, thick, and battered (wider at the base).
  //
  // ⚠️ **It has to be a ring, and it was a solid cylinder.** That single fact
  // is why this town read as a beige pancake for so long. A solid cylinder's
  // top is a full disc, so the wall's own lid covered the courtyard, the
  // street and every house plot inside it: there was no inside. Colour was
  // never going to fix it, because what was missing was the hole.
  //
  // Faces are drawn double-sided so the inner revetment is visible when the
  // camera looks down into the place, which is the angle this game is played
  // at almost all of the time.
  const WALL_TOP = wallTop(city.wallLevel);
  const outer = part(
    new CylinderGeometry(RAMPART_RADIUS, RAMPART_RADIUS + 0.1, RAMPART_HEIGHT, 6, 1, true),
    rubble(),
  );
  outer.position.y = 0.07 + RAMPART_HEIGHT / 2;
  outer.rotation.y = Math.PI / 6;
  group.add(outer);

  const inner = part(
    new CylinderGeometry(RAMPART_RADIUS - 0.12, RAMPART_RADIUS - 0.12, RAMPART_HEIGHT, 6, 1, true),
    rubble(),
  );
  inner.position.y = 0.07 + RAMPART_HEIGHT / 2;
  inner.rotation.y = Math.PI / 6;
  group.add(inner);

  // The rampart walk on top, turfed. Dark against the pale wall below it,
  // which is what finally gives the fort an edge to be recognised by.
  //
  // ⚠️ Omitted once the wall is more than half down: the turf is the finished
  // surface, and a breach should not look finished.
  if (!breached) {
    const walk = part(
      new RingGeometry(RAMPART_RADIUS - 0.12, RAMPART_RADIUS, 6, 1),
      sward(),
    );
    walk.rotation.x = -Math.PI / 2;
    walk.position.y = WALL_TOP;
    group.add(walk);
  }

  // The courtyard, well below the wall head, so the rampart reads as a wall
  // enclosing somewhere rather than as a plinth holding something up.
  const COURTYARD_TOP = 0.14;
  const courtyard = part(
    new CylinderGeometry(RAMPART_RADIUS - 0.11, RAMPART_RADIUS - 0.11, 0.14, 6),
    earth(),
  );
  courtyard.position.y = COURTYARD_TOP - 0.07;
  courtyard.rotation.y = Math.PI / 6;
  group.add(courtyard);

  /*
   * Bastions on alternating corners: arrowhead platforms projecting from the
   * wall so their flanks can sweep the face between them. Three, not six,
   * because six on a hex reads as a cog rather than a fort.
   *
   * Each gets a turfed terreplein on top. That is both correct, since the gun
   * platform was earth so shot would bury itself instead of throwing stone
   * splinters, and the thing that finally makes the bastion legible from
   * above: a dark cap on a light plinth has an edge, and an edge is a shape.
   *
   * ⚠️ Only at the full wall level. A rampart is earth and labour; a
   * bastioned trace is the thing that bankrupted states, and it should not be
   * standing round a township that has paid for one course of earthworks.
   */
  if (bastioned) {
    // A breach takes a bastion with it, so the damage is legible from above.
    const standing = breached ? 2 : 3;
    for (let i = 0; i < standing; i++) {
      const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const height = RAMPART_HEIGHT + 0.03;
      const x = Math.cos(angle) * (RAMPART_RADIUS + 0.02);
      const z = Math.sin(angle) * (RAMPART_RADIUS + 0.02);
      const bastion = part(new CylinderGeometry(0.2, 0.26, height, 3), stone());
      bastion.position.set(x, 0.07 + height / 2, z);
      // Point the arrowhead outwards, which is the whole idea of a bastion.
      bastion.rotation.y = -angle + Math.PI / 2;
      group.add(bastion);

      const terreplein = part(new CylinderGeometry(0.202, 0.202, 0.028, 3), sward());
      terreplein.position.set(x, 0.07 + height + 0.012, z);
      terreplein.rotation.y = -angle + Math.PI / 2;
      group.add(terreplein);
    }
  }
  }

  /*
   * Houses, along a street.
   *
   * ⚠️ **Randomly placed and randomly rotated is what made this look like
   * scattered blocks rather than a town.** Every house was on its own bearing
   * at its own radius, and a settlement is the opposite of that: buildings
   * share a frontage because they share a road, and the gaps between them are
   * regular because they were measured out as plots.
   *
   * So the town is a street running from the gate to the market, houses in two
   * facing rows, gable ends to the road. Each is jittered a little because
   * these were not surveyed, but the jitter is now noise on an order rather
   * than the order itself.
   */
  // Houses come from both axes: people need housing, and a higher rank means
  // the place is denser as well as bigger.
  const houses = Math.min(14, 2 + city.population + tier * 2);
  /** The street runs on this bearing, and the gate is at the end of it. */
  const STREET = Math.PI * 0.18;
  const along = { x: Math.cos(STREET), z: Math.sin(STREET) };
  const across = { x: -Math.sin(STREET), z: Math.cos(STREET) };

  for (let i = 0; i < houses; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2);
    // Down the street from the market place, plus a little slop.
    const t = -0.34 + row * 0.2 + (rand(i) - 0.5) * 0.05;
    const off = side * (0.15 + rand(i + 40) * 0.05);

    const w = 0.12 + rand(i + 80) * 0.05;
    const d = 0.13 + rand(i + 120) * 0.06;
    // A Großstadt builds upwards, because inside a wall there is nowhere else
    // to go. That is why real ones did it.
    const h = (0.13 + rand(i + 160) * 0.09) * (great ? 1.35 : 1);
    const x = along.x * t + across.x * off;
    const z = along.z * t + across.z * off;
    // Square to the street, give or take a few degrees of settling.
    const lean = STREET + (rand(i + 200) - 0.5) * 0.22;

    const walls = part(new BoxGeometry(w, h, d), rand(i + 240) > 0.55 ? plaster() : timber());
    walls.position.set(x, GROUND + h / 2, z);
    walls.rotation.y = lean;
    group.add(walls);

    const roof = part(new ConeGeometry(Math.max(w, d) * 0.82, h * 0.85, 4), tile());
    roof.position.set(x, GROUND + h + h * 0.425, z);
    roof.rotation.y = lean + Math.PI / 4;
    group.add(roof);
  }

  /*
   * The street surface, and the gate it runs out through.
   *
   * One directional cue is worth more than a dozen more props: a town with a
   * road leaving it is connected to the country around it, and a town without
   * one is a model sitting on a table.
   */
  const street = part(new BoxGeometry(0.98, 0.012, 0.15), trackway());
  street.position.set(along.x * 0.08, GROUND + 0.007, along.z * 0.08);
  street.rotation.y = -STREET;
  street.castShadow = false;
  group.add(street);

  // A gap in the rampart on the street's bearing, with the road running down
  // the glacis and off the hex. No wall, no gate: an open village still has a
  // road, it just has nothing to pass through.
  const gateX = along.x * (RAMPART_RADIUS + 0.06);
  const gateZ = along.z * (RAMPART_RADIUS + 0.06);
  if (walled) {
    const gateway = part(new BoxGeometry(0.19, 0.1, 0.26), trackway());
    gateway.position.set(gateX, 0.13, gateZ);
    gateway.rotation.y = -STREET;
    group.add(gateway);

    for (const side of [-1, 1]) {
      const post = part(new CylinderGeometry(0.035, 0.042, 0.3, 6), stone());
      post.position.set(
        gateX + across.x * side * 0.1,
        0.07 + 0.15,
        gateZ + across.z * side * 0.1,
      );
      group.add(post);
    }
  }

  const approach = part(new BoxGeometry(0.34, 0.01, 0.12), trackway());
  approach.position.set(along.x * 1.02, 0.05, along.z * 1.02);
  approach.rotation.y = -STREET;
  approach.castShadow = false;
  group.add(approach);

  /*
   * Two props by the gate, and no more.
   *
   * ⚠️ **These are the scale reference, which is the job no amount of extra
   * building does.** A town made only of houses could be any size, because
   * every part of it is measured against every other part and they all agree.
   * A cart and a well are objects whose real size everybody knows, so they
   * fix the whole thing: once the cart is a cart, the houses are houses.
   *
   * The temptation is to keep going, with villagers, fences, haystacks,
   * washing lines and market stalls. That way the settlement becomes clutter
   * and the fort stops reading as a fort, so it stops here.
   */
  const wagon = cart();
  wagon.position.set(
    along.x * (RAMPART_RADIUS + 0.22) + across.x * 0.11,
    0.06,
    along.z * (RAMPART_RADIUS + 0.22) + across.z * 0.11,
  );
  wagon.rotation.y = -STREET + 0.35;
  group.add(wagon);

  // A well head on the market place, at the top of the street.
  const wellX = along.x * -0.44;
  const wellZ = along.z * -0.44;
  const wellWall = part(new CylinderGeometry(0.05, 0.055, 0.055, 10), stone());
  wellWall.position.set(wellX, GROUND + 0.028, wellZ);
  group.add(wellWall);
  for (const side of [-1, 1]) {
    const upright = part(new CylinderGeometry(0.008, 0.009, 0.11, 4), ash());
    upright.position.set(
      wellX + across.x * side * 0.045,
      GROUND + 0.08,
      wellZ + across.z * side * 0.045,
    );
    group.add(upright);
  }
  const winch = part(new CylinderGeometry(0.01, 0.01, 0.1, 6), ash());
  winch.rotation.z = Math.PI / 2;
  winch.rotation.y = -STREET;
  winch.position.set(wellX, GROUND + 0.132, wellZ);
  group.add(winch);

  /*
   * The church tower, which is what a 1600 town is recognised by from a
   * distance, and the keep in the faction's colours beside it.
   *
   * ⚠️ The tower is the first thing a settlement earns, at Dorf, because a
   * church is what a village built before it built anything else. The keep
   * waits for Stadt: a lord's residence is a statement about power, and a
   * hamlet is not in a position to make one.
   */
  const hasTower = tier >= 1;
  const hasKeep = bastioned;

  let bannerTop = GROUND + 0.28;

  if (hasTower) {
    /*
     * ⚠️ **Capped, and it widens as it rises.** Height alone ran away with it:
     * a Großstadt's tower came out 1.22 units on a 0.16 base, an aspect of
     * more than seven to one, which stopped reading as a church and started
     * reading as a factory chimney. Real towers get thicker as they get
     * taller because the base has to carry the thing.
     */
    const towerHeight = Math.min(0.78, 0.32 + city.population * 0.018 + tier * 0.07);
    const towerWidth = 0.15 + tier * 0.022;
    const tower = part(new BoxGeometry(towerWidth, towerHeight, towerWidth), stone());
    tower.position.set(-0.12, GROUND + towerHeight / 2, 0.06);
    group.add(tower);

    const spire = part(
      new ConeGeometry(towerWidth * 0.82, great ? 0.4 : 0.26, 4),
      slate(),
    );
    spire.position.set(-0.12, GROUND + towerHeight + (great ? 0.2 : 0.13), 0.06);
    spire.rotation.y = Math.PI / 4;
    group.add(spire);
    bannerTop = Math.max(bannerTop, GROUND + towerHeight);
  }

  if (hasKeep) {
    // Capped for the same reason as the tower.
    const keepHeight = Math.min(0.62, 0.3 + city.population * 0.03);
    const keep = part(new CylinderGeometry(0.15, 0.18, keepHeight, 8), stone());
    keep.position.set(0.16, GROUND + keepHeight / 2, -0.08);
    group.add(keep);

    const keepRoof = part(new ConeGeometry(0.2, 0.18, 8), tile());
    keepRoof.position.set(0.16, GROUND + keepHeight + 0.09, -0.08);
    group.add(keepRoof);
    bannerTop = GROUND + keepHeight + 0.18;
  }

  /*
   * The banner. It replaces an emissive sphere, which was the single most
   * science-fiction thing on the map, and it does the same job: says whose
   * town this is, from above, at a glance.
   *
   * ⚠️ Flown from whatever the tallest thing here happens to be, which changes
   * with rank. A fixed height put the flag inside the keep of a large town and
   * hovering over nothing in a small one.
   */
  const pole = part(new CylinderGeometry(0.008, 0.008, 0.26, 6), timber());
  pole.position.set(0.16, bannerTop + 0.13, -0.08);
  group.add(pole);

  const banner = part(new BoxGeometry(0.13, 0.08, 0.006), cloth(factionColour));
  banner.position.set(0.16 + 0.065, bannerTop + 0.19, -0.08);
  group.add(banner);

  // Bigger kinds sit on a broader footprint, which is the readability aid the
  // old platform scale used to provide.
  const footprint = 0.92 + (kind.baseHp / 120) * 0.3;
  group.scale.setScalar(footprint);

  group.userData.kind = 'city';
  group.userData.id = city.id;
  return group;
}

/**
 * What is left after a razing.
 *
 * The same bastioned outline as a village, but broken: a ring of stumps where
 * the rampart stood, a few fallen blocks, and one gable still up. No banner and
 * no faction colour, because a ruin belongs to nobody. It is deliberately low
 * and grey so that from a distance a razed hex reads as empty ground with
 * something wrong about it, rather than as a settlement you could still take.
 */
export function buildRuin(ruin: Ruin): Group {
  const group = new Group();

  const seed = ruin.hex.q * 73856093 + ruin.hex.r * 19349663;
  const rand = (n: number): number => {
    const x = Math.sin(seed + n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };

  // The scorched footprint the rampart used to sit on.
  const scar = part(new CylinderGeometry(0.8, 0.86, 0.05, 6), earth());
  scar.position.y = 0.025;
  scar.castShadow = false;
  group.add(scar);

  // Broken rampart: six stumps at the old corners, most of them knocked down.
  for (let i = 0; i < 6; i++) {
    if (rand(i) < 0.28) continue; // that stretch is gone entirely
    const height = 0.05 + rand(i + 40) * 0.11;
    const stump = part(new BoxGeometry(0.26, height, 0.1), stone());
    const angle = (Math.PI / 3) * i + Math.PI / 6;
    stump.position.set(
      Math.cos(angle) * 0.68,
      height / 2 + 0.04,
      Math.sin(angle) * 0.68,
    );
    stump.rotation.y = -angle;
    // Leaning, because nothing here is plumb any more.
    stump.rotation.z = (rand(i + 90) - 0.5) * 0.24;
    group.add(stump);
  }

  // Fallen blocks scattered inside the old walls.
  for (let i = 0; i < 5; i++) {
    const size = 0.05 + rand(i + 130) * 0.06;
    const block = part(new BoxGeometry(size, size * 0.7, size), stone());
    const angle = rand(i + 170) * Math.PI * 2;
    const radius = rand(i + 210) * 0.5;
    block.position.set(
      Math.cos(angle) * radius,
      size * 0.35 + 0.04,
      Math.sin(angle) * radius,
    );
    block.rotation.y = rand(i + 250) * Math.PI;
    group.add(block);
  }

  // One gable still standing, so the eye reads "this was a place".
  const gable = part(new BoxGeometry(0.12, 0.26, 0.04), plaster());
  gable.position.set(0.1, 0.17, -0.12);
  gable.rotation.z = 0.07;
  group.add(gable);

  group.userData.kind = 'ruin';
  group.userData.id = ruin.id;
  return group;
}

/** Release every cached material. Called when the renderer is torn down. */
export function disposeEntityMaterials(): void {
  for (const mat of materialCache.values()) mat.dispose();
  materialCache.clear();
}

/** Recursively enable shadows on an imported or built object. */
export function enableShadows(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}
