/**
 * The duel.
 *
 * One function, deliberately, because a fight is a sequence and a sequence is
 * far easier to read, retime and argue about when it is written as one. The
 * timings below are the whole design: they are what the player experiences,
 * and every one of them was set by watching the frames rather than by
 * reasoning about milliseconds.
 *
 * It drives the renderer and nothing else. The engine has already decided who
 * won and by how much before this is called; what happens here is purely the
 * telling of it. That separation is what allows the animation to be skipped,
 * shortened or replaced without any risk to the rules.
 */

import { Vector3 } from 'three';
import type { Hex } from '@fabric-empires/engine';
import type { Scene3D } from './scene3d.js';

export interface DuelSides {
  readonly attackerId: string;
  readonly attackerHex: Hex;
  readonly attackerColour: string;
  readonly defenderId: string | undefined;
  readonly defenderHex: Hex;
  readonly defenderColour: string;
}

export interface DuelOutcome {
  readonly damageToDefender: number;
  readonly damageToAttacker: number;
  readonly defenderDestroyed: boolean;
  readonly attackerDestroyed: boolean;
  readonly ranged: boolean;
  /** Longer, closer framing for first blood and for city assaults. */
  readonly dramatic: boolean;
}

export interface DuelHooks {
  /** Called at the exact frame of impact, so damage lands with the hit. */
  onImpact(): void;
  /** Screen shake, still owned by the 2D effects layer. */
  shake(magnitude: number): void;
}

/** Height above the ground at which a unit's body sits. */
const BODY_HEIGHT = 0.3;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Run `fn` with t from 0 to 1 over `ms`, on animation frames. */
function tween(ms: number, fn: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      fn(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInQuad = (t: number) => t * t;

export async function playDuel(
  scene: Scene3D,
  sides: DuelSides,
  outcome: DuelOutcome,
  hooks: DuelHooks,
): Promise<void> {
  const fx = scene.fx;
  const speed = outcome.dramatic ? 1.35 : 1;

  const attackerGround = scene.groundAt(sides.attackerHex);
  const defenderGround = scene.groundAt(sides.defenderHex);
  const attackerBody = attackerGround.clone().setY(attackerGround.y + BODY_HEIGHT);
  const defenderBody = defenderGround.clone().setY(defenderGround.y + BODY_HEIGHT);

  const toDefender = defenderGround.clone().sub(attackerGround);
  const distance = Math.max(0.001, toDefender.length());
  const direction = toDefender.clone().divideScalar(distance);

  // Units are modelled facing +Z, so this is the yaw that points them at
  // each other. Two machines standing side-on while they fight is the single
  // most obvious tell that nothing is really happening.
  const attackerYaw = Math.atan2(direction.x, direction.z);
  const defenderYaw = attackerYaw + Math.PI;

  const attackerPose = fx.pose(sides.attackerId);
  const defenderPose = sides.defenderId ? fx.pose(sides.defenderId) : undefined;

  attackerPose.yaw = attackerYaw;
  if (defenderPose) defenderPose.yaw = defenderYaw;

  // Frame the fight, not one of the fighters.
  const midpoint = attackerGround.clone().lerp(defenderGround, 0.5);
  scene.focusWorld(midpoint, outcome.dramatic ? 6.5 : 9);
  await wait(outcome.dramatic ? 480 : 300);

  if (outcome.ranged) {
    // Brace, fire, recoil. The muzzle sits ahead of and above the hull.
    const muzzle = attackerBody.clone().addScaledVector(direction, 0.45);
    await tween(150 * speed, (t) => {
      attackerPose.pitch = -0.05 * t;
      attackerPose.offset.copy(direction).multiplyScalar(-0.06 * t);
    });

    fx.flash(muzzle, '#ffd9a0', 0.34, 130);
    fx.sparks(muzzle, '#ffcf7a', 10, 2.6);
    fx.dust(attackerGround.clone().setY(attackerGround.y + 0.03), 10, 0.35);
    hooks.shake(3);

    const travel = 190 * speed;
    fx.tracer(muzzle, defenderBody, travel);

    // The recoil settles while the round is still in the air.
    void tween(220 * speed, (t) => {
      attackerPose.pitch = -0.05 * (1 - t);
      attackerPose.offset.copy(direction).multiplyScalar(-0.06 * (1 - t));
    });

    await wait(travel);
  } else {
    // Wind up, then charge. Stopping short of the defender rather than
    // driving through it is what makes the two read as colliding.
    await tween(190 * speed, (t) => {
      attackerPose.offset.copy(direction).multiplyScalar(-0.22 * easeOutCubic(t));
      attackerPose.pitch = 0.07 * easeOutCubic(t);
    });

    const closeTo = Math.max(0, distance - 0.72);
    await tween(230 * speed, (t) => {
      const e = easeInQuad(t);
      attackerPose.offset.copy(direction).multiplyScalar(-0.22 + (closeTo + 0.22) * e);
      attackerPose.pitch = 0.07 * (1 - e) - 0.05 * e;
      if (t > 0.25 && Math.random() < 0.35) {
        const track = attackerGround
          .clone()
          .addScaledVector(direction, distance * t * 0.8)
          .setY(attackerGround.y + 0.02);
        fx.dust(track, 2, 0.28);
      }
    });
  }

  // Impact ---------------------------------------------------------------
  const contact = defenderBody.clone().addScaledVector(direction, -0.32);
  hooks.onImpact();

  fx.flash(contact, '#fff0c8', 0.5, 140);
  fx.sparks(contact, '#ffd27a', outcome.dramatic ? 46 : 30, 6.5);
  fx.dust(contact.clone().setY(defenderGround.y + 0.04), 18, 0.7);
  hooks.shake(Math.min(16, 4 + outcome.damageToDefender * 0.18) * (outcome.dramatic ? 1.4 : 1));

  // The defender is thrown back and rolls, then recovers. Its recoil is
  // scaled by the damage taken, so a glancing blow looks like one.
  const knock = Math.min(0.42, 0.08 + outcome.damageToDefender * 0.0045);
  if (defenderPose) {
    void tween(170 * speed, (t) => {
      const e = easeOutCubic(t);
      defenderPose.offset.copy(direction).multiplyScalar(knock * e);
      defenderPose.roll = -knock * 1.5 * e;
      defenderPose.pitch = -knock * 0.8 * e;
    }).then(() =>
      outcome.defenderDestroyed
        ? undefined
        : tween(320 * speed, (t) => {
            const e = easeOutCubic(t);
            defenderPose.offset.copy(direction).multiplyScalar(knock * (1 - e));
            defenderPose.roll = -knock * 1.5 * (1 - e);
            defenderPose.pitch = -knock * 0.8 * (1 - e);
          }),
    );
  }

  // A melee attacker rebounds off what it just hit.
  if (!outcome.ranged) {
    const restFrom = attackerPose.offset.clone();
    void tween(300 * speed, (t) => {
      const e = easeOutCubic(t);
      attackerPose.offset.copy(restFrom).multiplyScalar(1 - e);
      attackerPose.pitch = -0.05 * (1 - e);
    });
  }

  // The attacker takes its share back, if it took any.
  if (outcome.damageToAttacker > 0) {
    fx.sparks(attackerBody, '#ff9b6a', 14, 4);
    fx.flash(attackerBody, '#ffb27a', 0.3, 110);
  }

  await wait(260 * speed);

  // Deaths ---------------------------------------------------------------
  const deaths: Promise<void>[] = [];
  if (outcome.defenderDestroyed && defenderPose) {
    deaths.push(destroy(fx, defenderPose, defenderBody, defenderGround, direction, speed));
  }
  if (outcome.attackerDestroyed) {
    deaths.push(destroy(fx, attackerPose, attackerBody, attackerGround, direction, speed));
  }
  if (deaths.length > 0) {
    hooks.shake(9);
    await Promise.all(deaths);
  }

  await wait(outcome.dramatic ? 420 : 180);

  // Hand the units back to the renderer's own placement.
  fx.clearPose(sides.attackerId);
  if (sides.defenderId) fx.clearPose(sides.defenderId);
}

/**
 * A wreck.
 *
 * Toppling and sinking rather than simply vanishing. A unit that disappears
 * on the frame its health reaches zero reads as a bug even when it is
 * correct, because nothing in the world behaves that way.
 */
async function destroy(
  fx: Scene3D['fx'],
  pose: ReturnType<Scene3D['fx']['pose']>,
  body: Vector3,
  ground: Vector3,
  direction: Vector3,
  speed: number,
): Promise<void> {
  fx.sparks(body, '#ffb15a', 34, 7);
  fx.flash(body, '#ffd9a0', 0.62, 200);
  fx.smoke(body, 16);

  const startRoll = pose.roll;
  const startOffset = pose.offset.clone();

  await tween(430 * speed, (t) => {
    const e = easeOutCubic(t);
    // Over onto its side, and a little further along the blow.
    pose.roll = startRoll + (Math.PI * 0.46 - startRoll) * e;
    pose.pitch = 0.16 * e;
    pose.offset.copy(startOffset).addScaledVector(direction, 0.16 * e);
    pose.sink = 0.06 * e;
  });

  fx.dust(ground.clone().setY(ground.y + 0.03), 14, 0.55);
  fx.smoke(body, 10);

  await tween(360 * speed, (t) => {
    pose.sink = 0.06 + 0.14 * t;
    pose.opacity = 1 - t;
  });
}
