import {readFileSync,writeFileSync,mkdirSync,appendFileSync,statSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {cf,objectPath,projectConfig,wrangler} from '../../scripts/lib/cloudflare-admin.mjs';
import {snapshotDatabase} from '../../scripts/lib/snapshot-database.mjs';
import {migrationPlan} from '../../scripts/lib/release-plan.mjs';

const environment=process.argv[process.argv.indexOf('--env')+1];
if(!process.argv.includes('--env')||!['staging','production'].includes(environment))throw new Error('Use --env staging|production');
const config=JSON.parse(readFileSync('knowledge/wrangler.jsonc','utf8')),target=config.env[environment],{config:personnel,release}=projectConfig();
const account=config.account_id,binding=target.d1_databases[0],name=binding.database_name,configPath='knowledge/wrangler.generated.json';
if(account!==personnel.account_id||name!==`commie-knowledge-${environment}`||target.services[0].service!==personnel.env[environment].name)throw new Error('Knowledge environment isolation mismatch');
let databases=await cf(`/accounts/${account}/d1/database?per_page=100`);
if(!Array.isArray(databases)||databases.length===100)throw new Error('Ambiguous D1 inventory; inspect account before provisioning');
let matches=databases.filter(d=>d.name===name);if(matches.length>1)throw new Error('Duplicate knowledge databases');
if(!matches.length){
 try{matches=[await cf(`/accounts/${account}/d1/database`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})];}
 catch(error){databases=await cf(`/accounts/${account}/d1/database?per_page=100`);matches=databases.filter(d=>d.name===name);if(matches.length!==1)throw error;}
}
const databaseId=matches[0].uuid;
if(!databaseId||Object.values(personnel.env).some(e=>e.d1_databases.some(d=>d.database_id===databaseId))||release.recovery.database_id===databaseId)throw new Error('Knowledge must use its own D1 database');
binding.database_id=databaseId;writeFileSync(configPath,JSON.stringify(config,null,2));mkdirSync('tmp/knowledge',{recursive:true});
const query=async(sql,params=[])=>{const result=await cf(`/accounts/${account}/d1/database/${databaseId}/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql,params})});if(!Array.isArray(result)||result.some(r=>!r.success))throw new Error('Knowledge management query failed');return result[0].results;};
const pointer=objectPath(account,release.backup_bucket,`releases/knowledge-${environment}/latest.json`),priorResponse=await cf(pointer,{raw:true,allowMissing:true}),prior=priorResponse?await priorResponse.json():null;
const migrations=migrationPlan('knowledge/migrations',prior?.migrations??{});
const schema=await query("SELECT name FROM sqlite_master WHERE type='table'");
const allowedTables=new Set(['kb_meta','kb_tags','kb_entries','kb_versions','kb_proposals','kb_votes','kb_events','kb_requests','kb_guards','kb_imports','d1_migrations','sqlite_sequence','_cf_KV']);
if(schema.some(t=>!allowedTables.has(t.name)))throw new Error('Unrecognized tables found in knowledge database; refusing to adopt it');
if(schema.some(t=>t.name==='d1_migrations')){const applied=await query('SELECT name FROM d1_migrations');if(applied.some(m=>!migrations[m.name]))throw new Error('Unknown knowledge migration in database');}
const deploymentPath=`/accounts/${account}/workers/scripts/${target.name}/deployments`;
async function activeVersion(){const r=await cf(deploymentPath,{allowMissing:true});const versions=r?.deployments?.[0]?.versions;if(!versions?.length)return null;if(versions.length!==1||versions[0].percentage!==100)throw new Error('Release requires one active knowledge version');return versions[0].version_id;}
const previous=await activeVersion();
// Independent, private backup; never print the SQL or Wrangler export response.
let snapshot=null;
if(schema.some(t=>t.name==='kb_entries')){
 const file=resolve('tmp/knowledge',`${environment}-${randomUUID()}.sql`);
 try{
  await wrangler(['d1','export',name,'--env',environment,'--config',configPath,'--remote','--output',file]);
  if(statSync(file).size>release.max_export_bytes)throw new Error('Knowledge backup exceeds reviewed size');
  const sql=readFileSync(file),restored=snapshotDatabase(sql);try{if(restored.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Knowledge backup foreign keys invalid');}finally{restored.close();}
  snapshot=`snapshots/knowledge-${environment}/${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}`;
  const compressed=gzipSync(sql);await cf(objectPath(account,release.backup_bucket,snapshot+'/database.sql.gz'),{method:'PUT',body:compressed,headers:{'Content-Type':'application/gzip'},raw:true});
  await cf(objectPath(account,release.backup_bucket,snapshot+'/manifest.json'),{method:'PUT',body:JSON.stringify({database_id:databaseId,environment,sql_sha256:createHash('sha256').update(sql).digest('hex'),sql_bytes:sql.length}),headers:{'Content-Type':'application/json'},raw:true});
 }finally{if(statSync(file,{throwIfNoEntry:false}))unlinkSync(file);}
}
await wrangler(['d1','migrations','apply',name,'--env',environment,'--config',configPath,'--remote']);
const applied=await query('SELECT name FROM d1_migrations');if(applied.length!==Object.keys(migrations).length)throw new Error('Knowledge migrations incomplete');
if((await query('PRAGMA foreign_key_check')).length)throw new Error('Knowledge foreign keys invalid');
const origin=target.vars.APP_ORIGIN;
async function smoke(){
 const health=await fetch(origin+'/api/health',{redirect:'error',signal:AbortSignal.timeout(20000)});if(health.status!==200)throw new Error('Knowledge health failed');const data=await health.json();if(data.service!=='commie-knowledge'||data.environment!==environment)throw new Error('Wrong knowledge deployment');
 for(const path of ['/api/entries','/api/effective','/mcp']){const r=await fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(20000)});if(r.status!==401||!r.headers.get('cache-control')?.includes('no-store'))throw new Error('Knowledge private access check failed');await r.arrayBuffer();}
 const identity=await fetch(target.vars.IDENTITY_ORIGIN+'/api/knowledge/identity',{redirect:'error',signal:AbortSignal.timeout(20000)});if(identity.status!==401)throw new Error('Identity bridge not deployed');await identity.arrayBuffer();
}
try{
 await wrangler(['deploy','--env',environment,'--config',configPath]);
 for(let attempt=0;;attempt++){try{await smoke();break;}catch(e){if(attempt===3)throw e;await new Promise(r=>setTimeout(r,5000));}}
 const version=await activeVersion();if(!version)throw new Error('Knowledge deployment has no active version');
 const record={environment,worker:target.name,database_id:databaseId,database_name:name,origin,version,migrations,snapshot,commit:process.env.GITHUB_SHA,completed_at:new Date().toISOString()};
 await cf(pointer,{method:'PUT',body:JSON.stringify(record),headers:{'Content-Type':'application/json'},raw:true});
 writeFileSync(`tmp/knowledge/${environment}-deployment.json`,JSON.stringify(record,null,2));
 console.log(JSON.stringify({knowledge_release:'complete',environment,database_name:name,database_id:databaseId,worker:target.name,version,origin}));
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nKnowledge ${environment}: ${origin}\n\nDatabase: ${name} (${databaseId})\n\nWorker version: ${version}\n`);
}catch(error){if(previous){await wrangler(['rollback',previous,'--env',environment,'--config',configPath,'--message','Knowledge smoke failure','--yes']);if(await activeVersion()!==previous)throw new Error('Knowledge rollback could not be verified');throw new Error('Knowledge release failed; previous code restored, database retained',{cause:error});}throw error;}
