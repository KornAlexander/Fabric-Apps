// The asset contract for ONE high-resolution core. The world has two of them, and they do not
// carry the same files: the city core has 29 580 cadastre trees and a single drape, the airfield
// core has no tree data at all and four drape quadrants. So the file list is a union and the
// per-file role decides what may be absent.
//
// ⚠️ THE POINT OF THIS FILE IS THAT ABSENCE IS DECLARED, NOT INFERRED. A manifest states
// `state: 'absent'` for a file the core genuinely does not have, and the reader refuses a core
// that omits a REQUIRED one. Without that, a half-copied asset directory renders a plausible
// scene with a layer quietly missing.
export const FILE_TYPES = Object.freeze({
  'heightmap.json':'application/json','heightmap.u16':'application/octet-stream','heightmap_nodata.u8':'application/octet-stream',
  'landuse.json':'application/json','landuse_2m.u8z':'application/octet-stream',
  'shell.json':'application/json','shell.u16':'application/octet-stream',
  'drape.json':'application/json','drape.jpg':'image/jpeg','shell-drape.json':'application/json','shell-drape.jpg':'image/jpeg',
  'drape_0_0.jpg':'image/jpeg','drape_0_1.jpg':'image/jpeg','drape_1_0.jpg':'image/jpeg','drape_1_1.jpg':'image/jpeg',
  'buildings_lod2.json':'application/json','buildings_lod2.bin':'application/octet-stream',
  'buildings_colour.bin':'application/octet-stream','buildings_roof_spans.bin':'application/octet-stream',
  'vegetation.json':'application/json','vegetation.bin':'application/octet-stream',
});
export const MAP_FILES = Object.keys(FILE_TYPES).sort();
/** The four quadrants of a drape too large for one texture. Either all four or none. */
export const DRAPE_TILES = ['drape_0_0.jpg','drape_0_1.jpg','drape_1_0.jpg','drape_1_1.jpg'];
export const OPTIONAL_FILES = [
  'landuse.json','landuse_2m.u8z',
  // A core without a tree cadastre build. The airfield core is deliberately one.
  'vegetation.json','vegetation.bin',
  // Exactly one of these forms is present: a single drape, or the four quadrants.
  'drape.jpg',...DRAPE_TILES,
  // The world shell is built once and lives under a single core; the other core has none.
  'shell.json','shell.u16','shell-drape.json','shell-drape.jpg',
];
// Preserved because the terrain descriptor references it; this renderer does not request the mask.
export const UNREFERENCED_FILES = ['heightmap_nodata.u8'];
export const REQUIRED_FILES = MAP_FILES.filter(name => !OPTIONAL_FILES.includes(name) && !UNREFERENCED_FILES.includes(name));
export const assetRole = name => OPTIONAL_FILES.includes(name) ? 'optional' : UNREFERENCED_FILES.includes(name) ? 'unreferenced' : 'required';
export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 65536;
export const HASH = /^[0-9a-f]{64}$/;
export function assertKeys(value, keys) {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))throw new Error('Invalid asset contract fields.');
}
export function validateManifest(value) {
  assertKeys(value,['schemaVersion','profile','files']);
  if(value.schemaVersion!==1||value.profile!=='muenchen-zwilling-core-v1')throw new Error('Unsupported asset profile.');
  assertKeys(value.files,MAP_FILES);
  for(const name of MAP_FILES){
    const entry=value.files[name];
    if(entry?.role!==assetRole(name))throw new Error('Asset role disagrees with required scene profile.');
    if(entry?.state==='absent'){
      assertKeys(entry,['state','role']);
      if(!OPTIONAL_FILES.includes(name))throw new Error('Required map asset declared absent.');
      continue;
    }
    assertKeys(entry,['state','role','mediaType','encoding','bytes','sha256','decodedBytes','decodedSha256']);
    if(entry.state!=='present'||entry.mediaType!==FILE_TYPES[name]||entry.encoding!==(name==='landuse_2m.u8z'?'gzip':'identity'))throw new Error('Invalid map asset representation.');
    for(const key of ['bytes','decodedBytes'])if(!Number.isSafeInteger(entry[key])||entry[key]<1||entry[key]>MAX_ASSET_BYTES)throw new Error('Asset byte bound exceeded.');
    if(!HASH.test(entry.sha256)||!HASH.test(entry.decodedSha256))throw new Error('Invalid asset digest.');
    if(entry.encoding==='identity'&&(entry.bytes!==entry.decodedBytes||entry.sha256!==entry.decodedSha256))throw new Error('Identity encoding mismatch.');
  }
  const present=name=>value.files[name].state==='present';
  if(present('landuse.json')!==present('landuse_2m.u8z'))throw new Error('Land cover descriptor/payload must agree.');
  if(present('vegetation.json')!==present('vegetation.bin'))throw new Error('Vegetation descriptor/payload must agree.');
  if(present('shell.json')!==present('shell.u16'))throw new Error('Shell descriptor/payload must agree.');
  if(present('shell-drape.json')!==present('shell-drape.jpg'))throw new Error('Shell imagery descriptor/payload must agree.');
  // ⚠️ A core has EITHER one drape OR four quadrants. Both would ship the same photograph twice
  // — 6.4 MB of it on the airfield core — and neither would leave the terrain unphotographed.
  const tiles=DRAPE_TILES.filter(present).length;
  if(tiles!==0&&tiles!==DRAPE_TILES.length)throw new Error('A tiled drape needs all four quadrants.');
  if(present('drape.jpg')===(tiles>0))throw new Error('A core has either one drape or four quadrants.');
  return value;
}
export function validateOrigin(value, allowLoopback=false) {
  const url=new URL(value);
  const loopback=url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&Boolean(url.port);
  const publicName = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) &&
    !/^(?:\d+\.){3}\d+$/.test(url.hostname) && !/(?:^|\.)(?:localhost|local|internal|test)$/i.test(url.hostname);
  if(url.origin!==value||url.username||url.password||url.search||url.hash||
    (!(url.protocol==='https:'&&!url.port&&publicName)&&!(allowLoopback&&loopback)))throw new Error('Invalid approved asset origin.');
  return url.origin;
}
export function externalBase(origin,releaseId,site='munich') {
  if(!HASH.test(releaseId))throw new Error('Invalid release digest.');
  if(!/^[a-z][a-z0-9-]{1,31}$/.test(site))throw new Error('Invalid core name.');
  return `${origin}/releases/${releaseId}/${site}`;
}