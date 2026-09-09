import {z} from 'zod';
import {Failure,type Actor,type Env} from './types.ts';

export const evidenceInput=z.object({kind:z.enum(['observation','self_statement','member_instruction']),note:z.string().trim().min(1).max(2000),observation_id:z.uuid().optional(),content_version:z.number().int().positive().optional()}).strict().refine(e=>!!e.observation_id===!!e.content_version&&(e.kind!=='observation'||!!e.observation_id),'观察来源须同时提供记录 ID 与实际读取的版本');
export type Evidence=z.infer<typeof evidenceInput>;
export type TagBinding={tag_id:string;category_id:string;type:'person'|'org';category_name:string;name:string;description:string;definition_version:number;category_version:number;color:string;enabled:number;category_enabled:number;merged_into:string|null;added_by:string;added_at:string;confirmed_by:string;confirmed_at:string;evidence:Evidence[];focus:number};
export type TagLabel=Pick<TagBinding,'tag_id'|'category_name'|'name'|'color'|'focus'>;
// Trusted SQL expressions only; the actor is supplied through the two bind parameters.
export function evidenceVisibilitySql(expression:string){return `(json_array_length(${expression})=0 OR EXISTS(SELECT 1 FROM json_each(${expression}) ev WHERE json_extract(ev.value,'$.observation_id') IS NULL OR EXISTS(SELECT 1 FROM observations src WHERE src.id=json_extract(ev.value,'$.observation_id') AND ((EXISTS(SELECT 1 FROM archives ar WHERE ar.id=src.archive_id AND ar.deleted=0) AND (src.deleted=0 OR src.author_id=?)) OR ?='admin'))))`;}
export const bindingJson=`json_object('tag_id',t.id,'category_id',c.id,'type',c.type,'category_name',c.name,'name',t.name,'description',t.description,'definition_version',t.version,'category_version',c.version,'color',c.color,'enabled',t.enabled,'category_enabled',c.enabled,'merged_into',t.merged_into,'added_by',b.added_by,'added_at',b.added_at,'confirmed_by',b.confirmed_by,'confirmed_at',b.confirmed_at,'evidence',json(b.evidence_json),'focus',b.focus)`;

// A source reference controls every derived rendering, including immutable historical snapshots.
export class TagState {
 constructor(readonly env:Env,readonly actor:Actor){}
 async visible(binding:TagBinding):Promise<TagBinding|null>{
  if(!binding.evidence.length)return binding;
  const allowed:Evidence[]=[];
  for(const e of binding.evidence){
   if(!e.observation_id){allowed.push(e);continue;}
   if(await this.env.DB.prepare("SELECT 1 FROM observations src WHERE src.id=? AND ((EXISTS(SELECT 1 FROM archives ar WHERE ar.id=src.archive_id AND ar.deleted=0) AND (src.deleted=0 OR src.author_id=?)) OR ?='admin')").bind(e.observation_id,this.actor.id,this.actor.role).first())allowed.push(e);
  }
  return allowed.length?{...binding,evidence:allowed}:null;
 }
 async raw(archiveId:string,closed=false,snapshotVersion?:number|null):Promise<TagBinding[]>{
  const rows=closed?await this.env.DB.prepare('SELECT s.data_json,t.enabled,c.enabled category_enabled,t.merged_into,c.color FROM archive_tag_snapshots s JOIN tags t ON t.id=s.tag_id JOIN tag_categories c ON c.id=t.category_id WHERE s.archive_id=? AND s.close_version=?').bind(archiveId,snapshotVersion??0).all<{data_json:string;enabled:number;category_enabled:number;merged_into:string|null;color:string}>():await this.env.DB.prepare(`SELECT ${bindingJson} data_json FROM archive_tags b JOIN tags t ON t.id=b.tag_id JOIN tag_categories c ON c.id=t.category_id WHERE b.archive_id=?`).bind(archiveId).all<{data_json:string}>();
  return rows.results.map(({data_json,...current})=>({...JSON.parse(data_json),...current} as TagBinding)).sort((a,b)=>`${a.category_name}：${a.name}:${a.tag_id}`.localeCompare(`${b.category_name}：${b.name}:${b.tag_id}`,'zh'));
 }
 async list(archiveId:string,closed=false,snapshotVersion?:number|null){const raw=await this.raw(archiveId,closed,snapshotVersion);return (await Promise.all(raw.map(b=>this.visible(b)))).filter((b):b is TagBinding=>!!b);}
 async summary(archiveId:string,closed=false,snapshotVersion?:number|null){
  const source=closed?"SELECT json_set(s.data_json,'$.color',c.color) data_json FROM archive_tag_snapshots s JOIN tags t ON t.id=s.tag_id JOIN tag_categories c ON c.id=t.category_id WHERE s.archive_id=? AND s.close_version=?":`SELECT ${bindingJson} data_json FROM archive_tags b JOIN tags t ON t.id=b.tag_id JOIN tag_categories c ON c.id=t.category_id WHERE b.archive_id=?`;
  const rows=await this.env.DB.prepare(`WITH source AS (${source}), visible AS (SELECT data_json FROM source WHERE ${evidenceVisibilitySql("json_extract(data_json,'$.evidence')")}), ranked AS (SELECT data_json,count(*) OVER() total,max(json_extract(data_json,'$.focus')) OVER() any_focus FROM visible) SELECT json_extract(data_json,'$.tag_id') tag_id,json_extract(data_json,'$.category_name') category_name,json_extract(data_json,'$.name') name,json_extract(data_json,'$.color') color,json_extract(data_json,'$.focus') focus,total FROM ranked WHERE any_focus=0 OR json_extract(data_json,'$.focus')>0 ORDER BY focus,category_name,name,tag_id LIMIT 3`).bind(archiveId,...(closed?[snapshotVersion??0]:[]),this.actor.id,this.actor.role).all<TagLabel&{total:number}>();
  return {tags:rows.results.map(({total:_,...t})=>t),total:rows.results[0]?.total??0};
 }
 async summaries(ids:string[]){
  const result=new Map<string,{tags:TagLabel[];total:number}>();if(!ids.length)return result;
  const rows=await this.env.DB.prepare(`WITH selected AS (SELECT * FROM archives WHERE id IN (SELECT value FROM json_each(?))), source AS (
   SELECT b.archive_id,${bindingJson} data_json FROM selected a JOIN archive_tags b ON b.archive_id=a.id JOIN tags t ON t.id=b.tag_id JOIN tag_categories c ON c.id=t.category_id WHERE a.closed=0 AND a.deleted=0
   UNION ALL SELECT s.archive_id,json_set(s.data_json,'$.color',c.color) FROM selected a JOIN archive_tag_snapshots s ON s.archive_id=a.id AND s.close_version=CASE WHEN a.deleted=1 THEN a.deleted_snapshot_version ELSE a.tag_snapshot_version END JOIN tags t ON t.id=s.tag_id JOIN tag_categories c ON c.id=t.category_id WHERE a.closed=1 OR a.deleted=1
  ), visible AS (SELECT * FROM source WHERE ${evidenceVisibilitySql("json_extract(data_json,'$.evidence')")}), ranked AS (SELECT *,count(*) OVER(PARTITION BY archive_id) total,max(json_extract(data_json,'$.focus')) OVER(PARTITION BY archive_id) any_focus FROM visible), limited AS (
   SELECT *,row_number() OVER(PARTITION BY archive_id ORDER BY json_extract(data_json,'$.focus'),json_extract(data_json,'$.category_name'),json_extract(data_json,'$.name'),json_extract(data_json,'$.tag_id')) rank FROM ranked WHERE any_focus=0 OR json_extract(data_json,'$.focus')>0
  ) SELECT archive_id,total,json_extract(data_json,'$.tag_id') tag_id,json_extract(data_json,'$.category_name') category_name,json_extract(data_json,'$.name') name,json_extract(data_json,'$.color') color,json_extract(data_json,'$.focus') focus FROM limited WHERE rank<=3 ORDER BY archive_id,rank`).bind(JSON.stringify(ids),this.actor.id,this.actor.role).all<TagLabel&{archive_id:string;total:number}>();
  for(const {archive_id,total,...tag} of rows.results){const entry=result.get(archive_id)??{tags:[],total};entry.tags.push(tag);result.set(archive_id,entry);}return result;
 }
 snapshot(archiveId:string,version:number){return this.env.DB.prepare(`INSERT INTO archive_tag_snapshots(archive_id,close_version,tag_id,data_json) SELECT b.archive_id,?,b.tag_id,${bindingJson} FROM archive_tags b JOIN tags t ON t.id=b.tag_id JOIN tag_categories c ON c.id=t.category_id WHERE b.archive_id=?`).bind(version,archiveId);}
 async validateEvidence(evidence:Evidence[],archiveId:string,requireRead:boolean){
  for(const e of evidence){if(!e.observation_id)continue;
   const row=await this.env.DB.prepare("SELECT 1 FROM observations o JOIN observation_versions v ON v.observation_id=o.id WHERE o.id=? AND o.archive_id=? AND v.version=? AND (o.deleted=0 OR o.author_id=? OR ?='admin')").bind(e.observation_id,archiveId,e.content_version!,this.actor.id,this.actor.role).first();
   if(!row)throw new Failure(400,'SOURCE_UNAVAILABLE','依据记录或版本不存在、属于其他档案，或当前不可读');
   if(requireRead&&!await this.env.DB.prepare('SELECT 1 FROM observation_reads WHERE credential_id=? AND observation_id=? AND content_version=?').bind(this.actor.credential_id,e.observation_id,e.content_version!).first())throw new Failure(409,'SOURCE_NOT_READ','请先实际读取所引用的观察版本，再确认依据');
  }
 }
 async filterEvent(value:unknown){
  if(!Array.isArray(value))return value;
  return (await Promise.all((value as TagBinding[]).map(b=>this.visible(b)))).filter(Boolean);
 }
}
