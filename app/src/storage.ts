import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

type Snapshot = { version:1; slots:Record<string,unknown> };
const Store = registerPlugin<{ read():Promise<{json:string|null}>; write(options:{json:string}):Promise<void> }>('ShijiStore');
let cache:Record<string,unknown>={};
let database:IDBDatabase;
let queue=Promise.resolve();
const mediaCache=new Map<string,string>();
const native=()=>Capacitor.isNativePlatform();
const safeFile=(value:string)=>/^media\/[a-f0-9-]+\.(png|jpg|webp|gif|webm|ogg|mp4|bin)$/.test(value);

async function externalize(value:unknown):Promise<unknown> {
  if(Array.isArray(value))return Promise.all(value.map(externalize));
  if(!value||typeof value!=='object')return value;
  const object=value as Record<string,unknown>;
  if((object.kind==='photo'||object.kind==='audio')&&typeof object.src==='string'&&object.src.startsWith('data:')){
    let file=mediaCache.get(object.src);
    if(!file){
      const match=object.src.match(/^data:([^;,]+)(?:;codecs=[^;,]+)?;base64,(.+)$/s);if(!match)throw new Error('Invalid media');
      const ext:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4'};
      file=`media/${crypto.randomUUID()}.${ext[match[1]]??'bin'}`;
      await Filesystem.writeFile({path:file,directory:Directory.Data,data:match[2],recursive:true});
      mediaCache.set(object.src,file);
    }
    return {...object,src:undefined,file,mime:object.src.slice(5).split(';')[0]};
  }
  return Object.fromEntries(await Promise.all(Object.entries(object).map(async([key,entry])=>[key,await externalize(entry)])));
}
async function hydrate(value:unknown):Promise<unknown>{
  if(Array.isArray(value))return Promise.all(value.map(hydrate));
  if(!value||typeof value!=='object')return value;
  const object=value as Record<string,unknown>;
  if((object.kind==='photo'||object.kind==='audio')&&typeof object.file==='string'){
    if(!safeFile(object.file))throw new Error('Invalid media path');
    const {uri}=await Filesystem.getUri({path:object.file,directory:Directory.Data});
    return {...object,src:Capacitor.convertFileSrc(uri)};
  }
  return Object.fromEntries(await Promise.all(Object.entries(object).map(async([key,entry])=>[key,await hydrate(entry)])));
}

export async function initializeStorage(){
  let saved:Snapshot|undefined;
  if(native()){
    const {json}=await Store.read();if(json)saved=JSON.parse(json);
  }else{
    database=await new Promise((resolve,reject)=>{const req=indexedDB.open('shiji',1);req.onupgradeneeded=()=>req.result.createObjectStore('state');req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve(req.result);});
    saved=await new Promise((resolve,reject)=>{const req=database.transaction('state').objectStore('state').get('snapshot');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  }
  if(saved){if(saved.version!==1||!saved.slots||typeof saved.slots!=='object')throw new Error('Unsupported storage');cache=(native()?await hydrate(saved.slots):saved.slots) as Record<string,unknown>;}
}
export function readSlot<T>(key:string,fallback:T):T{return (cache[key]??fallback) as T;}
export function persistSlot(key:string,value:unknown){
  cache={...cache,[key]:value};
  const snapshot={...cache};
  queue=queue.catch(()=>{}).then(async()=>{
    const saved:Snapshot={version:1,slots:(native()?await externalize(snapshot):snapshot) as Record<string,unknown>};
    if(native())await Store.write({json:JSON.stringify(saved)});
    else await new Promise<void>((resolve,reject)=>{const tx=database.transaction('state','readwrite');tx.objectStore('state').put(saved,'snapshot');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  });
  queue.catch(()=>window.dispatchEvent(new CustomEvent('shiji-storage-error',{detail:'本次更改未能写入存储，请保留当前页面并导出备份。'})));
  return queue;
}
export const flushStorage=()=>queue;

export async function portableBackup(value:unknown):Promise<unknown>{
  if(Array.isArray(value))return Promise.all(value.map(portableBackup));
  if(!value||typeof value!=='object')return value;
  const object=value as Record<string,unknown>;
  if((object.kind==='photo'||object.kind==='audio')&&typeof object.src==='string'){
    const {file,...rest}=object;
    if(object.src.startsWith('data:'))return rest;
    if(typeof file!=='string'||!safeFile(file))throw new Error('Invalid backup media');
    const {data}=await Filesystem.readFile({path:file,directory:Directory.Data});
    const mime=object.mime??(object.kind==='audio'?'audio/webm':'image/jpeg');
    const src=`data:${mime};base64,${data}`;
    return {...rest,src};
  }
  return Object.fromEntries(await Promise.all(Object.entries(object).map(async([key,entry])=>[key,await portableBackup(entry)])));
}
