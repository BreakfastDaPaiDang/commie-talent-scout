import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,existsSync,unlinkSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
import {runInteractiveCodex} from './codex-interactive-client.mjs';

const v=await verificationClient('codex-review-first',{environment:process.argv.includes('--production')?'production':'staging'}),checks=[],rounds=[];
assert.ok(['cloud','production'].includes(v.target),'select --remote or --production explicitly');
const suffix=randomUUID().slice(0,8),root=resolve('secrets','codex-review-'+suffix),clientHome=join(root,'client'),work=mkdtempSync(join(tmpdir(),'cts-review-'));
mkdirSync(clientHome,{recursive:true});
const originalHome=join(process.env.USERPROFILE,'.codex'),baseline=readFileSync(join(originalHome,'config.toml'),'utf8').split(/\r?\n/).filter(x=>/^(model|model_reasoning_effort)\s*=/.test(x)).join('\n');
copyFileSync(join(originalHome,'auth.json'),join(clientHome,'auth.json'));
const extensions=join(process.env.USERPROFILE,'.vscode','extensions'),cli=readdirSync(extensions).filter(x=>x.startsWith('openai.chatgpt-')).sort().reverse().map(x=>join(extensions,x,'bin','windows-x86_64','codex.exe')).find(existsSync);assert.ok(cli);
const name='虚构顾问阿禾 '+suffix,audioName='音频修复 '+suffix;
const chat=`2026-09-09 的聊天（北京时间），以下均为虚构人物：
阿禾：青灯频道昨天交给小林了，现在我没有管理员权限，也不能代发稿。但访谈剪辑还能做，之前那两支 20 分钟访谈片的字幕、粗剪还是我交付的，拍摄和配乐不归我。
小敏：我平时用 Python 写自动化。阿禾刚跟教程学了一周，还没做过开发项目。
阿禾：新交付了两集播客的音频修复，用 Audition 降了持续底噪、处理房间混响，可以独立接小任务。
阿禾：九月每周三 20:00—22:00 北京时间可投入，十月还不确定。以后想学 Blender，目前只看教程，没作品。
阿禾：小岚会用英语主持活动，那是她，不是我。`;
let connection,archive,initial,published;
const readRecoveries=[];
async function read(tool,args={}){for(let attempt=0;;attempt++){try{return await v.call(tool,args);}catch(error){if(attempt>=2||![500,502,503,504].includes(error.data?.status))throw error;readRecoveries.push({tool,status:error.data.status});await new Promise(resolve=>setTimeout(resolve,500));}}}
async function dictionary(){let before;const tags=[];do{const page=await read('list_tags',{type:'person',include_disabled:true,limit:100,...(before?{before}:{})});tags.push(...page.tags);before=page.next_cursor;}while(before);return {tags:tags.map(({binding_count,...tag})=>tag),categories:(await read('list_tag_categories',{type:'person'})).categories};}
async function snapshot(){return {archive:(await read('get_archive',{id:archive.id})).archive,observations:(await read('list_observations',{archive_id:archive.id})).observations,tags:(await read('get_archive_tags',{archive_id:archive.id})).tags,dictionary:await dictionary()};}
const normalize=text=>text.replace(/[\s>*_`#]/g,'');
try{
 const dict=await dictionary(),skill=dict.tags.find(t=>t.name==='视频剪辑'),resource=dict.tags.find(t=>t.name==='传播渠道'),language=dict.tags.find(t=>t.category_name==='语言'&&t.name==='日语');assert.ok(skill&&resource&&language);
 archive=await v.call('create_archive',{type:'person',name,request_id:randomUUID()});
 const old=await v.call('create_observation',{archive_id:archive.id,body:'2026-08-20 阿禾本人自述：管理青灯频道且有发稿权限；今年交付两支 20 分钟访谈片的字幕和粗剪；2024 年取得日语 N3，不据此推定口语或翻译水平。',request_id:randomUUID()});
 await v.call('get_observation',{id:old.id});
 await v.call('update_archive_tags',{archive_id:archive.id,expected_version:2,changes:[skill,resource,language].map(t=>({tag_id:t.id,action:'add',evidence:[{kind:'observation',observation_id:old.id,content_version:1,note:'本人自述，具体范围以记录为准。'}]})),request_id:randomUUID()});
 initial=await snapshot();
 const r=await v.http('/connections',{name:'Codex 顾问与审阅验收 '+suffix,days:1});assert.equal(r.status,200);connection=r.body;
 writeFileSync(join(clientHome,'config.toml'),baseline+`\n[mcp_servers.cts_staging]\nurl = ${JSON.stringify(v.base+'/mcp')}\nhttp_headers = { Authorization = ${JSON.stringify('Bearer '+connection.secret)} }\nstartup_timeout_sec = 30\n`,{mode:0o600});
 writeFileSync(join(root,'fixture.json'),JSON.stringify({name,archive_id:archive.id,chat},null,2));
 console.log(JSON.stringify({status:'starting_review_conversation',private_artifacts:root}));
 const result=await runInteractiveCodex({cli,clientHome,work,path:join(root,'conversation'),redactValues:[connection.secret],prompt:`请用已经连接的康米巨星猎头系统，帮我把下面这段聊天整理进人物「${name}」的档案。\n\n${chat}`,nextTurn:async({index,final,output,turns})=>{
  const state=await snapshot(),calls=output.split('\n').map(x=>JSON.parse(x)).filter(e=>e.item?.type==='mcpToolCall').map(e=>e.item);
  rounds.push({index,final,tools:calls.map(c=>({tool:c.tool,arguments:c.arguments,status:c.status})),state});
  writeFileSync(join(root,'rounds.json'),JSON.stringify(rounds,null,2),{mode:0o600});
  assert.ok(!final.includes(connection.secret));
  if(index<2){
   assert.equal(state.archive.version,initial.archive.version,'proposal/revision leaves archive version unchanged');
   assert.deepEqual(state.observations,initial.observations);assert.deepEqual(state.tags,initial.tags);assert.deepEqual(state.dictionary,initial.dictionary);
   assert.ok(calls.every(c=>/^(whoami|get_|list_|search_|confirm_reading$)/.test(c.tool)),'before review only relevant reads and reading receipts are allowed');
   if(index===0){
    assert.match(final,/建议|推荐/);assert.match(final,/草稿|拟|正文/);assert.match(final,/交接|交给/);assert.match(final,/保留/);assert.match(final,/音频|播客/);assert.match(final,/确认|看看|发布|审阅/);
    checks.push('initial generic request reads context and recommends a draft/tag choices without mutations');
    return '太长了。观察只保留新交付两集播客音频修复、九月周三可用时段和渠道已经交接这三件事，来源和十月未定要保留。标签先都不动。';
   }
   checks.push('revision request produces a revised draft without publication or tag changes');
   return '就按上一版观察草稿发布，标签暂时不要动。';
  }
  if(index===2){
   const newRecords=state.observations.filter(o=>o.id!==old.id);assert.equal(newRecords.length,1);published=newRecords[0];
   assert.ok(normalize(turns[1].final).includes(normalize(published.body)),'published text is contained verbatim in the reviewed draft, allowing Markdown formatting');
   assert.match(published.body,/两集|2\s*集/);assert.match(published.body,/20[:：]00/);assert.match(published.body,/十月|10\s*月/);assert.match(published.body,/交接|交给/);
   assert.deepEqual(state.tags,initial.tags);assert.deepEqual(state.dictionary,initial.dictionary);
   assert.ok(calls.every(c=>/^(whoami|get_|list_|search_|confirm_reading$|record_task_context$|create_observation$)/.test(c.tool)));
   checks.push('observation-only confirmation publishes the reviewed text, leaving all tags and definitions unchanged');
   return `现在处理标签：移除传播渠道，保留视频剪辑和日语；为这份虚构验收档案新建并绑定技能标签「${audioName}」，描述为“可用音频工具独立完成播客降噪和房间混响处理等基础修复任务”。以上具体方案已确认，直接执行；其他标签不动，也不要再发观察。`;
  }
  assert.equal(index,3);assert.equal(state.observations.length,2);assert.ok(state.tags.some(t=>t.tag_id===skill.id));assert.ok(state.tags.some(t=>t.tag_id===language.id));assert.ok(!state.tags.some(t=>t.tag_id===resource.id));
  const audio=state.tags.find(t=>t.name===audioName);assert.ok(audio&&audio.evidence.length);assert.equal(state.tags.length,3);
  assert.ok(calls.some(c=>c.tool==='create_tag'&&c.status==='completed'));assert.ok(calls.some(c=>c.tool==='update_archive_tags'&&c.status==='completed'));
  assert.deepEqual(state.dictionary.categories,initial.dictionary.categories);
  assert.deepEqual(state.dictionary.tags.filter(t=>t.name!==audioName),initial.dictionary.tags);
  checks.push('separate explicit tag approval creates/binds the selected skill and removes only the channel, without another observation');
 }});
 assert.equal(result.turns.length,4);
 writeFileSync('tmp/verification/codex-review-first-detail-'+v.target+'.json',JSON.stringify({date:new Date().toISOString(),base:v.base,fixture:name,checks,readRecoveries,rounds,quality_review:'pending manual reading of recommendations and drafts; assertions alone do not establish advisor quality'},null,2));
}finally{
 try{
  if(archive){const a=(await read('get_archive',{id:archive.id})).archive;if(!a.closed)await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:randomUUID()});}
  const ownTag=(await read('list_tags',{type:'person',query:audioName})).tags.find(t=>t.name===audioName);
  if(ownTag){const preview=await v.call('preview_tag_availability',{entity_type:'tag',id:ownTag.id,enabled:false,reason:'虚构顾问验收已结束，停用本轮专用词条。'});await v.call('apply_tag_availability',{preview_id:preview.preview_id,request_id:randomUUID()});}
 }finally{
  try{if(connection)await v.http('/connections/revoke',{id:connection.id});}
  finally{
   if(existsSync(join(clientHome,'auth.json')))unlinkSync(join(clientHome,'auth.json'));
   if(existsSync(join(clientHome,'config.toml')))writeFileSync(join(clientHome,'config.toml'),baseline+'\n');
   await v.close(checks);
  }
 }
}
