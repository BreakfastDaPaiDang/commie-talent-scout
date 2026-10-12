import {assertAdmin} from '../server/credentials.ts';
import {Failure,uid,type Actor,type Env} from '../server/types.ts';

// Identity of the person described by an archive, never an assignment to maintain it.
export async function prepareArchiveAccount(env:Env,actor:Actor,input:{archiveId:string;type:string;isMember:boolean;name:string;accountId:string|null;previousId?:string|null}){
 const {archiveId,type,isMember,name,accountId,previousId=null}=input,changed=accountId!==previousId;
 if(changed)assertAdmin(actor);
 if(!accountId)return {name,guards:[],cleanup:[]};
 if(type!=='person'||(changed&&!isMember))throw new Failure(400,'ACCOUNT_LINK_NOT_APPLICABLE','本人账号只能绑定社员人物档案');
 const member=await env.DB.prepare('SELECT id,name,version,identity_kind FROM members WHERE id=?').bind(accountId).first<{id:string;name:string;version:number;identity_kind:string}>();
 if(!member||member.identity_kind!=='human')throw new Failure(400,'HUMAN_ACCOUNT_REQUIRED','请选择本人的真人猎头账号');
 if(await env.DB.prepare('SELECT id FROM archives WHERE linked_account_id=? AND id<>?').bind(accountId,archiveId).first())throw new Failure(409,'ACCOUNT_ALREADY_LINKED','该账号已有本人档案，请先核对已有档案（含已删除）');
 if(!changed&&name!==member.name)throw new Failure(409,'ACCOUNT_NAME_MANAGED','昵称跟随本人猎头账号，请刷新档案；改名请在账号资料中进行');
 const key=uid();
 return {name:member.name,guards:[env.DB.prepare('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members WHERE id=? AND version=?) THEN 1 ELSE 0 END)').bind(key,accountId,member.version)],cleanup:[env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(key)]};
}
