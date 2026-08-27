/**
 * The siege.
 *
 * A city assault used to run through `playDuel`, which is a choreography for
 * two machines meeting in a field: one lunges, the other rocks back. Pointed
 * at a walled town it read as a single unit head-butting a fortress, and the
 * three assault tactics the rules have offered since section 59 were
 * completely invisible. You chose escalade, sap or batter and watched the same
 * lunge either way.
 *
 * ⚠️ **The rules already had the whole vocabulary; only the telling was
 * missing.** `batter` puts everything into the masonry, `escalade` goes over
 * the top and gets counter-attacked for it (`cityCounter: 1`), `sap` is a
 * bonus spent entirely on stonework. On the other side, `hold` stands behind
 * what you built, `brace` puts everybody into cover and never hits back, and
 * `sally` opens the gate. That is nine legible combinations, and the animation
 * showed none of them.
 *
 * So this file stages each one literally, at the wall face:
 *
 *   batter    a hide-roofed ram rolls up and swings; timbers fly
 *   escalade  ladders slam onto the wall head and climbers go up
 *   sap       diggers work the footing until a charge drops a section
 *
 *   hold      defenders man the parapet and shoot down
 *   brace     defenders drop behind the merlons; shot rattles off stone
 *   sally     the gate opens and the garrison comes out to meet it
 *
 * ⚠️ **It drives the renderer and nothing else.** The engine decided the
 * outcome before this was called, exactly as with the duel. Everything here
 * can be retimed, shortened or skipped with no risk to the rules, which is the
 * only reason it is safe for it to be this elaborate.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { AssaultTactic, DefenceStance, Hex } from '@fabric-empires/engine';
import { WALL_RADIUS, wallTop as wallTopFor } from './entities.js';
import type { Scene3D } from './scene3d.js';

export interface SiegeSides {
  readonly attackerId: string;
  readonly attackerHex: Hex;
  readonly attackerColour: string;
  readonly cityHex: Hex;
  readonly defenderColour: string;
  /** 0 for an open town. Decides how high the wall face sits. */
  readonly wallLevel: number;
}

export interface SiegeOutcome {
  readonly damageToDefender: number;
  readonly damageToAttacker: number;
  /** The wall came down this blow. */
  readonly breached: boolean;
  /** The town changed hands. */
  readonly taken: boolean;
  readonly attackerDestroyed: boolean;
  readonly tactic: AssaultTactic;
  readonly stance: DefenceStance;
}

export interface SiegeHooks {
  /** The frame the damage lands on, so the model changes with the blow. */
  onImpact(): void;
  shake(magnitude: number): void;
}

/*
 * ⚠️ **Imported from the city builder, not copied from it.** An earlier draft
 * kept its own `WALL_RADIUS = 0.74` and its own height formula here, guarded
 * by a test asserting the two copies agreed. A test that watches a duplicate
 * is a worse answer than not having the duplicate: `entities.ts` now exports
 * the geometry, so a taller rampart moves the ladders with it and there is
 * nothing left to drift.
 */
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function tween(ms: number, fn: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / ms);
      fn(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInQuad = (t: number): number => t * t;

/**
 * Everything this siege made, so it can all be taken away again.
 *
 * ⚠️ Props are built per siege rather than cached. A siege runs for a couple
 * of seconds a handful of times a game, so the build cost is irrelevant, and
 * the alternative is a pool of ladders and rams living in the scene graph
 * forever waiting to be shown. Disposal is explicit because these materials
 * are not shared with `entities.ts` and so nothing else will ever free them.
 */
class Props {
  readonly root = new Group();
  private readonly owned: (Material | BufferGeometry)[] = [];

  constructor(private readonly scene: Scene3D) {
    scene.world.scene.add(this.root);
  }

  mesh(geometry: BufferGeometry, material: MeshStandardMaterial): Mesh {
    this.owned.push(geometry, material);
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  }

  material(colour: string, roughness = 0.9): MeshStandardMaterial {
    return new MeshStandardMaterial({ color: colour, roughness, metalness: 0 });
  }

  dispose(): void {
    this.scene.world.scene.remove(this.root);
    for (const item of this.owned) item.dispose();
    this.owned.length = 0;
  }
}

/** A soldier: a body and a head, small enough to read as a person at this scale. */
function figure(props: Props, colour: string): Group {
  const group = new Group();
  const body = props.mesh(new BoxGeometry(0.035, 0.075, 0.035), props.material(colour));
  body.position.y = 0.0375;
  const head = props.mesh(new BoxGeometry(0.026, 0.026, 0.026), props.material('#d8c3a5'));
  head.position.y = 0.088;
  group.add(body, head);
  return group;
}

/**
 * A scaling ladder: two rails and five rungs.
 *
 * Built lying flat along +Z with its foot at the origin, so raising it is a
 * single rotation about X rather than a position solve every frame.
 */
function ladder(props: Props, length: number): Group {
  const group = new Group();
  const wood = props.material('#8a6a44');
  for (const side of [-0.028, 0.028]) {
    const rail = props.mesh(new BoxGeometry(0.012, 0.012, length), wood);
    rail.position.set(side, 0, length / 2);
    group.add(rail);
  }
  for (let i = 1; i <= 5; i += 1) {
    const rung = props.mesh(new BoxGeometry(0.07, 0.008, 0.008), wood);
    rung.position.set(0, 0, (length * i) / 6);
    group.add(rung);
  }
  return group;
}

/**
 * A battering ram under a hide roof.
 *
 * The roof is the historically load-bearing part: a ram crew without cover was
 * simply shot, which is why the thing is a shed on wheels and not a log. It is
 * also what makes the silhouette readable from above, where a bare log would
 * be a stick.
 */
function ram(props: Props): { group: Group; head: Object3D } {
  const group = new Group();

  const roof = props.mesh(new BoxGeometry(0.17, 0.055, 0.28), props.material('#6b4f34'));
  roof.position.y = 0.13;
  group.add(roof);

  for (const side of [-0.07, 0.07]) {
    for (const along of [-0.09, 0.09]) {
      const wheel = props.mesh(
        new CylinderGeometry(0.028, 0.028, 0.016, 8),
        props.material('#4a3520'),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side, 0.028, along);
      group.add(wheel);
    }
  }

  // The beam swings from a pivot under the roof, so the head describes an arc.
  const head = new Group();
  const beam = props.mesh(new BoxGeometry(0.035, 0.035, 0.24), props.material('#5a4530'));
  beam.position.z = -0.12;
  const cap = props.mesh(new CylinderGeometry(0.03, 0.03, 0.04, 8), props.material('#3a3a3a'));
  cap.rotation.x = Math.PI / 2;
  cap.position.z = -0.24;
  head.add(beam, cap);
  head.position.y = 0.1;
  group.add(head);

  return { group, head };
}

/**
 * Play the assault.
 *
 * Resolves when the set piece is over and the props are gone. The camera is
 * handed to `cinema` for the duration so `OrbitControls` cannot drag the shot
 * back towards the map view one frame at a time.
 */
export async function playSiege(
  scene: Scene3D,
  sides: SiegeSides,
  outcome: SiegeOutcome,
  hooks: SiegeHooks,
): Promise<void> {
  const fx = scene.fx;
  const props = new Props(scene);

  /*
   * The blow lands whether or not anyone watched it.
   *
   * ⚠️ `onImpact` is what hands the new state to the map, so a siege that
   * returns without calling it leaves the board showing a fight that never
   * happened. Skipping is a presentation choice and must never be a rules
   * choice, so it is made idempotent here and fired from the `finally`
   * regardless of which path got us there.
   */
  let impacted = false;
  const land = (): void => {
    if (impacted) return;
    impacted = true;
    hooks.onImpact();
  };
  const beats: SiegeHooks = { onImpact: land, shake: hooks.shake };

  try {
    const cityGround = scene.groundAt(sides.cityHex);
    const attackerGround = scene.groundAt(sides.attackerHex);

    /*
     * The outward normal of the face under attack.
     *
     * ⚠️ From the town to the attacker, not the other way round. Everything
     * here is placed relative to the wall, and building the ram at the town
     * and pushing it outwards is how the first draft ended up assaulting the
     * back of the fortress while the army stood behind the camera.
     */
    const out = attackerGround.clone().sub(cityGround).setY(0);
    if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
    out.normalize();

    const wallTop = wallTopFor(sides.wallLevel);
    const wallFoot = cityGround.clone().addScaledVector(out, WALL_RADIUS);
    const wallHead = wallFoot.clone().setY(cityGround.y + wallTop);

    // Along the wall face, for spacing ladders and defenders.
    const along = new Vector3(-out.z, 0, out.x);

    // The shot: low, close, looking at the wall face from outside.
    const shotMs = 3200;
    const shotEndsAt = performance.now() + shotMs;

    /*
     * Aimed at the middle of the wall, not at the parapet.
     *
     * ⚠️ Both of these are corrections from watching the deployed build. The
     * first cut targeted `wallHead`, and a low camera looking UP at the top of
     * a wall puts the ram, the ladders and every soldier below the bottom edge
     * of the frame: the shot was of masonry, and the fight it was staging was
     * happening off screen. Aiming at mid-height holds the foot of the wall
     * and the defenders on top in the same frame.
     *
     * ⚠️ And it sits ABOVE the canopy. At 0.52 the camera was inside the
     * scenery trees on the attacker's own hex, and one of them filled the
     * middle of the picture. Looking slightly down from just over head height
     * clears them and is the angle the shot wanted anyway.
     */
    const wallMid = wallFoot.clone().setY(cityGround.y + wallTop * 0.55);

    void scene.cinema.play({
      id: `siege-${sides.attackerId}-${Date.now()}`,
      title: '',
      subtitle: '',
      durationMs: shotMs,
      frame: (t) => {
        // A slow creep in and a slight drift along the wall, so the shot is
        // alive without the camera ever taking over the action.
        const e = easeOutCubic(Math.min(1, t));
        const distance = 1.85 - 0.3 * e;
        const height = 0.95 - 0.17 * e;
        const drift = -0.18 + 0.36 * e;
        return {
          position: wallMid
            .clone()
            .addScaledVector(out, distance)
            .addScaledVector(along, drift)
            .setY(cityGround.y + height),
          target: wallMid.clone().addScaledVector(along, drift * 0.4),
        };
      },
    });

    const defenders = await manTheWall(props, scene, sides, outcome, cityGround, out, along, wallTop);

    /*
     * Did the player ask out?
     *
     * The overlay's Escape ends the shot, so a camera that is no longer
     * running before its time is up is the signal. Checked between beats
     * rather than inside every tween: the wait is at most one beat, and the
     * alternative is an abort flag threaded through sixteen call sites to
     * save a player half a second.
     */
    const bailed = (): boolean =>
      !scene.cinema.active && performance.now() < shotEndsAt - 60;

    await wait(280);
    if (bailed()) return;

    if (outcome.tactic === 'escalade') {
      await escalade(props, scene, sides, outcome, beats, cityGround, out, along, wallTop, defenders);
    } else if (outcome.tactic === 'sap') {
      await sap(props, scene, sides, outcome, beats, attackerGround, wallFoot, out, along);
    } else {
      await batter(props, scene, sides, outcome, beats, attackerGround, wallFoot, out, wallTop);
    }

    if (bailed()) return;

    // Aftermath ----------------------------------------------------------
    if (outcome.breached) {
      hooks.shake(14);
      fx.dust(wallFoot.clone().setY(cityGround.y + 0.05), 30, 1.1);
      fx.smoke(wallHead, 14);
      await collapse(props, scene, cityGround, out, along, wallTop);
    }

    if (outcome.damageToAttacker > 0) {
      const hurt = attackerGround.clone().setY(attackerGround.y + 0.3);
      fx.sparks(hurt, '#ff9b6a', 14, 4);
      fx.flash(hurt, '#ffb27a', 0.3, 110);
    }

    await wait(outcome.taken ? 620 : 380);
  } finally {
    /*
     * ⚠️ In a `finally`, so a thrown frame or a skipped shot cannot leave a
     * ram parked outside somebody's town for the rest of the game. The duel
     * learned the same lesson about poses.
     */
    land();
    props.dispose();
    fx.clearPose(sides.attackerId);
  }
}

/**
 * Put the garrison on the wall, according to how they chose to meet it.
 *
 * Returns the figures so the assault can knock them about.
 */
async function manTheWall(
  props: Props,
  scene: Scene3D,
  sides: SiegeSides,
  outcome: SiegeOutcome,
  cityGround: Vector3,
  out: Vector3,
  along: Vector3,
  wallTop: number,
): Promise<Group[]> {
  const defenders: Group[] = [];
  const count = 4;

  for (let i = 0; i < count; i += 1) {
    const spread = (i - (count - 1) / 2) * 0.17;
    const man = figure(props, sides.defenderColour);
    /*
     * ⚠️ Braced defenders stand BEHIND the wall head and lower, which is the
     * whole visual argument for the stance: they are harder to hit and they
     * are not shooting. Held defenders stand on the walk itself.
     */
    const inset = outcome.stance === 'brace' ? WALL_RADIUS - 0.14 : WALL_RADIUS - 0.05;
    const drop = outcome.stance === 'brace' ? -0.045 : 0;
    man.position
      .copy(cityGround)
      .addScaledVector(out, inset)
      .addScaledVector(along, spread)
      .setY(cityGround.y + wallTop + drop);
    man.lookAt(man.position.clone().addScaledVector(out, 1));
    props.root.add(man);
    defenders.push(man);
  }

  // A sally opens the gate and sends them out before anything else happens.
  if (outcome.stance === 'sally') {
    const gate = cityGround.clone().addScaledVector(out, WALL_RADIUS);
    scene.fx.dust(gate.clone().setY(cityGround.y + 0.05), 10, 0.4);
    await Promise.all(
      defenders.map((man, i) => {
        const target = cityGround
          .clone()
          .addScaledVector(out, WALL_RADIUS + 0.34)
          .addScaledVector(along, (i - 1.5) * 0.14)
          .setY(cityGround.y + 0.02);
        const from = man.position.clone();
        return tween(360, (t) => {
          const e = easeOutCubic(t);
          man.position.lerpVectors(from, target, e);
        });
      }),
    );
  }

  return defenders;
}

/** Arrows and stones from the parapet, unless everybody is in cover. */
function loose(
  scene: Scene3D,
  outcome: SiegeOutcome,
  defenders: readonly Group[],
  at: Vector3,
): void {
  // ⚠️ A braced garrison does not shoot. That is the cost of the stance, and
  // showing it firing anyway would make the choice look free.
  if (outcome.stance === 'brace') return;
  for (const man of defenders.slice(0, 3)) {
    const from = man.position.clone().setY(man.position.y + 0.06);
    scene.fx.tracer(from, at, 170, '#e8dcc0');
  }
}

/** Ladders against the wall, and the shove that throws one down. */
async function escalade(
  props: Props,
  scene: Scene3D,
  sides: SiegeSides,
  outcome: SiegeOutcome,
  hooks: SiegeHooks,
  cityGround: Vector3,
  out: Vector3,
  along: Vector3,
  wallTop: number,
  defenders: readonly Group[],
): Promise<void> {
  const fx = scene.fx;
  const length = wallTop + 0.16;
  const ladders: { group: Group; climber: Group }[] = [];

  for (let i = 0; i < 3; i += 1) {
    const offset = (i - 1) * 0.2;
    const foot = cityGround
      .clone()
      .addScaledVector(out, WALL_RADIUS + 0.16)
      .addScaledVector(along, offset)
      .setY(cityGround.y + 0.01);

    const rig = ladder(props, length);
    rig.position.copy(foot);
    // Lying flat, pointing away from the wall, ready to be reared up.
    rig.lookAt(foot.clone().addScaledVector(out, 1));
    rig.rotation.x = Math.PI / 2;
    props.root.add(rig);

    const climber = figure(props, sides.attackerColour);
    climber.position.copy(foot);
    props.root.add(climber);

    ladders.push({ group: rig, climber });
  }

  // Rear them up against the wall head.
  await Promise.all(
    ladders.map(({ group }, i) =>
      tween(420 + i * 60, (t) => {
        const e = easeOutCubic(t);
        // From flat (PI/2) to leaning on the wall.
        group.rotation.x = Math.PI / 2 - e * (Math.PI / 2 - 0.42);
      }),
    ),
  );
  fx.dust(cityGround.clone().addScaledVector(out, WALL_RADIUS).setY(cityGround.y + wallTop), 12, 0.4);
  hooks.shake(4);

  loose(scene, outcome, defenders, cityGround.clone().addScaledVector(out, WALL_RADIUS + 0.2));

  // Up they go.
  await Promise.all(
    ladders.map(({ group, climber }, i) => {
      const foot = group.position.clone();
      const head = cityGround
        .clone()
        .addScaledVector(out, WALL_RADIUS - 0.02)
        .addScaledVector(along, (i - 1) * 0.2)
        .setY(cityGround.y + wallTop);
      return tween(520, (t) => {
        climber.position.lerpVectors(foot, head, easeInQuad(t));
      });
    }),
  );

  hooks.onImpact();
  const contact = cityGround.clone().addScaledVector(out, WALL_RADIUS).setY(cityGround.y + wallTop);
  fx.sparks(contact, '#ffd27a', 30, 5.5);
  hooks.shake(Math.min(14, 5 + outcome.damageToDefender * 0.16));

  /*
   * ⚠️ One ladder is always thrown back, unless the garrison braced.
   *
   * This is `escalade`'s `cityCounter: 1` made visible: going over the top is
   * the tactic that guarantees the defenders hit you, whatever the attacker
   * brought. A brace has nobody at the parapet to push, which is exactly why
   * bracing gives up its counter.
   */
  if (outcome.stance !== 'brace') {
    const doomed = ladders[0]!;
    fx.dust(doomed.group.position.clone().setY(cityGround.y + 0.04), 10, 0.5);
    await tween(340, (t) => {
      const e = easeInQuad(t);
      doomed.group.rotation.x = 0.42 + e * (Math.PI / 2 - 0.42);
      doomed.climber.position.y = cityGround.y + wallTop - (wallTop - 0.02) * e;
      doomed.climber.rotation.z = e * 1.4;
    });
    hooks.shake(5);
  } else {
    await wait(220);
  }
}

/** Diggers at the footing, then a charge. */
async function sap(
  props: Props,
  scene: Scene3D,
  sides: SiegeSides,
  outcome: SiegeOutcome,
  hooks: SiegeHooks,
  attackerGround: Vector3,
  wallFoot: Vector3,
  out: Vector3,
  along: Vector3,
): Promise<void> {
  const fx = scene.fx;
  const diggers: Group[] = [];

  for (let i = 0; i < 3; i += 1) {
    const man = figure(props, sides.attackerColour);
    man.position.copy(attackerGround).setY(attackerGround.y + 0.01);
    props.root.add(man);
    diggers.push(man);
  }

  // Cross to the footing, keeping low.
  await Promise.all(
    diggers.map((man, i) => {
      const from = man.position.clone();
      const to = wallFoot
        .clone()
        .addScaledVector(along, (i - 1) * 0.13)
        .addScaledVector(out, 0.06)
        .setY(wallFoot.y + 0.005);
      return tween(560, (t) => {
        man.position.lerpVectors(from, to, easeOutCubic(t));
        man.scale.setScalar(1 - 0.25 * easeOutCubic(t));
      });
    }),
  );

  // Digging: a long, low plume with no bangs in it.
  for (let i = 0; i < 4; i += 1) {
    fx.dust(wallFoot.clone().setY(wallFoot.y + 0.02), 8, 0.3);
    await wait(150);
  }

  hooks.onImpact();
  fx.flash(wallFoot.clone().setY(wallFoot.y + 0.06), '#ffdca8', 0.7, 200);
  fx.sparks(wallFoot, '#ffcf7a', 40, 7);
  fx.smoke(wallFoot.clone().setY(wallFoot.y + 0.1), 18);
  hooks.shake(Math.min(18, 8 + outcome.damageToDefender * 0.2));

  // The diggers scatter from their own charge.
  await Promise.all(
    diggers.map((man) => {
      const from = man.position.clone();
      const to = from.clone().addScaledVector(out, 0.3);
      return tween(320, (t) => {
        man.position.lerpVectors(from, to, easeOutCubic(t));
      });
    }),
  );
}

/** The ram: roll up, and swing until something gives. */
async function batter(
  props: Props,
  scene: Scene3D,
  sides: SiegeSides,
  outcome: SiegeOutcome,
  hooks: SiegeHooks,
  attackerGround: Vector3,
  wallFoot: Vector3,
  out: Vector3,
  wallTop: number,
): Promise<void> {
  const fx = scene.fx;
  const engine = ram(props);
  const start = attackerGround.clone().setY(attackerGround.y + 0.01);
  const stop = wallFoot.clone().addScaledVector(out, 0.26).setY(wallFoot.y + 0.01);

  engine.group.position.copy(start);
  engine.group.lookAt(stop.clone().addScaledVector(out, -1).setY(start.y));
  props.root.add(engine.group);

  await tween(680, (t) => {
    engine.group.position.lerpVectors(start, stop, easeOutCubic(t));
    if (t > 0.15 && Math.random() < 0.4) {
      fx.dust(engine.group.position.clone().setY(start.y + 0.01), 2, 0.2);
    }
  });

  const contact = wallFoot.clone().setY(wallFoot.y + wallTop * 0.55);
  const blows = 3;
  for (let i = 0; i < blows; i += 1) {
    const last = i === blows - 1;

    // Haul back.
    await tween(190, (t) => {
      engine.head.position.z = 0.09 * easeOutCubic(t);
    });
    // Strike.
    await tween(90, (t) => {
      engine.head.position.z = 0.09 * (1 - easeInQuad(t));
    });

    /*
     * ⚠️ Only the last blow calls `onImpact`, and only once.
     *
     * The hook is what applies the engine's result, so calling it per swing
     * would apply the same damage three times to the model the player is
     * watching. Three blows are one attack; the arithmetic happened before
     * this function was entered.
     */
    if (last) hooks.onImpact();

    fx.sparks(contact, '#e8c98a', last ? 34 : 16, last ? 6 : 3.6);
    fx.dust(contact.clone().setY(wallFoot.y + 0.02), last ? 16 : 8, last ? 0.7 : 0.4);
    hooks.shake(last ? Math.min(16, 6 + outcome.damageToDefender * 0.18) : 5);

    // Recoil of the whole engine, so the wall reads as pushing back.
    void tween(200, (t) => {
      engine.group.position.copy(stop).addScaledVector(out, 0.03 * (1 - t));
    });

    if (!last) await wait(140);
  }
}

/**
 * A section of wall comes down.
 *
 * ⚠️ Rubble rather than a hole. The city model is rebuilt from `wallHp` the
 * moment `onImpact` adopts the new state, and it already drops its turfed walk
 * once a wall is more than half down, so the permanent change is handled. What
 * this adds is the falling: masonry that simply changes shape between two
 * frames reads as a rendering glitch rather than as a breach.
 */
async function collapse(
  props: Props,
  scene: Scene3D,
  cityGround: Vector3,
  out: Vector3,
  along: Vector3,
  wallTop: number,
): Promise<void> {
  const blocks: Mesh[] = [];
  for (let i = 0; i < 7; i += 1) {
    const block = props.mesh(
      new BoxGeometry(0.07 + Math.random() * 0.05, 0.05, 0.06 + Math.random() * 0.05),
      props.material('#8d8578'),
    );
    block.position
      .copy(cityGround)
      .addScaledVector(out, WALL_RADIUS)
      .addScaledVector(along, (i - 3) * 0.09)
      .setY(cityGround.y + wallTop - 0.02);
    block.rotation.set(Math.random(), Math.random(), Math.random());
    props.root.add(block);
    blocks.push(block);
  }

  await Promise.all(
    blocks.map((block, i) => {
      const from = block.position.clone();
      const to = from
        .clone()
        .addScaledVector(out, 0.1 + Math.random() * 0.18)
        .setY(cityGround.y + 0.015);
      const spin = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      return tween(420 + i * 25, (t) => {
        // A shallow arc: out and down, not a straight slide.
        const e = t;
        block.position.lerpVectors(from, to, e);
        block.position.y += Math.sin(e * Math.PI) * 0.05;
        block.rotation.x += spin.x * 0.06;
        block.rotation.y += spin.y * 0.06;
        block.rotation.z += spin.z * 0.06;
      });
    }),
  );

  scene.fx.dust(cityGround.clone().addScaledVector(out, WALL_RADIUS).setY(cityGround.y + 0.02), 22, 0.8);
}
