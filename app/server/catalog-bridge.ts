import {Failure,type Env,type Actor} from './types.ts';

export async function catalogMode(env:Env){return (await env.DB.prepare('SELECT mode FROM resource_catalog_state WHERE id=1').first<{mode:'legacy'|'migrating'|'independent'}>())?.mode??'legacy';}
export function catalogOrigin(env:Env){const value=env.CATALOG_ORIGIN;if(!value||new URL(value).protocol!=='https:'||new URL(value).origin!==value)throw new Failure(503,'CATALOG_UNAVAILABLE','生产资源服务暂不可用');return value;}
export async function requireCatalog(env:Env){if(await catalogMode(env)!=='independent')throw new Failure(503,'CATALOG_PREPARING','生产资源库正在准备，请稍后重试');if(!env.CATALOG)throw new Failure(503,'CATALOG_UNAVAILABLE','生产资源服务暂不可用');}
export async function catalogCall<T=Record<string,unknown>>(env:Env,actor:Actor,path:string,body?:unknown):Promise<T>{
 await requireCatalog(env);const origin=catalogOrigin(env),headers=new Headers(actor.catalog_headers);headers.set('Origin',origin);if(body!==undefined)headers.set('Content-Type','application/json');
 let response:Response;try{response=await env.CATALOG!.fetch(new Request(origin+'/api/catalog'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(15000)}));}catch{throw new Failure(503,'CATALOG_UNAVAILABLE','生产资源服务暂不可用；已提交的请求请先核实结果');}
 const data=await response.json() as T&{error?:{code?:string;message?:string}};if(!response.ok)throw new Failure(response.status,data.error?.code??'CATALOG_UNAVAILABLE',data.error?.message??'生产资源服务暂不可用');return data;
}
export async function catalogProxy(request:Request,env:Env,knowledgeOnly=false){
 if(knowledgeOnly){if(!env.CATALOG)throw new Failure(503,'KNOWLEDGE_UNAVAILABLE','知识服务暂不可用');}else await requireCatalog(env);const source=new URL(request.url),origin=catalogOrigin(env),headers=new Headers();
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==source.origin)throw new Failure(403,'ORIGIN_REJECTED','请从本站操作');
 for(const key of ['Authorization','Cookie','Content-Type']){const value=request.headers.get(key);if(value)headers.set(key,value);}headers.set('Origin',origin);
 const body=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer();
 let response:Response;try{response=await env.CATALOG!.fetch(new Request(origin+source.pathname+source.search,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(30000)}));}catch{throw new Failure(503,'CATALOG_UNAVAILABLE','生产资源服务暂不可用；请先核实原请求结果');}
 if(response.status>=300&&response.status<400)throw new Failure(503,'CATALOG_UNAVAILABLE','生产资源服务返回了意外跳转');return response;
}
