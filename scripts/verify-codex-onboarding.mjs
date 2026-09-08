import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,existsSync,unlinkSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const mode=process.argv[2]??'temporary';
assert.ok(['unselected','temporary','persistent'].includes(mode));
const base='https://scout-staging.dapaidang.org';
assert.equal((await fetch(base+'/api/health').then(r=>r.json())).environment,'staging');
const originalHome=join(process.env.USERPROFILE,'.codex');
const root=resolve('secrets','codex-onboarding-'+mode),clientHome=join(root,'client'),work=join(root,'work');
mkdirSync(clientHome,{recursive:true});mkdirSync(work,{recursive:true});
copyFileSync(join(originalHome,'auth.json'),join(clientHome,'auth.json'));
const baseline=readFileSync(join(originalHome,'config.toml'),'utf8').split(/\r?\n/).filter(x=>/^(model|model_reasoning_effort)\s*=/.test(x)).join('\n');
const extensionRoot=join(process.env.USERPROFILE,'.vscode','extensions');
const candidates=readdirSync(extensionRoot).filter(x=>x.startsWith('openai.chatgpt-')).sort().reverse().map(x=>join(extensionRoot,x,'bin','windows-x86_64','codex.exe'));
const cli=candidates.find(existsSync);assert.ok(cli,'Codex CLI is available');
const configPath=join(clientHome,'config.toml');
let cookie,credential;
const admin=JSON.parse(readFileSync('secrets/bootstrap-staging-remote-admin.json','utf8'));
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:admin.username,password:admin.password})});
assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
const member=(await login.json()).member;
const saved=[];
try{
  if(mode!=='unselected'){
    const response=await fetch(base+'/api/connections',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:`Codex ${mode} 验收 ${randomUUID().slice(0,8)}`,days:1})});assert.equal(response.status,200);credential=await response.json();
    writeFileSync(join(root,'connection.json'),JSON.stringify(credential,null,2),{mode:0o600});
  }
  let config=baseline+'\n';
  if(mode==='persistent')config+=`\n[mcp_servers.cts_staging]\nurl = ${JSON.stringify(base+'/mcp')}\nhttp_headers = { Authorization = ${JSON.stringify('Bearer '+credential.secret)} }\nstartup_timeout_sec = 30\n`;
  writeFileSync(configPath,config,{mode:0o600});
  const prompt=readFileSync('app/shared/bootstrap-prompt.txt','utf8').replace('{{MCP_SERVER_URL}}',base+'/mcp').replace('{{AUTHORIZATION_GUIDE}}',base+'/account/connections');
  const modes=mode==='persistent'?['first','fresh']:['first'];
  for(const round of modes){
    // The private client root isolates acceptance configuration from the maintainer's real client.
    // Each process gets a fresh environment; the persistent case deliberately removes temporary bearer injection.
    const childEnv={...process.env,CODEX_HOME:clientHome,PATH:dirname(cli)+';'+process.env.PATH};
    delete childEnv.CTS_MCP_TEST_BEARER;
    const args=['exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--output-last-message',join(root,round+'-final.txt'),'-C',work];
    if(mode==='temporary'){
      childEnv.CTS_MCP_TEST_BEARER=credential.secret;
      args.push('-c',`mcp_servers.cts_staging.url=${JSON.stringify(base+'/mcp')}`,'-c','mcp_servers.cts_staging.bearer_token_env_var="CTS_MCP_TEST_BEARER"','-c','mcp_servers.cts_staging.startup_timeout_sec=30');
    }
    const scope=mode==='unselected'?'':mode==='temporary'?'\n\n我选择仅本次临时连接。':'\n\n我已选择持久配置，请复用并核对当前客户端已有的连接。';
    const context=round==='fresh'?'\n这是独立新会话，没有继承上次临时注入的认证变量。核对身份后报告本次证据，不再另起客户端进程。':'';
    args.push('-');
    const start=Date.now();
    const run=spawn(cli,args,{cwd:work,env:childEnv,stdio:['pipe','pipe','pipe']});
    let output='',errors='';run.stdout.on('data',x=>output+=x);run.stderr.on('data',x=>errors+=x);run.stdin.end(prompt+scope+context);
    const exit=await new Promise((resolveRun,reject)=>{run.on('error',reject);run.on('exit',resolveRun);});
    writeFileSync(join(root,round+'-events.jsonl'),output,{mode:0o600});writeFileSync(join(root,round+'-stderr.txt'),errors,{mode:0o600});
    assert.equal(exit,0,'Codex client exits successfully; inspect private diagnostic output on failure');
    assert.ok(!credential||!output.includes(credential.secret),'Codex transcript does not echo the MCP secret');
    const final=readFileSync(join(root,round+'-final.txt'),'utf8');
    saved.push({round,elapsedMs:Date.now()-start,final});
    assert.equal(readFileSync(configPath,'utf8'),config,'existing client configuration remains unchanged');
    if(mode!=='unselected'){
      const calls=await fetch(base+'/api/admin/calls?limit=100',{headers:{Cookie:cookie}}).then(r=>r.json());
      assert.ok(calls.calls.some(x=>x.credential_id===credential.id&&x.tool==='whoami'&&x.outcome==='success'&&new Date(x.started_at).valueOf()>=start),'actual Codex identity call appears in the service journal');
      assert.ok(output.includes(member.id),'identity result belongs to the expected member');
    }else{assert.match(final,/是否[^\n]*持久|持久[^\n]*[？?]/,'unselected persistence is asked, not silently saved');}
    console.log(JSON.stringify({mode,round,passed:true,elapsedMs:Date.now()-start}));
  }
  const report={date:new Date().toISOString(),base,mode,client:'Codex CLI 0.153.0',configScope:'isolated private client root for product acceptance',temporaryBearerProvided:mode==='temporary',newIndependentProcessVerified:mode==='persistent',rounds:saved};
  mkdirSync('tmp/verification',{recursive:true});writeFileSync(`tmp/verification/codex-onboarding-${mode}.json`,JSON.stringify(report,null,2));
}finally{
  if(credential)await fetch(base+'/api/connections/revoke',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({id:credential.id})}).catch(()=>{});
  await fetch(base+'/api/auth/logout',{method:'POST',headers:{Origin:base,Cookie:cookie}}).catch(()=>{});
  // Remove the copied ChatGPT login credential after the isolated client exits.
  if(existsSync(join(clientHome,'auth.json')))unlinkSync(join(clientHome,'auth.json'));
}
