import {ApiError} from './api';
const attempts=new Map<string,string>();
export async function knowledgeRead<T=any>(path:string):Promise<T>{return send(path);}
async function send<T=any>(path:string,body?:Record<string,unknown>):Promise<T>{
 const response=await fetch('/api/knowledge-workspace'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const data=await response.json() as T&{error?:{code?:string;message?:string}};if(!response.ok)throw new ApiError(response.status,data.error?.code??'KNOWLEDGE_ERROR',data.error?.message??'知识库暂不可用');return data;
}
export async function knowledgeWrite<T=any>(path:string,body:Record<string,unknown>):Promise<T>{
 const signature=path+JSON.stringify(body),request_id=attempts.get(signature)??crypto.randomUUID();attempts.set(signature,request_id);
 try{const result=await send<T>(path,{...body,request_id});attempts.delete(signature);return result;}
 catch(error){const receipt=await knowledgeRead<{result:T|null}>('/requests/'+request_id).catch(()=>null);if(receipt?.result){attempts.delete(signature);return receipt.result;}if(error instanceof ApiError&&error.status<500)attempts.delete(signature);throw error;}
}
