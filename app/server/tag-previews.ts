import {Failure,now,uid,type Actor,type Env} from './types.ts';
export type TagExpectation={entity_type:'tag'|'category';id:string;version:number;impact_version:number};
type Row={member_id:string;auth_epoch:number;role:string;input_json:string;expected_json:string;expires_at:string};

// An actor-bound proposal and its transaction guards are shared by every vocabulary operation.
export class TagPreviews {
 constructor(readonly env:Env,readonly actor:Actor){}
 async save(input:unknown,expected:TagExpectation[]){const id=uid(),created=now(),expires=new Date(Date.now()+3600000).toISOString();await this.env.DB.prepare('INSERT INTO tag_maintenance_previews(id,member_id,auth_epoch,role,input_json,expected_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,this.actor.id,this.actor.auth_epoch,this.actor.role,JSON.stringify(input),JSON.stringify(expected),created,expires).run();return {preview_id:id,expires_at:expires};}
 async read(id:string){const row=await this.env.DB.prepare('SELECT * FROM tag_maintenance_previews WHERE id=? AND member_id=?').bind(id,this.actor.id).first<Row>();if(!row||row.expires_at<=now()||row.auth_epoch!==this.actor.auth_epoch||row.role!==this.actor.role)throw new Failure(409,'PREVIEW_EXPIRED','预览已失效，请重新读取影响范围');return {input:JSON.parse(row.input_json) as unknown,expected:JSON.parse(row.expected_json) as TagExpectation[]};}
 async guards(expected:TagExpectation[]){const statements:D1PreparedStatement[]=[],cleanup:D1PreparedStatement[]=[];
  for(const e of expected){const table=e.entity_type==='tag'?'tags':'tag_categories',current=await this.env.DB.prepare(`SELECT version,impact_version FROM ${table} WHERE id=?`).bind(e.id).first<{version:number;impact_version:number}>();if(!current||current.version!==e.version||current.impact_version!==e.impact_version)throw new Failure(409,'PREVIEW_STALE','定义、绑定范围或来源可见性已改变，请重新预览');const key=uid();statements.push(this.env.DB.prepare(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=? AND version=? AND impact_version=?) THEN 1 ELSE 0 END)`).bind(key,e.id,e.version,e.impact_version));cleanup.push(this.env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(key));}
  return {statements,cleanup};
 }
}
