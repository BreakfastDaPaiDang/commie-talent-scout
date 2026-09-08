import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
const primaryOnly=process.argv.includes('--primary-only');
const v=await verificationClient(primaryOnly?'codex-compression-refined':'codex-compression'),checks=[],rounds=[];
assert.equal(v.target,'cloud','real Codex cold-session acceptance uses isolated staging');
const suffix=randomUUID().slice(0,8),root=resolve('secrets','codex-compression-'+suffix),clientHome=join(root,'client'),work=join(root,'work');mkdirSync(clientHome,{recursive:true});mkdirSync(work,{recursive:true});
const originalHome=join(process.env.USERPROFILE,'.codex'),baseline=readFileSync(join(originalHome,'config.toml'),'utf8').split(/\r?\n/).filter(x=>/^(model|model_reasoning_effort)\s*=/.test(x)).join('\n');
copyFileSync(join(originalHome,'auth.json'),join(clientHome,'auth.json'));
const extensions=join(process.env.USERPROFILE,'.vscode','extensions'),cli=readdirSync(extensions).filter(x=>x.startsWith('openai.chatgpt-')).sort().reverse().map(x=>join(extensions,x,'bin','windows-x86_64','codex.exe')).find(existsSync);assert.ok(cli);
let connection,relay;let hadAudio=false;
const name='虚构冷启动阿禾 '+suffix;
const chat=`2026-09-08 的聊天（北京时间），人物均为虚构验收对象：
阿禾：我管理的「青灯频道」昨天正式交给小林，今天起没有管理员权限，也不能再代为发布。但访谈视频剪辑仍能做。今年完成过两支 20 分钟的访谈片，字幕和粗剪由我交付，拍摄和配乐不是我负责的。
小敏：我平时用 Python 写自动化程序。阿禾上周才开始跟教程，没有做过开发项目。
阿禾：这次另外交付了两集播客的音频修复，把持续底噪压低并处理了房间混响，主要用 Audition。这个我已经可以接独立的小任务。
阿禾：九月份，每周三 20:00—22:00 北京时间我可以投入，十月份还不知道。希望以后学 Blender，现在只是看教程，还没有作品。
阿禾：我朋友小岚说她能用英语主持活动。这说的是小岚，不是我。`;
async function run(round,prompt){
 const path=join(root,round),args=['exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--output-last-message',path+'-final.txt','-C',work,'-'];
 const childEnv={...process.env,CODEX_HOME:clientHome,PATH:dirname(cli)+';'+process.env.PATH};delete childEnv.CTS_MCP_TEST_BEARER;
 const start=Date.now();console.log(JSON.stringify({round,status:'started'}));
 const child=spawn(cli,args,{cwd:work,env:childEnv,stdio:['pipe','pipe','pipe']});let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);child.stdin.end(prompt);
 const exit=await new Promise((ok,no)=>{child.on('error',no);child.on('exit',ok);});writeFileSync(path+'-events.jsonl',output,{mode:0o600});writeFileSync(path+'-stderr.txt',errors,{mode:0o600});assert.equal(exit,0,'Codex exits successfully; private diagnostic retained');assert.ok(!output.includes(connection.secret),'no MCP secret in transcript');
 const final=readFileSync(path+'-final.txt','utf8');assert.ok(!final.includes(connection.secret));
 const calls=(await v.http('/admin/calls?limit=100')).body.calls.filter(c=>c.credential_id===connection.id&&new Date(c.started_at).valueOf()>=start);
 assert.ok(calls.some(c=>c.tool==='whoami'&&c.outcome==='success'),'cold session checks service identity');
 rounds.push({round,elapsed_ms:Date.now()-start,tools:calls.map(c=>({tool:c.tool,outcome:c.outcome,error_code:c.error_code,task_id:c.task_id})),final});writeFileSync(join(root,'rounds.json'),JSON.stringify(rounds,null,2));console.log(JSON.stringify({round,status:'finished',elapsed_ms:Date.now()-start,calls:calls.length}));return {final,calls,output};
}
try{
 const category=(await v.call('list_tag_categories',{type:'person'})).categories.find(c=>c.name==='技能'),tags=(await v.call('list_tags',{type:'person',limit:100})).tags,skill=tags.find(t=>t.name==='视频剪辑'),resource=tags.find(t=>t.name==='传播渠道'),language=tags.find(t=>t.category_name==='语言'&&t.name==='日语');
 hadAudio=tags.some(t=>/音频|音訊|声音/.test(t.name)&&t.category_id===category.id);
 const archive=await v.call('create_archive',{type:'person',name,request_id:randomUUID()}),old=await v.call('create_observation',{archive_id:archive.id,body:'2026-08-20，阿禾本人明确自述：正在管理青灯频道，有发稿权限；今年剪辑过两支 20 分钟访谈片，仅负责字幕和粗剪。2024 年取得日语 N3，不能据此推定口语或翻译能力。',request_id:randomUUID()});await v.call('get_observation',{id:old.id});
 await v.call('update_archive_tags',{archive_id:archive.id,expected_version:2,changes:[skill,resource,language].map(t=>({tag_id:t.id,action:'add',evidence:[{kind:'observation',note:'2026-08-20 本人明确自述，范围见观察，不扩展为额外能力。',observation_id:old.id,content_version:1}]})),request_id:randomUUID()});
 const r=await v.http('/connections',{name:'Codex 材料整理冷启动验收 '+suffix,days:1});assert.equal(r.status,200);connection=r.body;
 writeFileSync(join(clientHome,'config.toml'),baseline+`\n[mcp_servers.cts_staging]\nurl = ${JSON.stringify(v.base+'/mcp')}\nhttp_headers = { Authorization = ${JSON.stringify('Bearer '+connection.secret)} }\nstartup_timeout_sec = 30\n`,{mode:0o600});
 writeFileSync(join(root,'fixture.json'),JSON.stringify({archive_id:archive.id,name,old_observation_id:old.id,chat},null,2));
 const primary=await run('primary',`请使用已经接好的康米巨星猎头系统，把下面聊天整理进人物「${name}」的档案。这是隔离测试环境的虚构材料，已授权在这份档案内保存必要整理结果。\n\n${chat}`);
 let current=(await v.call('get_archive',{id:archive.id})).archive,observations=(await v.call('list_observations',{archive_id:archive.id})).observations,bound=(await v.call('get_archive_tags',{archive_id:archive.id})).tags;
 writeFileSync(join(root,'primary-artifacts.json'),JSON.stringify({archive:current,observations,tags:bound},null,2));
 assert.ok(observations.length>1,'new facts become observations');assert.ok(bound.some(t=>t.tag_id===skill.id),'resource handover does not remove video skill');assert.ok(!bound.some(t=>t.tag_id===resource.id),'explicit loss of publishing access removes channel resource');assert.ok(bound.some(t=>t.tag_id===language.id),'unmentioned Japanese stays');assert.ok(bound.some(t=>/音频|音訊|声音/.test(t.name)&&t.category_id===category.id),'new supported audio capability creates and binds an appropriate skill');assert.ok(bound.some(t=>t.name==='固定时段'),'dated availability reuses existing definition');assert.ok(!bound.some(t=>t.name==='软件开发'||t.name==='英语'||/Blender|三维|3D/.test(t.name)),'other speakers and learning plans are not inferred capabilities');assert.ok(bound.filter(t=>t.tag_id!==language.id&&t.tag_id!==skill.id).every(t=>t.evidence.length>0));
 if(!hadAudio)assert.ok(primary.calls.some(c=>c.tool==='create_tag'&&c.outcome==='success'));assert.ok(primary.calls.some(c=>c.task_id));
 checks.push('real cold Codex session publishes supported facts, reuses and creates tags, removes changed resource, preserves unmentioned skill/language and speaker boundaries');
 if(!primaryOnly){
 const beforeVersion=current.version,beforeCount=observations.length;
 const repeated=await run('no-new-material',`请用康米巨星猎头系统整理进人物「${name}」的档案。我再次转发的是刚才完全相同的聊天，没有补充或纠正：\n\n${chat}`);
 current=(await v.call('get_archive',{id:archive.id})).archive;assert.equal(current.version,beforeVersion);assert.equal(current.observation_count,beforeCount);assert.match(repeated.final,/没有|无新增|无需|重复|未新增/);checks.push('independent cold session recognizes repeated material and makes no business changes');
 const ambiguousName='虚构同名小川 '+suffix,a=await v.call('create_archive',{type:'person',name:ambiguousName,contacts:[{type:'QQ',value:'112233445',note:'虚构甲'}],request_id:randomUUID()}),b=await v.call('create_archive',{type:'person',name:ambiguousName,contacts:[{type:'QQ',value:'556677889',note:'虚构乙'}],request_id:randomUUID()});
 const ambiguity=await run('same-name',`请将「我这周开始负责视频后期」整理进人物「${ambiguousName}」的档案。`);assert.equal((await v.call('get_archive',{id:a.id})).archive.version,1);assert.equal((await v.call('get_archive',{id:b.id})).archive.version,1);assert.match(ambiguity.final,/哪|同名|确认|112233445|556677889/);checks.push('same-name ambiguity requests identifying information without guessing or writing');
 const conflictBefore=(await v.call('get_archive',{id:archive.id})).archive;
 const conflict=await run('conflicting-material',`请整理进人物「${name}」的档案：有人转发一句话「他九月周三晚上都没空」。没有说明发言者、转发时间，也不知道「他」是不是阿禾。`);
 const conflictTags=(await v.call('get_archive_tags',{archive_id:archive.id})).tags;assert.ok(conflictTags.some(t=>t.name==='固定时段'));assert.ok(conflict.calls.some(c=>['get_archive_tags','list_observations','get_observation'].includes(c.tool)));assert.match(conflict.final,/确认|不确定|无法|需要|来源|歧义|核实|不明|未知/);checks.push('conflicting unsourced material triggers old-evidence review and does not silently remove established availability');
 const open=await v.call('create_archive',{type:'person',name:'虚构部分成功开启 '+suffix,request_id:randomUUID()}),closed=await v.call('create_archive',{type:'person',name:'虚构部分成功关闭 '+suffix,status:'已弃用',request_id:randomUUID()});
 const partial=await run('partial-completion',`请分别给「虚构部分成功开启 ${suffix}」和「虚构部分成功关闭 ${suffix}」各记一条观察：2026-09-08 本人明确表示愿意先看项目说明，再决定是否参与。请按这两个档案各自当前状态办理，能办的先完成；不更改业务状态。`);
 assert.equal((await v.call('get_archive',{id:open.id})).archive.observation_count,1);assert.equal((await v.call('get_archive',{id:closed.id})).archive.observation_count,0);assert.equal((await v.call('get_archive',{id:closed.id})).archive.closed,true);assert.match(partial.final,/关闭|未完成|未写|无法|不能/);checks.push('multi-object partial completion reports actual success and remaining closed object without implicit reopening');
 const recovery=await v.call('create_archive',{type:'person',name:'虚构响应丢失恢复 '+suffix,request_id:randomUUID()});let dropped=false;
 // This isolated relay forwards real authenticated calls, then discards exactly one successful
 // synthetic create response. The service still commits and journals the real operation.
 relay=createServer(async(req,res)=>{try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024){res.writeHead(413).end();return;}chunks.push(chunk);}const body=Buffer.concat(chunks),rpc=body.length?JSON.parse(body.toString()):null,headers={};for(const name of ['authorization','content-type','accept','mcp-protocol-version','mcp-session-id'])if(req.headers[name])headers[name]=req.headers[name];const response=await fetch(v.base+'/mcp',{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body});const text=await response.text();
   if(!dropped&&rpc?.method==='tools/call'&&rpc.params?.name==='create_observation'&&rpc.params.arguments?.archive_id===recovery.id&&response.status===200&&text.includes('"changed":true')){dropped=true;res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Acceptance fixture: response lost after server commit; original request result is unknown to this client.'}));return;}
   res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'application/json'}).end(text);
  }catch{res.writeHead(502,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Fixture relay transport failure'}));}});
 await new Promise(ok=>relay.listen(0,'127.0.0.1',ok));const relayAddress=relay.address();
 writeFileSync(join(clientHome,'config.toml'),baseline+`\n[mcp_servers.cts_staging]\nurl = ${JSON.stringify('http://127.0.0.1:'+relayAddress.port+'/mcp')}\nhttp_headers = { Authorization = ${JSON.stringify('Bearer '+connection.secret)} }\nstartup_timeout_sec = 30\n`,{mode:0o600});
 const recovered=await run('lost-response',`请用已连接的系统给「虚构响应丢失恢复 ${suffix}」补充观察：2026-09-08，本人明确表示本月愿意按项目参与音频后期，具体排期另行约定。把有依据且适用的标签一并整理好。这是已授权的虚构验收资料。`);
 assert.equal(dropped,true,'the intended response-loss fixture was exercised');assert.equal((await v.call('get_archive',{id:recovery.id})).archive.observation_count,1,'recovery does not duplicate committed observation');assert.ok(recovered.calls.some(c=>c.tool==='get_request_result'||(c.tool==='create_observation'&&c.outcome==='no_change')),'agent recovers using receipt or original request retry');assert.ok((await v.call('get_archive_tags',{archive_id:recovery.id})).tags.some(t=>t.name==='项目制'),'remaining supported tagging completes');checks.push('real Codex recovers a deliberately lost post-commit response using the original request and completes remaining tagging without duplicate observations');
 }
 writeFileSync(primaryOnly?'tmp/verification/codex-compression-refined-detail-cloud.json':'tmp/verification/codex-compression-detail-cloud.json',JSON.stringify({date:new Date().toISOString(),base:v.base,fixture:name,checks,rounds,artifacts:{observations,tags:bound},quality_review:'pending manual reading; protocol assertions alone do not grade compression quality'},null,2));
}finally{
 if(relay)await new Promise(ok=>relay.close(ok));
 if(connection)await v.http('/connections/revoke',{id:connection.id});
 if(existsSync(join(clientHome,'auth.json')))unlinkSync(join(clientHome,'auth.json'));
 // The one-day test bearer is revoked above. Remove it from the private test configuration too.
 if(existsSync(join(clientHome,'config.toml')))writeFileSync(join(clientHome,'config.toml'),baseline+'\n');
 await v.close(checks);
}
