import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
const target=option('target','staging'), remote=args.includes('--remote');
if(!['staging','production'].includes(target))throw new Error('Unknown target');
const username=option('username','admin'), name=option('name','管理员');
if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username))throw new Error('Invalid username');
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const database=config.env[target]?.d1_databases?.[0];
if(!database || !database.database_id)throw new Error('Target database is not configured');
if(target==='production' && !remote)throw new Error('Production bootstrap requires --remote');
const credentialFile=resolve('secrets',`bootstrap-${target}-${remote?'remote':'local'}-${username}.json`);
if(existsSync(credentialFile))throw new Error('Private initialization file already exists; inspect it before attempting initialization again');
const password=randomBytes(24).toString('base64url');
const salt=randomBytes(16);
const hash=scryptSync(password,salt,32,{N:32768,r:8,p:3,maxmem:64*1024*1024});
const encoded=`scrypt$1$32768$8$3$${salt.toString('hex')}$${hash.toString('hex')}`;
const sqlString=value=>"'"+value.replaceAll("'","''")+"'";
// No anonymous bootstrap endpoint; D1 management authentication is required.
// One conditional SQL statement is atomic in D1; it also works with the remote import API,
// which does not accept explicit BEGIN/COMMIT. Existing members prevent reinitialization.
const memberId=randomUUID();
const sql=`INSERT INTO members(id,username,name,role,password_hash,created_at) SELECT ${[memberId,username,name,'admin',encoded,new Date().toISOString()].map(sqlString).join(',')} WHERE NOT EXISTS(SELECT 1 FROM members);\n`;
mkdirSync('secrets',{recursive:true});
const sqlFile=resolve('secrets',`bootstrap-${target}-${remote?'remote':'local'}.sql`);
writeFileSync(sqlFile,sql,{mode:0o600});
const credentialData={environment:target,remote,id:memberId,username,password,must_change_password:true,status:'pending'};
// Keep a private recovery copy before the network write; an interrupted response must not lose the password.
writeFileSync(credentialFile,JSON.stringify(credentialData,null,2),{flag:'wx',mode:0o600});
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute',database.database_name,'--env',target,remote?'--remote':'--local','--file',sqlFile,'--json'],{encoding:'utf8'});
if(result.status!==0){
  // Wrangler can echo SQL on errors. Never forward its raw output containing hashes.
  console.error('Bootstrap was not applied. The database may already contain members. Existing accounts were preserved.');
  process.exit(1);
}
const verification=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute',database.database_name,'--env',target,remote?'--remote':'--local','--command',`SELECT id FROM members WHERE id=${sqlString(memberId)}`,'--json'],{encoding:'utf8'});
if(verification.status!==0 || !verification.stdout.includes(memberId)){
  console.error('Initialization not confirmed; inspect the pending private credential file and existing members.');process.exit(1);
}
writeFileSync(credentialFile,JSON.stringify({...credentialData,status:'created'},null,2),{mode:0o600});
console.log(`Administrator initialized. Private credential file: ${credentialFile}`);
