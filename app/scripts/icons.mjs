import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Resvg} from '@resvg/resvg-js';

const root=new URL('../../',import.meta.url);
const res=new URL('app/android/app/src/main/res/',root);
const artwork=await readFile(new URL('branding/icon-artwork.png',root));
const foreground=await readFile(new URL('branding/icon-foreground.png',root));
const data=buffer=>`data:image/png;base64,${buffer.toString('base64')}`;
const svg=(size,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
const render=(source,size)=>new Resvg(source,{fitTo:{mode:'width',value:size},font:{loadSystemFonts:false}}).render();
const artworkLayer=`<image href="${data(artwork)}" width="512" height="512"/>`;
const icon=shape=>svg(512,`<defs><clipPath id="mask">${shape}</clipPath></defs><g clip-path="url(#mask)">${artworkLayer}</g>`);
const rounded=icon('<rect width="512" height="512" rx="114"/>');
const circle=icon('<circle cx="256" cy="256" r="256"/>');

await writeFile(new URL('branding/icon.png',root),render(rounded,512).asPng());
await copyFile(new URL('branding/icon.png',root),new URL('app/public/icon.png',root));
for(const [density,size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]){
 const folder=new URL(`mipmap-${density}/`,res);await mkdir(folder,{recursive:true});
 await writeFile(new URL('ic_launcher.png',folder),render(rounded,size).asPng());
 await writeFile(new URL('ic_launcher_round.png',folder),render(circle,size).asPng());
}

// Android shows the central 72 dp of its 108 dp adaptive icon canvas.
const raw=render(svg(512,`<image href="${data(foreground)}" width="512" height="512"/>`),512);
const pixels=raw.pixels;
let left=512,right=0,top=512,bottom=0;
for(let y=0;y<512;y++)for(let x=0;x<512;x++)if(pixels[(y*512+x)*4+3]>16){
 left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
}
assert(pixels[3]===0&&right>left&&bottom>top,'Foreground must contain a real transparent background');
const scale=48/(bottom-top+1);
const x=54-(left+right+1)*scale/2,y=54-(top+bottom+1)*scale/2;
const mark=svg(108,`<image href="${data(foreground)}" x="${x}" y="${y}" width="${512*scale}" height="${512*scale}"/>`);
const packed=render(mark,432),packedPixels=packed.pixels;
let radius=0;
for(let py=0;py<432;py++)for(let px=0;px<432;px++)if(packedPixels[(py*432+px)*4+3]>16)radius=Math.max(radius,Math.hypot((px+.5)/4-54,(py+.5)/4-54));
assert(radius<33,'Foreground must stay inside the Android adaptive icon safe circle');
await mkdir(new URL('drawable-nodpi/',res),{recursive:true});
await writeFile(new URL('drawable-nodpi/shiji_mark.png',res),packed.asPng());
const bitmap='<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/shiji_mark" android:gravity="fill" android:filter="true" />\n';
await writeFile(new URL('drawable/ic_launcher_foreground.xml',res),bitmap);
await writeFile(new URL('drawable-v24/ic_launcher_foreground.xml',res),bitmap);
await writeFile(new URL('drawable/ic_launcher_monochrome.xml',res),bitmap);
await writeFile(new URL('drawable/ic_launcher_background.xml',res),'<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#F1F5FB"/></shape>\n');
for(const version of ['26','33']){
 const folder=new URL(`mipmap-anydpi-v${version}/`,res);await mkdir(folder,{recursive:true});
 const xml=`<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@drawable/ic_launcher_background"/><foreground android:drawable="@drawable/ic_launcher_foreground"/>${version==='33'?'<monochrome android:drawable="@drawable/ic_launcher_monochrome"/>':''}</adaptive-icon>\n`;
 for(const name of ['ic_launcher','ic_launcher_round'])await writeFile(new URL(`${name}.xml`,folder),xml);
}
console.log(`Generated Shiji icons; adaptive mark radius ${radius.toFixed(1)} dp / 33 dp safe limit.`);
