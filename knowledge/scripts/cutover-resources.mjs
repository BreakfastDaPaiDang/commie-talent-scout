import {readFileSync} from 'node:fs';
import {cf,objectPath,projectConfig,managementDatabase} from '../../scripts/lib/cloudflare-admin.mjs';
import {importCatalog} from './catalog-import.mjs';
const environment=process.argv[process.argv.indexOf('--env')+1];if(!['staging','production'].includes(environment))throw new Error('Use --env staging|production');
const {config,release}=projectConfig(),targetConfig=JSON.parse(readFileSync('knowledge/wrangler.generated.json','utf8')).env[environment],sourceId=config.env[environment].d1_databases[0].database_id,targetId=targetConfig.d1_databases[0].database_id;
if(!targetId||targetId===sourceId||targetConfig.d1_databases[0].database_name!==`commie-knowledge-${environment}`)throw new Error('Independent catalog database mismatch');
const health=await fetch(config.env[environment].vars.APP_ORIGIN+'/api/health',{signal:AbortSignal.timeout(15000)});if(!health.ok||(await health.json()).catalog_bridge!==1)throw new Error('Personnel catalog adapter is not deployed');
const result=await importCatalog({source:managementDatabase(sourceId),target:managementDatabase(targetId),sourceId,saveSnapshot:async(snapshot,digest)=>{
 const key=`snapshots/resource-cutover-${environment}/${digest}.json`;await cf(objectPath(config.account_id,release.backup_bucket,key),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot),raw:true});
}});
console.log(JSON.stringify({resource_catalog_cutover:'complete',environment,...result}));
