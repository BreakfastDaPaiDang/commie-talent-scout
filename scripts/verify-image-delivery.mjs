import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('image-delivery'),checks=[];let archive,connection;
try{
 archive=await v.call('create_archive',{type:'person',name:'图片传输验收 '+randomUUID().slice(0,4),request_id:randomUUID()});
 const bytes=readFileSync('tests/fixtures/images/shapes.png');
 async function upload(purpose){const ticket=await v.call('prepare_image_upload',{purpose,archive_id:archive.id,mime_type:'image/png',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});assert.equal((await fetch(ticket.url,{method:'PUT',headers:ticket.headers,body:bytes})).status,200);return ticket.attachment_id;}
 const attachment=await upload('observation'),avatar=await upload('archive_avatar');
 await v.call('create_observation',{archive_id:archive.id,attachment_ids:[attachment],body:'虚构图片缓存验收',request_id:randomUUID()});
 const current=(await v.call('get_archive',{id:archive.id})).archive;assert.equal((await v.http('/avatars/set',{subject_type:'archive',id:archive.id,expected_version:current.version,attachment_id:avatar,request_id:randomUUID()})).status,200);
 connection=(await v.http('/connections',{name:'图片条件请求验收',days:1})).body;
 const saved=[];
 for(const path of ['/images/'+attachment,'/avatars/archives/'+archive.id]){
  const headers={Authorization:'Bearer '+connection.secret},start=performance.now(),first=await fetch(v.base+path,{headers});assert.equal(first.status,200);assert.deepEqual(Buffer.from(await first.arrayBuffer()),bytes);const initialMs=Math.round(performance.now()-start),etag=first.headers.get('ETag');assert.ok(etag);assert.equal(first.headers.get('Cache-Control'),'private, no-cache');assert.equal(first.headers.get('Vary'),'Cookie, Authorization');
  const repeatStart=performance.now(),repeat=await fetch(v.base+path,{headers:{...headers,'If-None-Match':etag}});assert.equal(repeat.status,304);assert.equal((await repeat.arrayBuffer()).byteLength,0);saved.push({path,etag});checks.push({kind:path.startsWith('/images/')?'observation':'avatar',firstBytes:bytes.length,repeatBytes:0,initialMs,repeatMs:Math.round(performance.now()-repeatStart)});
 }
 await v.http('/connections/revoke',{id:connection.id});for(const {path,etag} of saved){const denied=await fetch(v.base+path,{headers:{Authorization:'Bearer '+connection.secret,'If-None-Match':etag}});assert.equal(denied.status,401);assert.match(denied.headers.get('Cache-Control'),/no-store/);await denied.arrayBuffer();}
 checks.push('revoked credentials are denied before any conditional image or avatar response');
}finally{try{if(connection)await v.http('/connections/revoke',{id:connection.id});if(archive){const current=(await v.call('get_archive',{id:archive.id})).archive;await v.call('delete_archive',{id:archive.id,expected_version:current.version,request_id:randomUUID()});}}finally{await v.close(checks);}}
