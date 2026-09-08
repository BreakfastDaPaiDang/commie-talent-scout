import { z } from 'zod';
import { hashPassword, verifyPassword } from './password.ts';
import { digest, Failure, now, uid, type Actor, type Env } from './types.ts';

export const passwordInput = z.string().min(12,'密码至少 12 个字符').max(128,'密码最多 128 个字符');
const loginInput = z.object({ username:z.string().trim().min(1).max(80), password:z.string().min(1).max(128) });
export const cookieName = 'cts_session';

export async function authenticate(request: Request, env: Env, allowPasswordChange=false): Promise<Actor> {
  const isMcp = new URL(request.url).pathname === '/mcp';
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)cts_session=([^;]+)/)?.[1];
  const value = isMcp ? bearer : (bearer ?? cookie);
  if (!value) throw new Failure(401,'UNAUTHENTICATED','请先登录或重新连接');
  const actor=await env.DB.prepare(`SELECT m.id,m.username,m.name,m.role,m.frozen,m.auth_epoch,m.must_change_password,
    m.version,m.qq,m.avatar_id,c.id credential_id,c.kind credential_kind FROM credentials c JOIN members m ON m.id=c.member_id
    WHERE c.hash=? AND c.revoked_at IS NULL AND c.expires_at>? AND c.auth_epoch=m.auth_epoch AND m.frozen=0
    AND c.kind=?`).bind(await digest(value),now(),bearer?'mcp':'session').first<Actor>();
  if (!actor) throw new Failure(401,'UNAUTHENTICATED','登录或连接已失效，请重新认证');
  if (actor.must_change_password && !allowPasswordChange) throw new Failure(403,'PASSWORD_CHANGE_REQUIRED','请先更换临时密码');
  return actor;
}
async function limit(env: Env, identity: string, seconds: number, max: number) {
  const epoch=Math.floor(Date.now()/1000), window=Math.floor(epoch/seconds);
  const key=await digest(`${identity}:${window}`);
  const row=await env.DB.prepare(`INSERT INTO auth_rates(key,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).bind(key,(window+1)*seconds).first<{count:number}>();
  if (!row || row.count>max) throw new Failure(429,'RATE_LIMITED','尝试过于频繁，请稍后重试');
}
export async function login(request: Request, env: Env, input: unknown) {
  const a=loginInput.parse(input);
  await limit(env,'ip:'+(request.headers.get('CF-Connecting-IP')??'local'),60,20);
  await limit(env,'account:'+a.username.toLowerCase(),600,10);
  const member=await env.DB.prepare('SELECT * FROM members WHERE username=? AND frozen=0').bind(a.username).first<Actor & {password_hash:string}>();
  if (!member || !(await verifyPassword(a.password,member.password_hash))) throw new Failure(401,'INVALID_LOGIN','账号或密码不正确');
  const secret=uid()+uid(), credentialId=uid();
  const expires=new Date(Date.now()+7*86400000).toISOString();
  await env.DB.prepare(`INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at)
    SELECT ?,id,?,'session','网页登录',auth_epoch,?,? FROM members WHERE id=? AND frozen=0 AND auth_epoch=? AND password_hash=?`)
    .bind(credentialId,await digest(secret),now(),expires,member.id,member.auth_epoch,member.password_hash).run();
  const saved=await env.DB.prepare('SELECT id FROM credentials WHERE id=?').bind(credentialId).first();
  if (!saved) throw new Failure(409,'AUTH_CHANGED','账号已变更，请重新登录');
  return {secret,member};
}
export async function changePassword(env: Env, actor: Actor, input: unknown) {
  const a=z.object({current_password:z.string().min(1).max(128),new_password:passwordInput}).parse(input);
  await limit(env,'password:'+actor.id,600,6);
  const member=await env.DB.prepare('SELECT password_hash FROM members WHERE id=?').bind(actor.id).first<{password_hash:string}>();
  if (!member || !await verifyPassword(a.current_password,member.password_hash)) throw new Failure(400,'PASSWORD_MISMATCH','当前密码不正确');
  if (a.current_password===a.new_password) throw new Failure(400,'PASSWORD_UNCHANGED','请设置一个不同的新密码');
  const password=await hashPassword(a.new_password), key=uid();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members m JOIN credentials c ON c.member_id=m.id
      WHERE m.id=? AND m.auth_epoch=? AND m.frozen=0 AND m.password_hash=? AND c.id=? AND c.revoked_at IS NULL AND c.expires_at>?) THEN 1 ELSE 0 END)`)
      .bind(key,actor.id,actor.auth_epoch,member.password_hash,actor.credential_id,now()),
    env.DB.prepare('UPDATE members SET password_hash=?,must_change_password=0,auth_epoch=auth_epoch+1,version=version+1 WHERE id=?').bind(password,actor.id),
    env.DB.prepare('INSERT INTO auth_events VALUES(?,?,?,?)').bind(uid(),actor.id,'password.changed',now()),
    env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(key),
  ]);
  return {reauthenticate:true};
}
export function sessionCookie(secret: string, request: Request, expired=false) {
  return `${cookieName}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expired?0:604800}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
