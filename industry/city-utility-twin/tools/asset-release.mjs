import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,readdir,realpath,writeFile,copyFile} from 'node:fs/promises';
import {resolve,relative,join,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {MAP_FILES,FILE_TYPES,OPTIONAL_FILES,MAX_ASSET_BYTES,MAX_MANIFEST_BYTES,assetRole,validateManifest} from '../src/assets/contract.mjs';
import {inheritedName,privateCoordinate} from './map-assets.mjs';
export const PROJECT=fileURLToPath(new URL('../',import.meta.url));
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const manifestBytes=manifest=>Buffer.from(JSON.stringify(validateManifest(manifest)));

export async function safeTree(root){
  const resolved=await realpath(root);
  if((await lstat(root)).isSymbolicLink())throw new Error('Linked input root rejected.');
  const files=[];
  async function walk(path){
    for(const entry of await readdir(path,{withFileTypes:true})){
      const absolute=join(path,entry.name);const info=await lstat(absolute);
      if(info.isSymbolicLink())throw new Error('Asset links rejected.');
      if(info.isDirectory())await walk(absolute);
      else if(info.isFile())files.push(relative(resolved,absolute).split(sep).join('/'));
      else throw new Error('Unsupported file type.');
      if(files.length>1000)throw new Error('H12 file bound exceeded.');
    }
  }
  await walk(resolved);return files.sort();
}
export async function privateValues(){
  const path=join(PROJECT,'deploy/asset-host/target.local.json');
  try{
    const c=JSON.parse(await readFile(path,'utf8'));
    return [c.tenantId,c.subscriptionId,c.resourceGroup,c.environmentName,c.registryName,c.proposedIdentityName,
      c.fabric?.workspaceId,c.fabric?.itemId,c.fabric?.folderId].filter(v=>typeof v==='string'&&v.length>4);
  }catch(error){if(error.code==='ENOENT')return [];throw error;}
}
export function checkText(text,secrets=[]){
  if(inheritedName.test(text)||privateCoordinate.test(text)||secrets.some(v=>text.toLowerCase().includes(v.toLowerCase())))throw new Error('Unapproved map release text/identity.');
}
export async function inspectCore(folder){
  const names=await safeTree(folder);
  // ⚠️ SUBSET, NOT EQUALITY. The allowlist is the union of what any core may contain; a given
  // core legitimately holds only part of it. What must still hold is that it contains nothing
  // ELSE — an unlisted file in an asset directory is either a build artefact that should not
  // ship or something that has no business being published.
  const unlisted=names.filter(name=>!MAP_FILES.includes(name));
  if(unlisted.length)throw new Error(`Unlisted core file: ${unlisted.join(', ')}`);
  const secrets=await privateValues();const files={};const json={};
  for(const name of MAP_FILES){
    const role=assetRole(name);
    if(!names.includes(name)){
      if(!OPTIONAL_FILES.includes(name))throw new Error(`Required core file missing: ${name}`);
      files[name]={state:'absent',role};
      continue;
    }
    const path=join(folder,name);const info=await lstat(path);
    if(info.size<1||info.size>MAX_ASSET_BYTES)throw new Error('Asset size outside the core bound.');
    const bytes=await readFile(path);
    if(name.endsWith('.json')){checkText(bytes.toString('utf8'),secrets);json[name]=JSON.parse(bytes.toString('utf8'));}
    if(name.endsWith('.jpg')&&(bytes[0]!==255||bytes[1]!==216))throw new Error('Invalid JPEG signature.');
    const decoded=name==='landuse_2m.u8z'?gunzipSync(bytes,{maxOutputLength:MAX_ASSET_BYTES}):bytes;
    files[name]={state:'present',role,mediaType:FILE_TYPES[name],encoding:name==='landuse_2m.u8z'?'gzip':'identity',
      bytes:bytes.length,sha256:digest(bytes),decodedBytes:decoded.length,decodedSha256:digest(decoded)};
  }
  // ⚠️ EVERY CHECK BELOW IS DERIVED FROM THE DESCRIPTORS THEMSELVES, not from constants for one
  // site. The previous version asserted 1627 x 1971 cells, 15 746 buildings and 29 580 trees —
  // true of the Munich core and of nothing else, so a second core could not pass it at all. What
  // is worth checking is not the numbers but the AGREEMENT: a descriptor that claims a grid the
  // payload cannot contain is a real fault, at any site.
  const t=json['heightmap.json'];const b=json['buildings_lod2.json'];
  const v=json['vegetation.json'];const s=json['shell.json'];const l=json['landuse.json'];
  if(!t||!Number.isSafeInteger(t.width)||!Number.isSafeInteger(t.height)||t.width<1||t.height<1||
    t.crs!=='EPSG:25832'||!(t.resolutionM>0)||!Number.isFinite(t.origin?.easting)||!Number.isFinite(t.origin?.northing))
    throw new Error('Unexpected core grid.');
  if(!b||!Number.isSafeInteger(b.count)||b.count<1||b.buildings?.length!==b.count)throw new Error('Unexpected building index.');
  const expected={
    'heightmap.u16':t.width*t.height*2,'heightmap_nodata.u8':t.width*t.height,
    'buildings_lod2.bin':b.vertexCount*6,'buildings_colour.bin':b.count*4};
  if(s)expected['shell.u16']=s.width*s.height*2;
  if(v){
    if(!Number.isSafeInteger(v.count)||!Number.isSafeInteger(v.stride)||v.stride<1)throw new Error('Unexpected vegetation index.');
    expected['vegetation.bin']=v.count*v.stride;
  }
  for(const [name,length] of Object.entries(expected)){
    if(files[name].state!=='present')continue;
    if(files[name].bytes!==length)throw new Error(`Map descriptor and payload length disagree: ${name}`);
  }
  if(l&&files['landuse_2m.u8z'].decodedBytes!==l.width*l.height)throw new Error('Invalid land cover payload shape.');
  if(files['buildings_roof_spans.bin'].state==='present'&&files['buildings_roof_spans.bin'].bytes%7)throw new Error('Invalid auxiliary payload shape.');
  return validateManifest({schemaVersion:1,profile:'muenchen-zwilling-core-v1',files});
}
export async function validateRelease(path,releaseId){
  const info=await lstat(join(path,'manifest.json'));
  if(info.isSymbolicLink()||!info.isFile()||info.size>MAX_MANIFEST_BYTES)throw new Error('Invalid manifest file.');
  const raw=await readFile(join(path,'manifest.json'));
  if(digest(raw)!==releaseId)throw new Error('Release manifest hash mismatch.');
  const manifest=validateManifest(JSON.parse(raw));
  if((await safeTree(path)).join('|')!==['manifest.json',...MAP_FILES.map(n=>'munich/'+n)].sort().join('|'))throw new Error('Unlisted release file.');
  const actual=await inspectCore(join(path,'munich'));
  if(!manifestBytes(actual).equals(raw))throw new Error('Release payloads do not match manifest.');
  return manifest;
}
export async function prepareContext(output){
  if(!isAbsolute(output))throw new Error('Absolute task output required.');
  const temp=await realpath(join(PROJECT,'../temp'));const parent=await realpath(resolve(output,'..'));
  const rel=relative(temp,parent);if(isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`)||resolve(output)===temp)throw new Error('Context must be below repos/temp.');
  const manifest=await inspectCore(join(PROJECT,'public/terrain/munich'));
  const raw=manifestBytes(manifest);const releaseId=digest(raw);
  await mkdir(output);
  const release=join(output,'releases',releaseId);await mkdir(join(release,'munich'),{recursive:true});
  for(const name of MAP_FILES)await copyFile(join(PROJECT,'public/terrain/munich',name),join(release,'munich',name));
  await writeFile(join(release,'manifest.json'),raw,{flag:'wx'});
  await validateRelease(release,releaseId);
  await copyFile(join(PROJECT,'deploy/asset-host/server.mjs'),join(output,'server.mjs'));
  await copyFile(join(PROJECT,'src/assets/contract.mjs'),join(output,'contract.mjs'));
  for(const name of ['Dockerfile','.dockerignore'])await copyFile(join(PROJECT,'deploy/asset-host',name),join(output,name));
  await copyFile(join(PROJECT,'LICENSE'),join(output,'LICENSE'));
  await copyFile(join(PROJECT,'public/THIRD-PARTY-NOTICES.txt'),join(output,'THIRD-PARTY-NOTICES.txt'));
  return {releaseId,manifestSha256:releaseId,storedAssetBytes:Object.values(manifest.files).reduce((sum,f)=>sum+f.bytes,0),
    context:output,imageBuilt:false,cloudWrites:0};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)throw new Error('Usage: prepare-assets <new-absolute-temp-context>');
  console.log(JSON.stringify(await prepareContext(process.argv[2]),null,2));
}