import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  SPORTSCAR_CHEAT_SCALE,
  createBusGeometry,
  createCarGeometry,
  loadShuttle,
} from '@/twin3d/shuttle';
import type { WorldExtent } from '@/geo/world';

/**
 * The cheat vehicle.
 *
 * ⚠️ THIS FILE ONCE SAID "THE JOKE IS THE SPEED AND THE NOISE, NOT THE SIZE", AND THAT WAS
 * REVISED ON 2026-08-25 — deliberately, by the owner of the rule it cited, not worked around.
 * The old text called the car's real size a consequence of the standing no-exaggeration rule and
 * treated a cheat as no exemption. The revision is narrower and matches what the project already
 * does elsewhere: PLAN §57.3 draws the walking crowd at `FIGURE_SCALE = 4` because a true-scale
 * person is under a pixel, on the stated ground that **a size may be inflated when the size
 * carries no claim**.
 *
 * The cheat car meets that test more cleanly than the crowd does. It is a joke behind a hidden
 * word; the layer's claims (2 990 m, 312 s, the compression factor, the routed road) are carried
 * by numbers and by the path, and the mesh asserts nothing about OTH.
 *
 * ⚠️ SO WHAT IS GUARDED HERE CHANGED SHAPE, IT DID NOT GO AWAY:
 *   - the MODEL stays a real 4.7 x 1.98 x 1.21 m car, so it is still checkable against reality;
 *   - the exaggeration lives in ONE named, derived constant applied to the mesh;
 *   - the BUS is never scaled, in either direction, and that is the line that matters.
 * A future "improvement" that bakes the size into the geometry, or that lets the bus inherit the
 * scale, still fails here.
 */

const EXTENT: WorldExtent = {
  minEasting: 720_000,
  maxNorthing: 5_435_000,
  widthM: 5000,
  depthM: 5000,
  zone: 32,
};

const DOC = {
  legs: [
    {
      from: 'seyboth',
      to: 'pruefening',
      distanceM: 3000,
      driveSeconds: 300,
      points: [
        [12.0, 49.0],
        [12.02, 49.02],
      ],
    },
  ],
};

function mockFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => DOC })) as unknown as typeof fetch
  );
}

const ground = () => 0;

function sizeOf(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox!.getSize(size);
  return size;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the cheat car', () => {
  it('is modelled as a real-sized car, not a cartoon', () => {
    // ⚠️ STILL ASSERTED, AND STILL MEANINGFUL. The car is DRAWN oversized, but the geometry it is
    // drawn from is real. Baking the exaggeration in here would destroy the only reference the
    // scale factor is measured against, and `SPORTSCAR_CHEAT_SCALE` would become a number nobody
    // could check.
    const size = sizeOf(createCarGeometry());
    // Built along +X then rotated so +Z is forward, so length ends up on Z.
    const length = Math.max(size.x, size.z);
    const width = Math.min(size.x, size.z);

    // Roughly an F8: 4.7 x 1.98 x 1.21 m. Generous bounds, because the point is to catch a
    // ten-fold "make it bigger", not to pin the model to a centimetre.
    expect(length).toBeGreaterThan(4.0);
    expect(length).toBeLessThan(5.5);
    expect(width).toBeGreaterThan(1.6);
    expect(width).toBeLessThan(2.4);
    expect(size.y).toBeGreaterThan(0.9);
    expect(size.y).toBeLessThan(1.5);
  });

  it('is modelled smaller than the bus it replaces, in every dimension', () => {
    const car = sizeOf(createCarGeometry());
    const bus = sizeOf(createBusGeometry());
    expect(Math.max(car.x, car.z)).toBeLessThan(Math.max(bus.x, bus.z));
    expect(car.y).toBeLessThan(bus.y);
  });

  it('⚠️ stands the stated 1.21 m, because the constant drives the geometry', () => {
    // The first version hard-coded the upper body and came out at 1.10 m while the comment said
    // 1.21. The compiler caught it only because the constant was then unused.
    expect(sizeOf(createCarGeometry()).y).toBeCloseTo(1.21, 1);
  });

  it('is DRAWN about as tall as a house, which is the whole point of the cheat', () => {
    // The target is stated in metres and the factor is derived from it, so this asserts the
    // outcome a reader cares about rather than restating the arithmetic.
    const drawnHeightM = sizeOf(createCarGeometry()).y * SPORTSCAR_CHEAT_SCALE;
    expect(drawnHeightM).toBeGreaterThan(6);
    expect(drawnHeightM).toBeLessThan(11);
  });

  it('⚠️ scales the sports car and NEVER the bus', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    const mesh = shuttle!.group.children[0] as THREE.Mesh;

    // The honest vehicle starts, and stays, at true scale.
    expect(mesh.scale.x).toBe(1);
    expect(mesh.scale.y).toBe(1);
    expect(mesh.scale.z).toBe(1);

    shuttle!.setVehicle('sportscar');
    expect(mesh.scale.x).toBeCloseTo(SPORTSCAR_CHEAT_SCALE, 6);
    // Uniform, or the car is drawn stretched rather than large.
    expect(mesh.scale.y).toBeCloseTo(mesh.scale.x, 6);
    expect(mesh.scale.z).toBeCloseTo(mesh.scale.x, 6);

    // ⚠️ THE LINE. A bus left carrying the cheat scale would be a 79 m vehicle on a real road, in
    // the honest mode, after the joke had ended — an exaggeration arriving by accident, which is
    // exactly what the standing rule exists to prevent.
    shuttle!.setVehicle('bus');
    expect(mesh.scale.x).toBe(1);
    expect(mesh.scale.y).toBe(1);
    expect(mesh.scale.z).toBe(1);
  });

  it('⚠️ keeps the wheels on the road when scaled, rather than sinking the car', () => {
    // Both geometries are built with y = 0 at the wheel contact, so a uniform scale about the
    // origin cannot drive the car into the terrain. If a future edit re-centres either model on
    // its middle, this fails — and the symptom in the scene would be a car buried to its windows.
    for (const g of [createCarGeometry(), createBusGeometry()]) {
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeCloseTo(0, 3);
    }
  });

  it('⚠️ is a bigger exaggeration than the walking figures, and is the only other one', () => {
    // FIGURE_SCALE is 4 (PLAN §57.3). This being larger is intended, not a slip: a car on a road
    // is looked at from further away than a crowd on a path. Stated so the two are compared on
    // purpose rather than drifting apart unnoticed.
    expect(SPORTSCAR_CHEAT_SCALE).toBeGreaterThan(4);
    expect(SPORTSCAR_CHEAT_SCALE).toBeLessThan(12);
  });

  it('swaps the mesh and the paint, and swaps back', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    expect(shuttle!.vehicle()).toBe('bus');

    const mesh = shuttle!.group.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.RawShaderMaterial;
    const busColour = (material.uniforms.uBody.value as THREE.Color).getHex();
    const busSize = sizeOf(mesh.geometry);

    shuttle!.setVehicle('sportscar');
    expect(shuttle!.vehicle()).toBe('sportscar');
    const carColour = (material.uniforms.uBody.value as THREE.Color).getHex();
    expect(carColour).not.toBe(busColour);
    // Red: dominant red channel is the whole brief.
    const red = new THREE.Color(carColour);
    expect(red.r).toBeGreaterThan(0.6);
    expect(red.g).toBeLessThan(0.3);
    expect(red.b).toBeLessThan(0.3);
    expect(sizeOf(mesh.geometry).y).toBeLessThan(busSize.y);

    shuttle!.setVehicle('bus');
    expect(shuttle!.vehicle()).toBe('bus');
    expect((material.uniforms.uBody.value as THREE.Color).getHex()).toBe(busColour);
  });

  it('⚠️ disposes the geometry it replaces', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    const mesh = shuttle!.group.children[0] as THREE.Mesh;
    const spy = vi.spyOn(mesh.geometry, 'dispose');

    shuttle!.setVehicle('sportscar');

    // A cheat word is exactly the thing somebody types twenty times to watch it again, so an
    // orphaned buffer per swap is a real leak rather than a theoretical one.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does nothing when asked for the vehicle it already has', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    const mesh = shuttle!.group.children[0] as THREE.Mesh;
    const before = mesh.geometry;
    shuttle!.setVehicle('bus');
    expect(mesh.geometry).toBe(before);
  });

  it('keeps driving the same road at the same reported compression', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    shuttle!.setVisible(true);
    shuttle!.setVehicle('sportscar');
    shuttle!.playJourney(4);

    const j = shuttle!.journey()!;
    // ⚠️ The cheat must not invent a different road or a different real drive time. Only the
    // duration the user watches changes, and the factor follows from it honestly.
    expect(j.realSeconds).toBe(300);
    expect(j.shownSeconds).toBe(4);
    expect(j.factor).toBe(75);
  });
});
