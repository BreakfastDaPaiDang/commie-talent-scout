import {z} from 'zod';
import {assertAdmin,authGuard} from './credentials.ts';
import {credentialActor} from './authority.ts';
import {digest,Failure,now,uid,type Actor,type Env} from './types.ts';
import {zaojiSubject} from '../rules/service-subjects.ts';

const input=z.object({name:z.string().trim().min(1).max(60),days:z.number().int().min(1).max(90).default(90)}).strict();
const secret=()=> 'cts_'+[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
/** Only an existing human administrator can grant new root authority. */
export async function issueVerificationCredential(env:Env,actor:Actor,value:unknown){
 assertAdmin(actor);if(actor.identity_kind==='service'||actor.credential_kind!=='session')throw new Failure(403,'HUMAN_ADMIN_SESSION_REQUIRED','请由管理员通过网页登录签发验收凭据');
 const a=input.parse(value),id=uid(),key=uid(),token=secret(),at=now(),expires=new Date(Date.now()+a.days*86400000).toISOString();
 await env.DB.batch([
  authGuard(env,actor,key,true),
  env.DB.prepare(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members WHERE id=? AND identity_kind='service' AND frozen=0)
   AND (SELECT count(*) FROM credentials WHERE member_id=? AND purpose='verification' AND parent_id IS NULL AND revoked_at IS NULL AND expires_at>?)<5 THEN 1 ELSE 0 END)`).bind(key+':service',zaojiSubject.id,zaojiSubject.id,at),
  env.DB.prepare(`INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at,purpose)
   SELECT ?,id,?,'mcp',?,auth_epoch,?,?,'verification' FROM members WHERE id=?`).bind(id,await digest(token),a.name,at,expires,zaojiSubject.id),
  env.DB.prepare(`INSERT INTO member_events(id,actor_id,member_id,source,kind,after_json,created_at) VALUES(?,?,?,'web','member.verification_granted',?,?)`)
   .bind(uid(),actor.id,zaojiSubject.id,JSON.stringify({credential_id:id,name:a.name,purpose:'verification',role:'admin',expires_at:expires}),at),
  env.DB.prepare('DELETE FROM mutation_guards WHERE id IN (?,?)').bind(key,key+':service'),
 ]);
 return {id,secret:token,expires_at:expires,purpose:'verification',member_id:zaojiSubject.id};
}
/** Exchange a root MCP credential for a one-hour browser session; no password. */
export async function verificationSession(env:Env,actor:Actor,value:unknown){
 const a=z.object({name:z.string().trim().min(1).max(60)}).strict().parse(value);
 if(actor.identity_kind!=='service'||actor.execution_purpose!=='verification'||actor.credential_kind!=='mcp'||actor.credential_parent_id)throw new Failure(403,'VERIFICATION_ROOT_REQUIRED','需要早纪的验收根凭据');
 const id=uid(),key=uid(),token=secret(),at=now(),expires=new Date(Math.min(Date.now()+3600000,Date.parse(actor.credential_expires_at!))).toISOString();
 await env.DB.batch([
  authGuard(env,actor,key,true),
  env.DB.prepare("INSERT INTO mutation_guards VALUES(?,CASE WHEN (SELECT count(*) FROM credentials WHERE parent_id=? AND kind='session' AND revoked_at IS NULL AND expires_at>?)<20 THEN 1 ELSE 0 END)").bind(key+':limit',actor.credential_id,at),
  env.DB.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at,purpose,parent_id) VALUES(?,?,?,'session',?,?,?,?,'verification',?)")
   .bind(id,actor.id,await digest(token),'开发验收：'+a.name,actor.auth_epoch,at,expires,actor.credential_id),
  env.DB.prepare('DELETE FROM mutation_guards WHERE id IN (?,?)').bind(key,key+':limit'),
 ]);
 return {secret:token,member:(await credentialActor(env,id))!,expires_at:expires};
}
export async function revokeVerificationCredential(env:Env,actor:Actor,value:unknown){
 assertAdmin(actor);const a=z.object({id:z.uuid()}).strict().parse(value),key=uid(),at=now();
 const row=await env.DB.prepare("SELECT id,revoked_at FROM credentials WHERE id=? AND member_id=? AND purpose='verification' AND parent_id IS NULL").bind(a.id,zaojiSubject.id).first<{id:string;revoked_at:string|null}>();
 if(!row)throw new Failure(404,'NOT_FOUND','验收凭据不存在');
 await env.DB.batch([authGuard(env,actor,key,true),env.DB.prepare('UPDATE credentials SET revoked_at=?,version=version+1 WHERE id=? AND revoked_at IS NULL').bind(at,a.id),
  env.DB.prepare("INSERT INTO member_events(id,actor_id,member_id,source,kind,after_json,created_at) VALUES(?,?,?,'web','member.verification_revoked',?,?)").bind(uid(),actor.id,zaojiSubject.id,JSON.stringify({credential_id:a.id,purpose:'verification'}),at),env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(key)]);
 return {id:a.id,revoked:true,changed:!row.revoked_at};
}
