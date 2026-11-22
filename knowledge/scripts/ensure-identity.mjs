import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const env=process.argv[process.argv.indexOf('--env')+1];if(!['staging','production'].includes(env))throw new Error('Unknown identity environment');
const origin=JSON.parse(readFileSync('knowledge/wrangler.jsonc','utf8')).env[env].vars.IDENTITY_ORIGIN;
async function ready(){
 try{
  const options={redirect:'error',signal:AbortSignal.timeout(10000)};
  const health=await fetch(origin+'/api/health',options);
  if(!health.ok)return false;
  const data=await health.json();
  if(data.catalog_bridge!==1||data.knowledge_workspace!==1||(data.knowledge_identity??0)<2)return false;
  const identity=await fetch(origin+'/api/knowledge/identity',options);
  await identity.arrayBuffer();
  return identity.status===401;
 }catch{return false;}
}
if(env==='production'){
 // The personnel release checks and publishes the identity bridge independently.
 for(let i=0;i<60;i++){if(await ready()){console.log('Production identity bridge ready');process.exit(0);}await new Promise(r=>setTimeout(r,10000));}
 throw new Error('Production identity bridge is not ready; inspect the personnel release');
}
if(!await ready()){
 // Bring staging up to the required identity contract using its normal release flow.
 execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{stdio:'inherit',windowsHide:true});
 execFileSync(process.execPath,['scripts/release.mjs','--env','staging'],{stdio:'inherit',windowsHide:true});
}
if(!await ready())throw new Error('Staging identity bridge is not ready');
console.log('Staging identity bridge ready');
