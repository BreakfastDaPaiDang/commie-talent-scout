import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

const args=process.argv.slice(2), option=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
const base=option('base','http://127.0.0.1:8790');
const file=option('credentials','secrets/bootstrap-staging-local-admin.json');
const credentials=JSON.parse(readFileSync(file,'utf8'));
const health=await fetch(base+'/api/health').then(r=>r.json());
assert.equal(health.environment,'staging','Only isolated staging may be used for this behavioral verification');
let cookie='';const checks=[];
async function request(path,body,options={}){
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:options.origin??base}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  let data;try{data=await response.json();}catch{data=null;}
  return {status:response.status,data,cookie:response.headers.get('Set-Cookie')};
}
function check(name,result,status){assert.equal(result.status,status,name);checks.push({name,status:'passed'});}
check('anonymous workspace is private',await request('/api/workspace'),401);
check('wrong password is rejected',await request('/api/auth/login',{username:credentials.username,password:'not-the-correct-password'}),401);
const first=await request('/api/auth/login',{username:credentials.username,password:credentials.password});
check('real password signs in',first,200);
cookie=first.cookie.split(';')[0];
assert.match(first.cookie,/HttpOnly/);assert.match(first.cookie,/SameSite=Lax/);
if(base.startsWith('https:'))assert.match(first.cookie,/Secure/);
checks.push({name:'session cookie protects browser authentication',status:'passed'});
if(first.data.member.must_change_password)check('temporary password cannot access workspace',await request('/api/workspace'),403);
check('cross-origin write is rejected',await request('/api/auth/password',{current_password:credentials.password,new_password:'an-unused-new-password'}, {origin:'https://untrusted.invalid'}),403);
const newPassword=randomBytes(24).toString('base64url');
check('member changes their password',await request('/api/auth/password',{current_password:credentials.password,new_password:newPassword}),200);
credentials.password=newPassword;credentials.must_change_password=false;
writeFileSync(file,JSON.stringify(credentials,null,2),{mode:0o600});
check('previous session is invalid after password change',await request('/api/auth/me'),401);
cookie='';
const second=await request('/api/auth/login',{username:credentials.username,password:credentials.password});
check('new password signs in',second,200);cookie=second.cookie.split(';')[0];
check('changed password can access workspace',await request('/api/workspace'),200);
check('member signs out',await request('/api/auth/logout',{}),200);
check('signed-out cookie cannot be replayed',await request('/api/auth/me'),401);
cookie='';
check('private image path is protected',await request('/images/not-a-real-image'),401);
check('unknown API is JSON 404',await request('/api/not-real'),404);
mkdirSync('tmp/verification',{recursive:true});
const report={environment:health.environment,base,date:new Date().toISOString(),checks};
writeFileSync(option('report','tmp/verification/auth-local.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({checks:checks.length,passed:true,base}));
