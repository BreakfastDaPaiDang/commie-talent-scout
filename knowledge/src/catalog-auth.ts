import {z} from 'zod';
import {authenticate,identityHeaders} from './identity.ts';
import {KnowledgeError,hash,type Env} from './types.ts';
import type {CatalogActor} from './catalog.ts';
import type {CatalogPerson} from '../../app/shared/catalog.ts';

export async function giftIdentity(key:string,env:Env):Promise<CatalogActor>{
 if(!/^candy_[a-f0-9]{64}$/.test(key))throw new KnowledgeError(401,'INVALID_GIFT','访问入口无效或已撤销');
 const row=await env.KNOWLEDGE_DB.prepare('SELECT id,recipient_name FROM catalog_grants WHERE token_hash=? AND revoked_at IS NULL').bind(await hash(key)).first<{id:string;recipient_name:string}>();
 if(!row)throw new KnowledgeError(401,'INVALID_GIFT','访问入口无效或已撤销');return {kind:'guest',id:row.id,name:row.recipient_name,eligible:false};
}
export async function catalogIdentity(request:Request,env:Env):Promise<CatalogActor>{
 const bearer=request.headers.get('Authorization'),gift=bearer?.startsWith('Bearer candy_')?bearer.slice(7):request.headers.get('Cookie')?.match(/(?:^|;\s*)cts_candy=([^;]+)/)?.[1];
 const headers=identityHeaders(request,true);
 if(headers.has('Authorization')||headers.has('Cookie')){
  try{const actor=await authenticate(request,env,true);if(actor.eligible)return actor;if(!gift)throw new KnowledgeError(403,'FORMAL_MEMBER_REQUIRED','仅正式成员或获得糖果访问授权的人可以查看');}
  catch(e){if(!gift||!(e instanceof KnowledgeError)||![401,403].includes(e.status))throw e;}
 }
 if(gift)return giftIdentity(gift,env);
 throw new KnowledgeError(401,'UNAUTHENTICATED','请登录正式成员账号或使用已发放的糖果入口');
}
export async function catalogMembers(request:Request,env:Env):Promise<CatalogPerson[]>{
 let response:Response;try{response=await env.IDENTITY.fetch(new Request(env.IDENTITY_ORIGIN+'/api/knowledge/members',{headers:identityHeaders(request,true),redirect:'manual',signal:AbortSignal.timeout(10000)}));}catch{throw new KnowledgeError(503,'IDENTITY_UNAVAILABLE','暂时无法核对正式成员');}
 if(!response.ok)throw new KnowledgeError(response.status===403?403:503,'DIRECTORY_UNAVAILABLE','暂时无法读取正式成员目录');
 try{return z.object({members:z.array(z.object({id:z.uuid(),name:z.string()})).max(2000)}).parse(await response.json()).members;}catch{throw new KnowledgeError(503,'IDENTITY_INVALID','成员目录返回无效');}
}
export function giftCookie(key:string,secure=true,expired=false){return `cts_candy=${key}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${expired?0:60*60*24*30}${secure?'; Secure':''}`;}
