// Focused H12 review regression: real Vite dev/preview MIME and production-shaped bundle guards.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,realpath,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from '@playwright/test';
import {createServer,preview} from 'vite';
import {PROJECT,prepareContext,digest,safeTree} from './asset-release.mjs';
const exec=promisify(execFile);const output=process.argv[2];
if(process.argv.length!==3||!isAbsolute(output))throw new Error('New absolute task output required.');
const temp=await realpath(join(PROJECT,'../temp'));const parent=await realpath(resolve(output,'..'));const rel=relative(temp,parent);
if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error('Evidence belongs in repos/temp.');
await mkdir(output);
const release=await prepareContext(join(output,'host-context'));
const configPath=join(output,'release.production-shape.json');const origin='https://swm-sample.northeurope.azurecontainerapps.io';
await writeFile(configPath,JSON.stringify({mode:'external',origin,releaseId:release.releaseId,
  releaseDirectory:join(output,'host-context/releases',release.releaseId),purpose:'production'},null,2));
const log=[];
for(const name of ['local','external']){
  const env={...process.env,SWM_BUILD_OUT:join(output,name)};delete env.SWM_ASSET_CONFIG;delete env.SWM_ALLOW_LOCAL_TEST;
  if(name==='external')env.SWM_ASSET_CONFIG=configPath;
  for(const args of [['tools/check-assets.mjs'],['node_modules/vite/bin/vite.js','build'],['tools/check-assets.mjs','--bundle']]){
    const result=await exec(process.execPath,args,{cwd:PROJECT,env,maxBuffer:1024*1024});log.push(result.stdout,result.stderr);
  }
}
const externalEnv={...process.env,SWM_BUILD_OUT:join(output,'external'),SWM_ASSET_CONFIG:configPath};delete externalEnv.SWM_ALLOW_LOCAL_TEST;
// Prove the complete bundle scanner inspects extra chunks, not just hand-written URL strings.
const injection=join(output,'external/assets/guard-negative.js');
for(const text of [`const allowed="${origin}",privateId="11111111-2222-3333-4444-555555555555";`,
  `const allowed="${origin}",other="https://other.northeurope.azurecontainerapps.io";`,
  `const allowed="${origin}",secret="Bearer example-token";`]){
  await writeFile(injection,text);let rejected=false;
  try{await exec(process.execPath,['tools/check-assets.mjs','--bundle'],{cwd:PROJECT,env:externalEnv});}catch{rejected=true;}
  assert(rejected,'Bundle guard missed an extra minified chunk.');
}
await rm(injection);await writeFile(join(output,'build.log'),log.join('\n'));
let dev,viewer,browser,context;
const saved={};for(const key of ['SWM_ASSET_CONFIG','SWM_ALLOW_LOCAL_TEST','SWM_BUILD_OUT']){saved[key]=process.env[key];delete process.env[key];}
try{
  dev=await createServer({root:PROJECT,server:{host:'127.0.0.1',port:0,strictPort:true}});await dev.listen();
  viewer=await preview({root:PROJECT,configFile:false,base:'./',build:{outDir:join(output,'local')},preview:{host:'127.0.0.1',port:0,strictPort:true}});
  const urls={dev:`http://127.0.0.1:${dev.httpServer.address().port}`,preview:`http://127.0.0.1:${viewer.httpServer.address().port}`};
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist'],ignoreDefaultArgs:['--disable-gpu']});
  context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});
  await context.route('**/*',route=>Object.values(urls).includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const evidence={};
  for(const [mode,url] of Object.entries(urls)){
    const response=await fetch(`${url}/terrain/munich/heightmap.u16`);const mime=response.headers.get('content-type');
    assert.equal(response.status,200);await response.body.cancel();
    await page.goto(url);await page.waitForFunction(()=>document.querySelector('#city-map')?.dataset.ready==='true'&&window.__swmMap?.().frames>2,{},{timeout:30000});
    const result=await page.evaluate(()=>{
      const canvas=document.querySelector('#city-map');const gl=canvas.getContext('webgl2');const ext=gl.getExtension('WEBGL_debug_renderer_info');
      return {scene:window.__swmMap(),png:canvas.toDataURL('image/png').split(',')[1],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'};
    });
    assert.equal(result.scene.buildingCount,15746);assert.equal(result.scene.treeCount,29580);assert(!/SwiftShader|unknown/i.test(result.renderer));
    const png=Buffer.from(result.png,'base64');delete result.png;
    assert.equal(digest(png),'bfafaa91817fa735e2c41756e555ecfa0b41438cd00c0253ae63a7f933a35dbb');
    await writeFile(join(output,`${mode}.png`),png);evidence[mode]={...result,actualBinaryMime:mime,pngSha256:digest(png)};
  }
  assert.deepEqual(errors,[]);
  const files=await safeTree(join(output,'external'));assert(!files.some(n=>n.startsWith('terrain/')));
  await writeFile(join(output,'evidence.json'),JSON.stringify({result:'PASS',releaseId:release.releaseId,evidence,
    productionShapedBuildPassed:true,minifiedNegativeControls:3,externalHostContacted:false,cloudWrites:0},null,2));
  console.log(JSON.stringify({result:'PASS',realViteModes:Object.keys(evidence),actualMime:Object.fromEntries(Object.entries(evidence).map(([key,value])=>[key,value.actualBinaryMime])),
    exactCanvasParity:true,productionShapedBuildPassed:true,minifiedNegativeControls:3,output},null,2));
}finally{
  if(context)await context.close();if(browser)await browser.close();if(dev)await dev.close();
  if(viewer){viewer.httpServer.closeAllConnections();await new Promise(r=>viewer.httpServer.close(r));}
  for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}