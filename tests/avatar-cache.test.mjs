import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Avatars} from '../app/server/avatars.ts';
import {Images,boundedImageBody,cleanupImages} from '../app/server/images.ts';
const png=readFileSync(new URL('./fixtures/images/shapes.png',import.meta.url));
test('QQ fetch works in Workers and rejects upstream redirects without following them',async t=>{
 const f=fixture();t.after(f.close);let redirect=false;const requests=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  // Workers supports follow/manual only; Node accepting error hid the production failure.
  if(init?.redirect==='error')throw new TypeError('Invalid redirect value');
  requests.push({url:String(url),redirect:init?.redirect});
  return redirect?new Response(null,{status:302,headers:{Location:'https://untrusted.example/avatar'}}):new Response(png);
 });
 const service=new Avatars(f.env,f.actor,'web');assert.equal((await service.read('member',f.actor.id)).status,200);
 assert.equal(requests[0].redirect,'manual');
 f.sqlite.prepare('DELETE FROM qq_avatar_cache').run();redirect=true;
 await assert.rejects(service.read('member',f.actor.id),{code:'AVATAR_UNAVAILABLE'});
 assert.equal(requests.length,2);assert.ok(requests.every(r=>r.url.startsWith('https://q1.qlogo.cn/')));
 assert.equal(f.sqlite.prepare('SELECT object_key FROM qq_avatar_cache').get().object_key,null);
});
test('QQ refresh uses the fixed origin, shares a 24-hour cache, preserves fallback on failure and does not alter activity',async t=>{
 const f=fixture();t.after(f.close);const urls=[];let fail=false;
 t.mock.method(globalThis,'fetch',async url=>{urls.push(String(url));if(fail)throw new Error('simulated upstream failure');return new Response(png,{headers:{'Content-Type':'image/png'}});});
 const service=new Avatars(f.env,f.actor,'web');assert.equal((await service.read('member',f.actor.id)).status,200);assert.deepEqual(urls,['https://q1.qlogo.cn/g?b=qq&nk=00000&s=640']);
 const cache=f.sqlite.prepare('SELECT * FROM qq_avatar_cache').get();assert.ok(Math.abs(Date.parse(cache.refresh_after)-Date.parse(cache.refreshed_at)-86400000)<1000);assert.equal(f.sqlite.prepare('SELECT version FROM members WHERE id=?').get(f.actor.id).version,1);
 assert.equal((await service.read('member',f.actor.id)).status,200);assert.equal(urls.length,1);
 fail=true;f.sqlite.prepare("UPDATE qq_avatar_cache SET refresh_after='2020-01-01T00:00:00.000Z'").run();const fallback=await service.read('member',f.actor.id);assert.deepEqual(Buffer.from(await fallback.arrayBuffer()),png);assert.equal(urls.length,2);assert.equal(f.sqlite.prepare('SELECT object_key FROM qq_avatar_cache').get().object_key,cache.object_key);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM member_events').get().n,0);
});
test('simultaneous expired QQ reads acquire one refresh lease and organization/default paths never fetch QQ',async t=>{
 const f=fixture();t.after(f.close);let calls=0,finish;const pending=new Promise(ok=>finish=ok);
 f.objects.set('qq/00000/old',png);f.sqlite.prepare("INSERT INTO qq_avatar_cache(qq,object_key,mime_type,refresh_after) VALUES('00000','qq/00000/old','image/png','2020-01-01T00:00:00.000Z')").run();
 t.mock.method(globalThis,'fetch',async()=>{calls++;await pending;return new Response(png,{headers:{'Content-Length':String(png.length)}});});
 const service=new Avatars(f.env,f.actor,'web'),one=service.read('member',f.actor.id);await new Promise(ok=>setImmediate(ok));const two=await service.read('member',f.actor.id);assert.equal(two.status,200);assert.equal(calls,1);finish();await one;assert.ok(f.deleted.includes('qq/00000/old'));
 const org=randomUUID();f.sqlite.prepare("INSERT INTO archives(id,type,name,contacts_json,created_by,created_at,updated_at) VALUES(?,'org','虚构组织','[{\"type\":\"QQ\",\"value\":\"00000\"}]',?,'2026-09-08','2026-09-08')").run(org,f.actor.id);await assert.rejects(service.read('archive',org),{code:'AVATAR_UNAVAILABLE'});assert.equal(calls,1);
 f.sqlite.prepare('UPDATE members SET qq=NULL WHERE id=?').run(f.actor.id);await assert.rejects(service.read('member',f.actor.id),{code:'AVATAR_UNAVAILABLE'});assert.equal(calls,1);
});
test('uploads retain their ready state across retry and cleanup retries failed deletion without allowing new references',async t=>{
 const f=fixture();t.after(f.close);const archive=randomUUID();f.sqlite.prepare("INSERT INTO archives(id,type,name,created_by,created_at,updated_at) VALUES(?,'person','虚构上传',?,'2026-09-08','2026-09-08')").run(archive,f.actor.id);
 const images=new Images(f.env,f.actor,'web'),hash=await crypto.subtle.digest('SHA-256',png),ticket=await images.prepare({purpose:'observation',archive_id:archive,mime_type:'image/png',byte_size:png.length,sha256:Buffer.from(hash).toString('hex')});
 const request=()=>new Request(ticket.url,{method:'PUT',headers:{...ticket.headers,'Content-Length':String(png.length)},body:png});await Images.receive(f.env,ticket.upload_id,request());await assert.rejects(Images.receive(f.env,ticket.upload_id,request()),{code:'UPLOAD_ALREADY_COMPLETE'});
 f.sqlite.prepare("UPDATE attachments SET created_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(ticket.upload_id);let failed=false;const realDelete=f.env.IMAGES.delete;f.env.IMAGES.delete=async key=>{if(!failed){failed=true;throw new Error('temporary storage failure');}return realDelete(key);};t.mock.method(console,'warn',()=>{});
 await cleanupImages(f.env);assert.equal((await images.status(ticket.upload_id)).state,'cleaning');await assert.rejects(images.planVersion([ticket.upload_id],archive,randomUUID(),1),{code:'ATTACHMENT_UNAVAILABLE'});assert.equal(f.objects.size,1);
 await cleanupImages(f.env,Date.now()+6*60000);assert.equal(f.objects.size,0);await assert.rejects(images.status(ticket.upload_id),{code:'UPLOAD_NOT_FOUND'});
});
test('bounded upload bodies reject overrun, truncation and slow streams before object writes',async()=>{
 await assert.rejects(boundedImageBody(new Response(png).body,png.length-1),{code:'IMAGE_SIZE'});await assert.rejects(boundedImageBody(new Response(png).body,png.length+1),{code:'UPLOAD_INCOMPLETE'});
 await assert.rejects(boundedImageBody(new ReadableStream({start(){}}),10,10),{code:'UPLOAD_TIMEOUT'});
});
