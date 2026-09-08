import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectImage,MAX_IMAGE_BYTES} from '../app/server/image-format.ts';
const fixture=(ext:string)=>new Uint8Array(readFileSync(new URL('./fixtures/images/shapes.'+ext,import.meta.url)));
test('actual PNG/JPEG/WebP containers identify dimensions and reject truncation and unsupported bytes',()=>{
 for(const [ext,mime] of [['png','image/png'],['jpg','image/jpeg'],['webp','image/webp']]){const bytes=fixture(ext);assert.deepEqual(inspectImage(bytes),{mime_type:mime,width:240,height:160});assert.throws(()=>inspectImage(bytes.subarray(0,bytes.length-2)));}
 for(const body of ['<svg xmlns="http://www.w3.org/2000/svg"/>','GIF89a','not an image'])assert.throws(()=>inspectImage(new TextEncoder().encode(body)));
 assert.throws(()=>inspectImage(new Uint8Array(MAX_IMAGE_BYTES+1)),{code:'IMAGE_SIZE'});
});
test('declared dimensions and animation containers are bounded independently of extensions',()=>{
 const png=fixture('png'),view=new DataView(png.buffer);view.setUint32(16,16001);assert.throws(()=>inspectImage(png),{code:'IMAGE_DIMENSIONS'});view.setUint32(16,10000);view.setUint32(20,5000);assert.throws(()=>inspectImage(png),{code:'IMAGE_DIMENSIONS'});
 const animated=fixture('png');animated.set(new TextEncoder().encode('acTL'),37);assert.throws(()=>inspectImage(animated),{code:'INVALID_IMAGE'});
 const webp=fixture('webp');webp.set(new TextEncoder().encode('ANIM'),12);assert.throws(()=>inspectImage(webp),{code:'INVALID_IMAGE'});
});
