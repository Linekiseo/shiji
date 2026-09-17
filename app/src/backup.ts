const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown)=>typeof v==='string';
const status=(v:unknown)=>['todo','doing','done'].includes(String(v));
const date=(v:unknown)=>text(v)&&!Number.isNaN(Date.parse(v as string));
const uniqueIds=(list:Record<string,unknown>[])=>new Set(list.map(value=>value.id)).size===list.length;
export function isValidBackup(data:unknown):boolean{
  if(!record(data)||data.version!==1||!Array.isArray(data.items)||data.items.length>100000)return false;
  const items=data.items;
  if(!items.every((work:unknown)=>{
    if(!record(work)||!text(work.id)||!text(work.title)||!text(work.description)||!text(work.tag)||!date(work.createdAt)||!status(work.status))return false;
    if(!Array.isArray(work.entries)||!work.entries.length||!work.entries.every((entry:unknown)=>{
      if(!record(entry)||!text(entry.id)||!date(entry.at)||!text(entry.text)||!status(entry.status)||!['created','progress','status','done','reopened','edited'].includes(String(entry.kind)))return false;
      if(entry.attachments!==undefined&&(!Array.isArray(entry.attachments)||!entry.attachments.every((asset:unknown)=>record(asset)&&text(asset.id)&&text(asset.name)&&['photo','audio'].includes(String(asset.kind))&&text(asset.src)&&/^data:(image\/(png|jpeg|webp|gif)|audio\/[a-z0-9.+-]+)(;codecs=[^;,]+)?;base64,[A-Za-z0-9+/=\s]+$/i.test(asset.src as string))))return false;
      return true;
    })||!uniqueIds(work.entries))return false;
    if(work.subtasks!==undefined&&(!Array.isArray(work.subtasks)||!work.subtasks.every((child:unknown)=>record(child)&&text(child.id)&&text(child.title)&&status(child.status)&&date(child.createdAt)&&child.subtasks===undefined)||!uniqueIds(work.subtasks)))return false;
    const ids=new Set((work.subtasks as Record<string,unknown>[]|undefined)?.map(child=>child.id));
    return work.entries.every((entry:Record<string,unknown>)=>entry.subtaskId===undefined||ids.has(entry.subtaskId));
  })||!uniqueIds(items))return false;
  return data.categories===undefined||Array.isArray(data.categories);
}
