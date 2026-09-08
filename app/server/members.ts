import {z} from 'zod';
import {passwordInput,limitPasswordWork} from './auth.ts';
import {hashPassword} from './password.ts';
import {assertAdmin} from './credentials.ts';
import {command,requestId,expectedVersion,type Source} from './commands.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';

export const memberCreateInput=z.object({
  username:z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,40}$/,'账号使用 3–40 位字母、数字、点、下划线或连字符'),
  name:z.string().trim().min(1).max(80),role:z.enum(['admin','member']).default('member'),
  qq:z.string().regex(/^\d{5,20}$/,'QQ 使用 5–20 位数字').nullable().default(null),
  temporary_password:passwordInput.describe('客户端生成并私下交付的临时密码；服务只保存带盐的慢哈希，不回显。'),
  request_id:requestId,
}).strict();
export const memberResetInput=z.object({id:z.uuid(),expected_version:expectedVersion,temporary_password:passwordInput,request_id:requestId}).strict();
export const memberFrozenInput=z.object({id:z.uuid(),expected_version:expectedVersion,frozen:z.boolean(),request_id:requestId}).strict();
export const memberRoleInput=z.object({id:z.uuid(),expected_version:expectedVersion,role:z.enum(['admin','member']),request_id:requestId}).strict();
export const memberProfileInput=z.object({id:z.uuid(),expected_version:expectedVersion,name:z.string().trim().min(1).max(80),qq:z.string().regex(/^\d{5,20}$/).nullable(),request_id:requestId}).strict();
type ManagedMember={id:string;username:string;name:string;role:'admin'|'member';frozen:number;must_change_password:number;qq:string|null;avatar_id:string|null;version:number;auth_epoch:number};
export class Members{
  constructor(private env:Env,private actor:Actor,private source:Source){}
  private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
  private async get(id:string,version?:number){
    const member=await this.stmt('SELECT id,username,name,role,frozen,must_change_password,qq,avatar_id,version,auth_epoch FROM members WHERE id=?',id).first<ManagedMember>();
    if(!member)throw new Failure(404,'NOT_FOUND','猎头账号不存在');
    if(version!==undefined&&member.version!==version)throw new Failure(409,'VERSION_CONFLICT','账号已被更新，请刷新后核对');
    return member;
  }
  private versionGuard(id:string,version:number,key:string){return this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members WHERE id=? AND version=?) THEN 1 ELSE 0 END)',key,id,version);}
  private event(id:string,kind:string,before:unknown,after:unknown){return this.stmt('INSERT INTO member_events(id,actor_id,member_id,source,kind,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),this.actor.id,id,this.source,kind,JSON.stringify(before),JSON.stringify(after),now());}
  async list(input:unknown={}){
    assertAdmin(this.actor);
    const a=z.object({before:z.string().max(100).optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(input);
    const rows=await this.stmt(`SELECT id,username,name,role,frozen,must_change_password,qq,avatar_id,version,created_at FROM members ${a.before?'WHERE username>?':''} ORDER BY username COLLATE NOCASE LIMIT ?`,...(a.before?[a.before]:[]),a.limit+1).all();
    const members:Record<string,unknown>[]=rows.results.slice(0,a.limit).map(m=>({...m,frozen:!!m.frozen,must_change_password:!!m.must_change_password}));
    return {members,next_cursor:rows.results.length>a.limit?String(members.at(-1)?.username):null};
  }
  async detail(id:string){assertAdmin(this.actor);z.uuid().parse(id);const {auth_epoch:_,...member}=await this.get(id);return {member:{...member,frozen:!!member.frozen,must_change_password:!!member.must_change_password}};}
  async create(input:unknown){
    assertAdmin(this.actor);const a=memberCreateInput.parse(input);
    await limitPasswordWork(this.env,this.actor.id);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'member.create',parameters:{username:a.username,name:a.name,role:a.role,qq:a.qq},secret:a.temporary_password,requireAdmin:true},async()=>{
      if(await this.stmt('SELECT id FROM members WHERE username=?',a.username).first())throw new Failure(409,'USERNAME_TAKEN','这个猎头账号已存在');
      const id=uid(),created=now(),password=await hashPassword(a.temporary_password);
      const result={id,username:a.username,name:a.name,role:a.role,qq:a.qq,version:1,frozen:false,must_change_password:true,changed:true};
      return {result,secretHash:password,statements:[
        this.stmt('INSERT INTO members(id,username,name,role,password_hash,qq,created_at) VALUES(?,?,?,?,?,?,?)',id,a.username,a.name,a.role,password,a.qq,created),
        this.stmt('INSERT INTO member_events(id,actor_id,member_id,source,kind,after_json,created_at) VALUES(?,?,?,?,?,?,?)',uid(),this.actor.id,id,this.source,'member.created',JSON.stringify({username:a.username,name:a.name,role:a.role,qq:a.qq,must_change_password:true}),created),
      ]};
    });
  }
  async resetPassword(input:unknown){
    assertAdmin(this.actor);const a=memberResetInput.parse(input);
    await limitPasswordWork(this.env,this.actor.id);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'member.reset_password',parameters:{id:a.id,expected_version:a.expected_version},secret:a.temporary_password,requireAdmin:true},async()=>{
      const member=await this.get(a.id,a.expected_version),key=uid(),password=await hashPassword(a.temporary_password);
      return {result:{id:a.id,version:member.version+1,must_change_password:true,changed:true},secretHash:password,statements:[
        this.versionGuard(a.id,a.expected_version,key),
        this.stmt('UPDATE members SET password_hash=?,must_change_password=1,auth_epoch=auth_epoch+1,version=version+1 WHERE id=?',password,a.id),
        this.event(a.id,'member.password_reset',{must_change_password:!!member.must_change_password},{must_change_password:true,existing_credentials_invalidated:true}),
        this.stmt('DELETE FROM mutation_guards WHERE id=?',key),
      ]};
    });
  }
  async setFrozen(input:unknown){const a=memberFrozenInput.parse(input);return this.setAccess(a,{frozen:a.frozen?1:0});}
  async setRole(input:unknown){const a=memberRoleInput.parse(input);return this.setAccess(a,{role:a.role});}
  private async activeAdminCount(){return (await this.stmt("SELECT count(*) n FROM members WHERE role='admin' AND frozen=0").first<{n:number}>())!.n;}
  private async setAccess(a:{id:string;expected_version:number;request_id:string},patch:{role?:'admin'|'member';frozen?:number}){
    assertAdmin(this.actor);
    const removingAdmin=(m:ManagedMember)=>(m.role==='admin'&&!m.frozen)&&((patch.role!==undefined&&patch.role!=='admin')||patch.frozen===1);
    try{
      return await command(this.env,this.actor,{requestId:a.request_id,operation:patch.role!==undefined?'member.role':'member.frozen',parameters:{id:a.id,expected_version:a.expected_version,...patch},requireAdmin:true},async()=>{
        const member=await this.get(a.id,a.expected_version),role=patch.role??member.role,frozen=patch.frozen??member.frozen,key=uid();
        const changed=role!==member.role||frozen!==member.frozen;
        if(changed&&removingAdmin(member)&&await this.activeAdminCount()<=1)throw new Failure(409,'LAST_ADMIN_REQUIRED','至少需要保留一名未冻结的管理员');
        const result={id:a.id,role,frozen:!!frozen,version:member.version+(changed?1:0),changed};
        const statements=[this.versionGuard(a.id,a.expected_version,key)];
        if(changed)statements.push(
          this.stmt('UPDATE members SET role=?,auth_epoch=auth_epoch+CASE WHEN ?=1 AND frozen=0 THEN 1 ELSE 0 END,frozen=?,version=version+1 WHERE id=?',role,frozen,frozen,a.id),
          // This guard runs AFTER the mutation in the same transaction. Concurrent self-demotions
          // serialize in D1 and the second transaction rolls back if no active admin would remain.
          this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members WHERE role='admin' AND frozen=0) THEN 1 ELSE 0 END)",key+':admin'),
          this.event(a.id,patch.role!==undefined?'member.role_changed':frozen?'member.frozen':'member.unfrozen',{role:member.role,frozen:!!member.frozen},{role,frozen:!!frozen}),
          this.stmt('DELETE FROM mutation_guards WHERE id=?',key+':admin'),
        );
        statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
        return {result,statements};
      });
    }catch(error){
      if(error instanceof Failure&&error.code==='PRECONDITION_CHANGED'){
        const current=await this.get(a.id);
        if(removingAdmin(current)&&await this.activeAdminCount()<=1)throw new Failure(409,'LAST_ADMIN_REQUIRED','至少需要保留一名未冻结的管理员；另一项并发变更已完成');
        if(current.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','账号已被另一项操作更新，请刷新后核对');
      }
      throw error;
    }
  }
  async updateProfile(input:unknown){
    assertAdmin(this.actor);const a=memberProfileInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'member.profile',parameters:{id:a.id,expected_version:a.expected_version,name:a.name,qq:a.qq},requireAdmin:true},async()=>{
      const member=await this.get(a.id,a.expected_version),key=uid(),changed=member.name!==a.name||member.qq!==a.qq;
      const statements=[this.versionGuard(a.id,a.expected_version,key)];
      if(changed)statements.push(this.stmt('UPDATE members SET name=?,qq=?,version=version+1 WHERE id=?',a.name,a.qq,a.id),this.event(a.id,'member.profile_changed',{name:member.name,qq:member.qq},{name:a.name,qq:a.qq}));
      statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
      return {result:{id:a.id,name:a.name,qq:a.qq,version:member.version+(changed?1:0),changed},statements};
    });
  }
  async history(id:string){assertAdmin(this.actor);z.uuid().parse(id);await this.get(id);const rows=await this.stmt('SELECT id,actor_id,(SELECT name FROM members WHERE members.id=member_events.actor_id) actor_name,source,kind,before_json,after_json,created_at FROM member_events WHERE member_id=? ORDER BY created_at DESC,id DESC LIMIT 100',id).all();return {events:rows.results,complete:rows.results.length<100};}
}
