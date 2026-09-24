import {validateManifest,HASH,FILE_TYPES,MAX_ASSET_BYTES,MAX_MANIFEST_BYTES} from './contract.mjs';

export class AssetError extends Error {
  constructor(code,name,detail=''){super(`${code}: ${name}${detail?` (${detail})`:''}`);this.name='AssetError';this.code=code;this.detail=detail;}
}
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function consume(stream,limit,signal,onBytes,idleMs,controller){
  if(!stream)throw new AssetError('body','asset');
  const reader=stream.getReader();const chunks=[];let received=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{
    for(;;){
      signal.throwIfAborted();let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new AssetError('body-timeout','asset',`${received} bytes`);reject(error);controller.abort(error);},idleMs);});
      let item;try{item=await Promise.race([reader.read(),timeout]);}finally{clearTimeout(timer);}
      signal.throwIfAborted();if(item.done)break;
      received+=item.value.length;if(received>limit)throw new AssetError('size','asset');chunks.push(item.value);onBytes?.(received);
    }
    const bytes=new Uint8Array(received);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
  }finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function verifiedFetch(url,entry,options={}){
  const {signal,onBytes,headerMs=20000,idleMs=20000,fetchImpl=fetch,allowMissingBinaryType=false}=options;
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason??new AssetError('cancelled','asset'));
  if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});
  const header=setTimeout(()=>controller.abort(new AssetError('header-timeout','asset')),headerMs);
  // Generous whole-operation bound, growing with declared payload rather than a short fixed download limit.
  const deadline=setTimeout(()=>controller.abort(new AssetError('deadline','asset')),Math.max(120000,entry.bytes/16384*1000));
  try{
    const response=await fetchImpl(url,{signal:controller.signal,credentials:'omit',mode:'cors',redirect:'error'});
    clearTimeout(header);
    if(!response.ok)throw new AssetError('http','asset',String(response.status));
    const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    // Local static servers may omit MIME for custom binary suffixes. Missing is
    // acceptable only in local mode for hash-bound binary data, never HTML/text.
    const missingLocalBinary=allowMissingBinaryType&&type===''&&entry.mediaType==='application/octet-stream';
    if(type!==entry.mediaType&&!missingLocalBinary)throw new AssetError('media-type','asset');
    const delivered=await consume(response.body,Math.max(entry.bytes,entry.decodedBytes),controller.signal,
      onBytes ? bytes=>onBytes(Math.min(bytes,entry.bytes)) : undefined,idleMs,controller);
    const isGzip=delivered[0]===31&&delivered[1]===139;
    let decoded=delivered;
    if(entry.encoding==='gzip'&&isGzip){
      if(delivered.length!==entry.bytes||await sha256(delivered)!==entry.sha256)throw new AssetError('integrity','asset');
      decoded=await consume(new Blob([delivered]).stream().pipeThrough(new DecompressionStream('gzip')),entry.decodedBytes,controller.signal,undefined,idleMs,controller);
    }else if(entry.encoding==='identity'&&(delivered.length!==entry.bytes||await sha256(delivered)!==entry.sha256))throw new AssetError('integrity','asset');
    if(decoded.length!==entry.decodedBytes||await sha256(decoded)!==entry.decodedSha256)throw new AssetError('integrity','asset');
    controller.signal.throwIfAborted();
    return decoded;
  }catch(error){
    controller.abort(error);
    if(error instanceof AssetError)throw error;
    if(signal?.aborted)throw new AssetError('cancelled','asset');
    if(controller.signal.reason instanceof AssetError)throw controller.signal.reason;
    throw new AssetError('network-or-decode','asset');
  }finally{clearTimeout(header);clearTimeout(deadline);signal?.removeEventListener('abort',abort);}
}
/**
 * A verifying reader for ONE core's assets.
 *
 * ⚠️ THE MANIFEST IS PER CORE, and getting this wrong is what the second core exposed. With a
 * single world-wide manifest the airfield's `heightmap.json` was checked against the Munich
 * descriptor's byte count, and the reader rejected it as oversized — a correct file failing a
 * correct check, because the check was pointed at the wrong core. Each core has its own manifest,
 * keyed by site id, and a site the binding does not know is refused rather than guessed at.
 */
export async function createAssetReader(binding,signal,siteId,localBase){
  if(typeof siteId!=='string'||!/^[a-z][a-z0-9-]{1,31}$/.test(siteId))throw new AssetError('configuration','site');
  let manifest;let base;
  if(binding.mode==='local'){
    const core=binding.cores?.[siteId];
    if(!core)throw new AssetError('unknown-core',siteId);
    manifest=validateManifest(core.manifest);
    base=localBase??`./terrain/${siteId}`;
  }
  else if(binding.mode==='external'&&HASH.test(binding.releaseId)){
    // ⚠️ DELIBERATELY NOT IMPLEMENTED RATHER THAN HALF-IMPLEMENTED. External hosting was designed
    // around one core and one manifest at the release root. A two-core world needs a manifest per
    // core and a release layout to match, and that is a hosting decision with a cost attached
    // (see docs/MAP-ASSET-HOSTING-PLAN.md) rather than something to improvise here. Failing
    // loudly is better than fetching a manifest that cannot describe what is being read.
    throw new AssetError('external-multi-core',siteId,'external hosting still describes a single core');
  }else throw new AssetError('configuration','manifest');
  const entry=name=>{if(!Object.hasOwn(FILE_TYPES,name))throw new AssetError('unlisted','asset');return manifest.files[name];};
  return {manifest,signal,site:siteId,has:name=>entry(name).state==='present',size:name=>entry(name).bytes??0,
    async bytes(name,onBytes){
      const record=entry(name);if(record.state==='absent')return null;
      try{return await verifiedFetch(`${base}/${name}`,record,{signal,onBytes,allowMissingBinaryType:binding.mode==='local'});}
      catch(error){throw new AssetError(error.code??'load',name,error.detail??'');}
    },
    async json(name){const data=await this.bytes(name);return data===null?null:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));},
  };
}