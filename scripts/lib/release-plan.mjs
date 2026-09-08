import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

export function migrationPlan(directory='migrations',previous={}){
 const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
 const files=readdirSync(directory).filter(n=>n.endsWith('.sql')).sort(),hashes={};
 if(JSON.stringify(files)!==JSON.stringify(Object.keys(manifest.migrations).sort()))throw new Error('Every migration must have exactly one reviewed manifest entry');
 for(const file of files){const sql=readFileSync(join(directory,file),'utf8').replaceAll('\r\n','\n'),review=manifest.migrations[file],sha=createHash('sha256').update(sql).digest('hex');
  if(review.sha256!==sha)throw new Error(`Migration checksum changed: ${file}`);
  if(review.backwards_compatible!==true||!review.reason?.trim())throw new Error(`Migration requires a separately reviewed rollout: ${file}`);
  if(/\bDROP\s+(TABLE|COLUMN)\b|\bALTER\s+TABLE\s+\w+\s+RENAME\b/i.test(sql))throw new Error(`Destructive migration cannot use automatic code rollback: ${file}`);
  hashes[file]=sha;
 }
 for(const [file,sha] of Object.entries(previous))if(hashes[file]!==sha)throw new Error(`An already released migration was removed or changed: ${file}`);
 return hashes;
}

// Dependencies are the operational boundary: failures before deploy cannot change code;
// failures after deployment begins must restore the known code version, never the database.
export async function releaseStages(ops){
 const prior=await ops.inspect();await ops.validate(prior);const snapshot=await ops.backup();await ops.migrate();
 let attempted=false;
 try{attempted=true;await ops.deploy();const version=await ops.version();await ops.smoke();await ops.record({prior,snapshot,version});return {snapshot,version};}
 catch(error){if(attempted&&prior.version){try{await ops.rollback(prior.version);await ops.verifyRollback(prior.version);}catch{throw new Error('Release failed and code rollback could not be verified; inspect the active deployment before retrying',{cause:error});}throw new Error('Release failed; prior code restored and database retained',{cause:error});}throw new Error('Initial deployment failed; no prior code version exists. Database retained',{cause:error});}
}
