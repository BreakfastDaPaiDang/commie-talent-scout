import {z} from 'zod';
import {command,requestId} from './commands.ts';
import {Archives} from './archives.ts';
import {occurredAt} from './observations.ts';
import {Images,imageIds} from './images.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';
const cutoff=()=>new Date(Date.now()-30*86400000).toISOString();
const input=z.object({archive_id:z.uuid(),expected_version:z.number().int().min(0),body:z.string().max(100000),occurred_at:occurredAt,attachment_ids:imageIds.optional(),request_id:requestId}).strict();
type Draft={archive_id:string;body:string;occurred_at:string|null;version:number;publish_request_id:string;updated_at:string};
export class Drafts{
 constructor(private env:Env,private actor:Actor){}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async list(){const rows=await this.stmt("SELECT archive_id,updated_at FROM observation_drafts d WHERE member_id=? AND updated_at>=? AND (length(trim(body))>0 OR EXISTS(SELECT 1 FROM draft_attachments a WHERE a.member_id=d.member_id AND a.archive_id=d.archive_id))",this.actor.id,cutoff()).all();return {drafts:rows.results};}
 async get(archiveId:string){
  z.uuid().parse(archiveId);await new Archives(this.env,this.actor,'web').get(archiveId);
  const draft=await this.stmt('SELECT archive_id,body,occurred_at,version,publish_request_id,updated_at FROM observation_drafts WHERE member_id=? AND archive_id=? AND updated_at>=?',this.actor.id,archiveId,cutoff()).first<Draft>();
  const receipt=draft?await this.stmt('SELECT result FROM commands WHERE member_id=? AND request_id=?',this.actor.id,draft.publish_request_id).first<{result:string}>():null;
  return {draft: draft?{...draft,attachments:await new Images(this.env,this.actor,'web').draftImages(archiveId),expires_at:new Date(Date.parse(draft.updated_at)+30*86400000).toISOString()}:null,published:receipt?JSON.parse(receipt.result):null,retention_days:30};
 }
 async save(value:unknown){
  const a=input.parse(value);await new Archives(this.env,this.actor,'web').get(a.archive_id);
  return command(this.env,this.actor,{requestId:a.request_id,operation:'draft.save',parameters:{...a,request_id:undefined}},async()=>{
   const old=await this.stmt('SELECT archive_id,body,occurred_at,version,publish_request_id,updated_at FROM observation_drafts WHERE member_id=? AND archive_id=? AND updated_at>=?',this.actor.id,a.archive_id,cutoff()).first<Draft>();
   if((old?.version??0)!==a.expected_version)throw new Failure(409,'DRAFT_CONFLICT','另一处已保存了这个草稿；你的输入仍保留，请核对后重新读取');
   const images=new Images(this.env,this.actor,'web'),previous=old?(await images.draftImages(a.archive_id)).map(i=>i.id):[],ids=a.attachment_ids??previous;
   const changed=!old||old.body!==a.body||old.occurred_at!==a.occurred_at||JSON.stringify(ids)!==JSON.stringify(previous),key=uid(),at=now(),version=(old?.version??0)+(changed?1:0),publishId=changed?uid():old!.publish_request_id;
   const condition=a.expected_version===0?'NOT EXISTS(SELECT 1 FROM observation_drafts WHERE member_id=? AND archive_id=? AND updated_at>=?)':'EXISTS(SELECT 1 FROM observation_drafts WHERE member_id=? AND archive_id=? AND version=?)';
   const statements=[this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN ${condition} THEN 1 ELSE 0 END)`,key,this.actor.id,a.archive_id,a.expected_version===0?cutoff():a.expected_version)];
   if(changed)statements.push(this.stmt('INSERT INTO observation_drafts(member_id,archive_id,body,occurred_at,version,publish_request_id,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(member_id,archive_id) DO UPDATE SET body=excluded.body,occurred_at=excluded.occurred_at,version=excluded.version,publish_request_id=excluded.publish_request_id,updated_at=excluded.updated_at',this.actor.id,a.archive_id,a.body,a.occurred_at,version,publishId,at));
   if(changed){const plan=await images.planDraft(ids,a.archive_id);statements.push(...plan.statements,...plan.cleanup);}
   statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
   return {result:{archive_id:a.archive_id,version,publish_request_id:publishId,updated_at:changed?at:old!.updated_at,changed},statements};
  });
 }
}
