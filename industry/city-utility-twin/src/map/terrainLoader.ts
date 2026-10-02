import * as THREE from 'three';
import type { MapAssetReader } from '../assets/types';

export interface TerrainFocusPlace { id: string; name: string; u: number; v: number; groundM: number; }
export interface TerrainMeta {
  width: number; height: number; resolutionM: number; heightMinM: number; heightMaxM: number; heightScale: number;
  origin: { easting: number; northing: number }; coveragePct: number; focusPlaces: TerrainFocusPlace[];
  attribution: string; sourceAcquisition: string;
}
export interface LanduseMeta {
  file: string; bytes: number; compressedBytes: number; width: number; height: number; resolutionM: number;
  classes: Record<string,string>; coveragePct: number;
}
export interface DrapeTileMeta {
  file: string; row: number; col: number; width: number; height: number;
}
export interface DrapeMeta {
  file: string; width: number; height: number; resolutionM: number; origin: { easting: number; northing: number };
  spanM: { east: number; north: number }; attribution: string; resolutionNote: string;
  /** Present when the core is too large to photograph in one texture. See split_drape.py. */
  tiles?: { cols: number; rows: number; tileWidth: number; tileHeight: number; items: DrapeTileMeta[] } | null;
}
export interface ShellMeta {
  file: string; width: number; height: number; resolutionM: number; heightMinM: number; heightMaxM: number;
  heightScale: number; origin: { easting: number; northing: number };
  core: { easting: number; northing: number; widthM: number; heightM: number };
  transitionBandM: number; seamOffsetM: number; attribution: string;
}
export interface TerrainAssets {
  terrain: TerrainMeta; heightTexture: THREE.DataTexture;
  landuse: LanduseMeta | null; landuseTexture: THREE.DataTexture | null;
  drape: DrapeMeta; drapeTexture: THREE.Texture | null; drapeTiles: THREE.Texture[] | null;
}
export interface ShellAssets {
  shell: ShellMeta; shellTexture: THREE.DataTexture;
  shellDrape: DrapeMeta; shellDrapeTexture: THREE.Texture;
}
export interface LoadStageProgress {
  stage: 'terrain' | 'drape' | 'buildings' | 'vegetation'; step: number; stepCount: number; loadedBytes: number; totalBytes: number;
}
export type ProgressReporter = (value: LoadStageProgress) => void;
export const LOAD_STEP_COUNT = 4;
export class StageTracker {
  private expected = 0;
  private loaded = 0;
  constructor(private stage: LoadStageProgress['stage'], private step: number, private report?: ProgressReporter) {}
  addExpected(bytes: number) { this.expected += bytes; this.emit(); }
  track() {
    let previous = 0;
    return (received: number) => { this.loaded += received - previous; previous = received; this.emit(); };
  }
  private emit() { this.report?.({stage:this.stage,step:this.step,stepCount:LOAD_STEP_COUNT,
    loadedBytes:this.loaded,totalBytes:this.expected}); }
}
function grid(meta: TerrainMeta | ShellMeta | LanduseMeta) {
  if (!Number.isInteger(meta.width) || !Number.isInteger(meta.height) || meta.width < 1 || meta.height < 1 ||
    meta.width > 8192 || meta.height > 8192 || meta.width * meta.height > 16_000_000) throw new Error('Invalid raster dimensions.');
}
function heightTexture(data: Uint8Array, meta: TerrainMeta | ShellMeta) {
  grid(meta);
  if (data.byteLength !== meta.width * meta.height * 2) throw new Error('Height-grid shape mismatch.');
  const texture = new THREE.DataTexture(new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2),
    meta.width, meta.height, THREE.RedIntegerFormat, THREE.UnsignedShortType);
  texture.internalFormat = 'R16UI'; texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true; return texture;
}
async function imageTexture(
  reader: MapAssetReader,
  name: string,
  expected: { width: number; height: number },
  report?: ProgressReporter,
) {
  if (expected.width < 1 || expected.height < 1 || expected.width > 4096 || expected.height > 4096) {
    throw new Error('Invalid imagery descriptor.');
  }
  const progress = new StageTracker('drape',2,report); progress.addExpected(reader.size(name));
  const bytes = await reader.bytes(name,progress.track()); if (!bytes) throw new Error('Required imagery absent.');
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], {type:'image/jpeg'}));
  try {
    const image = await new Promise<HTMLImageElement>((resolve,reject) => {
      const img = new Image();
      const stop = () => { img.src=''; finish(new Error('Image decode cancelled.')); };
      const timer = setTimeout(() => finish(new Error('Image decode timed out.')),20000);
      function finish(error?: Error) {
        clearTimeout(timer); reader.signal?.removeEventListener('abort',stop); img.onload=null; img.onerror=null;
        if(error) reject(error); else resolve(img);
      }
      img.onload=()=>finish(); img.onerror=()=>finish(new Error('Image decode failed.'));
      reader.signal?.addEventListener('abort',stop,{once:true});
      if(reader.signal?.aborted) stop(); else img.src=url;
    });
    if(image.naturalWidth!==expected.width||image.naturalHeight!==expected.height)throw new Error('Image dimensions disagree.');
    const texture=new THREE.Texture(image);
    // Raw shaders use sRGB values directly. Keep the verified photo orientation
    // and no-mipmap path; this transport change does not alter rendered colours.
    texture.colorSpace=THREE.NoColorSpace;texture.generateMipmaps=false;
    texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
    texture.wrapS=THREE.ClampToEdgeWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;
    texture.flipY=false;texture.needsUpdate=true;return texture;
  } finally { URL.revokeObjectURL(url); }
}

/**
 * The orthophoto for one core, as either one texture or four quadrants.
 *
 * ⚠️ THE ORDER OF THE QUADRANTS IS THE CONTRACT. The shader indexes them as north-west,
 * north-east, south-west, south-east, so they are sorted by (row, col) here rather than trusted
 * to arrive in that order from the descriptor. A shuffled `items` array would otherwise render a
 * plausible-looking airfield with its quadrants swapped, which is the kind of wrong that survives
 * a screenshot review.
 */
async function loadDrape(reader: MapAssetReader, drape: DrapeMeta, report?: ProgressReporter) {
  const grid = drape.tiles;
  if (!grid) {
    return { single: await imageTexture(reader, drape.file, drape, report), tiles: null };
  }
  if (grid.cols !== 2 || grid.rows !== 2 || grid.items.length !== 4) {
    throw new Error('Only a 2 x 2 drape grid is supported.');
  }
  const ordered = [...grid.items].sort((a, b) => (a.row - b.row) || (a.col - b.col));
  const tiles: THREE.Texture[] = [];
  for (const item of ordered) {
    if (item.width !== grid.tileWidth || item.height !== grid.tileHeight) {
      throw new Error('Drape quadrants must all be the same size.');
    }
    tiles.push(await imageTexture(reader, item.file, item, report));
  }
  return { single: null, tiles };
}

/** One high-resolution core: terrain, land cover and imagery. No shell — the world shares one. */
export async function loadCore(reader: MapAssetReader, report?: ProgressReporter): Promise<TerrainAssets> {
  const owned: THREE.Texture[]=[];
  try {
    const [terrain,landuse,drape]: [TerrainMeta,LanduseMeta|null,DrapeMeta] = await Promise.all([
      reader.json('heightmap.json'),reader.json('landuse.json'),reader.json('drape.json')]);
    grid(terrain);
    if(landuse&&landuse.file!=='landuse_2m.u8z')throw new Error('Unexpected raster reference.');
    const progress=new StageTracker('terrain',1,report);
    for(const name of ['heightmap.u16',...(landuse?['landuse_2m.u8z']:[])]) progress.addExpected(reader.size(name));
    const height=await reader.bytes('heightmap.u16',progress.track());
    if(!height)throw new Error('Required terrain absent.');
    const coreTexture=heightTexture(height,terrain);owned.push(coreTexture);
    let landuseTexture: THREE.DataTexture|null=null;
    if(landuse){
      grid(landuse);const data=await reader.bytes('landuse_2m.u8z',progress.track());
      if(!data||data.byteLength!==landuse.width*landuse.height)throw new Error('Land cover shape mismatch.');
      landuseTexture=new THREE.DataTexture(data,landuse.width,landuse.height,THREE.RedIntegerFormat,THREE.UnsignedByteType);
      landuseTexture.internalFormat='R8UI';landuseTexture.minFilter=THREE.NearestFilter;landuseTexture.magFilter=THREE.NearestFilter;
      landuseTexture.needsUpdate=true;owned.push(landuseTexture);
    }
    const imagery=await loadDrape(reader,drape,report);
    for(const texture of [imagery.single,...(imagery.tiles??[])]) if(texture)owned.push(texture);
    return {terrain,heightTexture:coreTexture,landuse,landuseTexture,drape,
      drapeTexture:imagery.single,drapeTiles:imagery.tiles};
  } catch(error) { for(const texture of owned)texture.dispose();throw error; }
}

/**
 * The coarse terrain both cores sit in.
 *
 * ⚠️ LOADED ONCE FOR THE WHOLE WORLD, from whichever core's directory holds the union shell —
 * not once per core. Two per-core shells 28 km apart do not meet: they leave a hole exactly where
 * the camera flies between the two sites, which is the failure this shell exists to avoid.
 */
export async function loadShell(reader: MapAssetReader, report?: ProgressReporter): Promise<ShellAssets> {
  const owned: THREE.Texture[]=[];
  try {
    const [shell,shellDrape]: [ShellMeta,DrapeMeta] = await Promise.all([
      reader.json('shell.json'),reader.json('shell-drape.json')]);
    grid(shell);
    if(shell.file!=='shell.u16')throw new Error('Unexpected raster reference.');
    const progress=new StageTracker('terrain',1,report);
    progress.addExpected(reader.size('shell.u16'));
    const shellData=await reader.bytes('shell.u16',progress.track());if(!shellData)throw new Error('Required surroundings absent.');
    const shellTexture=heightTexture(shellData,shell);owned.push(shellTexture);
    const shellDrapeTexture=await imageTexture(reader,shellDrape.file,shellDrape);owned.push(shellDrapeTexture);
    return {shell,shellTexture,shellDrape,shellDrapeTexture};
  } catch(error) { for(const texture of owned)texture.dispose();throw error; }
}