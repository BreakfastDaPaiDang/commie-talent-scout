import type {CatalogFile} from '../shared/catalog';
import {ApiError} from './api';
const attempts=new Map<string,string>(),files=new WeakMap<File,string>();
export async function catalogRead<T=any>(path:string,body?:unknown):Promise<T>{
 const response=await fetch('/api/catalog'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json() as T&{error?:{code?:string;message?:string}};if(!response.ok)throw new ApiError(response.status,data.error?.code??'CATALOG_ERROR',data.error?.message??'暂时无法读取资源');return data;
}
export async function catalogWrite<T=any>(path:string,input:Record<string,unknown>):Promise<T>{
 const key=path+JSON.stringify(input),request_id=attempts.get(key)??crypto.randomUUID();attempts.set(key,request_id);
 try{const result=await catalogRead<T>(path,{...input,request_id});attempts.delete(key);return result;}
 catch(error){const saved=await catalogRead<{result:T|null}>('/requests/'+request_id).catch(()=>null);if(saved?.result){attempts.delete(key);return saved.result;}if(error instanceof ApiError&&error.status<500){attempts.delete(key);throw error;}throw Object.assign(error instanceof Error?error:new Error(String(error)),{retryOnly:true});}
}
export async function catalogUpload(file:File,entryId:string|null):Promise<CatalogFile>{
 if(file.size>10485760||file.size===0)throw new Error('请选择不超过 10 MiB 的文档或图片');
 const id=files.get(file)??crypto.randomUUID();files.set(file,id);const bytes=await file.arrayBuffer(),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const mime=file.type||(/\.md$/i.test(file.name)?'text/markdown':/\.txt$/i.test(file.name)?'text/plain':'');
 await catalogWrite('/files/prepare',{id,name:file.name,mime,bytes:file.size,sha256,entry_id:entryId});
 const response=await fetch('/api/catalog/files/'+id+'/content',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes,credentials:'same-origin'}),data=await response.json() as {error?:{message?:string}};if(!response.ok)throw new Error(data.error?.message??'上传失败，请重试');
 return {id,name:file.name,mime,bytes:file.size,state:'ready',entry_id:entryId};
}
