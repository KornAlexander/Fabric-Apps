import {readFile,readdir,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildAssetConfig,CORES} from './asset-build-config.mjs';
import {PROJECT,inspectCore,privateValues,safeTree} from './asset-release.mjs';
import {inheritedName,privateCoordinate,withoutApprovedOrigin,withoutApprovedRelay,withoutVendorSymbols,withoutApprovedFabricIds,withoutApprovedPlaceNames,configWithoutHostingRedirect} from './map-assets.mjs';
const bundle=process.argv.includes('--bundle');
if(process.argv.slice(2).some(v=>v!=='--bundle'))throw new Error('Unknown asset check argument.');
const config=await buildAssetConfig();
const out=resolve(process.env.SWM_BUILD_OUT??join(PROJECT,'dist'));
const secrets=await privateValues();
if(config.mode==='local'){
  const root=join(bundle?out:join(PROJECT,'public'),'terrain');
  // ⚠️ EXACT SET, BOTH WAYS. An extra directory under terrain/ is an unapproved payload being
  // published; a missing one is a core the app will fail to load at runtime. The world's core
  // list is the single source of truth for both.
  const present=(await readdir(root)).sort().join('|');
  if(present!==[...CORES].sort().join('|'))throw new Error(`Unapproved map directory set: ${present}`);
  const manifests={};
  for(const id of CORES)manifests[id]=await inspectCore(join(root,id));

  // ⚠️ PER-SITE REQUIREMENTS, BECAUSE THE CONTRACT ALONE CANNOT EXPRESS THEM.
  //
  // Generalising the asset contract from one core to two necessarily made vegetation, the shell
  // and the single-drape form optional — the airfield core has no tree data and the city core no
  // longer carries its own shell. But "optional in the format" is not "optional in this app":
  // src/config/world.ts declares `hasVegetation: true` for Munich and the scene throws if it is
  // missing, and exactly one core must hold the world shell. Deleting Munich's two vegetation
  // files would otherwise pass every gate here and fail at runtime in front of an audience.
  const world=await readFile(join(PROJECT,'src/config/world.ts'),'utf8');
  const shellSite=(world.match(/WORLD_SHELL_SITE\s*=\s*'([a-z0-9-]+)'/)??[])[1];
  if(!shellSite||!CORES.includes(shellSite))throw new Error('WORLD_SHELL_SITE does not name a shipped core.');
  for(const name of ['shell.json','shell.u16','shell-drape.json','shell-drape.jpg']){
    if(manifests[shellSite].files[name].state!=='present')throw new Error(`World shell core ${shellSite} is missing ${name}.`);
  }
  const vegetation=[...world.matchAll(/id:\s*'([a-z0-9-]+)',[\s\S]*?hasVegetation:\s*(true|false)/g)]
    .reduce((all,[,id,flag])=>({...all,[id]:flag==='true'}),{});
  for(const id of CORES){
    const declared=vegetation[id]===true;
    const shipped=manifests[id].files['vegetation.bin'].state==='present';
    if(declared!==shipped)throw new Error(`Core ${id}: world.ts says hasVegetation=${declared}, assets say ${shipped}.`);
  }
}else if(bundle){
  const files=await safeTree(out);
  if(files.some(n=>n.startsWith('terrain/')||n.endsWith('.bin')||n.endsWith('.jpg')||n.endsWith('.u16')||n.endsWith('.u8z')))throw new Error('External build contains map payloads.');
  if(!files.includes('LICENSE.txt')||!files.includes('THIRD-PARTY-NOTICES.txt'))throw new Error('External build missing legal notices.');
  const scripts=files.filter(n=>n.endsWith('.js'));
  if(!scripts.length)throw new Error('Empty external build.');
  const combined=(await Promise.all(scripts.map(n=>readFile(join(out,n),'utf8')))).join('\n');
  if(!combined.includes(config.binding.releaseId)||!combined.includes(config.origin)
    ||!Object.values(config.binding.bases).every(base=>combined.includes(base)))throw new Error('Compiled external binding absent.');
}
let checked=0;
async function scan(path){
  const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Linked build content rejected.');
  if(info.isDirectory()){for(const name of await readdir(path))await scan(join(path,name));return;}
  if(!/\.(?:html|css|ts|mjs|js|json|yml)$/.test(path))return;
  const raw=await readFile(path,'utf8');
  // The ADS-B relay is a deliberately public endpoint the browser must know about; see
  // APPROVED_RELAY_ORIGIN. Every other deployment coordinate still fails.
  const text=withoutApprovedPlaceNames(withoutApprovedFabricIds(withoutVendorSymbols(withoutApprovedRelay(withoutApprovedOrigin(path.endsWith('rayfin.yml')?configWithoutHostingRedirect(raw):raw,config.origin,config.binding.releaseId)))),path);
  if(inheritedName.test(text)||privateCoordinate.test(text)||secrets.some(v=>text.toLowerCase().includes(v.toLowerCase())))throw new Error(`Unapproved application text: ${path}`);
  checked++;
}
if(bundle)await scan(out);
else for(const name of ['src','index.html','package.json','rayfin/rayfin.yml'])await scan(join(PROJECT,name));
console.log(`Asset gate passed: ${config.mode}, ${bundle?'bundle':'source'}, ${checked} text files; cores ${CORES.join(', ')}.`);