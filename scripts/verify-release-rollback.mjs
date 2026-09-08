import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {cf,d1Query,objectPath,projectConfig,wrangler} from './lib/cloudflare-admin.mjs';
import {migrationPlan,releaseStages} from './lib/release-plan.mjs';
import {smoke} from './smoke.mjs';
// This deliberately fails verification after a real deployment, only on isolated staging.
const environment='staging',{config,release}=projectConfig(),target=config.env.staging,db=target.d1_databases[0];
assert.notEqual(target.name,config.env.production.name);assert.notEqual(db.database_id,config.env.production.d1_databases[0].database_id);
const path=`/accounts/${config.account_id}/workers/scripts/${target.name}/deployments`;
async function version(){const v=(await cf(path)).deployments[0].versions;assert.equal(v.length,1);assert.equal(v[0].percentage,100);return v[0].version_id;}
const before=await version(),counts=async()=> (await d1Query(db.database_id,'SELECT (SELECT count(*) FROM archives) archives,(SELECT count(*) FROM observations) observations,(SELECT count(*) FROM observation_versions) versions,(SELECT count(*) FROM version_attachments) image_references'))[0].results[0],original=await counts();let deployed,rolledBack=false;
const record=await (await cf(objectPath(config.account_id,release.backup_bucket,'releases/staging/latest.json'),{raw:true})).json();
assert.equal(record.version,before,'Begin from the known successful staging release');
await assert.rejects(releaseStages({
 inspect:async()=>({version:before}),validate:async()=>migrationPlan('migrations',record.migrations),
 backup:async()=>{const manifest=await (await cf(objectPath(config.account_id,release.backup_bucket,record.snapshot+'/manifest.json'),{raw:true})).json();assert.equal(manifest.environment,'staging');return record.snapshot;},
 migrate:async()=>{const applied=(await d1Query(db.database_id,'SELECT name FROM d1_migrations ORDER BY id'))[0].results.map(r=>r.name);assert.deepEqual(applied,Object.keys(record.migrations).sort(),'This exercise must have no pending migrations');},
 deploy:async()=>{await wrangler(['deploy','--env',environment]);},version:async()=>{deployed=await version();assert.notEqual(deployed,before);return deployed;},
 smoke:async()=>{await smoke(environment);throw new Error('Intentional post-deploy verification failure on staging');},record:async()=>assert.fail('Failed verification must not publish a success record'),
 rollback:async id=>{await wrangler(['rollback',id,'--env',environment,'--message','Staging recovery acceptance: intentional post-deploy verification failure','--yes']);},
 verifyRollback:async id=>{assert.equal(await version(),id);await smoke(environment);rolledBack=true;},
}),/prior code restored/);
assert.equal(rolledBack,true);assert.deepEqual(await counts(),original);const report={date:new Date().toISOString(),environment,previous_version:before,attempted_version:deployed,active_version:await version(),intentional_verification_failure:true,code_rollback_verified:true,business_counts_unchanged:original,data_restore_performed:false};mkdirSync('tmp/verification',{recursive:true});writeFileSync('tmp/verification/release-rollback.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
