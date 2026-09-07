import { readFile,writeFile,mkdir } from 'node:fs/promises';
const base=process.env.BASE_URL??'http://127.0.0.1:8787';
const {tokens}=JSON.parse((await readFile(new URL('./test-credentials.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const results=[];
let admin;
for(const name of ['admin','admin2']){
  const response=await fetch(base+'/api/whoami',{headers:{Authorization:`Bearer ${tokens[name]}`},signal:AbortSignal.timeout(30000)});
  if((await response.json()).role==='admin'){admin=name;break;}
}
if(!admin)throw new Error('No active synthetic admin');
for(const path of ['/probe/password','/probe/scrypt']){
  const started=performance.now();
  const response=await fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${tokens[admin]}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});
  const result={path,status:response.status,totalMs:Math.round(performance.now()-started),body:await response.text()};
  try{result.body=JSON.parse(result.body);}catch{}
  results.push(result);console.log(JSON.stringify(result));
}
await mkdir(new URL('./test-output/',import.meta.url),{recursive:true});
await writeFile(new URL(`./test-output/${base.includes('127.0.0.1')?'local':'remote'}-kdf.json`,import.meta.url),JSON.stringify({at:new Date().toISOString(),base,results},null,2));
