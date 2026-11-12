import {z} from 'zod';
import {KnowledgeError,type Env,type Identity} from './types.ts';

const identity=z.object({id:z.uuid(),name:z.string(),username:z.string(),role:z.enum(['member','admin']),eligible:z.boolean(),membership_id:z.uuid().nullable(),verified_at:z.iso.datetime(),environment:z.enum(['staging','production'])});
export function identityHeaders(request:Request,allowCookie=false){
 const headers=new Headers(),bearer=request.headers.get('Authorization');
 if(bearer&&/^Bearer \S{1,1024}$/.test(bearer)&&!bearer.startsWith('Bearer candy_'))headers.set('Authorization',bearer);
 else if(allowCookie){const session=request.headers.get('Cookie')?.match(/(?:^|;\s*)cts_session=([^;]+)/)?.[1];if(session&&/^\S{1,1024}$/.test(session))headers.set('Cookie','cts_session='+session);}
 return headers;
}
export async function authenticate(request:Request,env:Env,allowCookie=false):Promise<Identity>{
 const bearer=request.headers.get('Authorization');
 const headers=identityHeaders(request,allowCookie);
 if(!headers.has('Authorization')&&!headers.has('Cookie'))throw new KnowledgeError(401,'UNAUTHENTICATED','请使用本人的康米巨星账号或个人连接');
 const origin=new URL(env.IDENTITY_ORIGIN);
 if(origin.protocol!=='https:'||origin.origin!==env.IDENTITY_ORIGIN)throw new KnowledgeError(503,'IDENTITY_CONFIGURATION','身份服务配置无效');
 let response:Response;
 // workerd supports manual/follow, not Node's redirect:error. Manual rejects
 // redirects below without ever forwarding a user's credential to another host.
 try{response=await env.IDENTITY.fetch(new Request(origin.origin+'/api/knowledge/identity',{headers,redirect:'manual',signal:AbortSignal.timeout(10000)}));}
 catch{throw new KnowledgeError(503,'IDENTITY_UNAVAILABLE','身份服务暂不可用，请稍后重试');}
 if(response.status===401||response.status===403)throw new KnowledgeError(response.status,'IDENTITY_REJECTED','连接已失效或该账号不能使用知识库');
 if(!response.ok)throw new KnowledgeError(503,'IDENTITY_UNAVAILABLE','身份服务暂不可用，请稍后重试');
 let parsed:Identity;
 try{parsed=identity.parse(await response.json());}catch{throw new KnowledgeError(503,'IDENTITY_INVALID','身份服务返回无效，请稍后重试');}
 if(parsed.environment!==env.ENVIRONMENT||parsed.eligible!==!!parsed.membership_id||Math.abs(Date.now()-Date.parse(parsed.verified_at))>60000)throw new KnowledgeError(503,'IDENTITY_INVALID','身份信息环境或有效时间不匹配');
 return parsed;
}
