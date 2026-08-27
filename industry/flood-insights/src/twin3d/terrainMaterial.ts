import * as THREE from 'three';

import { HAZE_COLOUR, HAZE_FAR_M, HAZE_NEAR_M } from './haze';
import type { FlowFieldMeta, TerrainMeta } from './terrainLoader';

/**
 * Terrain + water material — PLAN §6.3.
 *
 * The vertex shader displaces a flat grid by the DGM1 heightmap. The fragment shader resolves the
 * level-set flood in one step per pixel:
 *
 *     depth = WSE[chainIndex] - terrainZ,  masked by connectivity
 *
 * No hydraulics run in the browser. The only thing that changes per frame is a 984-value WSE
 * profile, which is why scrubbing the timeline is instant.
 *
 * Water colour is deliberately turbid brown, not blue (PLAN §9.2). The Ahr carried mud, debris and
 * heating oil that night; clear blue water would be both wrong and glib.
 */

const vertexShader = /* glsl */ `
precision highp float;
precision highp usampler2D;

uniform usampler2D uHeight;
uniform vec2  uHeightSize;
uniform float uHeightMin;
uniform float uHeightScale;
uniform float uVerticalExaggeration;
uniform float uCellSizeM;

out vec2  vUv;
out float vTerrainZ;
out vec3  vNormal;
// Distance from the eye, in metres, for the haze mix. Without it the terrain ends in a hard cliff
// against the clear colour, and on a 23 km AOI that reads as a model on a white page rather than
// as a valley. See haze.ts for why THREE.Fog cannot do this job here.
out float vViewDist;

// PlaneGeometry uv has v=0 at +Z, and after rotateX(-90deg) +Z is the SOUTH edge. Our rasters are
// image-ordered with row 0 = NORTH. Without this flip the terrain, the river and the villages are
// all mirrored against each other, which is invisible on screen but wrong everywhere it matters.
vec2 gridUv(vec2 uv) {
  return vec2(uv.x, 1.0 - uv.y);
}

float sampleElevation(vec2 uv) {
  ivec2 texel = ivec2(clamp(gridUv(uv), 0.0, 1.0) * (uHeightSize - 1.0));
  return uHeightMin + float(texelFetch(uHeight, texel, 0).r) * uHeightScale;
}

void main() {
  vUv = uv;

  float elevation = sampleElevation(uv);
  vTerrainZ = elevation;

  // Central differences on the heightmap give a surface normal without needing normals in the
  // geometry, which keeps the buffer small.
  vec2 step = 1.0 / uHeightSize;
  float zx = sampleElevation(uv + vec2(step.x, 0.0)) - sampleElevation(uv - vec2(step.x, 0.0));
  float zy = sampleElevation(uv + vec2(0.0, step.y)) - sampleElevation(uv - vec2(0.0, step.y));
  vNormal = normalize(vec3(-zx * uVerticalExaggeration, 2.0 * uCellSizeM, zy * uVerticalExaggeration));

  vec3 displaced = position;
  displaced.y = elevation * uVerticalExaggeration;

  vec4 viewPos = modelViewMatrix * vec4(displaced, 1.0);
  vViewDist = -viewPos.z;

  gl_Position = projectionMatrix * viewPos;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp usampler2D;

uniform usampler2D uChain;
uniform sampler2D  uMask;
uniform sampler2D  uWse;
uniform sampler2D  uHazardWse;
uniform float uShowHazard;
uniform usampler2D uLanduse;
uniform vec2  uLanduseSize;
uniform float uHasLanduse;
uniform float uShowLanduse;
uniform sampler2D uDrape;
uniform float uHasDrape;
uniform float uShowDrape;
uniform float uDrapeGamma;
// One high-resolution window, from drape_detail.json. See src/twin3d/drapeDetail.ts.
uniform sampler2D uDetail;
uniform float uHasDetail;
uniform vec4  uDetailRect;
uniform float uDetailGamma;
// Per-flight exposure match: xy = the span along u, z = the exponent. See terrainLoader.ts.
uniform vec3  uCampaigns[4];
uniform int   uCampaignCount;
uniform vec2  uChainSize;
uniform float uChainCount;
uniform uint  uNotConnected;
uniform float uTime;
uniform float uShowWater;

in vec2  vUv;
in float vTerrainZ;
in vec3  vNormal;
in float vViewDist;

/** Where the haze starts and where the ground has fully dissolved into it, in metres. */
uniform float uHazeNearM;
uniform float uHazeFarM;
uniform vec3  uHazeColour;

out vec4 fragColor;

vec2 gridUv(vec2 uv) {
  return vec2(uv.x, 1.0 - uv.y);
}

// An orthophoto product is a mosaic of flight campaigns, and where two meet the picture steps: the
// Ahr's box is covered by two flights of 2023 that differ by 20 % in brightness at a tile column
// just west of Altenahr. The exponent that makes them render alike is measured offline per
// campaign; here it simply multiplies the AOI-wide one, because pow(pow(x, a), b) == pow(x, a*b).
// 1.0 for the reference flight, and 1.0 anywhere no campaign is declared, so an AOI with a single
// flight renders exactly as it always did.
float campaignGamma(float u) {
  for (int i = 0; i < uCampaignCount; i++) {
    if (u >= uCampaigns[i].x && u <= uCampaigns[i].y) return uCampaigns[i].z;
  }
  return 1.0;
}

// Light topographic palette — the register of a printed relief map, not a product dashboard.
// Still muted and unsaturated (PLAN §2.3): warm paper greys rising to a slightly cooler ridge,
// with no cheerful greens and nothing that competes with the water for attention.
vec3 terrainColour(float z) {
  vec3 valley  = vec3(0.80, 0.79, 0.75);
  vec3 slope   = vec3(0.71, 0.70, 0.66);
  vec3 ridge   = vec3(0.61, 0.60, 0.57);
  float t = clamp((z - 90.0) / 420.0, 0.0, 1.0);
  return t < 0.5 ? mix(valley, slope, t * 2.0) : mix(slope, ridge, (t - 0.5) * 2.0);
}

// Land cover, from OpenStreetMap. Class ids come from tools/geodata/build_landuse.py and are
// append-only.
//
// These stay in the same muted register as the elevation palette — a hand-tinted survey sheet,
// not satellite imagery. Two constraints are doing most of the work here: nothing may approach
// the saturation of the flood water, which has to remain the darkest and most salient thing on
// screen, and nothing may be dark enough to be mistaken for it. So the greens are greyed and the
// range between the lightest and darkest cover is kept narrow.
vec3 landCoverColour(uint id) {
  if (id == 1u)  return vec3(0.62, 0.56, 0.40);  // vineyard — warm ochre, the Ahr's signature
  if (id == 2u)  return vec3(0.60, 0.62, 0.45);  // orchard
  if (id == 3u)  return vec3(0.44, 0.50, 0.39);  // forest
  if (id == 4u)  return vec3(0.76, 0.72, 0.57);  // farmland
  if (id == 5u)  return vec3(0.66, 0.69, 0.54);  // meadow and grass
  if (id == 6u)  return vec3(0.62, 0.67, 0.51);  // park and garden
  if (id == 7u)  return vec3(0.70, 0.68, 0.52);  // allotments
  if (id == 8u)  return vec3(0.75, 0.72, 0.68);  // residential
  if (id == 9u)  return vec3(0.70, 0.69, 0.70);  // commercial and industrial
  if (id == 10u) return vec3(0.60, 0.60, 0.47);  // scrub and heath
  if (id == 11u) return vec3(0.50, 0.54, 0.55);  // standing water
  if (id == 12u) return vec3(0.58, 0.62, 0.55);  // wetland
  if (id == 13u) return vec3(0.68, 0.66, 0.62);  // rock and quarry
  // The network reads because the two surfaces go opposite ways: asphalt is darker than nearly
  // any ground here, gravel paler than nearly any. One shared grey made both disappear.
  if (id == 20u) return vec3(0.30, 0.29, 0.30);  // paved road, major
  if (id == 21u) return vec3(0.40, 0.39, 0.40);  // paved road, minor
  if (id == 22u) return vec3(0.84, 0.81, 0.72);  // unpaved track
  if (id == 23u) return vec3(0.26, 0.24, 0.24);  // railway
  return vec3(0.0);
}

// How far each class is allowed to pull the surface away from its elevation colour. Cover is
// mapped at 8 m from a source that is neither complete nor contemporaneous, so it tints the
// ground rather than replacing it — the relief has to stay readable through it.
float landCoverStrength(uint id) {
  if (id == 0u)  return 0.0;
  // Built lines are surveyed to the metre and are the one thing here with a hard edge, so they
  // are allowed to sit on top of the ground colour rather than be averaged into it.
  if (id >= 20u) return 0.94;
  if (id == 1u)  return 0.72;  // vineyard, the one class worth naming from a distance
  if (id == 3u)  return 0.68;
  return 0.58;
}

// Cheap 2D hash, used to ragged the class boundaries.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// The four hazard classes, on the ZURS frequency boundaries but derived from public data only
// (PLAN §5) — this is emphatically not ZURS itself.
//
// The ramp runs yellow → red with rising frequency, which is the convention every German hazard
// map uses, so it needs no learning. GK1 is deliberately the palest: it is not "safe", it is
// "rarer than a 200-year flood", and the whole point of Act I is that a great deal of GK1 and GK2
// ground stood under two metres of water in 2021. Making it green would tell exactly the lie the
// app exists to correct.
vec3 hazardColour(int gk) {
  if (gk == 4) return vec3(0.72, 0.13, 0.11);  // GK4 — HQ10 or more often
  if (gk == 3) return vec3(0.88, 0.41, 0.14);  // GK3 — rarer than HQ10, at least HQ100
  if (gk == 2) return vec3(0.95, 0.72, 0.22);  // GK2 — rarer than HQ100, at least HQ200
  return vec3(0.93, 0.89, 0.72);               // GK1 — rarer than HQ200
}

void main() {
  vec3 colour = terrainColour(vTerrainZ);

  uint cover = 0u;
  if (uHasLanduse > 0.5 && uShowLanduse > 0.5) {
    // Jitter the lookup by up to half a cell. The raster is 8 m and the terrain is drawn far
    // finer, so a straight nearest lookup gives every field a staircase edge. Displacing the
    // sample by a hash of the position breaks the staircase into a ragged margin, which is both
    // closer to how land cover actually changes and much cheaper than rasterising finer.
    //
    // Roads and rail are exempt in both directions. A field boundary is genuinely vague and
    // deserves a ragged edge; a road is surveyed, mostly one cell wide, and ragging it either
    // eats the line or smears it sideways into ground that has no road on it.
    vec2 luUv = clamp(gridUv(vUv), 0.0, 1.0);
    vec2 texel = 1.0 / uLanduseSize;
    ivec2 exact = ivec2(luUv * (uLanduseSize - 1.0));
    uint direct = texelFetch(uLanduse, exact, 0).r;

    if (direct >= 20u) {
      cover = direct;
    } else {
      vec2 jitter = (vec2(hash12(luUv * 4096.0), hash12(luUv * 4096.0 + 7.7)) - 0.5) * texel * 1.1;
      ivec2 luTexel = ivec2(clamp(luUv + jitter, 0.0, 1.0) * (uLanduseSize - 1.0));
      uint jittered = texelFetch(uLanduse, luTexel, 0).r;
      cover = jittered >= 20u ? direct : jittered;
    }

    vec3 tint = landCoverColour(cover);
    float strength = landCoverStrength(cover);

    if (strength > 0.0) {
      // A little per-pixel variation so a large field does not read as a flat swatch.
      float grain = (hash12(luUv * 9000.0) - 0.5) * 0.045;
      colour = mix(colour, tint + grain, strength);
    }
  }

  // The aerial photograph, over the top of the land cover.
  //
  // Over rather than instead of: the land-cover classes stay underneath, so the surface is still
  // coloured where the drape has no pixels — the Ahr's box crosses out of Rheinland-Pfalz and its
  // DOP20 service has no imagery beyond the border, which arrives as white.
  float drapeMix = uHasDrape * uShowDrape;
  bool onDrape = false;
  if (drapeMix > 0.0) {
    vec2 photoUv = gridUv(vUv);
    vec3 photo = texture(uDrape, photoUv).rgb;
    // Nodata in an orthophoto mosaic is white, not transparent. Fading it out where it is nearly
    // white keeps the land cover visible past the state border instead of a blank sheet, and
    // costs nothing inside the coverage because real ground is never this bright.
    //
    // ⚠️ Measured on the RAW photo, before the exposure below. Brightening first would push more
    // pale ground over the threshold and punch holes in the imagery where gravel and glasshouse
    // roofs happen to be bright.
    float coverage = 1.0 - smoothstep(0.93, 0.995, min(photo.r, min(photo.g, photo.b)));

    // Exposure, measured per AOI from the drape's own ground pixels by
    // tools/geodata/measure_drape_exposure.py and carried in drape.json.
    //
    // The Ahr's orthophoto is a genuinely dark photograph — a narrow, steeply wooded valley, mean
    // ground luma 0.314 against Horta Sud's 0.513 — and it rendered as a near-black mass. That is
    // not something the hillshade above could fix: it is already as gentle as it can be over a
    // photo (0.80–1.00), and lifting it further would flatten the relief instead.
    //
    // Gamma rather than a multiplier, because a gain large enough to lift the Ahr would clip every
    // pale roof, gravel bar and glasshouse to white; gamma moves the mean and leaves 1.0 at 1.0,
    // so the nodata white stays white and the coverage test still means what it meant. Only ever
    // brightens — Horta Sud measures above the target and is passed through at exactly 1.0.
    photo = pow(photo, vec3(uDrapeGamma * campaignGamma(photoUv.x)));

    // The detail window, over the top of the AOI-wide photograph.
    //
    // The base drape is 2.878 m/px because one texture cannot hold the Ahr's 23.6 km at anything
    // finer; the source is flown at 0.20 m. So the sharpness is fetched separately, as a small
    // window centred on wherever the camera is looking, and blended in here.
    //
    // ⚠️ Feathered, not clipped. A hard rect edge in the middle of a hillside reads as a seam in
    // the terrain — a rendering fault — whereas a photograph that softens over ~30 m reads as what
    // it is: the same picture, less sharp further out. The window is small enough that its edge is
    // usually off screen anyway; the feather is for when it is not.
    //
    // ⚠️ Its gamma is the base drape's, not its own. The window is blended into that photograph,
    // so what it has to match is the brightness of the drape AT THIS PLACE, not an absolute
    // target. Correcting each tile to a target of its own rendered every window 1.77x too dark and
    // would have put a halo on the feather.
    //
    // 🔴 The fetch is UNCONDITIONAL, and that is load-bearing. It was inside an "if (w > 0.0)" at
    // first, which is non-uniform control flow — and GLSL leaves the implicit derivatives, and
    // therefore the mipmap level, UNDEFINED there. It did not fail loudly: the window rendered,
    // registered correctly, and simply came out 1.2x too dark from an arbitrary LOD. Found by
    // substituting the base texture into the same path, where an identity operation still changed
    // the picture. Anything sampled with mipmaps must be fetched in uniform flow and gated with
    // mix() afterwards.
    if (uHasDetail > 0.5) {
      vec2 local = (photoUv - uDetailRect.xy) / (uDetailRect.zw - uDetailRect.xy);
      vec2 toEdge = min(local, 1.0 - local);
      float w = smoothstep(0.0, 0.03, min(toEdge.x, toEdge.y));
      vec3 fine = pow(texture(uDetail, clamp(local, 0.0, 1.0)).rgb,
                      vec3(uDetailGamma * campaignGamma(photoUv.x)));
      photo = mix(photo, fine, w);
      // A detail tile is cut from inside the survey, so where it applies there is data by
      // construction — even where the base mosaic happens to be padding.
      coverage = mix(coverage, 1.0, w);
    }

    colour = mix(colour, photo, drapeMix * coverage);
    onDrape = coverage > 0.5;
  }

  // Low north-west sun, the cartographic convention for hillshading. Without this the relief is
  // completely unreadable — a flat pale mass rather than a valley.
  //
  // The gain is kept at or below 1.0 on purpose. An earlier version peaked at 1.14, which clipped
  // every sunlit slope to pure white and made the terrain look like plaster once you zoomed in.
  vec3 sun = normalize(vec3(-0.55, 0.62, -0.55));
  float lambert = clamp(dot(normalize(vNormal), sun), 0.0, 1.0);
  // ⚠️ Shade a photograph far more gently than the synthetic palette. An orthophoto already
  // contains the sun — it was flown on a real morning and carries that day's shadows baked into
  // the pixels — so applying the full hillshade on top shades the terrain twice and north faces
  // go almost black. Dropping it entirely is worse: the relief flattens and the 3D scene reads as
  // a paper map draped over nothing. Half the contrast keeps the landform legible without
  // relighting a photograph.
  float shadeLow = onDrape ? 0.80 : 0.58;
  float shadeGain = onDrape ? 0.20 : 0.42;
  colour *= shadeLow + shadeGain * lambert;

  // Hazard classes, drawn under the water so Act I and Act II can be read against each other:
  // the class is what was knowable beforehand, the water is what actually happened.
  if (uShowHazard > 0.5) {
    ivec2 hazardTexel = ivec2(clamp(gridUv(vUv), 0.0, 1.0) * (uChainSize - 1.0));
    uint hazardChain = texelFetch(uChain, hazardTexel, 0).r;
    float hazardConnected = texture(uMask, gridUv(vUv)).r;

    // 0 means "outside the mapped area". Ground the river cannot reach at any discharge is not
    // shaded at all, which is how an official Hochwassergefahrenkarte looks too — it maps the
    // floodplain and simply stops. Tinting every hillside the palest class would bury the valley
    // in a wash of colour and say nothing.
    int gk = 0;

    if (hazardChain != uNotConnected && hazardConnected > 0.35) {
      float hu = (float(hazardChain) + 0.5) / uChainCount;
      // r = HQ10, g = HQ100, b = HQ200. One fetch, because the three boundaries are only ever
      // needed together.
      vec3 levels = texture(uHazardWse, vec2(hu, 0.5)).rgb;

      gk = 1;
      if (vTerrainZ <= levels.r)      gk = 4;
      else if (vTerrainZ <= levels.g) gk = 3;
      else if (vTerrainZ <= levels.b) gk = 2;
    }

    if (gk > 0) {
      colour = mix(colour, hazardColour(gk) * (0.72 + 0.34 * lambert), 0.62);
    }
  }

  if (uShowWater > 0.5) {
    ivec2 chainTexel = ivec2(clamp(gridUv(vUv), 0.0, 1.0) * (uChainSize - 1.0));
    uint chainIndex = texelFetch(uChain, chainTexel, 0).r;
    float connected = texture(uMask, gridUv(vUv)).r;

    if (chainIndex != uNotConnected && connected > 0.35) {
      float u = (float(chainIndex) + 0.5) / uChainCount;
      float wse = texture(uWse, vec2(u, 0.5)).r;
      float depth = wse - vTerrainZ;

      if (depth > 0.0) {
        // Turbid brown, darkening with depth. Deliberately unchanged from the dark theme: the Ahr
        // carried mud, debris and heating oil that night, and clear blue water would be both wrong
        // and glib (PLAN §9.2). Against the pale terrain it now reads as the darkest thing on
        // screen, which is the correct emphasis.
        vec3 shallow = vec3(0.55, 0.45, 0.30);
        vec3 deep    = vec3(0.24, 0.17, 0.10);
        vec3 water = mix(shallow, deep, clamp(depth / 4.0, 0.0, 1.0));

        // Foam at the margin, where the water is only just over the ground.
        float foam = smoothstep(0.30, 0.0, depth);
        water = mix(water, vec3(0.78, 0.73, 0.65), foam * 0.5);

        // Slow surface movement so the water does not read as a static sheet.
        float ripple = sin(vUv.x * 900.0 + uTime * 1.6) * sin(vUv.y * 700.0 - uTime * 1.1);
        water += ripple * 0.012;

        float opacity = clamp(0.62 + depth * 0.22, 0.0, 0.96);
        colour = mix(colour, water, opacity);
      }
    }
  }

  // Haze last, over everything including the water, because it is atmosphere between the eye and
  // the ground rather than a property of the ground. Squared so the near field stays crisp and
  // only the far edge goes soft.
  float haze = smoothstep(uHazeNearM, uHazeFarM, vViewDist);
  colour = mix(colour, uHazeColour, haze * haze);

  fragColor = vec4(colour, 1.0);
}
`;

export interface TerrainMaterialOptions {
  terrain: TerrainMeta;
  flow: FlowFieldMeta;
  heightTexture: THREE.DataTexture;
  chainTexture: THREE.DataTexture;
  maskTexture: THREE.DataTexture;
  wseTexture: THREE.DataTexture;
  /** Water surface at HQ10 / HQ100 / HQ200, packed r/g/b — the hazard class boundaries. */
  hazardWseTexture: THREE.DataTexture;
  landuseTexture?: THREE.DataTexture | null;
  landuse?: { width: number; height: number } | null;
  /** The aerial photograph, aligned to the heightmap grid. Optional. */
  drapeTexture?: THREE.Texture | null;
  /** Exposure correction measured from the drape's own pixels; 1.0 leaves it untouched. */
  drapeGamma?: number;
  verticalExaggeration?: number;
}

export function createTerrainMaterial(options: TerrainMaterialOptions): THREE.ShaderMaterial {
  const { terrain, flow, landuse, landuseTexture } = options;

  // A usampler2D uniform still has to be bound to something when the raster is missing, or the
  // sampler reads as unit 0 and picks up whatever integer texture is there.
  const landuseFallback = new THREE.DataTexture(
    new Uint8Array(1),
    1,
    1,
    THREE.RedIntegerFormat,
    THREE.UnsignedByteType
  );
  landuseFallback.internalFormat = 'R8UI';
  landuseFallback.needsUpdate = true;

  // Same reasoning for the drape: a sampler2D left unbound reads texture unit 0, which is
  // whatever happened to be bound last. One transparent-black pixel, never sampled because
  // uHasDrape gates it, but bound so it cannot pick up the heightmap.
  const drapeFallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  drapeFallback.needsUpdate = true;

  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      uHeight: { value: options.heightTexture },
      uHeightSize: { value: new THREE.Vector2(terrain.width, terrain.height) },
      uHeightMin: { value: terrain.heightMinM },
      uHeightScale: { value: terrain.heightScale },
      uVerticalExaggeration: { value: options.verticalExaggeration ?? 1 },
      uCellSizeM: { value: terrain.resolutionM },
      uChain: { value: options.chainTexture },
      uMask: { value: options.maskTexture },
      uWse: { value: options.wseTexture },
      uHazardWse: { value: options.hazardWseTexture },
      uShowHazard: { value: 0 },
      uLanduse: { value: landuseTexture ?? landuseFallback },
      uLanduseSize: { value: new THREE.Vector2(landuse?.width ?? 1, landuse?.height ?? 1) },
      uHasLanduse: { value: landuseTexture ? 1 : 0 },
      uShowLanduse: { value: 1 },
      uDrape: { value: options.drapeTexture ?? drapeFallback },
      uHasDrape: { value: options.drapeTexture ? 1 : 0 },
      uDrapeGamma: { value: options.drapeGamma ?? 1 },
      // Off by default. It is the heaviest asset in the scene and the cartographic surface is the
      // one the rest of the interface is designed against; the photograph is something the viewer
      // asks for.
      uShowDrape: { value: 0 },
      // Filled in per frame by the scene once a detail tile has been fetched. Same fallback
      // reasoning as the drape: bound, never sampled while uHasDetail is 0.
      uDetail: { value: drapeFallback },
      uHasDetail: { value: 0 },
      uDetailRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uDetailGamma: { value: 1 },
      // Filled by the scene from drape_campaigns.json. Count 0 means every exponent is 1.
      uCampaigns: {
        value: Array.from({ length: 4 }, () => new THREE.Vector3(0, 0, 1)),
      },
      uCampaignCount: { value: 0 },
      uChainSize: { value: new THREE.Vector2(flow.width, flow.height) },
      uChainCount: { value: flow.chainagePoints },
      uNotConnected: { value: flow.notConnected },
      uTime: { value: 0 },
      uShowWater: { value: 1 },
      uHazeNearM: { value: HAZE_NEAR_M },
      uHazeFarM: { value: HAZE_FAR_M },
      uHazeColour: { value: new THREE.Color(HAZE_COLOUR) },
    },
  });
}
