import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {migrationPlan,releaseStages} from '../scripts/lib/release-plan.mjs';

function fixture(failure,priorVersion='previous'){
 const calls=[];const stage=(name,result)=>async()=>{calls.push(name);if(failure===name)throw new Error('simulated outage');return result;};
 return {calls,ops:{inspect:stage('inspect',{version:priorVersion}),validate:stage('validate'),backup:stage('backup','snapshot'),migrate:stage('migrate'),deploy:stage('deploy'),version:stage('version','next'),smoke:stage('smoke'),record:stage('record'),rollback:stage('rollback'),verifyRollback:stage('verifyRollback')}};
}
test('backup or compatibility failure stops before migration; migration failure leaves previous code',async()=>{for(const fail of ['validate','backup','migrate']){const {calls,ops}=fixture(fail);await assert.rejects(releaseStages(ops));assert.ok(!calls.includes('deploy'));assert.ok(!calls.includes('rollback'));if(fail==='backup')assert.ok(!calls.includes('migrate'));}});
test('uncertain deploy and smoke/record failures restore code without running data restoration',async()=>{for(const fail of ['deploy','version','smoke','record']){const {calls,ops}=fixture(fail);await assert.rejects(releaseStages(ops),/prior code restored/);assert.deepEqual(calls.slice(-2),['rollback','verifyRollback']);assert.equal(calls.filter(x=>x==='migrate').length,1);}});
test('failed rollback remains an actionable failure; initial install cannot claim rollback',async()=>{const {ops}=fixture('smoke');ops.rollback=async()=>{throw new Error('unavailable');};await assert.rejects(releaseStages(ops),/rollback could not be verified/);const initial=fixture('smoke',null);await assert.rejects(releaseStages(initial.ops),/no prior code version/);assert.ok(!initial.calls.includes('rollback'));});
test('successful release records snapshot and version only after smoke',async()=>{const {ops,calls}=fixture();assert.deepEqual(await releaseStages(ops),{snapshot:'snapshot',version:'next'});assert.deepEqual(calls,['inspect','validate','backup','migrate','deploy','version','smoke','record']);});
test('migration review rejects edited, removed, missing or destructive migrations',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cts-release-test-'));try{
 const sql='CREATE TABLE example(id TEXT);\n',sha=createHash('sha256').update(sql).digest('hex');const manifest={migrations:{'0001.sql':{sha256:sha,backwards_compatible:true,reason:'Additive table'}}};
 writeFileSync(join(dir,'0001.sql'),sql.replaceAll('\n','\r\n'));writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));assert.deepEqual(migrationPlan(dir),{'0001.sql':sha});
 assert.throws(()=>migrationPlan(dir,{'removed.sql':'old'}),/removed or changed/);writeFileSync(join(dir,'0001.sql'),sql+'-- edit');assert.throws(()=>migrationPlan(dir),/checksum/);
 const destructive='DROP TABLE example;';writeFileSync(join(dir,'0001.sql'),destructive);manifest.migrations['0001.sql'].sha256=createHash('sha256').update(destructive).digest('hex');writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));assert.throws(()=>migrationPlan(dir),/Destructive/);
 }finally{assert.ok(dir.startsWith(join(tmpdir(),'cts-release-test-')));rmSync(dir,{recursive:true,force:true});}
});
test('checked-in migration manifest is complete and compatible',()=>{assert.equal(Object.keys(migrationPlan()).length,JSON.parse(readFileSync('migrations/manifest.json','utf8')).count);});
