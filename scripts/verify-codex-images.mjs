import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
import {runInteractiveCodex} from './codex-interactive-client.mjs';
const resumeAt=process.argv.indexOf('--resume-upload');let resumed;
if(resumeAt>=0){const path=resolve(process.argv[resumeAt+1]??'');const location=relative(resolve('secrets'),path);assert.ok(location&&!location.startsWith('..')&&!isAbsolute(location));resumed=JSON.parse(readFileSync(path,'utf8'));}
const v=await verificationClient('codex-images',{environment:process.argv.includes('--production')?'production':'staging'}),checks=[],rounds=[];assert.ok(['cloud','production'].includes(v.target));
const suffix=randomUUID().slice(0,8),root=resolve('secrets','codex-images-'+suffix),clientHome=join(root,'client'),work=join(root,'work');mkdirSync(clientHome,{recursive:true});mkdirSync(work,{recursive:true});
const originalHome=join(process.env.USERPROFILE,'.codex'),baseline=readFileSync(join(originalHome,'config.toml'),'utf8').split(/\r?\n/).filter(x=>/^(model|model_reasoning_effort)\s*=/.test(x)).join('\n');copyFileSync(join(originalHome,'auth.json'),join(clientHome,'auth.json'));
for(const ext of ['png','jpg','webp'])copyFileSync(resolve('tests','fixtures','images','shapes.'+ext),join(work,'fixture.'+ext));
const extensions=join(process.env.USERPROFILE,'.vscode','extensions'),cli=readdirSync(extensions).filter(x=>x.startsWith('openai.chatgpt-')).sort().reverse().map(x=>join(extensions,x,'bin','windows-x86_64','codex.exe')).find(existsSync);assert.ok(cli);let connection;
async function run(round,prompt){
 const path=join(root,round);const start=Date.now();console.log(JSON.stringify({round,status:'started'}));
 const {output,final}=await runInteractiveCodex({cli,clientHome,work,path,prompt});
 assert.ok(!output.includes(connection.secret),'MCP credential must not enter transcript');assert.ok(!/ctsu_[a-f0-9]{64}|cts_[a-f0-9]{64}/.test(final),'secrets do not enter final text');
 const calls=(await v.http('/admin/calls?limit=100')).body.calls.filter(c=>c.credential_id===connection.id&&Date.parse(c.started_at)>=start);assert.ok(calls.some(c=>c.tool==='whoami'&&c.outcome==='success'));rounds.push({round,elapsed_ms:Date.now()-start,tools:calls.map(c=>({tool:c.tool,outcome:c.outcome,error_code:c.error_code})),final});console.log(JSON.stringify({round,status:'finished',calls:calls.length,elapsed_ms:Date.now()-start}));writeFileSync(join(root,'rounds.json'),JSON.stringify(rounds,null,2));return {calls,final};
}
try{
 const name=resumed?.name??'虚构冷启动图像 '+suffix,archive=resumed?{id:resumed.archive_id}:await v.call('create_archive',{type:'person',name,request_id:randomUUID()});
 assert.equal((await v.call('list_observations',{archive_id:archive.id})).observations.length,0,'upload resume must not duplicate an existing publication');
 writeFileSync(join(root,'fixture.json'),JSON.stringify({name,archive_id:archive.id},null,2),{mode:0o600});
 connection=(await v.http('/connections',{name:'Codex 图像冷启动 '+suffix,days:1})).body;
 writeFileSync(join(clientHome,'config.toml'),baseline+`\n[mcp_servers.cts_staging]\nurl = ${JSON.stringify(v.base+'/mcp')}\nhttp_headers = { Authorization = ${JSON.stringify('Bearer '+connection.secret)} }\nstartup_timeout_sec = 30\n`,{mode:0o600});
 const first=await run('upload',`请使用已经接好的康米巨星猎头系统，为人物「${name}」发布一条观察。当前工作目录的 fixture.png 和 fixture.jpg 都是本次验收专用的虚构图片，我已经授权你读取这两个本地文件，并用 HTTP PUT 把原始字节上传到系统返回的上传地址。两张都要保留。上传后请从系统取回图片查看，在观察正文中简短记录画面的主要图形和颜色，并注明这是虚构验收图，不解释操作过程。系统写入和文件上传均已授权，无需再等确认；不要回显秘密。`);
 const observations=(await v.call('list_observations',{archive_id:archive.id})).observations;assert.equal(observations.length,1);const record=observations[0];assert.equal(record.attachments.length,2);assert.match(record.body,/红/);assert.match(record.body,/蓝/);assert.match(record.body,/圆/);assert.match(record.body,/方|矩形/);assert.ok(first.calls.some(c=>c.tool==='get_image'&&c.outcome==='success'));assert.equal(first.calls.filter(c=>c.tool==='prepare_image_upload'&&c.outcome==='success').length,2);assert.ok(first.calls.some(c=>c.tool==='get_upload_status'&&c.outcome==='success'));
 checks.push('real cold Codex reads two authorized local files, prepares and performs HTTP PUT, verifies readiness, retrieves MCP image content and publishes two images with accurate visual observations');
 const second=await run('edit-history',`请在康米巨星猎头系统的人物「${name}」中编辑刚才那条虚构图像观察：当前版本移除 PNG，保留 JPEG，并添加当前工作目录里的 fixture.webp。此文件也是虚构验收图片，已授权本地读取及 HTTP PUT 上传到系统返回的上传地址。正文保留原意。完成后检查上一版本还能取回原 PNG，并从系统读取那张旧图核对主要形状和颜色。已授权这次编辑和图片上传，无需再次确认，不回显秘密。`);
 const current=(await v.call('get_observation',{id:record.id})).observation,history=(await v.call('list_observation_versions',{id:record.id})).versions;assert.equal(current.content_version,2);assert.deepEqual(current.attachments.map(i=>i.mime_type).sort(),['image/jpeg','image/webp']);assert.deepEqual(history[1].attachments.map(i=>i.id),record.attachments.map(i=>i.id));assert.ok(second.calls.some(c=>c.tool==='list_observation_versions'&&c.outcome==='success'));assert.ok(second.calls.some(c=>c.tool==='get_image'&&c.outcome==='success'));assert.equal((await v.http('/observations/'+record.id)).body.observation.content_version,2);assert.equal((await v.http('/observations/'+record.id+'/versions')).body.versions[1].attachments.length,2);
 checks.push('another real cold Codex session edits JPEG/WebP attachments and reads the original PNG from immutable history; independent web API reads agree');
 writeFileSync('tmp/verification/codex-images-detail-'+v.target+'.json',JSON.stringify({date:new Date().toISOString(),base:v.base,archive_id:archive.id,archive_name:name,observation:current,history,checks,rounds,web_visual_check:'pending actual browser control'},null,2));
}finally{if(connection)await v.http('/connections/revoke',{id:connection.id});if(existsSync(join(clientHome,'auth.json')))unlinkSync(join(clientHome,'auth.json'));if(existsSync(join(clientHome,'config.toml')))writeFileSync(join(clientHome,'config.toml'),baseline+'\n');await v.close(checks);}
