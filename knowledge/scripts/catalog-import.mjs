import {createHash} from 'node:crypto';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}':JSON.stringify(value);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const purposes=values=>[...new Set(values.map(v=>({contact:'接触',review:'审核',onboarding:'对接',member:'社员',friend:'社外联系'}[v]??v.trim())).filter(Boolean))];
function content(value,owner){return {name:value.name,kind:value.kind??'',purposes:purposes(value.purposes??JSON.parse(value.purposes_json??'[]')),capacity:value.capacity??null,active:!!value.active,deleted:!!(value.deleted||value.deleted_at),note:value.note??'',group_id:null,owner_id:owner,collaborator_ids:[],provider:'',conditions:'',contact:'',requirements:'',time_commitment:'',support:'',headcount:null,attachment_ids:[],source:'主站资源迁入'};}
async function rows(db,sql,...params){return (await db.prepare(sql).bind(...params).all()).results;}
/** Freeze the source, retain a private snapshot, verify every imported row, then switch authority. */
export async function importCatalog({source,target,sourceId,saveSnapshot=async()=>{}}){
 const at=new Date().toISOString(),marker=await source.prepare('SELECT * FROM resource_catalog_state WHERE id=1').first();
 if(!marker)throw new Error('Personnel catalog bridge migration is missing');
 if(marker.mode==='independent'){
  const imported=await target.prepare("SELECT * FROM catalog_imports WHERE id='personnel-resources-v1'").first();if(!imported||imported.source_database_id!==sourceId||imported.digest!==marker.imported_digest)throw new Error('Catalog authority receipt mismatch');
  await target.prepare('UPDATE catalog_meta SET authority_ready=1 WHERE id=1').run();return {already_imported:true,entries:imported.entry_count,history:imported.history_count,digest:imported.digest};
 }
 await source.prepare("UPDATE resource_catalog_state SET mode='migrating',changed_at=? WHERE id=1 AND mode IN ('legacy','migrating')").bind(at).run();
 const entries=await rows(source,'SELECT * FROM work_overview_resources ORDER BY id');
 const history=await rows(source,"SELECT h.*,m.name actor_name FROM work_overview_history h LEFT JOIN members m ON m.id=h.actor_id WHERE h.entity_type IN ('resource','resource_delete') ORDER BY h.created_at,h.id");
 const snapshot={source_database_id:sourceId,entries,history},checksum=digest(snapshot);await saveSnapshot(snapshot,checksum);
 const expected=[];let expectedVersions=0;
 for(const r of entries){
  // An old editor is not necessarily the resource's provider or maintainer.
  const events=history.filter(h=>h.entity_id===r.id),owner=null,data=content(r,owner),json=JSON.stringify(data);
  const old=await target.prepare('SELECT * FROM catalog_entries WHERE id=?').bind(r.id).first();if(old&&(old.version!==r.version||old.content_json!==json))throw new Error('Refusing to overwrite an existing catalog record');
  const versions=new Map();for(const h of events){const after=JSON.parse(h.after_json);if(Number.isInteger(after?.version)&&after.version>0&&after.name)versions.set(after.version,{data:content(after,owner),actor_id:h.actor_id,actor_name:h.actor_name??'历史作者',at:h.created_at});}
  versions.set(r.version,{data,actor_id:events.at(-1)?.actor_id??null,actor_name:events.at(-1)?.actor_name??'历史迁入',at:r.updated_at});expectedVersions+=versions.size;
  const statements=[target.prepare("INSERT OR IGNORE INTO catalog_entries VALUES(?,?,'resource',NULL,?,?,?,?,?,?,?)").bind(r.id,r.version,owner,r.name,+data.active,+data.deleted,json,events[0]?.created_at??r.updated_at,r.updated_at)];
  for(const [version,v] of versions){const existing=await target.prepare("SELECT content_json FROM catalog_versions WHERE target_type='entry' AND target_id=? AND version=?").bind(r.id,version).first();if(existing&&existing.content_json!==JSON.stringify(v.data))throw new Error('Catalog history differs from the frozen source');statements.push(target.prepare("INSERT OR IGNORE INTO catalog_versions VALUES('entry',?,?,?,?,?,NULL,?)").bind(r.id,version,JSON.stringify(v.data),v.actor_id,v.actor_name,v.at));}
  for(let offset=0;offset<statements.length;offset+=40)await target.batch(statements.slice(offset,offset+40));
  expected.push({id:r.id,version:r.version,content_json:json});
 }
 for(let offset=0;offset<history.length;offset+=40)await target.batch(history.slice(offset,offset+40).map(h=>target.prepare('INSERT OR IGNORE INTO catalog_source_history VALUES(?,?,?)').bind(h.id,JSON.stringify(h),at)));
 const actual=await rows(target,'SELECT id,version,content_json FROM catalog_entries ORDER BY id');if(digest(actual)!==digest(expected))throw new Error('Imported catalog content does not match source');
 const copiedHistory=await rows(target,'SELECT id,source_json FROM catalog_source_history ORDER BY id');if(digest(copiedHistory.map(h=>JSON.parse(h.source_json)).sort((a,b)=>a.id.localeCompare(b.id)))!==digest([...history].sort((a,b)=>a.id.localeCompare(b.id))))throw new Error('Imported resource history does not match source');
 if((await target.prepare('SELECT count(*) n FROM catalog_versions').first()).n!==expectedVersions)throw new Error('Imported version count mismatch');
 if((await rows(target,'PRAGMA foreign_key_check')).length)throw new Error('Imported catalog has invalid references');
 const previous=await target.prepare("SELECT * FROM catalog_imports WHERE id='personnel-resources-v1'").first();if(previous&&previous.digest!==checksum)throw new Error('Import receipt differs from frozen source');
 await target.prepare("INSERT OR IGNORE INTO catalog_imports VALUES('personnel-resources-v1',?,?,?,?,?)").bind(sourceId,checksum,entries.length,history.length,at).run();
 await source.prepare("UPDATE resource_catalog_state SET mode='independent',imported_digest=?,changed_at=? WHERE id=1 AND mode='migrating'").bind(checksum,at).run();
 const complete=await source.prepare('SELECT * FROM resource_catalog_state WHERE id=1').first();if(complete.mode!=='independent'||complete.imported_digest!==checksum)throw new Error('Authority switch could not be verified');
 await target.prepare('UPDATE catalog_meta SET authority_ready=1,revision=revision+1 WHERE id=1').run();
 return {already_imported:false,entries:entries.length,history:history.length,versions:expectedVersions,digest:checksum};
}
