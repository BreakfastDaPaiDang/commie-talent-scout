import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
import {runInteractiveCodex} from './codex-interactive-client.mjs';
const resumeAt=process.argv.indexOf('--resume-after-delete');
let resumed;
if(resumeAt>=0){const path=resolve(process.argv[resumeAt+1]??'');const location=relative(resolve('secrets'),path);assert.ok(location&&!location.startsWith('..')&&!isAbsolute(location));resumed=JSON.parse(readFileSync(path,'utf8'));}
const v=await verificationClient('codex-observation-state'),checks=[],rounds=[];
assert.equal(v.target,'cloud','real Codex cold-session acceptance uses isolated staging');
const suffix=randomUUID().slice(0,8),root=resolve('secrets','codex-observation-state-'+suffix),clientHome=join(root,'client'),work=join(root,'work');mkdirSync(clientHome,{recursive:true});mkdirSync(work,{recursive:true});
const originalHome=join(process.env.USERPROFILE,'.codex'),baseline=readFileSync(join(originalHome,'config.toml'),'utf8').split(/\r?\n/).filter(x=>/^(model|model_reasoning_effort)\s*=/.test(x)).join('\n');
copyFileSync(join(originalHome,'auth.json'),join(clientHome,'auth.json'));
const extensions=join(process.env.USERPROFILE,'.vscode','extensions'),cli=readdirSync(extensions).filter(x=>x.startsWith('openai.chatgpt-')).sort().reverse().map(x=>join(extensions,x,'bin','windows-x86_64','codex.exe')).find(existsSync);assert.ok(cli);
let connection;
const name=resumed?.name??'虚构删除恢复冷启动 '+suffix;
async function run(round,prompt){
 const path=join(root,round);
 const start=Date.now();console.log(JSON.stringify({round,status:'started'}));
 const {output,final}=await runInteractiveCodex({cli,clientHome,work,path,prompt});
 assert.ok(!output.includes(connection.secret),'no MCP secret in transcript');assert.ok(!final.includes(connection.secret));
 const calls=(await v.http('/admin/calls?limit=100')).body.calls.filter(c=>c.credential_id===connection.id&&new Date(c.started_at).valueOf()>=start);
 assert.ok(calls.some(c=>c.tool==='whoami'&&c.outcome==='success'),'cold session checks service identity');
 rounds.push({round,elapsed_ms:Date.now()-start,tools:calls.map(c=>({tool:c.tool,outcome:c.outcome,error_code:c.error_code,task_id:c.task_id})),final});writeFileSync(join(root,'rounds.json'),JSON.stringify(rounds,null,2));console.log(JSON.stringify({round,status:'finished',elapsed_ms:Date.now()-start,calls:calls.length}));return {final,calls,output};
}
try{
 const archive=resumed?{id:resumed.archive_id}:await v.call('create_archive',{type:'person',name,request_id:randomUUID()});
 const record=resumed?{id:resumed.observation_id}:await v.call('create_observation',{archive_id:archive.id,body:'虚构删除恢复验收：这条材料由测试成员误发，恢复后仍应保留原始作者。',request_id:randomUUID()});
 writeFileSync(join(root,'fixture.json'),JSON.stringify({name,archive_id:archive.id,observation_id:record.id},null,2),{mode:0o600});
 const c=await v.http('/connections',{name:'Codex 删除恢复验收 '+suffix,days:1});assert.equal(c.status,200);connection=c.body;
 writeFileSync(join(clientHome,'config.toml'),baseline+`\n[mcp_servers.cts_staging]\nurl = ${JSON.stringify(v.base+'/mcp')}\nhttp_headers = { Authorization = ${JSON.stringify('Bearer '+connection.secret)} }\nstartup_timeout_sec = 30\n`,{mode:0o600});
 if(resumed){
  const calls=(await v.http('/admin/calls?limit=100')).body.calls;
  const evidence=calls.find(call=>call.id===resumed.deletion_call_id&&call.request_id===resumed.deletion_request_id&&call.tool==='delete_observation'&&call.outcome==='success');
  assert.ok(evidence,'resume requires the successful original Codex deletion receipt');
  rounds.push({round:'delete',resumed_after_client_timeout:true,tools:[{tool:evidence.tool,outcome:evidence.outcome,error_code:evidence.error_code}],final:null});
 }else await run('delete',`请使用已连接的猎头系统，删除人物「${name}」档案内观察 ID ${record.id}。这是隔离测试站的虚构误发内容，已明确授权可恢复删除这条记录。`);
 const deleted=(await v.call('get_observation',{id:record.id})).observation;assert.equal(deleted.deleted,true);assert.equal(deleted.version,2);assert.equal(deleted.content_version,1);assert.equal((await v.call('list_observations',{archive_id:archive.id})).observations.length,0);checks.push('real cold Codex reads identity and target then executes explicitly authorized recoverable deletion');
 await run('restore',`请使用已连接的猎头系统，恢复人物「${name}」档案内刚误删的观察 ID ${record.id}。这是明确的恢复要求，请保留原记录和作者。`);
 const restored=(await v.call('get_observation',{id:record.id})).observation;assert.equal(restored.deleted,false);assert.equal(restored.version,3);assert.equal(restored.content_version,1);assert.equal(restored.author_id,deleted.author_id);assert.equal((await v.call('list_observation_versions',{id:record.id})).versions.length,1);checks.push('second independent cold Codex session restores same record identity, author and immutable content history');
 let a=(await v.call('get_archive',{id:archive.id})).archive;await v.call('set_archive_state',{id:archive.id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:randomUUID()});
 const locked=await run('closed',`请删除人物「${name}」中的观察 ID ${record.id}。如果当前状态不允许，就如实说明，保持档案业务状态。`);assert.equal((await v.call('get_observation',{id:record.id})).observation.deleted,false);assert.equal((await v.call('get_archive',{id:archive.id})).archive.closed,true);assert.match(locked.final,/关闭|不能|无法/);checks.push('cold Codex respects current closed archive and reports inability without implicit reopening');
 writeFileSync('tmp/verification/codex-observation-state-detail-cloud.json',JSON.stringify({date:new Date().toISOString(),base:v.base,archive_id:archive.id,observation_id:record.id,checks,rounds},null,2));
}finally{
 if(connection)await v.http('/connections/revoke',{id:connection.id});
 if(existsSync(join(clientHome,'auth.json')))unlinkSync(join(clientHome,'auth.json'));
 if(existsSync(join(clientHome,'config.toml')))writeFileSync(join(clientHome,'config.toml'),baseline+'\n');
 await v.close(checks);
}
