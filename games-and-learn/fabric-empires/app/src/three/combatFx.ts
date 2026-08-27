/**
 * Combat effects in three dimensions.
 *
 * The 2D effects layer survives for floating damage numbers, because text is
 * crisper drawn flat. Everything that is supposed to exist in the world lives
 * here instead: how a unit is standing, sparks that fly off an impact, dust
 * kicked off the ground, and the tracer of a shot in flight.
 *
 * Two rules shape the design.
 *
 * First, this owns no game state. A pose is a display override keyed by unit
 * id, applied after the renderer has placed the unit where the engine says it
 * is. A dropped frame or an interrupted animation can therefore never leave a
 * unit standing on the wrong hex.
 *
 * Second, everything is pooled. A fight can produce a couple of hundred
 * particles in one frame, and allocating meshes at that rate during the one
 * moment the player is actually watching is the worst possible time to make
 * the garbage collector work.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';

/** A per-unit display override. All fields are relative to the engine pose. */
export interface UnitPose {
  /** World-space offset from the unit's hex. */
  offset: Vector3;
  /** Facing, radians. Undefined leaves the renderer's default. */
  yaw: number | undefined;
  /** Tilt around the facing axis, for recoil and for toppling over. */
  roll: number;
  /** Nose-up tilt, for bracing and for the moment of a strike. */
  pitch: number;
  /** Sink into the ground, used as a wreck settles. */
  sink: number;
  opacity: number;
}

function emptyPose(): UnitPose {
  return {
    offset: new Vector3(),
    yaw: undefined,
    roll: 0,
    pitch: 0,
    sink: 0,
    opacity: 1,
  };
}

interface Particle {
  readonly position: Vector3;
  readonly velocity: Vector3;
  life: number;
  readonly maxLife: number;
  readonly size: number;
  readonly spin: number;
  readonly gravity: number;
  readonly colour: Color;
  readonly fade: boolean;
}

interface Tracer {
  readonly from: Vector3;
  readonly to: Vector3;
  elapsed: number;
  readonly duration: number;
  readonly colour: Color;
}

const SPARK_POOL = 260;
const DUST_POOL = 150;

export interface CombatFx {
  readonly group: Group;
  /** The pose override for a unit, created on demand. */
  pose(unitId: string): UnitPose;
  poseOf(unitId: string): UnitPose | undefined;
  clearPose(unitId: string): void;
  clearAllPoses(): void;

  /** A burst of hot fragments, thrown outward from a point. */
  sparks(at: Vector3, colour: string, count?: number, force?: number): void;
  /** A ground puff: slower, heavier, and it does not glow. */
  dust(at: Vector3, count?: number, spread?: number): void;
  /** Black smoke rising from a wreck. */
  smoke(at: Vector3, count?: number): void;
  /** A round in flight. */
  tracer(from: Vector3, to: Vector3, durationMs: number, colour?: string): void;
  /** A brief bright flash, used for muzzles and for the moment of impact. */
  flash(at: Vector3, colour: string, radius: number, durationMs: number): void;

  update(deltaSeconds: number): void;
  active(): boolean;
  dispose(): void;
}

export function createCombatFx(): CombatFx {
  const group = new Group();
  // Effects must never be occluded by the ground they sit on, and they never
  // need to occlude anything themselves.
  group.renderOrder = 5;

  const poses = new Map<string, UnitPose>();

  // Sparks: additive, so overlapping ones build to white the way real hot
  // fragments do on camera.
  const sparkMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const sparkMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), sparkMaterial, SPARK_POOL);
  sparkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  sparkMesh.frustumCulled = false;
  sparkMesh.count = 0;
  group.add(sparkMesh);

  // Dust and smoke are lit-looking but cheap: plain spheres, no glow.
  const dustMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    opacity: 0.34,
  });
  const dustMesh = new InstancedMesh(new SphereGeometry(1, 7, 5), dustMaterial, DUST_POOL);
  dustMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  dustMesh.frustumCulled = false;
  dustMesh.count = 0;
  group.add(dustMesh);

  const tracerMaterial = new MeshBasicMaterial({
    color: 0xffe6b0,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const tracerMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), tracerMaterial, 24);
  tracerMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  tracerMesh.frustumCulled = false;
  tracerMesh.count = 0;
  group.add(tracerMesh);

  const flashMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const flashMesh = new InstancedMesh(new SphereGeometry(1, 10, 8), flashMaterial, 12);
  flashMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  flashMesh.frustumCulled = false;
  flashMesh.count = 0;
  group.add(flashMesh);

  const sparks: Particle[] = [];
  const dust: Particle[] = [];
  const tracers: Tracer[] = [];
  const flashes: { at: Vector3; radius: number; life: number; max: number; colour: Color }[] = [];

  const matrix = new Matrix4();
  const scratchPos = new Vector3();
  const scratchQuat = new Quaternion();
  const scratchScale = new Vector3();
  const dummy = new Object3D();

  function push(
    list: Particle[],
    limit: number,
    at: Vector3,
    velocity: Vector3,
    life: number,
    size: number,
    gravity: number,
    colour: Color,
    fade: boolean,
  ): void {
    // Oldest out first when the pool is full, so a big hit never silently
    // drops the sparks it just created.
    if (list.length >= limit) list.shift();
    list.push({
      position: at.clone(),
      velocity,
      life,
      maxLife: life,
      size,
      spin: Math.random() * 6.28,
      gravity,
      colour: colour.clone(),
      fade,
    });
  }

  return {
    group,

    pose(unitId) {
      let pose = poses.get(unitId);
      if (!pose) {
        pose = emptyPose();
        poses.set(unitId, pose);
      }
      return pose;
    },

    poseOf(unitId) {
      return poses.get(unitId);
    },

    clearPose(unitId) {
      poses.delete(unitId);
    },

    clearAllPoses() {
      poses.clear();
    },

    sparks(at, colour, count = 26, force = 5.5) {
      const tint = new Color(colour);
      for (let i = 0; i < count; i++) {
        // Biased upward and outward: fragments off an impact go up and away,
        // they do not spray evenly in all directions.
        const theta = Math.random() * Math.PI * 2;
        const up = 0.35 + Math.random() * 0.75;
        const out = Math.random();
        const speed = force * (0.35 + Math.random() * 0.9);
        const velocity = new Vector3(
          Math.cos(theta) * out * speed,
          up * speed,
          Math.sin(theta) * out * speed,
        );
        push(
          sparks,
          SPARK_POOL,
          at,
          velocity,
          0.32 + Math.random() * 0.42,
          0.018 + Math.random() * 0.03,
          14,
          tint,
          true,
        );
      }
    },

    dust(at, count = 16, spread = 0.5) {
      const tint = new Color('#b6a892');
      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const speed = spread * (0.4 + Math.random());
        const velocity = new Vector3(
          Math.cos(theta) * speed,
          0.25 + Math.random() * 0.5,
          Math.sin(theta) * speed,
        );
        push(
          dust,
          DUST_POOL,
          at,
          velocity,
          0.7 + Math.random() * 0.6,
          0.06 + Math.random() * 0.09,
          0.6,
          tint,
          true,
        );
      }
    },

    smoke(at, count = 14) {
      // Not black. Smoke lit by a bright sky is a mid grey, and a dark one
      // renders as an opaque blob hanging in the air rather than as a cloud.
      const tint = new Color('#6a645d');
      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const velocity = new Vector3(
          Math.cos(theta) * 0.25,
          0.7 + Math.random() * 0.7,
          Math.sin(theta) * 0.25,
        );
        push(
          dust,
          DUST_POOL,
          at,
          velocity,
          1.1 + Math.random() * 0.9,
          0.09 + Math.random() * 0.12,
          -0.35, // rises
          tint,
          true,
        );
      }
    },

    tracer(from, to, durationMs, colour = '#ffe6b0') {
      tracers.push({
        from: from.clone(),
        to: to.clone(),
        elapsed: 0,
        duration: durationMs / 1000,
        colour: new Color(colour),
      });
    },

    flash(at, colour, radius, durationMs) {
      flashes.push({
        at: at.clone(),
        radius,
        life: durationMs / 1000,
        max: durationMs / 1000,
        colour: new Color(colour),
      });
    },

    update(delta) {
      const step = Math.min(0.05, delta);

      // Sparks -----------------------------------------------------------
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]!;
        p.life -= step;
        if (p.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        p.velocity.y -= p.gravity * step;
        p.position.addScaledVector(p.velocity, step);
      }
      sparkMesh.count = sparks.length;
      for (let i = 0; i < sparks.length; i++) {
        const p = sparks[i]!;
        const t = p.life / p.maxLife;
        dummy.position.copy(p.position);
        dummy.rotation.set(p.spin, p.spin * 1.7, 0);
        // Fragments stretch along their travel, which is most of what makes
        // a spark read as fast rather than as a floating cube.
        const speed = p.velocity.length();
        dummy.scale.set(p.size * t, p.size * t, p.size * t * (1 + speed * 0.09));
        dummy.updateMatrix();
        sparkMesh.setMatrixAt(i, dummy.matrix);
        sparkMesh.setColorAt(i, scratchColour(p.colour, t));
      }
      sparkMesh.instanceMatrix.needsUpdate = true;
      if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;

      // Dust and smoke ---------------------------------------------------
      for (let i = dust.length - 1; i >= 0; i--) {
        const p = dust[i]!;
        p.life -= step;
        if (p.life <= 0) {
          dust.splice(i, 1);
          continue;
        }
        p.velocity.y -= p.gravity * step;
        p.velocity.multiplyScalar(1 - 1.6 * step);
        p.position.addScaledVector(p.velocity, step);
      }
      dustMesh.count = dust.length;
      for (let i = 0; i < dust.length; i++) {
        const p = dust[i]!;
        const t = p.life / p.maxLife;
        dummy.position.copy(p.position);
        dummy.rotation.set(0, p.spin, 0);
        // Puffs expand as they fade, which is the opposite of sparks.
        dummy.scale.setScalar(p.size * (1.6 - t * 0.75));
        dummy.updateMatrix();
        dustMesh.setMatrixAt(i, dummy.matrix);
        dustMesh.setColorAt(i, scratchColour(p.colour, t * 0.65));
      }
      dustMesh.instanceMatrix.needsUpdate = true;
      if (dustMesh.instanceColor) dustMesh.instanceColor.needsUpdate = true;

      // Tracers ----------------------------------------------------------
      for (let i = tracers.length - 1; i >= 0; i--) {
        const t = tracers[i]!;
        t.elapsed += step;
        if (t.elapsed >= t.duration) tracers.splice(i, 1);
      }
      tracerMesh.count = tracers.length;
      for (let i = 0; i < tracers.length; i++) {
        const t = tracers[i]!;
        const progress = Math.min(1, t.elapsed / t.duration);
        const head = scratchPos.copy(t.from).lerp(t.to, progress);
        const total = t.from.distanceTo(t.to);
        const length = Math.min(total * 0.32, total * progress + 0.05);
        const direction = t.to.clone().sub(t.from).normalize();
        const centre = head.clone().addScaledVector(direction, -length / 2);

        scratchQuat.setFromUnitVectors(new Vector3(0, 0, 1), direction);
        scratchScale.set(0.035, 0.035, length);
        matrix.compose(centre, scratchQuat, scratchScale);
        tracerMesh.setMatrixAt(i, matrix);
        tracerMesh.setColorAt(i, t.colour);
      }
      tracerMesh.instanceMatrix.needsUpdate = true;
      if (tracerMesh.instanceColor) tracerMesh.instanceColor.needsUpdate = true;

      // Flashes ----------------------------------------------------------
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]!;
        f.life -= step;
        if (f.life <= 0) flashes.splice(i, 1);
      }
      flashMesh.count = flashes.length;
      for (let i = 0; i < flashes.length; i++) {
        const f = flashes[i]!;
        const t = f.life / f.max;
        dummy.position.copy(f.at);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(f.radius * (1.25 - t * 0.55));
        dummy.updateMatrix();
        flashMesh.setMatrixAt(i, dummy.matrix);
        flashMesh.setColorAt(i, scratchColour(f.colour, t * t));
      }
      flashMesh.instanceMatrix.needsUpdate = true;
      if (flashMesh.instanceColor) flashMesh.instanceColor.needsUpdate = true;
    },

    active() {
      return (
        sparks.length > 0 ||
        dust.length > 0 ||
        tracers.length > 0 ||
        flashes.length > 0 ||
        poses.size > 0
      );
    },

    dispose() {
      sparkMesh.geometry.dispose();
      dustMesh.geometry.dispose();
      tracerMesh.geometry.dispose();
      flashMesh.geometry.dispose();
      sparkMaterial.dispose();
      dustMaterial.dispose();
      tracerMaterial.dispose();
      flashMaterial.dispose();
    },
  };
}

/**
 * Fade by scaling the instance colour.
 *
 * Instanced meshes share one material, so per-instance opacity is not
 * available. With additive blending, scaling the colour towards black is
 * exactly equivalent to fading out, and it costs nothing.
 */
const fadeColour = new Color();
function scratchColour(base: Color, amount: number): Color {
  return fadeColour.setRGB(base.r * amount, base.g * amount, base.b * amount);
}
