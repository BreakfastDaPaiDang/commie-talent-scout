import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base='https://scout-staging.dapaidang.org';
assert.equal((await fetch(base+'/api/health').then(r=>r.json())).environment,'staging');
const admin=JSON.parse(readFileSync('secrets/bootstrap-staging-remote-admin.json','utf8'));
const tail=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','tail','--env','staging','--format','json'],{stdio:['ignore','pipe','pipe']});
let raw='';tail.stdout.on('data',x=>raw+=x);tail.stderr.on('data',()=>{});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const checks=[];
try{
  await sleep(9000);
  const attempt=async()=>{
    const start=performance.now();
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:admin.username,password:admin.password})});
    const result={status:response.status,elapsedMs:Math.round(performance.now()-start)};
    assert.ok([200,429].includes(response.status),'login succeeds or applies bounded concurrency');
    if(response.status===200){const cookie=response.headers.get('set-cookie').split(';')[0];await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:base}});}
    else{assert.equal((await response.json()).error.code,'PASSWORD_BUSY','concurrent requests only reject because the KDF slot is busy');}
    return result;
  };
  checks.push({mode:'single',results:[await attempt()]});
  checks.push({mode:'concurrent-three',results:await Promise.all([attempt(),attempt(),attempt()])});
  await sleep(4000);
}finally{
  if(tail.pid)spawnSync('taskkill.exe',['/PID',String(tail.pid),'/T','/F'],{stdio:'ignore'});
}
// Raw tail can contain Cookie/Authorization. Parse in memory; persist only these safe fields.
const events=[];let start=-1,depth=0,quoted=false,escaped=false;
for(let i=0;i<raw.length;i++){
  const c=raw[i];
  if(start<0){if(c==='{'){start=i;depth=1;}continue;}
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){
    try{const e=JSON.parse(raw.slice(start,i+1));if(e.event?.request?.url)events.push({path:new URL(e.event.request.url).pathname,cpuMs:e.cpuTime,wallMs:e.wallTime,outcome:e.outcome});}catch{}
    start=-1;
  }
}
assert.ok(events.some(x=>x.path==='/api/auth/login'&&Number.isFinite(x.cpuMs)),'cloud CPU timing is available');
assert.ok(events.every(x=>x.outcome==='ok'),'no CPU or memory exhaustion observed');
const report={date:new Date().toISOString(),base,checks,events,kdf:{perIsolateConcurrency:1,N:32768,r:8,p:3,maxmemBytes:67108864,approxWorkingMemoryBytes:33554432},memoryObservation:'No Worker memory-exhaustion outcome in this bounded load. Tail does not expose measured peak heap; maxmem is the KDF allocation limit, not measured total Worker memory.'};
writeFileSync('tmp/verification/auth-load-cloud.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
