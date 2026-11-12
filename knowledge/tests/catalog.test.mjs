import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,request} from './fixture.mjs';
import {Catalog} from '../src/catalog.ts';
import {CatalogFiles} from '../src/catalog-files.ts';
import {giftIdentity} from '../src/catalog-auth.ts';
import {emptyCatalogContent} from '../../app/shared/catalog.ts';
import {fixture as mainFixture} from '../../tests/d1-fixture.mjs';
import {Resources} from '../../app/server/resources.ts';
import {importCatalog} from '../scripts/catalog-import.mjs';
import {createHash} from 'node:crypto';

function setup(t){const f=fixture();t.after(f.close);f.sqlite.exec('UPDATE catalog_meta SET authority_ready=1');const objects=new Map(),env={KNOWLEDGE_DB:f.db,CATALOG_FILES:{async put(k,v){objects.set(k,Buffer.from(v));},async get(k){const v=objects.get(k);return v?{body:new Response(v).body}:null;}},APP_ORIGIN:'https://catalog.test',ENVIRONMENT:'staging'};const directory=async()=>f.actors.map(({id,name})=>({id,name})),services=f.actors.map(a=>new Catalog(env,a,directory,f.clock));return {...f,env,services,directory,objects};}
const publication=(actor,extra={})=>({id:request(),request_id:request(),record_kind:'resource',content:{...emptyCatalogContent(),name:'虚构制作资源',owner_id:actor.id,provider:'测试提供方',contact:'由测试负责人接收',...extra}});
async function publish(f,extra={}){const input=publication(f.actors[0],extra);await f.services[0].publish(input);return input;}
async function proposal(f,p,changes={},index=1){return f.services[index].submitIssue({id:request(),request_id:request(),target_type:'entry',target_id:p.id,base_version:1,title:'更新获取条件',body:'实际使用后发现需要补充',proposal:{...p.content,...changes}});}

test('publishing is formal-member only, request identity is immutable, and resources remain independent',async t=>{
 const f=setup(t),p=publication(f.actors[0]);const r=await f.services[0].publish(p);assert.equal(r.version,1);assert.deepEqual(await f.services[0].publish(p),r);assert.equal((await f.services[1].list()).entries.length,1);
 await assert.rejects(()=>f.services[0].publish({...p,content:{...p.content,name:'other'}}),e=>e.code==='REQUEST_REUSED');
 const outsider=new Catalog(f.env,{...f.actors[0],role:'admin',eligible:false,membership_id:null},f.directory);await assert.rejects(()=>outsider.publish(publication(f.actors[0])),e=>e.code==='FORMAL_MEMBER_REQUIRED');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM kb_entries').get().n,0);
});
test('issues retain current publication until accepted by a maintainer and cannot overwrite a newer version',async t=>{
 const f=setup(t),p=await publish(f),a=await proposal(f,p,{conditions:'预约后领取'}),b=await proposal(f,p,{conditions:'不同建议'});
 assert.equal((await f.services[2].get(p.id)).entry.conditions,'');await assert.rejects(()=>f.services[1].resolve({request_id:request(),issue_id:a.id,expected_version:1,action:'merge',result:'同意'}),e=>e.code==='MAINTAINER_REQUIRED');
 await f.services[0].resolve({request_id:request(),issue_id:a.id,expected_version:1,action:'merge',result:'实际提供方已确认'});const detail=await f.services[2].get(p.id);assert.equal(detail.entry.conditions,'预约后领取');assert.equal(detail.versions.length,2);
 await assert.rejects(()=>f.services[0].resolve({request_id:request(),issue_id:b.id,expected_version:1,action:'merge',result:'过期修改'}),e=>e.code==='VERSION_CONFLICT');
 assert.equal((await f.services[1].issueDetail(b.id)).issue.state,'open');assert.throws(()=>f.sqlite.prepare('UPDATE catalog_versions SET content_json=?').run('{}'),/immutable/);
});
test('concurrent issue merges adopt one complete revision and leave the other proposal open',async t=>{
 const f=setup(t),p=await publish(f),a=await proposal(f,p,{note:'first'}),b=await proposal(f,p,{note:'second'});
 const results=await Promise.allSettled([a,b].map(i=>f.services[0].resolve({request_id:request(),issue_id:i.id,expected_version:1,action:'merge',result:'采纳'})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM catalog_issues WHERE state='open'").get().n,1);assert.equal((await f.services[0].get(p.id)).entry.version,2);
});
test('a position requires an actual group and clear work, time, support and contact',async t=>{
 const f=setup(t),groupId=request();await f.services[0].createGroup({id:groupId,request_id:request(),content:{name:'虚构视频组',description:'测试',maintainer_ids:[f.actors[0].id]}});
 const p=publication(f.actors[0],{group_id:groupId});p.record_kind='position';await assert.rejects(()=>f.services[0].publish(p),e=>e.code==='POSITION_INCOMPLETE');
 await f.services[0].publish({...p,content:{...p.content,note:'剪辑短片',time_commitment:'每周三小时',support:'提供素材及反馈'}});assert.equal((await f.services[0].list({kind:'position'})).entries.length,1);
});
test('a candy grant is read-only, scoped to its own reception details, revocable, and never stored in receipts',async t=>{
 const f=setup(t),p=await publish(f),input={id:request(),request_id:request(),entry_id:p.id,recipient_name:'虚构接收者',receiver_id:f.actors[1].id};const r=await f.services[0].give(input);assert.match(r.access_key,/^candy_[a-f0-9]{64}$/);
 assert.equal((await f.services[0].give(input)).access_key,null);assert.ok(!JSON.stringify(await f.services[0].receipt(input.request_id)).includes(r.access_key));
 const actor=await giftIdentity(r.access_key,f.env),guest=new Catalog(f.env,actor,f.directory);await f.services[0].give({...input,id:request(),request_id:request(),recipient_name:'另一接收者'});
 assert.equal((await guest.list()).entries.length,1);assert.equal((await guest.grants()).grants.length,1);assert.equal((await guest.get(p.id)).versions.length,0);await assert.rejects(()=>guest.issues(),e=>e.code==='FORMAL_MEMBER_REQUIRED');await assert.rejects(()=>guest.publish(publication(f.actors[0])),e=>e.code==='FORMAL_MEMBER_REQUIRED');
 await assert.rejects(()=>f.services[0].grantAction({id:r.id,expected_version:1,request_id:request(),action:'receive',result:'代为接收'}),e=>e.code==='GRANT_OWNER_REQUIRED');
 await f.services[1].grantAction({id:r.id,expected_version:1,request_id:request(),action:'receive',result:'已取得联系并说明入口'});assert.equal((await f.services[0].get(p.id)).entry.capacity,null);
 await f.services[0].grantAction({id:r.id,expected_version:2,request_id:request(),action:'revoke',result:'结束访问'});await assert.rejects(()=>giftIdentity(r.access_key,f.env),e=>e.code==='INVALID_GIFT');await assert.rejects(()=>guest.list(),e=>e.code==='GIFT_REVOKED');
});
test('concurrent retry cannot return a secret that was never committed',async t=>{
 const f=setup(t),p=await publish(f),input={id:request(),request_id:request(),entry_id:p.id,recipient_name:'测试',receiver_id:f.actors[1].id};const results=await Promise.all([f.services[0].give(input),f.services[0].give(input)]);const keys=results.map(r=>r.access_key).filter(Boolean);assert.equal(keys.length,1);await giftIdentity(keys[0],f.env);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM catalog_grants').get().n,1);
});
test('attachments verify original bytes and stay private until linked to a published record',async t=>{
 const f=setup(t),files=new CatalogFiles(f.services[0]),bytes=Buffer.from('虚构文档内容'),id=request();await files.prepare({id,request_id:request(),name:'说明.txt',mime:'text/plain',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 await assert.rejects(()=>files.upload(id,new Request('https://test',{method:'PUT',body:Buffer.from('wrong')})),e=>e.code==='FILE_SIZE');assert.equal(f.objects.size,0);
 await files.upload(id,new Request('https://test',{method:'PUT',body:bytes}));await assert.rejects(()=>new CatalogFiles(f.services[1]).download(id),e=>e.code==='NOT_FOUND');
 const p=await publish(f,{attachment_ids:[id]}),grant=await f.services[0].give({id:request(),request_id:request(),entry_id:p.id,recipient_name:'测试',receiver_id:f.actors[1].id}),guest=new Catalog(f.env,await giftIdentity(grant.access_key,f.env),f.directory);assert.equal(await (await new CatalogFiles(guest).download(id)).text(),bytes.toString());
 await f.services[0].grantAction({id:grant.id,expected_version:1,request_id:request(),action:'revoke',result:'撤销'});await assert.rejects(()=>new CatalogFiles(guest).download(id),e=>e.code==='GIFT_REVOKED');
});
test('migration preserves resource ids, every source history row, and permanently disables old authoritative writes',async t=>{
 const f=setup(t),p=mainFixture();t.after(p.close);const resource=new Resources(p.env,p.actor),id=request();
 await resource.save({entity:'resource',id,expected_version:0,request_id:request(),name:'既有虚构资源',kind:'项目',purposes:['review'],capacity:4,active:true,note:'原说明'});
 await resource.save({entity:'resource',id,expected_version:1,request_id:request(),name:'既有虚构资源',kind:'项目',purposes:['审核'],capacity:3,active:true,note:'更新说明'});
 let snapshot;const result=await importCatalog({source:p.env.DB,target:f.db,sourceId:'fixture-source',saveSnapshot:async value=>{snapshot=value;}});assert.equal(result.entries,1);assert.equal(result.history,2);assert.equal(snapshot.history.length,2);const imported=await f.services[0].get(id);assert.equal(imported.entry.version,2);assert.equal(imported.entry.note,'更新说明');assert.equal(imported.versions.length,2);assert.equal(imported.entry.owner_id,null);
 assert.throws(()=>p.sqlite.prepare('UPDATE work_overview_resources SET note=? WHERE id=?').run('illegal',id),/independent catalog/);
 assert.equal((await importCatalog({source:p.env.DB,target:f.db,sourceId:'fixture-source'})).already_imported,true);
 p.env.CATALOG={async fetch(){return Response.json({resources:[{id,version:3,name:'来自新库',kind:'',purposes:[],capacity:2,active:true,note:'新依据'}]});}};p.env.CATALOG_ORIGIN='https://catalog.test';assert.equal((await resource.list()).resources[0].name,'来自新库');
 p.env.CATALOG.fetch=async()=>{throw new Error('offline');};await assert.rejects(()=>resource.list(),e=>e.code==='CATALOG_UNAVAILABLE');
 await assert.rejects(()=>resource.save({entity:'resource_delete',id,expected_version:2,request_id:request()}),e=>e.code==='RESOURCE_ISSUE_REQUIRED');
});
test('failed import leaves old writes frozen and can be resumed without overwriting different target content',async t=>{
 const f=setup(t),p=mainFixture();t.after(p.close);const id=request();await new Resources(p.env,p.actor).save({entity:'resource',id,expected_version:0,request_id:request(),name:'测试资源'});
 await assert.rejects(()=>importCatalog({source:p.env.DB,target:f.db,sourceId:'source',saveSnapshot:async()=>{throw new Error('backup unavailable');}}),/backup unavailable/);assert.equal(p.sqlite.prepare('SELECT mode FROM resource_catalog_state').get().mode,'migrating');assert.throws(()=>p.sqlite.prepare('UPDATE work_overview_resources SET note=? WHERE id=?').run('race',id),/independent catalog/);
 assert.equal((await importCatalog({source:p.env.DB,target:f.db,sourceId:'source'})).entries,1);
});
