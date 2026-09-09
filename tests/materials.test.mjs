import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid,createHash} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Materials,cleanupMaterials} from '../app/server/materials.ts';
import {backupObjects} from '../scripts/lib/backup-objects.mjs';

function setup(t){const f=fixture();t.after(f.close);f.env.IMAGES.put=async(key,body,options)=>{const bytes=Buffer.from(await new Response(body).arrayBuffer());if(options?.sha256&&createHash('sha256').update(bytes).digest('hex')!==options.sha256)throw new Error('R2 checksum mismatch');f.objects.set(key,bytes);return {size:bytes.length};};return f;}
const create=(f,type='person')=>new Archives(f.env,f.actor,'web').create({type,name:'虚构材料档案',request_id:uuid()});
const service=f=>new Materials(f.env,f.actor,'web');
async function upload(f,id,text='原始材料'){const bytes=Buffer.from(text),s=service(f),p=await s.prepare({archive_id:id,name:'材料.txt',mime_type:'text/plain',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});const request=()=>new Request(p.url,{method:'PUT',headers:{...p.headers,'Content-Length':String(bytes.length)},body:bytes});const result=await Materials.receive(f.env,p.upload_id,request());return {p,result,bytes,request};}
function makeAdmin(f){f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor={...f.actor,role:'admin'};}

test('materials preserve immutable bytes and stable references; upload retry does not duplicate events',async t=>{
 const f=setup(t),a=await create(f),s=service(f),u=await upload(f,a.id);assert.equal(u.result.state,'ready');
 assert.equal((await Materials.receive(f.env,u.p.upload_id,u.request())).state,'ready');
 const list=await s.list({archive_id:a.id});assert.equal(list.materials.length,1);assert.equal(list.capacity.limit_bytes,100_000_000);assert.equal(list.capacity.used_bytes,u.bytes.length);assert.equal(list.capacity.reserved_bytes,0);
 const file=list.materials[0];assert.match(file.reference_url,/material=/);assert.deepEqual(Buffer.from(await (await s.read(file.id)).arrayBuffer()),u.bytes);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM archive_events WHERE kind='material.uploaded'").get().n,1);
 const other=await create(f,'org');assert.equal((await s.capacity(other.id)).limit_bytes,200_000_000);
});

test('capacity reservations are checked inside the transaction and expiration/cancellation release them',async t=>{
 const f=setup(t),a=await create(f),s=service(f),input={archive_id:a.id,name:'大材料.bin',mime_type:'application/octet-stream',byte_size:60_000_000,sha256:'0'.repeat(64)};
 const real=f.env.DB.batch;let race=true;f.env.DB.batch=async stmts=>{if(race){race=false;await s.prepare(input);}return real(stmts);};
 await assert.rejects(s.prepare(input),e=>e.status===409);assert.equal((await s.capacity(a.id)).reserved_bytes,60_000_000);
 const id=f.sqlite.prepare('SELECT id FROM materials').get().id;await s.cancel({id,request_id:uuid()});assert.equal((await s.capacity(a.id)).reserved_bytes,0);
 await s.prepare(input);f.sqlite.prepare("UPDATE materials SET ticket_expires_at='2000-01-01' WHERE state='pending'").run();assert.equal((await s.capacity(a.id)).reserved_bytes,0);await s.prepare(input);
});

test('recycle bin retains quota; edits are versioned; purge releases only after object deletion succeeds',async t=>{
 const f=setup(t),a=await create(f),s=service(f),u=await upload(f,a.id),id=u.p.upload_id;
 await s.update({id,expected_version:1,name:'参考材料.txt',description:'一条说明',request_id:uuid()});await assert.rejects(s.update({id,expected_version:1,name:'过期修改',description:'',request_id:uuid()}),{code:'VERSION_CONFLICT'});
 const input={id,expected_version:2,request_id:uuid()};await s.setDeleted(input,true);assert.equal((await s.setDeleted(input,true)).replayed,true);assert.equal((await s.list({archive_id:a.id})).materials.length,0);assert.equal((await s.capacity(a.id)).used_bytes,u.bytes.length);
 await s.setDeleted({id,expected_version:3,request_id:uuid()},false);await s.setDeleted({id,expected_version:4,request_id:uuid()},true);
 const remove=f.env.IMAGES.delete;f.env.IMAGES.delete=async()=>{throw new Error('temporary R2 failure');};const purge={id,expected_version:5,request_id:uuid()};const result=await s.purge(purge);assert.equal(result.state,'purging');assert.equal((await s.capacity(a.id)).used_bytes,u.bytes.length);await assert.rejects(s.read(id),e=>e.status===404);
 f.env.IMAGES.delete=remove;assert.equal((await s.purge(purge)).state,'purged');assert.equal((await s.capacity(a.id)).used_bytes,0);assert.equal(f.objects.size,0);
 const event=f.sqlite.prepare("SELECT before_json,after_json FROM archive_events WHERE kind='material.updated'").get();assert.ok(!JSON.stringify(event).includes('参考材料'));
});

test('material permissions respect authors, archive lifecycle, credential revocation and admin quota changes',async t=>{
 const f=setup(t),a=await create(f),u=await upload(f,a.id),id=u.p.upload_id,s=service(f);
 await assert.rejects(s.setQuota({archive_id:a.id,expected_version:1,limit_bytes:200_000_000,request_id:uuid()}),{code:'ADMIN_REQUIRED'});
 const other={...f.actor,id:uuid()},reader=new Materials(f.env,other,'mcp');assert.equal((await reader.list({archive_id:a.id})).materials.length,1);await assert.rejects(reader.update({id,expected_version:1,name:'无权改名',description:'',request_id:uuid()}),e=>e.status===403);
 await s.setDeleted({id,expected_version:1,request_id:uuid()},true);assert.equal((await reader.list({archive_id:a.id,deleted:true})).materials.length,0);await assert.rejects(reader.read(id),e=>e.status===404);
 makeAdmin(f);const admin=service(f);await admin.setQuota({archive_id:a.id,expected_version:1,limit_bytes:200_000_000,request_id:uuid()});assert.equal((await admin.capacity(a.id)).limit_bytes,200_000_000);
 const pending=await admin.prepare({archive_id:a.id,name:'撤销.txt',mime_type:'text/plain',byte_size:1,sha256:createHash('sha256').update('x').digest('hex')});f.sqlite.prepare('UPDATE credentials SET revoked_at=? WHERE id=?').run(new Date().toISOString(),f.actor.credential_id);await assert.rejects(Materials.receive(f.env,pending.upload_id,new Request(pending.url,{method:'PUT',headers:{...pending.headers,'Content-Length':'1'},body:'x'})),e=>e.status===401);
 f.sqlite.prepare('UPDATE credentials SET revoked_at=NULL WHERE id=?').run(f.actor.credential_id);const archives=new Archives(f.env,f.actor,'web');await archives.setState({id:a.id,expected_version:(await archives.get(a.id)).version,status:'已弃用',member_ids:[],request_id:uuid()});await assert.rejects(admin.setDeleted({id,expected_version:2,request_id:uuid()},false),{code:'ARCHIVE_CLOSED'});
 await archives.setDeleted({id:a.id,expected_version:(await archives.get(a.id)).version,request_id:uuid()},true);await assert.rejects(s.read(id),e=>e.status===404);assert.equal((await admin.read(id)).status,200);
});

test('mismatched content never becomes visible; cleanup retains ready and trashed files',async t=>{
 const f=setup(t),a=await create(f),s=service(f),u=await upload(f,a.id);await s.setDeleted({id:u.p.upload_id,expected_version:1,request_id:uuid()},true);
 const p=await s.prepare({archive_id:a.id,name:'坏文件.txt',mime_type:'text/plain',byte_size:1,sha256:'0'.repeat(64)});await assert.rejects(Materials.receive(f.env,p.upload_id,new Request(p.url,{method:'PUT',headers:{...p.headers,'Content-Length':'1'},body:'x'})));
 await cleanupMaterials(f.env,Date.now()+2*86400000);assert.equal((await s.list({archive_id:a.id,deleted:true})).materials.length,1);assert.deepEqual(Buffer.from(await (await s.read(u.p.upload_id)).arrayBuffer()),u.bytes);
 const response=await s.read(u.p.upload_id,true);assert.match(response.headers.get('Content-Disposition'),/^attachment/);assert.match(response.headers.get('Content-Security-Policy'),/sandbox/);
});

test('backup includes active and trashed materials, while a closing archive rejects in-flight publication',async t=>{
 const f=setup(t),a=await create(f),s=service(f),u=await upload(f,a.id);await s.setDeleted({id:u.p.upload_id,expected_version:1,request_id:uuid()},true);assert.equal(backupObjects(f.sqlite).length,1);
 const put=f.env.IMAGES.put;f.env.IMAGES.put=async(...args)=>{const r=await put(...args);f.sqlite.prepare('UPDATE archives SET closed=1,version=version+1 WHERE id=?').run(a.id);return r;};
 await assert.rejects(upload(f,a.id,'不能发布的并发材料'),e=>e.status===409);assert.equal(backupObjects(f.sqlite).length,1);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM materials WHERE state='ready'").get().n,1);
});

test('a slow R2 write finishing after cleanup cannot leave an untracked file or publish',async t=>{
 const f=setup(t),a=await create(f),put=f.env.IMAGES.put;f.env.IMAGES.put=async(...args)=>{await cleanupMaterials(f.env,Date.now()+2*86400000);return put(...args);};
 await assert.rejects(upload(f,a.id),e=>e.status===409);assert.equal(f.objects.size,0);assert.equal((await service(f).capacity(a.id)).used_bytes,0);
});
