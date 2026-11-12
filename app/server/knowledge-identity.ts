import {authenticate} from './auth.ts';
import {Failure,now,type Env} from './types.ts';

// Identity-only bridge: no passwords, credentials, archive content or contact data.
export async function knowledgeIdentity(request:Request,env:Env){
 const url=new URL(request.url);
 if(url.protocol!=='https:'&&!(env.ENVIRONMENT==='staging'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Failure(403,'HTTPS_REQUIRED','请使用 HTTPS');
 const actor=await authenticate(request,env);
 if(actor.identity_kind!=='human')throw new Failure(403,'HUMAN_ACCOUNT_REQUIRED','知识库使用真人账号身份');
 const membership=await env.DB.prepare("SELECT id FROM archives WHERE linked_account_id=? AND type='person' AND person_role='member' AND deleted=0 AND closed=0").bind(actor.id).first<{id:string}>();
 return {id:actor.id,name:actor.name,username:actor.username,role:actor.role,eligible:!!membership,membership_id:membership?.id??null,verified_at:now(),environment:env.ENVIRONMENT};
}
