import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('tags'),checks=[],createdMembers=[];let hiddenRecord;
async function sql(text){const file=`tmp/verification/tags-fixture-${v.target}.sql`;writeFileSync(file,text);const fixtureEnv={...process.env,NODE_OPTIONS:'--dns-result-order=ipv4first'};for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'])delete fixtureEnv[name];const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cts-staging','--env','staging',v.target==='cloud'?'--remote':'--local','--file',file,'--json'],{encoding:'utf8',env:fixtureEnv});assert.equal(r.status,0,'exact synthetic fixture adjustment');}
async function rejected(tool,args,code){const r=await v.client.callTool({name:tool,arguments:args});assert.equal(r.isError,true);assert.equal(r.structuredContent.error.code,code);}
async function post(path,body){const r=await v.http(path,body);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
try{
 const person=await v.call('list_tags',{type:'person',limit:100}),org=await v.call('list_tags',{type:'org',limit:100});
 assert.ok(person.tags.length>=34);assert.ok(org.tags.length>=31);assert.equal((await v.call('list_tag_categories',{type:'person'})).categories.filter(c=>['技能','语言','资源','协作方式','可用性','发展方向','工作方法'].includes(c.name)).length,7);
 const skill=person.tags.find(t=>t.name==='视频剪辑'),resource=person.tags.find(t=>t.name==='传播渠道'),available=person.tags.find(t=>t.name==='固定时段');assert.ok(skill.description.includes('交付'));assert.ok(org.tags.some(t=>t.category_name==='活动方向'&&t.name==='内容生产'));
 checks.push('public catalog includes all 34 person and 31 organization entries, independent categories and descriptions');
 const suffix=randomUUID().slice(0,8),category=await v.call('create_tag_category',{type:'person',name:'虚构标签验收'+suffix,request_id:randomUUID()}),tag=await v.call('create_tag',{category_id:category.id,name:'ABC',description:'可核对的虚构验收特征，范围见绑定依据。',request_id:randomUUID()});
 const reused=await v.call('create_tag',{category_id:category.id,name:'ＡＢＣ',description:'不应覆盖已有描述',request_id:randomUUID()});assert.equal(reused.id,tag.id);assert.equal(reused.changed,false);
 for(const name of ['a:b','a：b','a\nb'])assert.equal((await v.http('/tags/create',{category_id:category.id,name,description:'有效描述',request_id:randomUUID()})).status,400);
 assert.equal((await v.http('/tags/create',{category_id:category.id,name:'空描述',description:' ',request_id:randomUUID()})).status,400);
 const race=await Promise.all(['race','ＲＡＣＥ'].map(name=>v.http('/tags/create',{category_id:category.id,name,description:'并发词条的相同通用描述',request_id:randomUUID()})));assert.ok(race.some(r=>r.status===200));assert.ok(race.every(r=>[200,409].includes(r.status)));assert.equal((await v.call('list_tags',{type:'person',category_id:category.id})).tags.filter(t=>t.name.toLowerCase()==='race'||t.name==='ＲＡＣＥ').length,1);
 checks.push('normalization reuses names without overwriting definitions; invalid fields are rejected and concurrent creation stays unique');
 const archive=await v.call('create_archive',{type:'person',name:'虚构标签闭环验收 '+suffix,request_id:randomUUID()}),observation=await v.call('create_observation',{archive_id:archive.id,body:'2026-09-08，虚构人物阿禾自述：做过两支访谈片的剪辑；九月每周三晚北京时间可投入，维护的频道下周交接。',request_id:randomUUID()});
 const evidence=[{kind:'observation',note:'虚构自述：交付两支访谈片；不推定全流程制作能力。',observation_id:observation.id,content_version:1}];
 const input={archive_id:archive.id,expected_version:2,changes:[{tag_id:skill.id,action:'add',evidence}],request_id:randomUUID()};
 await rejected('update_archive_tags',input,'SOURCE_NOT_READ');await v.call('get_observation',{id:observation.id});
 await rejected('update_archive_tags',{...input,request_id:randomUUID(),changes:[{tag_id:skill.id,action:'add'}]},'EVIDENCE_REQUIRED');
 await rejected('update_archive_tags',{...input,request_id:randomUUID(),changes:[{tag_id:org.tags[0].id,action:'add',evidence}]},'TAG_TYPE_MISMATCH');
 const written=await v.call('update_archive_tags',input);assert.equal(written.version,3);assert.equal((await v.call('update_archive_tags',input)).replayed,true);
 assert.equal((await v.call('update_archive_tags',{...input,expected_version:3,request_id:randomUUID(),changes:[{...input.changes[0],evidence:[{kind:'member_instruction',note:'重复添加不应覆盖旧依据'}]}]})).changed,false);
 let bound=await v.call('get_archive_tags',{archive_id:archive.id});assert.deepEqual(bound.tags[0].evidence,evidence);
 await rejected('update_archive_tags',{archive_id:archive.id,expected_version:3,changes:[{tag_id:skill.id,action:'evidence',evidence:[]}],request_id:randomUUID()},'EVIDENCE_REQUIRED');
 checks.push('MCP requires actual version reads and evidence, rejects cross-library writes, and retries never duplicate or overwrite evidence');
 const task=await v.call('record_task_context',{purpose:'整理本次虚构聊天',agent_summary:'只提供摘要，没有收到用户原话',material_type:'虚构聊天',source_references:evidence,archive_id:archive.id,request_id:randomUUID()});assert.equal(task.original_request_state,'unknown');
 const batch=await v.call('update_archive_tags',{archive_id:archive.id,expected_version:3,changes:[{tag_id:tag.id,action:'add',evidence:[{kind:'member_instruction',note:'验收成员明确要求标记此虚构特征。'}]},{tag_id:available.id,action:'add',evidence:[{...evidence[0],note:'2026 年九月，每周三晚北京时间，范围以本次自述为限。'}]}],focus:[skill.id,available.id],request_id:randomUUID(),task_id:task.task_id});assert.equal(batch.version,4);
 const eventList=await v.call('list_archive_events',{id:archive.id});assert.equal(eventList.events.filter(e=>e.kind==='archive.tags_changed').length,2);
 bound=await v.call('get_archive_tags',{archive_id:archive.id});assert.equal(bound.tags.length,3);assert.equal(bound.tags.filter(t=>t.focus>0).length,2);
 const journal=(await v.http('/admin/calls?limit=100')).body.calls;assert.ok(journal.some(c=>c.tool==='update_archive_tags'&&c.task_id===task.task_id&&c.outcome==='success'));
 assert.equal((await v.http('/archives/'+archive.id)).body.archive.tags.length,3);
 assert.equal((await v.call('update_archive_tags',{archive_id:archive.id,expected_version:4,changes:[{tag_id:resource.id,action:'remove'}],request_id:randomUUID()})).changed,false);
 checks.push('multi-tag and focus updates emit one event per batch, preserve source conditions, agree with web, and correlate explicit task IDs');
 const close=await v.call('set_archive_state',{id:archive.id,expected_version:4,status:'已弃用',member_ids:[],request_id:randomUUID()});
 await rejected('update_archive_tags',{archive_id:archive.id,expected_version:close.version,changes:[{tag_id:tag.id,action:'remove'}],request_id:randomUUID()},'ARCHIVE_CLOSED');
 await sql(`UPDATE tags SET name='ABC 澄清',name_key='abc 澄清',description='已澄清的通用定义。',version=version+1 WHERE id='${tag.id}';`);
 assert.equal((await v.call('get_archive_tags',{archive_id:archive.id})).tags.find(t=>t.tag_id===tag.id).name,'ABC');
 const reopened=await v.call('reopen_archive',{id:archive.id,expected_version:close.version,status:'视奸观察',member_ids:[],request_id:randomUUID()});assert.equal(reopened.definition_changes.length,1);assert.equal(reopened.definition_changes[0].before.name,'ABC');
 assert.equal((await v.call('get_archive_tags',{archive_id:archive.id})).tags.find(t=>t.tag_id===tag.id).name,'ABC 澄清');assert.ok(JSON.stringify((await v.call('list_archive_events',{id:archive.id})).events).includes('"name":"ABC"'));
 checks.push('close atomically freezes definitions and evidence; every role is locked; reopening reports current definition differences while history retains old wording');
 const loginName='tag-reader-'+suffix,temp='TagTemp!'+randomUUID(),password='TagReader!'+randomUUID(),member=await v.call('create_member',{username:loginName,name:'虚构标签可见性读者',temporary_password:temp,role:'member',request_id:randomUUID()});createdMembers.push(member.id);
 let readerCookie;async function reader(path,body){const r=await fetch(v.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:v.base,'Content-Type':'application/json',...(readerCookie?{Cookie:readerCookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const cookie=r.headers.get('set-cookie')?.split(';')[0];return {status:r.status,body:await r.json(),cookie};}
 readerCookie=(await reader('/auth/login',{username:loginName,password:temp})).cookie;assert.equal((await reader('/auth/password',{current_password:temp,new_password:password})).status,200);readerCookie=(await reader('/auth/login',{username:loginName,password})).cookie;
 hiddenRecord=observation.id;await sql(`UPDATE observations SET deleted=1,deleted_at='2026-09-08T00:00:00.000Z' WHERE id='${observation.id}';`);
 let visible=(await reader('/archives/'+archive.id+'/tags')).body.tags;assert.equal(visible.length,1);assert.equal(visible[0].tag_id,tag.id);
 const timeline=(await reader('/archives/'+archive.id+'/timeline')).body;assert.ok(!JSON.stringify(timeline).includes('访谈片'));assert.ok(!JSON.stringify(timeline).includes(skill.id));
 const events=(await reader('/archives/'+archive.id+'/events')).body;assert.ok(!JSON.stringify(events).includes(skill.id));assert.equal((await reader('/archives/'+archive.id)).body.archive.tags.length,1);
 const list=(await reader('/archives?type=person&query='+encodeURIComponent('虚构标签闭环验收 '+suffix))).body.archives;assert.equal(list[0].tag_summary.total,1);assert.ok(!JSON.stringify(list).includes(skill.id));assert.ok(!JSON.stringify(list).includes('evidence'));
 const readerLibrary=(await reader('/tags?type=person&query=视频剪辑')).body.tags;const adminCount=(await v.call('list_tags',{type:'person',query:'视频剪辑'})).tags[0].binding_count;assert.equal(readerLibrary[0].binding_count,adminCount-1);
 let current=(await v.call('get_archive',{id:archive.id})).archive;
 await v.call('update_archive_tags',{archive_id:archive.id,expected_version:current.version,changes:[{tag_id:skill.id,action:'evidence',evidence:[...evidence,{kind:'member_instruction',note:'来自验收成员另行提供的独立材料，仅用于权限验收。'}]}],request_id:randomUUID()});
 visible=(await reader('/archives/'+archive.id+'/tags')).body.tags;assert.equal(visible.length,2);assert.equal(visible.find(t=>t.tag_id===skill.id).evidence.length,1);assert.ok(!JSON.stringify(visible).includes('访谈片'));
 current=(await reader('/archives/'+archive.id)).body.archive;
 const edited=await reader('/archive-tags/update',{archive_id:archive.id,expected_version:current.version,changes:[{tag_id:skill.id,action:'evidence',evidence:[{kind:'member_instruction',note:'读者修订自己可见的独立材料范围，未触碰隐藏来源。'}]}],request_id:randomUUID()});assert.equal(edited.status,200);
 assert.equal((await v.call('get_archive_tags',{archive_id:archive.id})).tags.find(t=>t.tag_id===skill.id).evidence.length,2,'editing visible evidence preserves restricted references');
 await sql(`UPDATE observations SET deleted=0,deleted_at=NULL WHERE id='${observation.id}';`);hiddenRecord=null;visible=(await reader('/archives/'+archive.id+'/tags')).body.tags;assert.equal(visible.length,3);assert.equal(visible.find(t=>t.tag_id===skill.id).evidence.length,2);await reader('/auth/logout',{});
 checks.push('deleted sources hide derived tags, focus, history, counts and summaries from another member; independent evidence stays visible and restoration creates no duplicate binding');
 const raceArchive=await v.call('create_archive',{type:'person',name:'虚构标签关闭竞争 '+suffix,request_id:randomUUID()});
 const closing=await Promise.all([v.http('/archive-tags/update',{archive_id:raceArchive.id,expected_version:1,changes:[{tag_id:tag.id,action:'add'}],request_id:randomUUID()}),v.http('/archives/state',{id:raceArchive.id,expected_version:1,status:'已弃用',member_ids:[],request_id:randomUUID()})]);assert.equal(closing.filter(r=>r.status===200).length,1);assert.equal(closing.filter(r=>r.status===409).length,1);
 checks.push('concurrent tagging and closing commit only one outcome, with no partial bindings or snapshots');
}finally{
 if(hiddenRecord)await sql(`UPDATE observations SET deleted=0,deleted_at=NULL WHERE id='${hiddenRecord}';`);
 for(const id of createdMembers){const m=(await v.call('get_member',{id})).member;if(!m.frozen)await v.call('set_member_frozen',{id,expected_version:m.version,frozen:true,request_id:randomUUID()});}
 await v.close(checks);
}
