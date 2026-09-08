import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
// The service contract is tested against real SQLite constraints and transactions.
// Only the D1 transport surface and R2 object transport are adapted for an isolated test.
export function fixture(){
 const sqlite=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const objects=new Map(),deleted=[];
 const wrap=(sql,args=[])=>({bind(...next){return wrap(sql,next);},async first(column){const row=sqlite.prepare(sql).get(...args);return row?(column?row[column]:row):null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}});
 const DB={prepare:sql=>wrap(sql),async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const IMAGES={async put(key,bytes){objects.set(key,Buffer.from(bytes));},async get(key){const bytes=objects.get(key);return bytes?{size:bytes.length,body:new Response(bytes).body}:null;},async delete(key){deleted.push(key);objects.delete(key);}};
 const id=randomUUID(),credential=randomUUID(),at=new Date().toISOString();sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,qq,created_at) VALUES(?,?,?,'member','fixture',0,'00000',?)").run(id,'fixture','虚构测试成员',at);sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'mcp','fixture',1,?,'2099-01-01T00:00:00.000Z')").run(credential,id,randomUUID(),at);
 const actor={...sqlite.prepare('SELECT * FROM members WHERE id=?').get(id),credential_id:credential,credential_kind:'mcp'};
 return {env:{DB,IMAGES,APP_ORIGIN:'https://fixture.invalid',ENVIRONMENT:'staging'},actor,sqlite,objects,deleted,close:()=>sqlite.close()};
}
