import {readFile,realpath} from 'node:fs/promises';
import {resolve,isAbsolute,relative,sep} from 'node:path';
import {PROJECT,inspectCore,manifestBytes,digest,validateRelease} from './asset-release.mjs';
import {assertKeys,validateOrigin,HASH,externalBase} from '../src/assets/contract.mjs';

/**
 * The cores this world ships, in the order the app loads them.
 *
 * ⚠️ DUPLICATED FROM src/config/world.ts ON PURPOSE, and it is the smaller evil. This module
 * runs in the Vite config, before any TypeScript is compiled, so it cannot import the app's own
 * list. `npm test` asserts the two agree, which turns the duplication into a checked fact rather
 * than a thing to remember.
 */
export const CORES = ['munich','flughafen'];

export async function buildAssetConfig(env=process.env){
  if(!env.SWM_ASSET_CONFIG){
    const cores={};
    for(const id of CORES){
      const manifest=await inspectCore(resolve(PROJECT,`public/terrain/${id}`));
      cores[id]={manifest,releaseId:digest(manifestBytes(manifest))};
    }
    return {mode:'local',binding:{mode:'local',cores},origin:null,releaseDirectory:null};
  }
  if(!isAbsolute(env.SWM_ASSET_CONFIG))throw new Error('Absolute asset configuration path required.');
  const path=await realpath(env.SWM_ASSET_CONFIG);const temp=await realpath(resolve(PROJECT,'../temp'));
  const allowed=path===resolve(PROJECT,'deploy/asset-host/release.local.json')||(!relative(temp,path).startsWith('..')&&!isAbsolute(relative(temp,path)));
  if(!allowed)throw new Error('Use private release configuration or task temp config.');
  const config=JSON.parse(await readFile(path,'utf8'));
  assertKeys(config,['mode','origin','releaseId','releaseDirectory','purpose']);
  if(config.mode!=='external'||!['production','local-test'].includes(config.purpose)||!HASH.test(config.releaseId))throw new Error('Invalid external build configuration.');
  const localTest=config.purpose==='local-test'&&env.SWM_ALLOW_LOCAL_TEST==='1';
  if(config.purpose==='local-test'&&!localTest)throw new Error('Local-test build requires explicit opt-in.');
  validateOrigin(config.origin,localTest);
  if(!isAbsolute(config.releaseDirectory))throw new Error('Absolute validated release directory required.');
  await validateRelease(config.releaseDirectory,config.releaseId);
  return {mode:'external',origin:config.origin,releaseDirectory:config.releaseDirectory,
    binding:{mode:'external',origin:config.origin,releaseId:config.releaseId,
      bases:Object.fromEntries(CORES.map(id=>[id,externalBase(config.origin,config.releaseId,id)]))}};
}
export async function buildOutput(env=process.env){
  if(!env.SWM_BUILD_OUT)return resolve(PROJECT,'dist');
  if(!isAbsolute(env.SWM_BUILD_OUT))throw new Error('Absolute output required.');
  const temp=await realpath(resolve(PROJECT,'../temp'));const path=resolve(env.SWM_BUILD_OUT);const rel=relative(temp,path);
  if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error('Alternate builds belong in repos/temp.');
  const parent=await realpath(resolve(path,'..'));const actual=relative(temp,parent);
  if(actual==='..'||actual.startsWith(`..${sep}`)||isAbsolute(actual))throw new Error('Linked output escapes task temp.');
  // Vite can empty output. Only a fresh directory is permitted for alternative builds.
  try{await realpath(path);throw new Error('Alternate output already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
  return path;
}