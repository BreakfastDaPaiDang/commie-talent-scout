import {z} from 'zod';
import {assertAdmin,authGuard} from './credentials.ts';
import {verifyPassword} from './password.ts';
import {digest,Failure,now,uid,type Actor,type Env} from './types.ts';

export const requestId=z.uuid().describe('本次业务写入的 UUID；结果不明时以相同 ID 和参数重试。');
export const expectedVersion=z.number().int().min(1).describe('最近读取的目标版本。冲突时重新读取，不猜测递增覆盖。');
export type Source='web'|'mcp';
type Receipt={input_hash:string;result:string;secret_hash:string|null;require_admin:number};
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
type Command={requestId:string;operation:string;parameters:unknown;secret?:string;requireAdmin?:boolean};
type Mutation<R>={statements:D1PreparedStatement[];result:R;secretHash?:string};

// One transaction binds the current authority, all business guards, effects, audit, and retry receipt.
// Callers pass only non-secret parameters into the fast fingerprint. Password-bearing commands use
// their salted scrypt hash for retry comparison, avoiding a fast offline password oracle.
export async function command<R extends Record<string,unknown>>(env:Env,actor:Actor,input:Command,prepare:()=>Promise<Mutation<R>>):Promise<R>{
  requestId.parse(input.requestId);if(input.requireAdmin)assertAdmin(actor);
  const hash=await digest(JSON.stringify(canonical([input.operation,input.parameters])));
  const find=()=>env.DB.prepare('SELECT input_hash,result,secret_hash,require_admin FROM commands WHERE member_id=? AND request_id=?').bind(actor.id,input.requestId).first<Receipt>();
  const accept=async(receipt:Receipt)=>{
    if(receipt.require_admin)assertAdmin(actor);
    if(receipt.input_hash!==hash||(!!receipt.secret_hash!==(input.secret!==undefined)))throw new Failure(409,'IDEMPOTENCY_CONFLICT','这个请求标识已用于不同的操作或参数');
    if(receipt.secret_hash&&!await verifyPassword(input.secret!,receipt.secret_hash))throw new Failure(409,'IDEMPOTENCY_CONFLICT','这个请求标识已用于不同的临时密码');
    return {...JSON.parse(receipt.result),replayed:true} as R;
  };
  const cached=await find();if(cached)return accept(cached);
  const mutation=await prepare(),key=uid();
  if(input.secret!==undefined&&!mutation.secretHash)throw new Error('Secret-bearing command must provide a slow salted comparison hash');
  try{
    await env.DB.batch([
      authGuard(env,actor,key,!!input.requireAdmin),
      ...mutation.statements,
      env.DB.prepare('INSERT INTO commands(member_id,request_id,input_hash,result,created_at,secret_hash,require_admin) VALUES(?,?,?,?,?,?,?)')
        .bind(actor.id,input.requestId,hash,JSON.stringify(mutation.result),now(),mutation.secretHash??null,input.requireAdmin?1:0),
      env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(key),
    ]);
    return mutation.result;
  }catch(error){
    const raced=await find();if(raced)return accept(raced);
    if(String(error).includes('CHECK constraint'))throw new Failure(409,'PRECONDITION_CHANGED','账号、权限或目标版本已变更，请刷新后重试');
    if(String(error).includes('UNIQUE constraint'))throw new Failure(409,'DUPLICATE_VALUE','账号或目标已存在，请核对已有内容');
    throw error;
  }
}
export async function getRequestResult(env:Env,actor:Actor,id:string){
  requestId.parse(id);
  const row=await env.DB.prepare('SELECT result,require_admin FROM commands WHERE member_id=? AND request_id=?').bind(actor.id,id).first<{result:string;require_admin:number}>();
  if(row?.require_admin)assertAdmin(actor);
  return row?{status:'completed',result:JSON.parse(row.result)}:{status:'unknown',result:null,message:'尚未找到已提交结果，不表示仍在途的操作未发生；保留原请求标识。'};
}
