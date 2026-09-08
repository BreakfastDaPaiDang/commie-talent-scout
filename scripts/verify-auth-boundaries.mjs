import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const remote=process.argv.includes('--remote'), base=remote?'https://scout-staging.dapaidang.org':'http://127.0.0.1:8790';
assert.equal((await fetch(base+'/api/health').then(r=>r.json())).environment,'staging');
const secret=randomUUID()+randomUUID(), hash=createHash('sha256').update(secret).digest('hex');
mkdirSync('tmp/verification',{recursive:true});
// Fixture creation uses management auth; assertions use the public HTTP interface.
const fixture=`INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) SELECT '${randomUUID()}',id,'${hash}','session','expired verification',auth_epoch,'2020-01-01T00:00:00.000Z','2020-01-02T00:00:00.000Z' FROM members WHERE username='admin';`;
writeFileSync('tmp/verification/expired-session.sql',fixture);
const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cts-staging','--env','staging',remote?'--remote':'--local','--file','tmp/verification/expired-session.sql','--json'],{encoding:'utf8'});
assert.equal(r.status,0,'expired fixture was created');
const checks=[];
assert.equal((await fetch(base+'/api/auth/me',{headers:{Cookie:'cts_session='+secret}})).status,401);
checks.push('expired session is rejected with the current authentication epoch');
assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{invalid'})).status,400);
checks.push('malformed JSON is a client error');
assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'x'.repeat(1024*1024+1)})).status,413);
checks.push('oversized request is rejected before processing');
const name='limit-'+randomUUID();
for(let i=0;i<11;i++){
  const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:name,password:'invalid-password'})});
  assert.equal(response.status,i===10?429:401,'bounded account attempts');
}
checks.push('account attempts are bounded before expensive password work');
writeFileSync(`tmp/verification/auth-boundaries-${remote?'cloud':'local'}.json`,JSON.stringify({base,date:new Date().toISOString(),checks},null,2));
console.log(JSON.stringify({base,checks:checks.length,passed:true}));
