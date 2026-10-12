import {type Actor,type Env,now} from './types.ts';

// All entry points (bearer, browser, upload ticket and commit guards) use this
// same live authority. Derived credentials cannot outlive or survive their root.
export const effectiveRoleSql="CASE WHEN m.identity_kind='service' AND c.purpose='verification' THEN 'admin' ELSE m.role END";
export const activeAuthoritySql=`m.frozen=0 AND c.auth_epoch=m.auth_epoch AND c.revoked_at IS NULL AND c.expires_at>?
 AND ((m.identity_kind='human' AND c.purpose='interactive' AND c.parent_id IS NULL)
 OR (m.identity_kind='service' AND c.purpose='verification' AND (
  (c.parent_id IS NULL AND c.kind='mcp') OR EXISTS(SELECT 1 FROM credentials p
   WHERE p.id=c.parent_id AND p.member_id=m.id AND p.kind='mcp' AND p.purpose='verification'
   AND p.parent_id IS NULL AND p.revoked_at IS NULL AND p.auth_epoch=m.auth_epoch AND p.expires_at>=c.expires_at)
 )))`;
export const actorProjection=`m.id,m.username,m.name,${effectiveRoleSql} role,m.identity_kind,m.frozen,m.auth_epoch,m.must_change_password,
 m.version,m.qq,m.avatar_id,c.id credential_id,c.kind credential_kind,c.purpose execution_purpose,c.parent_id credential_parent_id,c.expires_at credential_expires_at`;
export async function credentialActor(env:Env,id:string){
 return env.DB.prepare(`SELECT ${actorProjection} FROM members m JOIN credentials c ON c.member_id=m.id WHERE c.id=? AND ${activeAuthoritySql}`)
  .bind(id,now()).first<Actor>();
}
