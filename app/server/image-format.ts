import {Failure} from './types.ts';
export const MAX_IMAGE_BYTES=10*1024*1024;
export const MAX_IMAGE_PIXELS=40_000_000;
export type ImageType='image/png'|'image/jpeg'|'image/webp';
const bad=()=>new Failure(400,'INVALID_IMAGE','图片内容不是完整的静态 PNG、JPEG 或 WebP');
function dimensions(mime:ImageType,width:number,height:number){if(!width||!height||width>16000||height>16000||width*height>MAX_IMAGE_PIXELS)throw new Failure(400,'IMAGE_DIMENSIONS','图片边长最多 16,000 像素，总像素最多 4,000 万');return {mime_type:mime,width,height};}
// Inspect bounded bytes, not the supplied extension or Content-Type. No image decoder is run
// inside the Worker; signature, container boundaries and declared dimensions are checked here.
export function inspectImage(bytes:Uint8Array){
 if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw new Failure(413,'IMAGE_SIZE','单张图片最多 10 MiB');
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(start:number,length:number)=>String.fromCharCode(...bytes.subarray(start,start+length));
 if(bytes.length>=33&&bytes[0]===137&&text(1,3)==='PNG'&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10){
  let p=8,width=0,height=0,data=false,ended=false,count=0;
  while(p+12<=bytes.length){if(++count>65536)throw bad();const length=d.getUint32(p),kind=text(p+4,4),end=p+12+length;if(end>bytes.length)throw bad();
   if(p===8){if(kind!=='IHDR'||length!==13)throw bad();width=d.getUint32(p+8);height=d.getUint32(p+12);}
   else if(kind==='IHDR'||kind==='acTL')throw bad();
   if(kind==='IDAT')data=true;if(kind==='IEND'){if(length!==0||end!==bytes.length)throw bad();ended=true;break;}p=end;
  }
  if(!ended||!data)throw bad();return dimensions('image/png',width,height);
 }
 if(bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217){
  let p=2,width=0,height=0,scanned=false;
  while(p+4<bytes.length){if(bytes[p++]!==255)throw bad();while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===218){scanned=true;break;}if(marker===0||marker===216||marker===217)throw bad();if(marker===1||(marker>=208&&marker<=215))continue;
   if(p+2>bytes.length)throw bad();const length=d.getUint16(p);if(length<2||p+length>bytes.length)throw bad();
   if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){if(length<8)throw bad();height=d.getUint16(p+3);width=d.getUint16(p+5);}p+=length;
  }
  if(!scanned)throw bad();return dimensions('image/jpeg',width,height);
 }
 if(bytes.length>=20&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'&&d.getUint32(4,true)+8===bytes.length){
  let p=12,width=0,height=0,codec=false;
  while(p+8<=bytes.length){const kind=text(p,4),length=d.getUint32(p+4,true),start=p+8,end=start+length;if(end>bytes.length)throw bad();
   if(kind==='ANIM'||kind==='ANMF')throw bad();
   if(kind==='VP8X'){if(length<10||(bytes[start]&2))throw bad();width=1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16);height=1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16);}
   if(kind==='VP8 '){if(length<10||text(start+3,3)!=='\u009d\u0001*')throw bad();const w=d.getUint16(start+6,true)&16383,h=d.getUint16(start+8,true)&16383;if(width&&(width!==w||height!==h))throw bad();width=w;height=h;codec=true;}
   if(kind==='VP8L'){if(length<5||bytes[start]!==47)throw bad();const bits=d.getUint32(start+1,true),w=(bits&16383)+1,h=((bits>>>14)&16383)+1;if(width&&(width!==w||height!==h))throw bad();width=w;height=h;codec=true;}
   p=end+(length%2);
  }
  if(!codec||p!==bytes.length)throw bad();return dimensions('image/webp',width,height);
 }
 throw bad();
}
export async function imageHash(bytes:Uint8Array<ArrayBuffer>){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
