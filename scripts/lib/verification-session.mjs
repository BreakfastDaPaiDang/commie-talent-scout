import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// A service token never becomes a human password. Each run gets its own expiring
// cookie; the caller creates/revokes its short-lived MCP connection as before.
export async function openVerificationSession(base,target,name){
 const file=`secrets/zaoji-verification-${target}.json`;
 let credential;try{credential=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error(`Missing ${file}; run scripts/setup-verification.mjs for this environment`);}
 assert.equal(credential.base,base,'verification credential belongs to a different environment');
 const response=await fetch(base+'/api/auth/verification-session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Authorization:'Bearer '+credential.secret},body:JSON.stringify({name}),signal:AbortSignal.timeout(30000)});
 const body=await response.json();assert.equal(response.status,200,`Service verification authentication failed: ${body.error?.code??response.status}`);
 assert.equal(body.member.identity_kind,'service');assert.equal(body.member.execution_purpose,'verification');
 return {body,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
