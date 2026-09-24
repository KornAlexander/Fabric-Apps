// Three local journeys: unchanged-frame parity, required-payload corruption, mid-load cancellation.
// Runs the actual build gates and staged Node host. No Docker, Azure or authenticated browser.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from '@playwright/test';
import {PROJECT,prepareContext,digest,safeTree} from './asset-release.mjs';
import {FILE_TYPES} from '../src/assets/contract.mjs';
const exec=promisify(execFile);
const output=process.argv[2];
if(process.argv.length!==3||!isAbsolute(output))throw new Error('New absolute task output required.');
const temp=await realpath(join(PROJECT,'../temp'));const parent=await realpath(resolve(output,'..'));const rel=relative(temp,parent);
if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error('Browser evidence belongs in repos/temp.');
await mkdir(output);
const protectedBefore={};
for(const tree of ['public','dist','rayfin'])for(const name of await safeTree(join(PROJECT,tree))){
  // Hash only. Never copy or print private deployment file contents.
  protectedBefore[`${tree}/${name}`]=digest(await readFile(join(PROJECT,tree,name)));
}
const release=await prepareContext(join(output,'host-context'));
const {createAssetHost}=await import(pathToFileURL(join(output,'host-context/server.mjs')));
const files=new Map();const errors=[];const requests=[];let mode='normal';let cancelGate;let releaseDrape;
const app=createServer(async(req,res)=>{
  const path=req.url.split('?')[0];const file=files.get(path);
  if(!file){res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found');return;}
  const bytes=await readFile(file);const type=FILE_TYPES[path.split('/').at(-1)]??({'.html':'text/html','.js':'application/javascript','.css':'text/css','.txt':'text/plain','.json':'application/json'}[extname(file)]??'application/octet-stream');
  res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store'}).end(bytes);
});
let host,browser,context;
try{
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const appOrigin=`http://127.0.0.1:${app.address().port}`;
  host=await createAssetHost({root:join(output,'host-context/releases'),origins:[appOrigin]});
  await new Promise(r=>host.server.listen(0,'127.0.0.1',r));const assetOrigin=`http://127.0.0.1:${host.server.address().port}`;
  const configPath=join(output,'release.local-test.json');
  await writeFile(configPath,JSON.stringify({mode:'external',origin:assetOrigin,releaseId:release.releaseId,
    releaseDirectory:join(output,'host-context/releases',release.releaseId),purpose:'local-test'},null,2));
  const log=[];
  for(const name of ['local','external']){
    const env={...process.env,SWM_BUILD_OUT:join(output,name)};
    delete env.SWM_ASSET_CONFIG;delete env.SWM_ALLOW_LOCAL_TEST;
    if(name==='external'){env.SWM_ASSET_CONFIG=configPath;env.SWM_ALLOW_LOCAL_TEST='1';}
    for(const args of [['tools/check-assets.mjs'],['node_modules/vite/bin/vite.js','build'],['tools/check-assets.mjs','--bundle']]){
      const result=await exec(process.execPath,args,{cwd:PROJECT,env,maxBuffer:1024*1024});log.push(result.stdout,result.stderr);
    }
  }
  await writeFile(join(output,'build.log'),log.join('\n'));
  for(const name of ['baseline','local','external']){
    const root=name==='baseline'?join(PROJECT,'dist'):join(output,name);
    for(const file of await safeTree(root))files.set(`/${name}/${file}`,join(root,file));
  }
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist'],ignoreDefaultArgs:['--disable-gpu']});
  context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1,colorScheme:'dark'});
  // All traffic must stay on these two task-owned loopback servers.
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(![appOrigin,assetOrigin].includes(url.origin)){errors.push('Unexpected external request');return route.abort();}
    if(url.origin===assetOrigin&&url.pathname.endsWith('/drape.jpg')){
      if(mode==='corrupt'){
        const response=await route.fetch();const body=await response.body();body[20]^=1;
        return route.fulfill({response,body});
      }
      if(mode==='cancel'){
        await cancelGate;return route.abort('aborted');
      }
    }
    return route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(request.url()));
  const captures={};
  for(const name of ['baseline','local','external']){
    const begin=requests.length;const started=performance.now();
    await page.goto(`${appOrigin}/${name}/index.html`);
    await page.waitForFunction(()=>document.querySelector('#city-map')?.dataset.ready==='true'&&window.__swmMap?.().frames>2);
    const scene=await page.evaluate(()=>window.__swmMap());
    assert.equal(scene.buildingCount,15746);assert.equal(scene.treeCount,29580);assert.equal(scene.rastersShareOrientation,true);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    const pixels=await page.evaluate(async()=>{
      const canvas=document.querySelector('#city-map');const gl=canvas.getContext('webgl2');
      const data=new Uint8Array(64*64*4);gl.readPixels(gl.drawingBufferWidth/2-32,gl.drawingBufferHeight/2-32,64,64,gl.RGBA,gl.UNSIGNED_BYTE,data);
      const colours=new Set();let bright=0;
      for(let i=0;i<data.length;i+=4){colours.add((data[i]<<16)|(data[i+1]<<8)|data[i+2]);if(data[i]+data[i+1]+data[i+2]>90)bright++;}
      const ext=gl.getExtension('WEBGL_debug_renderer_info');
      return {png:canvas.toDataURL('image/png').split(',')[1],colours:colours.size,bright,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'};
    });
    assert(pixels.colours>100&&pixels.bright>1000);assert(!/SwiftShader|software|unknown/i.test(pixels.renderer));
    const png=Buffer.from(pixels.png,'base64');await writeFile(join(output,`${name}.png`),png);
    delete pixels.png;const traffic=requests.slice(begin).map(url=>({origin:new URL(url).origin,path:new URL(url).pathname}));
    const assets=traffic.filter(v=>v.origin===assetOrigin);
    if(name==='external'){
      assert.equal(assets.length,17);assert(assets[0].path.endsWith('/manifest.json'));
      assert(assets.every(a=>a.path.startsWith(`/releases/${release.releaseId}/`)));
      assert(!traffic.some(v=>v.path.includes('/terrain/')));
      assert(!assets.some(v=>v.path.endsWith('heightmap_nodata.u8')));
    }else assert.equal(assets.length,0);
    captures[name]={scene,...pixels,pngSha256:digest(png),readyMs:performance.now()-started,requests:traffic};
  }
  assert.equal(captures.local.pngSha256,captures.baseline.pngSha256,'Local loader changed rendered pixels.');
  assert.equal(captures.external.pngSha256,captures.baseline.pngSha256,'External loader changed rendered pixels.');
  // One navigation interaction on the external mode, then the explicit failure journeys.
  await page.locator('#city-map').focus();await page.keyboard.down('w');
  try{await page.waitForFunction(()=>window.__swmMap().flying&&Math.abs(window.__swmMap().camera[2]-window.__swmMap().target[2])<1090);}finally{await page.keyboard.up('w');}
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Reset map view'}).click();
  await page.waitForFunction(()=>Math.abs(window.__swmMap().heading)<0.001);
  mode='corrupt';await page.goto(`${appOrigin}/external/index.html`);await page.getByRole('alert').waitFor({state:'visible'});
  assert.notEqual(await page.locator('#city-map').getAttribute('data-ready'),'true');assert.equal(await page.evaluate(()=>Boolean(window.__swmMap)),false);
  mode='cancel';cancelGate=new Promise(r=>{releaseDrape=r;});
  const reached=page.waitForRequest(request=>request.url()===`${assetOrigin}/releases/${release.releaseId}/munich/drape.jpg`);
  await page.goto(`${appOrigin}/external/index.html`);await reached;
  await page.locator('#city-map').dispatchEvent('webglcontextlost');await page.getByRole('alert').waitFor({state:'visible'});
  releaseDrape();
  assert.notEqual(await page.locator('#city-map').getAttribute('data-ready'),'true');assert.equal(await page.evaluate(()=>Boolean(window.__swmMap)),false);
  assert.deepEqual(errors,[]);
  for(const [path,hash] of Object.entries(protectedBefore))assert.equal(digest(await readFile(join(PROJECT,path))),hash,`Protected file changed: ${path}`);
  const bundleSize={};for(const name of ['local','external'])bundleSize[name]=(await Promise.all((await safeTree(join(output,name))).map(async p=>(await stat(join(output,name,p))).size))).reduce((a,b)=>a+b,0);
  const evidence={release,captures,bundleSize,host:{...host.metrics,rssAtEndBytes:process.memoryUsage().rss},
    checks:{exactCanvasParity:true,externalRequestCount:17,requiredCorruptionFails:true,cancellationNoReady:true,protectedFiles:Object.keys(protectedBefore).length},
    limitations:['Loopback HTTP only','No Docker image or constrained container measurement','No Azure/Fabric ingress, TLS, CSP or iframe proof','No citywide tile loading'],cloudWrites:0};
  await writeFile(join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({result:'PASS',releaseId:release.releaseId,bundleSize,host:host.metrics,checks:evidence.checks,output},null,2));
}finally{
  releaseDrape?.();
  if(context)await context.close();if(browser)await browser.close();if(host)await host.close();
  app.closeAllConnections();if(app.listening)await new Promise(r=>app.close(r));
}