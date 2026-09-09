import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
import {runInteractiveCodex} from './codex-interactive-client.mjs';
const v=await verificationClient('codex-archive-lifecycle',{environment:process.argv.includes('--production')?'production':'staging'}),checks=[],rounds=[];
assert.ok(['cloud','production'].includes(v.target),'real Codex acceptance requires an explicitly selected cloud environment');
const suffix=randomUUID().slice(0,8),root=resolve('secrets','codex-archive-lifecycle-'+suffix),clientHome=join(root,'client'),work=join(root,'work');mkdirSync(clientHome,{recursive:true});mkdirSync(work,{recursive:true});
const originalHome=join(process.env.USERPROFILE,'.codex'),baseline=readFileSync(join(originalHome,'config.toml'),'utf8').split(/\r?\n/).filter(x=>/^(model|model_reasoning_effort)\s*=/.test(x)).join('\n');
copyFileSync(join(originalHome,'auth.json'),join(clientHome,'auth.json'));
const extensions=join(process.env.USERPROFILE,'.vscode','extensions'),cli=readdirSync(extensions).filter(x=>x.startsWith('openai.chatgpt-')).sort().reverse().map(x=>join(extensions,x,'bin','windows-x86_64','codex.exe')).find(existsSync);assert.ok(cli);
let connection;
const name='虚构档案回收冷启动 '+suffix;
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
 const archive=await v.call('create_archive',{type:'person',name,request_id:randomUUID()}),record=await v.call('create_observation',{archive_id:archive.id,body:'虚构档案回收验收：恢复后保留本条原始观察。',request_id:randomUUID()});let a=(await v.call('get_archive',{id:archive.id})).archive;await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:randomUUID()});
 connection=(await v.http('/connections',{name:'Codex 档案回收验收 '+suffix,days:1})).body;
 writeFileSync(join(clientHome,'config.toml'),baseline+`\n[mcp_servers.cts_staging]\nurl = ${JSON.stringify(v.base+'/mcp')}\nhttp_headers = { Authorization = ${JSON.stringify('Bearer '+connection.secret)} }\nstartup_timeout_sec = 30\n`,{mode:0o600});
 writeFileSync(join(root,'fixture.json'),JSON.stringify({archive_id:archive.id,observation_id:record.id},null,2));
 const result=await run('archive-trash-restore',`请验收人物「${name}」（档案 ID ${archive.id}）的回收与恢复。这是本次专用虚构档案，已明确授权把整个档案移入回收，再恢复同一档案；这是可恢复删除，不永久清理。请实际依次完成并核对每一步，恢复后仍保持已关闭/已弃用状态，不重新开启，保留原观察 ${record.id} 的身份、作者和正文。不要操作其他档案。`);
 assert.ok(result.calls.some(c=>c.tool==='delete_archive'&&c.outcome==='success'));assert.ok(result.calls.some(c=>c.tool==='restore_archive'&&c.outcome==='success'));a=(await v.call('get_archive',{id:archive.id})).archive;assert.equal(a.deleted,false);assert.equal(a.closed,true);assert.equal(a.status,'已弃用');assert.equal((await v.call('get_observation',{id:record.id})).observation.body,'虚构档案回收验收：恢复后保留本条原始观察。');checks.push('actual production Codex recycles and restores the same closed archive, preserving status and original observation');
 writeFileSync('tmp/verification/codex-archive-lifecycle-detail-'+v.target+'.json',JSON.stringify({date:new Date().toISOString(),base:v.base,archive_id:archive.id,checks,rounds},null,2));
}finally{if(connection)await v.http('/connections/revoke',{id:connection.id});if(existsSync(join(clientHome,'auth.json')))unlinkSync(join(clientHome,'auth.json'));if(existsSync(join(clientHome,'config.toml')))writeFileSync(join(clientHome,'config.toml'),baseline+'\n');await v.close(checks);}
