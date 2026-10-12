import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),target=args[args.indexOf('--target')+1];assert.ok(['local','cloud','production'].includes(target),'Use --target local|cloud|production');
const base=target==='production'?'https://scout.dapaidang.org':target==='cloud'?'https://scout-staging.dapaidang.org':'http://127.0.0.1:8790',file=`secrets/zaoji-verification-${target}.json`;
assert.ok(!existsSync(file),'Credential file already exists; revoke/retain the prior credential and select a new file before renewal');
const adminFile=args.includes('--admin-file')?args[args.indexOf('--admin-file')+1]:target==='production'?'secrets/development-test-admin.json':`secrets/bootstrap-staging-${target==='cloud'?'remote':'local'}-admin.json`;
const admin=JSON.parse(readFileSync(adminFile,'utf8'));let cookie;
async function request(path,body){const r=await fetch(base+'/api'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const result=await r.json();assert.equal(r.status,200,result.error?.code);return {body:result,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
try{
 cookie=(await request('/auth/login',{username:admin.username,password:admin.password})).cookie;
 const issued=await request('/admin/service-connections/create',{name:'开发验收 · '+target,days:90});
 mkdirSync('secrets',{recursive:true});writeFileSync(file,JSON.stringify({base,...issued.body},null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({target,member_id:issued.body.member_id,expires_at:issued.body.expires_at,saved:file}));
}finally{if(cookie)await request('/auth/logout',{});}
