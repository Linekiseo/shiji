import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {Resvg} from '@resvg/resvg-js';
const root=new URL('../../',import.meta.url), res=new URL('app/android/app/src/main/res/',root);
const svg=await readFile(new URL('branding/icon.svg',root),'utf8');
await copyFile(new URL('branding/icon.svg',root),new URL('app/public/icon.svg',root));
await writeFile(new URL('branding/icon.png',root),new Resvg(svg).render().asPng());
for(const [density,size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]){
 const folder=new URL(`mipmap-${density}/`,res);await mkdir(folder,{recursive:true});
 const png=new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng();
 for(const name of ['ic_launcher','ic_launcher_round'])await writeFile(new URL(`${name}.png`,folder),png);
}
const foreground=`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="512" android:viewportHeight="512"><path android:pathData="M151,278 L220,345 L367,178" android:strokeColor="#F2FDFF" android:strokeWidth="48" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000"/><path android:pathData="M172,205 A18,18 0,1 1,136 205 A18,18 0,1 1,172 205 M188,144 A12,12 0,1 1,164 144 A12,12 0,1 1,188 144" android:fillColor="#E8FAFF"/></vector>`;
const background=`<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" android:width="108dp" android:height="108dp" android:viewportWidth="512" android:viewportHeight="512"><path android:pathData="M0,0 H512 V512 H0 Z"><aapt:attr name="android:fillColor"><gradient android:startX="0" android:startY="0" android:endX="512" android:endY="512"><item android:offset="0" android:color="#3978EE"/><item android:offset="0.55" android:color="#258BCF"/><item android:offset="1" android:color="#37B8B6"/></gradient></aapt:attr></path><path android:pathData="M0,0 H512 V189 C402,113 352,314 170,288 C77,275 71,358 0,375 Z" android:fillColor="#22FFFFFF"/></vector>`;
await writeFile(new URL('drawable/ic_launcher_foreground.xml',res),foreground);
await writeFile(new URL('drawable-v24/ic_launcher_foreground.xml',res),foreground);
await writeFile(new URL('drawable/ic_launcher_background.xml',res),background);
for(const version of ['26','33']){
 const folder=new URL(`mipmap-anydpi-v${version}/`,res);await mkdir(folder,{recursive:true});
 const xml=`<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@drawable/ic_launcher_background"/><foreground android:drawable="@drawable/ic_launcher_foreground"/>${version==='33'?'<monochrome android:drawable="@drawable/ic_launcher_foreground"/>':''}</adaptive-icon>`;
 for(const name of ['ic_launcher','ic_launcher_round'])await writeFile(new URL(`${name}.xml`,folder),xml);
}
