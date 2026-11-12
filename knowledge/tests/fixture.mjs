import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Knowledge} from '../src/service.ts';
export function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const wrap=(sql,args=[])=>({bind(...next){return wrap(sql,next);},async first(column){const row=sqlite.prepare(sql).get(...args);return row?(column?row[column]:row):null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}});
 // Queue like the single D1 primary; a failing statement rolls back the whole batch.
 let queue=Promise.resolve();const db={prepare:sql=>wrap(sql),batch(statements){const run=queue.then(async()=>{sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}});queue=run.catch(()=>{});return run;}};
 let time='2026-11-12T04:00:00.000Z';
 const actors=Array.from({length:4},(_,i)=>({id:randomUUID(),name:'虚构社员'+i,username:'fixture'+i,role:i?'member':'admin',eligible:true,membership_id:randomUUID(),verified_at:time,environment:'staging'}));
 const services=actors.map(a=>new Knowledge(db,a,()=>time));
 return {sqlite,db,actors,services,clock:()=>time,advance:ms=>{time=new Date(Date.parse(time)+ms).toISOString();},close:()=>sqlite.close()};
}
export const request=()=>randomUUID();
export async function draft(service,extra={}){return service.save({title:'测试知识',body:'为了检验一个明确判断，应当先收集实际材料。',tags:['共识'],request_id:request(),...extra});}
export async function proposal(service,extra={}){const d=await draft(service,extra);return service.submit({id:d.id,expected_revision:d.revision,request_id:request()});}
export async function adopt(f,p){for(const service of f.services.slice(0,3))await service.endorse({proposal_id:p.proposal_id,request_id:request()});}
