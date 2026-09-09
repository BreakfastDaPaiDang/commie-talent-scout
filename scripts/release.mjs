import {execFileSync} from 'node:child_process';
import {cf,d1Query,objectPath,projectConfig,wrangler} from './lib/cloudflare-admin.mjs';
import {migrationPlan,releaseStages} from './lib/release-plan.mjs';
import {backup} from './backup.mjs';
import {smoke} from './smoke.mjs';
const args=process.argv.slice(2);if(!args.includes('--env'))throw new Error('Use --env staging|production');const environment=args[args.indexOf('--env')+1],{config,release}=projectConfig(),target=config.env[environment];if(!release.environments[environment]||!target)throw new Error('Unknown release environment');
const db=target.d1_databases[0],pointer=objectPath(config.account_id,release.backup_bucket,`releases/${environment}/latest.json`),deploymentPath=`/accounts/${config.account_id}/workers/scripts/${target.name}/deployments`;
async function currentVersion(){const result=await cf(deploymentPath,{allowMissing:true});if(!result)return null;const versions=result.deployments?.[0]?.versions;if(!versions?.length)return null;if(versions.length!==1||versions[0].percentage!==100)throw new Error('Automatic release requires one active version at 100 percent');return versions[0].version_id;}
let migrations,previousProductVersion;
try{const result=await releaseStages({
 inspect:async()=>{const health=await fetch(release.environments[environment].origin+'/api/health');if(health.ok)previousProductVersion=(await health.json()).version;const response=await cf(pointer,{raw:true,allowMissing:true});return {version:await currentVersion(),record:response?await response.json():null};},
 validate:async prior=>{migrations=migrationPlan('migrations',prior.record?.migrations??{});const applied=(await d1Query(db.database_id,'SELECT name FROM d1_migrations ORDER BY id'))[0].results.map(r=>r.name);if(applied.some(name=>!migrations[name]))throw new Error('Database contains migrations unknown to this code');console.log(JSON.stringify({release:'validated',environment,applied_migrations:applied.length,code_rollback_available:!!prior.version}));},
 backup:async()=> (await backup(environment)).snapshot,
 migrate:async()=>{await wrangler(['d1','migrations','apply',db.database_name,'--env',environment,'--remote']);console.log('Compatible migrations applied');},
 deploy:async()=>{await wrangler(['deploy','--env',environment]);console.log('Worker deployment submitted');},version:currentVersion,
 smoke:async()=>{for(let attempt=0;attempt<3;attempt++){try{return await smoke(environment);}catch(error){if(attempt===2)throw error;await new Promise(r=>setTimeout(r,5000));}}},
 record:async({snapshot,version})=>{if(!version)throw new Error('No active deployment version found');const commit=process.env.GITHUB_SHA??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();await cf(pointer,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({format:1,environment,version,commit,migrations,snapshot,completed_at:new Date().toISOString()}),raw:true});},
 rollback:async version=>{await wrangler(['rollback',version,'--env',environment,'--message','Automatic rollback after failed release verification','--yes']);},
 verifyRollback:async version=>{if(await currentVersion()!==version)throw new Error('Active code version does not match rollback target');await smoke(environment,{compareAssets:false,expectedVersion:previousProductVersion});},
});console.log(JSON.stringify({release:'complete',environment,...result}));}catch(error){console.error(error.message);process.exitCode=1;}
