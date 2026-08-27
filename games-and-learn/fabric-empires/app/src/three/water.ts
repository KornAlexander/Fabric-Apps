/**
 * Water.
 *
 * The single largest realism win available for the money. A flat blue plane
 * reads as plastic no matter how good the terrain is, because water is one
 * of the few materials people can judge instantly: it reflects the sky,
 * refracts what is under it, and moves.
 *
 * three's Water does the reflection with a real mirror pass, so the surface
 * shows the actual sky and the actual coastline rather than an approximation.
 * The one asset it needs is a normal map, which is generated here.
 */

import { Color, PlaneGeometry, RepeatWrapping, CanvasTexture, Vector3 } from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { heightCanvas, normalMapCanvas } from './noise.js';

export interface WaterSurface {
  readonly mesh: Water;
  /** Advance the ripple animation. */
  update(deltaSeconds: number): void;
  setSunDirection(direction: Vector3): void;
  dispose(): void;
}

export function createWater(size: number, level: number, quality = 512): WaterSurface {
  const detail = heightCanvas(256, 5, { octaves: 4, seed: 91 });
  const normals = new CanvasTexture(normalMapCanvas(detail, 256, 3.5).canvas);
  normals.wrapS = RepeatWrapping;
  normals.wrapT = RepeatWrapping;

  const water = new Water(new PlaneGeometry(size, size), {
    textureWidth: quality,
    textureHeight: quality,
    waterNormals: normals,
    sunDirection: new Vector3(0, 1, 0),
    sunColor: 0xfff0dd,
    // A real sea is not the colour of deep water alone: most of what reaches
    // the eye is reflected sky. Too dark a base and the whole ocean reads as
    // mud no matter how good the reflection is.
    waterColor: 0x1d4a63,
    // Low enough that the coastline stays readable. High distortion looks
    // impressive in isolation and makes a strategy map unplayable.
    distortionScale: 1.6,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = level;
  water.receiveShadow = false;

  const uniforms = water.material.uniforms;
  uniforms.size!.value = 6;

  return {
    mesh: water,
    update(delta) {
      uniforms.time!.value += delta;
    },
    setSunDirection(direction) {
      uniforms.sunDirection!.value.copy(direction).normalize();
    },
    dispose() {
      water.geometry.dispose();
      normals.dispose();
    },
  };
}

/** Shallow-water tint applied to the sea floor, kept in one place. */
export const SHALLOW_TINT = new Color('#2f6a7a');
