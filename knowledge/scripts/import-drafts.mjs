import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {cf,projectConfig} from '../../scripts/lib/cloudflare-admin.mjs';

// Input is a private CI secret or a git-ignored local file. Content is never logged.
const raw=process.env.KNOWLEDGE_INITIAL_DRAFTS;
if(!raw){console.log('No private draft import requested');process.exit(0);}
const input=z.object({id:z.uuid(),owner_id:z.uuid(),owner_name:z.string().min(1).max(100),items:z.array(z.object({id:z.uuid(),version_id:z.uuid(),title:z.string().min(1).max(200),body:z.string().min(1).max(60000),tags:z.array(z.enum(['共识','方法','题目'])).min(1),source:z.string().max(2000)})).length(21)}).strict().parse(JSON.parse(raw));
const config=JSON.parse(readFileSync('knowledge/wrangler.generated.json','utf8')),target=config.env.production,binding=target.d1_databases[0],{config:main}=projectConfig();
if(binding.database_name!=='commie-knowledge-production'||!binding.database_id||Object.values(main.env).some(e=>e.d1_databases.some(d=>d.database_id===binding.database_id)))throw new Error('Import must target independent knowledge production');
const path=`/accounts/${config.account_id}/d1/database/${binding.database_id}/query`;
async function send(value){const r=await cf(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!Array.isArray(r)||r.some(q=>!q.success))throw new Error('Private draft import failed');return r;}
const contentHash=createHash('sha256').update(raw).digest('hex'),prior=(await send({sql:'SELECT * FROM kb_imports WHERE id=?',params:[input.id]}))[0].results[0];
if(prior){if(prior.content_hash!==contentHash||prior.owner_id!==input.owner_id)throw new Error('Import ID was already used for different content');console.log(JSON.stringify({draft_import:'already_completed',count:prior.item_count}));process.exit(0);}
const at=new Date().toISOString(),batch=[];
for(const item of input.items){batch.push({sql:'INSERT INTO kb_entries(id,author_id,author_name,created_at) VALUES(?,?,?,?)',params:[item.id,input.owner_id,input.owner_name,at]},{sql:"INSERT INTO kb_versions(id,entry_id,author_id,author_name,title,body,tags_json,source,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'draft',?,?)",params:[item.version_id,item.id,input.owner_id,input.owner_name,item.title,item.body,JSON.stringify(item.tags),item.source,at,at]});}
batch.push({sql:'INSERT INTO kb_imports VALUES(?,?,?,?,?)',params:[input.id,input.owner_id,contentHash,input.items.length,at]});
await send({batch});
const rows=(await send({sql:"SELECT count(*) n FROM kb_versions v JOIN kb_entries e ON e.id=v.entry_id WHERE v.state='draft' AND e.public_at IS NULL AND e.author_id=? AND e.id IN ("+input.items.map(()=>'?').join(',')+')',params:[input.owner_id,...input.items.map(i=>i.id)]}))[0].results;
if(rows[0].n!==21)throw new Error('Draft import verification failed');console.log(JSON.stringify({draft_import:'complete',private_drafts:21,published:0}));
