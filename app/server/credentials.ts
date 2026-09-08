import {z} from 'zod';
import {digest,Failure,now,uid,type Actor,type Env} from './types.ts';

export const credentialInput=z.object({name:z.string().trim().min(1).max(60),days:z.number().int().min(1).max(365).default(90)}).strict();
export function assertAdmin(actor:Actor){if(actor.role!=='admin')throw new Failure(403,'ADMIN_REQUIRED','仅管理员可以执行此操作');}
export function authGuard(env:Env,actor:Actor,key:string,requireAdmin=false){
  return env.DB.prepare(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM members m JOIN credentials c ON c.member_id=m.id
    WHERE m.id=? AND m.frozen=0 AND m.auth_epoch=? AND c.id=? AND c.auth_epoch=m.auth_epoch AND c.revoked_at IS NULL AND c.expires_at>? AND (?=0 OR m.role='admin')
  ) THEN 1 ELSE 0 END)`).bind(key,actor.id,actor.auth_epoch,actor.credential_id,now(),requireAdmin?1:0);
}
export async function listCredentials(env:Env,actor:Actor){
  const result=await env.DB.prepare(`SELECT id,name,created_at,expires_at,revoked_at,version,
    CASE WHEN auth_epoch<>? OR revoked_at IS NOT NULL OR expires_at<=? THEN 0 ELSE 1 END active
    FROM credentials WHERE member_id=? AND kind='mcp' ORDER BY created_at DESC LIMIT 100`).bind(actor.auth_epoch,now(),actor.id).all();
  return {credentials:result.results};
}
export async function createCredential(env:Env,actor:Actor,input:unknown){
  if(actor.credential_kind!=='session')throw new Failure(403,'WEB_SESSION_REQUIRED','请从猎头账号的连接管理创建凭证');
  const a=credentialInput.parse(input),id=uid(),key=uid();
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const secret='cts_'+Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  const created=now(),expires=new Date(Date.now()+a.days*86400000).toISOString();
  try{
    await env.DB.batch([
      authGuard(env,actor,key),
      env.DB.prepare(`INSERT INTO mutation_guards VALUES(?,CASE WHEN (SELECT count(*) FROM credentials WHERE member_id=? AND kind='mcp' AND revoked_at IS NULL AND expires_at>? AND auth_epoch=?)<20 THEN 1 ELSE 0 END)`).bind(key+':limit',actor.id,created,actor.auth_epoch),
      env.DB.prepare(`INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'mcp',?,?,?,?)`).bind(id,actor.id,await digest(secret),a.name,actor.auth_epoch,created,expires),
      env.DB.prepare('DELETE FROM mutation_guards WHERE id IN (?,?)').bind(key,key+':limit'),
    ]);
  }catch(error){
    if(String(error).includes('CHECK constraint'))throw new Failure(409,'CONNECTION_LIMIT_OR_AUTH_CHANGED','连接数量已达 20 个，或登录已变更；请刷新并撤销不用的连接');
    throw error;
  }
  return {id,name:a.name,secret,created_at:created,expires_at:expires,version:1};
}
export async function revokeCredential(env:Env,actor:Actor,input:unknown){
  const {id}=z.object({id:z.uuid()}).strict().parse(input),key=uid();
  const existing=await env.DB.prepare("SELECT id,revoked_at FROM credentials WHERE id=? AND member_id=? AND kind='mcp'").bind(id,actor.id).first<{id:string;revoked_at:string|null}>();
  if(!existing)throw new Failure(404,'NOT_FOUND','连接不存在');
  try{
    await env.DB.batch([
      authGuard(env,actor,key),
      env.DB.prepare('UPDATE credentials SET revoked_at=?,version=version+1 WHERE id=? AND revoked_at IS NULL').bind(now(),id),
      env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(key),
    ]);
  }catch(error){if(String(error).includes('CHECK constraint'))throw new Failure(409,'AUTH_CHANGED','账号或连接已变更，请重新认证');throw error;}
  return {id,revoked:true,changed:!existing.revoked_at};
}
