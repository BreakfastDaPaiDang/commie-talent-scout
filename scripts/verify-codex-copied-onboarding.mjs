import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {verificationClient} from './verification-client.mjs';
import {runInteractiveCodex} from './codex-interactive-client.mjs';
const index=process.argv.indexOf('--fixture'),root=resolve(process.argv[index+1]??'');assert.ok(index>=0);const within=relative(resolve('secrets'),root);assert.ok(within&&!within.startsWith('..')&&!isAbsolute(within));
const fixture=JSON.parse(readFileSync(join(root,'fixture.json'),'utf8')),prompt=readFileSync(join(root,'prompt.txt'),'utf8');
const config=JSON.parse(prompt.split('认证配置：\n')[1].split('\n凭据到期：')[0]).mcpServers.commie_talent_scout,secret=config.headers.Authorization.slice(7);
const v=await verificationClient('codex-copied-onboarding',{environment:process.argv.includes('--production')?'production':'staging'}),checks=[];assert.equal(v.base,fixture.base);assert.equal(v.actor.id,fixture.actor_id);
const clientHome=join(root,'client'),work=clientHome;mkdirSync(clientHome,{recursive:true});
const originalHome=join(process.env.USERPROFILE,'.codex'),baseline=readFileSync(join(originalHome,'config.toml'),'utf8').split(/\r?\n/).filter(x=>/^(model|model_reasoning_effort)\s*=/.test(x)).join('\n');
copyFileSync(join(originalHome,'auth.json'),join(clientHome,'auth.json'));const configPath=join(clientHome,'config.toml');writeFileSync(configPath,baseline+'\n',{mode:0o600});
const extensions=join(process.env.USERPROFILE,'.vscode','extensions'),cli=readdirSync(extensions).filter(x=>x.startsWith('openai.chatgpt-')).sort().reverse().map(x=>join(extensions,x,'bin','windows-x86_64','codex.exe')).find(existsSync);assert.ok(cli);
try{
 console.log(JSON.stringify({round:'configure-from-copy',status:'started',fixture:root}));
 const first=await runInteractiveCodex({cli,clientHome,work,path:join(root,'configure'),requireMcp:false,sandbox:'workspace-write',redactValues:[secret],prompt:prompt+`\n\n我已选择持久配置，保存到当前验收专用 Codex 客户端的用户级私有配置。CODEX_HOME 是 ${clientHome}，只允许修改这份隔离客户端配置并保留已有设置。你没有浏览器工具，直接使用上面复制的认证信息，不访问网页登录入口。配置完成后说明保存证据；新会话由外部验收程序真正冷启动，不要自行启动第二个 Codex 进程。`});
 assert.ok(!first.final.includes(secret),'final response must not echo the credential');const saved=readFileSync(configPath,'utf8');for(const line of baseline.split('\n'))assert.ok(saved.includes(line),'existing model settings preserved');assert.ok(saved.includes(config.url));checks.push('a real Codex session starts without MCP configuration and persists the browser-copied connection in its isolated private client');
 const started=Date.now();console.log(JSON.stringify({round:'independent-cold-session',status:'started'}));
 const fresh=await runInteractiveCodex({cli,clientHome,work,path:join(root,'fresh'),serverName:'commie_talent_scout',redactValues:[secret],prompt:'这是独立新会话。请通过已配置的康米巨星猎头系统 MCP 确认服务环境、成员身份和实际能力，读取接入使用指南，然后报告本次实际连通结果。不要修改配置，也不要索要任何凭据。'});
 assert.ok(!fresh.final.includes(secret));assert.equal(readFileSync(configPath,'utf8'),saved);const calls=(await v.http('/admin/calls?limit=100')).body.calls.filter(c=>c.credential_id===fixture.connection_id&&Date.parse(c.started_at)>=started);assert.ok(calls.some(c=>c.tool==='whoami'&&c.outcome==='success'));assert.ok(calls.some(c=>c.tool==='get_usage_guide'&&c.outcome==='success'));assert.ok(fresh.output.includes(fixture.actor_id));checks.push('an independent app-server process authenticates from the saved configuration without temporary credential injection or browser login and retrieves the service guide');
 mkdirSync('tmp/verification',{recursive:true});writeFileSync('tmp/verification/codex-copied-onboarding-detail-'+v.target+'.json',JSON.stringify({date:new Date().toISOString(),base:v.base,checks,configured_from_copied_prompt:true,preconfigured_mcp:false,new_process_verified:true,rounds:[{round:'configure',final:first.final},{round:'fresh',final:fresh.final}],tools:calls.map(c=>({tool:c.tool,outcome:c.outcome}))},null,2));
}finally{await v.http('/connections/revoke',{id:fixture.connection_id});if(existsSync(join(clientHome,'auth.json')))unlinkSync(join(clientHome,'auth.json'));if(existsSync(configPath))writeFileSync(configPath,baseline+'\n');await v.close(checks);}
