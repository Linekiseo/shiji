import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
export const isAndroid=()=>Capacitor.getPlatform()==='android';

export async function chooseNativeImages(source:'camera'|'upload'){
  if(source==='camera'){
    const photo=await Camera.getPhoto({source:CameraSource.Camera,resultType:CameraResultType.Uri,quality:90,correctOrientation:true,saveToGallery:false});
    if(!photo.webPath)throw new Error('没有获取到照片');
    return [await asFile(photo.webPath,`拍照-${Date.now()}.${photo.format}`)];
  }
  const result=await Camera.pickImages({quality:90,limit:12});
  return Promise.all(result.photos.map((photo,index)=>asFile(photo.webPath,`图片-${Date.now()}-${index+1}.${photo.format}`)));
}
async function asFile(path:string,name:string){const response=await fetch(path);if(!response.ok)throw new Error('图片读取失败');const blob=await response.blob();return new File([blob],name,{type:blob.type||'image/jpeg'});}

export async function download(name:string,body:string,type='text/plain'){
  if(Capacitor.isNativePlatform()){
    const result=await Filesystem.writeFile({path:`exports/${name}`,directory:Directory.Cache,data:body,encoding:Encoding.UTF8,recursive:true});
    await Share.share({title:name,files:[result.uri],dialogTitle:'保存或分享备份'});
    return;
  }
  const url=URL.createObjectURL(new Blob([body],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
