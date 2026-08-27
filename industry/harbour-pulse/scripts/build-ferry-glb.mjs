/**
 * Generates public/models/ferry.glb — a detailed Sydney Ferries "Friendship"
 * (First Fleet-class catamaran). Uses three.js geometry generators headlessly
 * in Node (no WebGL) so the GLB shown in the Cesium view matches the in-app
 * three.js FerryManager model exactly: twin lofted demi-hulls, a bridged deck,
 * a rounded white saloon + set-back upper deck with framed glazing, a forward
 * wheelhouse, funnel, mast with radar + navigation lights, rubbing strakes,
 * railings and life rings — in TfNSW livery. No third-party assets.
 * Run with:  node scripts/build-ferry-glb.mjs
 *
 * Axes (glTF, metres):  X = beam (port−/starboard+),  Y = up,  Z = length
 * (stern −Z → bow +Z). Cesium auto-converts Y-up to its Z-up ENU frame.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/models/ferry.glb');

// sRGB → linear (glTF colour factors are linear).
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgba = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [s2l(((n >> 16) & 255) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255), 1];
};

// Material palette (colour + PBR response), keyed by part — livery sampled
// from the real "Friendship": green hull, cream superstructure, green trim.
const MAT = {
  hull: { color: '#0e7a3d', rough: 0.5, metal: 0.1, doubleSided: true },
  cabin: { color: '#eee0a4', rough: 0.55, metal: 0.02 },
  trim: { color: '#0e7a3d', rough: 0.45, metal: 0.0 },
  glass: { color: '#12181d', rough: 0.06, metal: 0.9 },
  deckf: { color: '#b3ab94', rough: 0.85, metal: 0.0 },
  roof: { color: '#e7dfc0', rough: 0.6, metal: 0.0 },
  frame: { color: '#eee0a4', rough: 0.5, metal: 0.0 },
  dark: { color: '#1e242a', rough: 0.5, metal: 0.5 },
  black: { color: '#121417', rough: 0.85, metal: 0.0 },
  ring: { color: '#f0efe8', rough: 0.5, metal: 0.0 },
  flag: { color: '#c8202a', rough: 0.6, metal: 0.0, doubleSided: true },
  navRed: { color: '#200000', rough: 0.4, metal: 0.0, emissive: '#ff2020' },
  navGreen: { color: '#002000', rough: 0.4, metal: 0.0, emissive: '#24ff34' },
  navWhite: { color: '#222222', rough: 0.4, metal: 0.0, emissive: '#fff2cc' },
};

// ── Geometry helpers (shared logic with src/three/FerryManager.ts) ───────────

/** Box (w×h×d, X/Y/Z) whose four vertical corners are rounded. */
function roundedBoxGeometry(w, h, d, r) {
  const hw = w / 2;
  const hd = d / 2;
  const rr = Math.max(0.05, Math.min(r, hw - 0.05, hd - 0.05));
  const shape = new THREE.Shape();
  shape.moveTo(-hw + rr, -hd);
  shape.lineTo(hw - rr, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + rr);
  shape.lineTo(hw, hd - rr);
  shape.quadraticCurveTo(hw, hd, hw - rr, hd);
  shape.lineTo(-hw + rr, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - rr);
  shape.lineTo(-hw, -hd + rr);
  shape.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.12,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -h / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Lofted displacement hull (rounded-V stations, fine bow, rising sheer). */
function buildHull(len, maxHalfWidth, maxDepth, deckY, sheer) {
  const NS = 28;
  const NU = 14;
  const zStern = -len / 2;
  const positions = [];
  const indices = [];
  const stationZ = [];
  const stationPts = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const z = zStern + t * len;
    let wf;
    if (t < 0.12) wf = 0.84 + (t / 0.12) * 0.16;
    else if (t < 0.64) wf = 1.0;
    else wf = Math.max(0.05, 1 - ((t - 0.64) / 0.36) ** 1.7);
    const df = t > 0.68 ? Math.max(0.12, 1 - ((t - 0.68) / 0.32) * 0.9) : 1.0;
    const topY = deckY + sheer * Math.max(0, (t - 0.5) / 0.5) ** 1.7 + 0.3 * Math.max(0, (0.12 - t) / 0.12);
    const hw = maxHalfWidth * wf;
    const keelY = -maxDepth * df;
    const pts = [];
    for (let j = 0; j <= NU; j++) {
      const u = -1 + (2 * j) / NU;
      const x = u * hw;
      const y = keelY + (topY - keelY) * Math.abs(u) ** 1.7;
      pts.push([x, y]);
    }
    stationZ.push(z);
    stationPts.push(pts);
  }
  const idx = (i, j) => i * (NU + 1) + j;
  for (let i = 0; i <= NS; i++) for (const [x, y] of stationPts[i]) positions.push(x, y, stationZ[i]);
  for (let i = 0; i < NS; i++)
    for (let j = 0; j < NU; j++) {
      const a = idx(i, j);
      const b = idx(i, j + 1);
      const c = idx(i + 1, j + 1);
      const d = idx(i + 1, j);
      indices.push(a, b, d, b, c, d);
    }
  const topBase = positions.length / 3;
  for (let i = 0; i <= NS; i++) {
    const p = stationPts[i][0];
    const q = stationPts[i][NU];
    positions.push(p[0], p[1], stationZ[i], q[0], q[1], stationZ[i]);
  }
  for (let i = 0; i < NS; i++) {
    const a = topBase + i * 2;
    const b = topBase + i * 2 + 1;
    const c = topBase + (i + 1) * 2 + 1;
    const d = topBase + (i + 1) * 2;
    indices.push(a, b, c, a, c, d);
  }
  const transBase = positions.length / 3;
  for (const [x, y] of stationPts[0]) positions.push(x, y, stationZ[0]);
  for (let j = 1; j < NU; j++) indices.push(transBase, transBase + j, transBase + j + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ── Bake geometry into per-material vertex buckets ───────────────────────────
const buckets = {};
function emit(geo, key) {
  const ni = geo.index ? geo.toNonIndexed() : geo;
  if (!ni.getAttribute('normal')) ni.computeVertexNormals();
  const pos = ni.getAttribute('position').array;
  const nrm = ni.getAttribute('normal').array;
  const b = (buckets[key] ??= { pos: [], nrm: [] });
  for (let i = 0; i < pos.length; i++) b.pos.push(pos[i]);
  for (let i = 0; i < nrm.length; i++) b.nrm.push(nrm[i]);
}
/** Place a geometry at (x,y,z) with optional Euler rotation, then bake it. */
function part(geo, key, x = 0, y = 0, z = 0, rot = [0, 0, 0]) {
  const mtx = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
    new THREE.Vector3(1, 1, 1),
  );
  geo.applyMatrix4(mtx);
  emit(geo, key);
}

/** Perimeter railing (top rails + evenly-spaced posts) at height y. */
function addRailing(x0, x1, z0, z1, y, key = 'dark') {
  const H = 1.1;
  const R = 0.06;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  part(new THREE.BoxGeometry(w, R * 2, R * 2), key, cx, y + H, z0);
  part(new THREE.BoxGeometry(w, R * 2, R * 2), key, cx, y + H, z1);
  part(new THREE.BoxGeometry(R * 2, R * 2, d), key, x0, y + H, cz);
  part(new THREE.BoxGeometry(R * 2, R * 2, d), key, x1, y + H, cz);
  const posts = Math.max(2, Math.round(d / 2.4));
  for (let i = 0; i <= posts; i++) {
    const pz = z0 + (d * i) / posts;
    for (const px of [x0, x1]) part(new THREE.BoxGeometry(R * 2, H, R * 2), key, px, y + H / 2, pz);
  }
}

// ── Vessel layout (mirrors FerryManager.buildTemplate) ───────────────────────
const LEN = 30;
const HALF_BEAM = 5.3;

// Green hull (single lofted displacement hull, rising sheer).
part(buildHull(LEN - 4, HALF_BEAM, 2.8, 2.9, 0.9), 'hull', 0, 0, -1);
// Black rubbing strake at the deck edge + boot-top at the waterline.
part(new THREE.BoxGeometry(0.32, 0.5, 20), 'black', -HALF_BEAM, 2.6, -1);
part(new THREE.BoxGeometry(0.32, 0.5, 20), 'black', HALF_BEAM, 2.6, -1);
part(new THREE.BoxGeometry(0.3, 0.45, 19), 'black', -HALF_BEAM + 0.5, 0.5, -1);
part(new THREE.BoxGeometry(0.3, 0.45, 19), 'black', HALF_BEAM - 0.5, 0.5, -1);
// Deck floor recessed into the hull top + green foredeck bulwark.
part(roundedBoxGeometry(9.8, 0.4, LEN - 5, 1.4), 'deckf', 0, 2.95, -1);
part(roundedBoxGeometry(9.0, 1.4, 3.0, 0.9), 'hull', 0, 4.0, 11);
// Lower saloon (cream).
part(roundedBoxGeometry(9.0, 3.2, 24, 1.7), 'cabin', 0, 4.9, -1.5);
part(roundedBoxGeometry(9.1, 1.6, 22.2, 1.7), 'glass', 0, 5.05, -1.5);
part(roundedBoxGeometry(9.15, 0.32, 22.8, 1.75), 'trim', 0, 6.3, -1.5);
part(roundedBoxGeometry(9.3, 0.45, 24.2, 1.8), 'roof', 0, 6.7, -1.5);
for (let z = -10; z <= 8 + 1e-6; z += 1.7) {
  part(new THREE.BoxGeometry(0.16, 1.55, 0.16), 'frame', -4.58, 5.05, z);
  part(new THREE.BoxGeometry(0.16, 1.55, 0.16), 'frame', 4.58, 5.05, z);
}
part(new THREE.BoxGeometry(0.14, 2.1, 1.3), 'frame', -4.55, 4.55, -9); // doors
part(new THREE.BoxGeometry(0.14, 2.1, 1.3), 'frame', 4.55, 4.55, -9);
// Upper deck (cream, set back).
part(roundedBoxGeometry(7.6, 2.6, 15.5, 1.5), 'cabin', 0, 8.25, -3);
part(roundedBoxGeometry(7.7, 1.4, 13.8, 1.5), 'glass', 0, 8.4, -3);
part(roundedBoxGeometry(7.75, 0.28, 15.7, 1.5), 'trim', 0, 9.6, -3);
part(roundedBoxGeometry(7.85, 0.4, 15.7, 1.5), 'roof', 0, 9.8, -3);
for (let z = -8; z <= 6 + 1e-6; z += 1.7) {
  part(new THREE.BoxGeometry(0.16, 1.35, 0.16), 'frame', -3.88, 8.4, z);
  part(new THREE.BoxGeometry(0.16, 1.35, 0.16), 'frame', 3.88, 8.4, z);
}
// Aft open-deck railing (on the saloon roof).
addRailing(-3.8, 3.8, -13, -7, 6.95, 'frame');
// Wheelhouse (cream, green roof trim).
part(roundedBoxGeometry(5.4, 2.3, 4.6, 1.2), 'cabin', 0, 11.15, 4);
part(roundedBoxGeometry(5.5, 1.4, 4.7, 1.2), 'glass', 0, 11.3, 4);
part(roundedBoxGeometry(5.55, 0.28, 4.75, 1.2), 'trim', 0, 12.35, 4);
part(roundedBoxGeometry(5.5, 0.2, 4.65, 1.15), 'roof', 0, 12.55, 4);
// Low aft exhaust vent (no tall funnel on this class).
part(new THREE.BoxGeometry(1.7, 1.3, 1.9), 'cabin', 0, 10.65, -9);
part(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 10), 'black', -0.5, 11.9, -9);
part(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 10), 'black', 0.5, 11.9, -9);
// Cream mast with radar, antenna, red flag.
part(new THREE.CylinderGeometry(0.12, 0.15, 5, 8), 'cabin', 0, 15, 3.2);
part(new THREE.BoxGeometry(2.4, 0.12, 0.12), 'dark', 0, 16.3, 3.2);
part(new THREE.BoxGeometry(1.5, 0.2, 0.5), 'dark', 0, 13.6, 3.2);
part(new THREE.CylinderGeometry(0.03, 0.03, 2, 6), 'dark', 0.9, 17.4, 3.2);
part(new THREE.BoxGeometry(0.02, 0.7, 1.0), 'flag', -1.0, 15.9, 3.2);
// Navigation lights + life rings.
part(new THREE.SphereGeometry(0.18, 10, 8), 'navRed', -2.85, 11.5, 3.6);
part(new THREE.SphereGeometry(0.18, 10, 8), 'navGreen', 2.85, 11.5, 3.6);
part(new THREE.SphereGeometry(0.18, 10, 8), 'navWhite', 0, 17.0, 3.2);
part(new THREE.SphereGeometry(0.18, 10, 8), 'navWhite', 0, 7.0, -13.2);
part(new THREE.TorusGeometry(0.42, 0.13, 8, 16), 'ring', -4.62, 5.3, 5.0, [0, -Math.PI / 2, 0]);
part(new THREE.TorusGeometry(0.42, 0.13, 8, 16), 'ring', 4.62, 5.3, 5.0, [0, Math.PI / 2, 0]);

// ── Assemble glTF ────────────────────────────────────────────────────────────
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('friendship');

for (const [key, b] of Object.entries(buckets)) {
  const spec = MAT[key];
  const mat = doc
    .createMaterial(key)
    .setBaseColorFactor(rgba(spec.color))
    .setRoughnessFactor(spec.rough)
    .setMetallicFactor(spec.metal);
  if (spec.emissive) mat.setEmissiveFactor(rgba(spec.emissive).slice(0, 3));
  if (spec.doubleSided) mat.setDoubleSided(true);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.nrm)).setBuffer(buffer))
    .setMaterial(mat);
  const mesh = doc.createMesh(key).addPrimitive(prim);
  scene.addChild(doc.createNode(key).setMesh(mesh));
}

const glb = await new NodeIO().writeBinary(doc);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, glb);
console.log(`Wrote ${OUT} (${(glb.byteLength / 1024).toFixed(1)} KB)`);
