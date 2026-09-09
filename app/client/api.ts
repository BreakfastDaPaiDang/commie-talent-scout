export type Member = {id:string;username:string;name:string;role:'admin'|'member';must_change_password:boolean;version:number;qq:string|null;avatar_id:string|null};
export class ApiError extends Error {status:number;code:string;constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}}
export async function api<T=unknown>(path:string,body?:unknown):Promise<T>{
  const response=await fetch('/api'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json() as T & {error?:{code?:string;message?:string}};
  if(!response.ok){if(response.status===401&&path!=='/auth/login'&&path!=='/auth/me')window.dispatchEvent(new Event('cts-session-expired'));throw new ApiError(response.status,data.error?.code??'UNKNOWN',data.error?.message??'服务暂时不可用');}
  return data;
}
