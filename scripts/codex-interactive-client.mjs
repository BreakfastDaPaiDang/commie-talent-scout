import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';

// An actual app-server client. Approval requests wait for a human response in
// <path>-reply.json; this harness never grants an approval automatically.
export async function runInteractiveCodex({cli,clientHome,work,path,prompt}) {
 const env={...process.env,CODEX_HOME:clientHome,PATH:dirname(cli)+';'+process.env.PATH};
 delete env.CTS_MCP_TEST_BEARER;
 const child=spawn(cli,['app-server'],{cwd:work,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let nextId=1,buffer='',errors='',final='',ended=false,turnId,threadId;
 const waiting=new Map(),approvals=new Map(),events=[];
 let finish,rejectCompletion;
 const completed=new Promise((resolve,reject)=>{finish=resolve;rejectCompletion=reject;});
 const fail=error=>{for(const pending of waiting.values())pending.reject(error);waiting.clear();rejectCompletion(error);};
 // A request can fail before the caller reaches the turn completion await.
 completed.catch(()=>{});
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 const request=(method,params)=>new Promise((resolve,reject)=>{
  const id=nextId++;waiting.set(id,{resolve,reject});send({id,method,params});
 });
 child.stderr.on('data',data=>errors+=data);
 child.on('error',fail);
 child.on('exit',code=>{if(!ended)fail(new Error('Codex app-server exited before completion: '+code));});
 child.stdout.on('data',data=>{
  buffer+=data;let newline;
  while((newline=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
   let message;try{message=JSON.parse(line);}catch{continue;}
   if(message.id!==undefined&&!message.method){
    const pending=waiting.get(message.id);if(!pending)continue;
    waiting.delete(message.id);message.error?pending.reject(new Error(JSON.stringify(message.error))):pending.resolve(message.result);continue;
   }
   if(message.id!==undefined&&message.method){
    approvals.set(message.id,message);
    writeFileSync(path+'-pending.json',JSON.stringify([...approvals.values()],null,2),{mode:0o600});
    console.log(JSON.stringify({status:'human_input_required',method:message.method,request_id:message.id,pending_file:path+'-pending.json'}));
    continue;
   }
   const p=message.params;
   if(message.method==='serverRequest/resolved'){
    approvals.delete(p.requestId);writeFileSync(path+'-pending.json',JSON.stringify([...approvals.values()],null,2),{mode:0o600});
   }
   if(message.method==='item/completed'){
    const item=p.item;
    if(item.type==='agentMessage'){final=item.text;events.push({method:message.method,item});}
    if(item.type==='mcpToolCall'){
     events.push({method:message.method,item});
     console.log(JSON.stringify({status:'mcp_call_completed',tool:item.tool,status_result:item.status}));
    }
   }
   if(message.method==='turn/completed'&&(!turnId||p.turn.id===turnId)){
    events.push(message);p.turn.status==='completed'?finish():fail(new Error('Codex turn '+p.turn.status));
   }
   if(message.method==='error')events.push(message);
  }
 });
 const timer=setInterval(()=>{
  const replyPath=path+'-reply.json';if(!existsSync(replyPath))return;
  try{
   const reply=JSON.parse(readFileSync(replyPath,'utf8'));
   assert.ok(approvals.has(reply.id),'reply must match an outstanding request');
   assert.ok(reply.human_confirmed===true||['decline','cancel'].includes(reply.result?.decision??reply.result?.action),'granting approval requires human confirmation');
   assert.ok(reply.result&&typeof reply.result==='object');
   unlinkSync(replyPath);send({id:reply.id,result:reply.result});approvals.delete(reply.id);timeout.refresh();
   writeFileSync(path+'-pending.json',JSON.stringify([...approvals.values()],null,2),{mode:0o600});
  }catch(error){fail(error);}
 },500);
 const timeout=setTimeout(()=>fail(new Error('Interactive acceptance timed out')),30*60*1000);
 try{
  await request('initialize',{clientInfo:{name:'cts_acceptance',title:'CTS acceptance',version:'0.1.0'},capabilities:{experimentalApi:true}});
  send({method:'initialized'});
  const started=await request('thread/start',{cwd:work,ephemeral:true,sandbox:'read-only',approvalPolicy:'on-request'});
  threadId=started.thread.id;
  const inventory=await request('mcpServerStatus/list',{threadId});
  const server=inventory.data.find(server=>server.name==='cts_staging');
  console.log(JSON.stringify({status:'mcp_inventory',connection:server?.runtimeStatus,tools:Object.keys(server?.tools??{}).length}));
  assert.ok(server&&Object.keys(server.tools).length,'MCP server must connect before acceptance starts');
  const turn=await request('turn/start',{threadId,input:[{type:'text',text:prompt}]});turnId=turn.turn.id;
  await completed;
  writeFileSync(path+'-final.txt',final,{mode:0o600});
  const output=events.map(event=>JSON.stringify(event)).join('\n');
  writeFileSync(path+'-events.jsonl',output,{mode:0o600});
  return {final,output};
 }finally{
  ended=true;clearInterval(timer);clearTimeout(timeout);
  writeFileSync(path+'-pending.json','[]',{mode:0o600});
  writeFileSync(path+'-events.jsonl',events.map(event=>JSON.stringify(event)).join('\n'),{mode:0o600});
  writeFileSync(path+'-stderr.txt',errors,{mode:0o600});
  child.kill();
 }
}
