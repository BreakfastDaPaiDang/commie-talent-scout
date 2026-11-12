import {fixture,request} from './fixture.mjs';
import {fixture as personnelFixture} from '../../tests/d1-fixture.mjs';
import worker from '../src/index.ts';
import personnel from '../../app/server/index.ts';
import {digest} from '../../app/server/types.ts';
export async function connectedFixture(){
 const k=fixture(),p=personnelFixture(),at=new Date().toISOString(),pending=[],paths=[],objects=new Map(),ctx={waitUntil(promise){pending.push(promise);}};
 const token='fixture-catalog-'+request(),session='fixture-session-'+request();p.env.ENVIRONMENT='staging';
 p.sqlite.prepare('UPDATE credentials SET hash=? WHERE id=?').run(await digest(token),p.actor.credential_id);
 p.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'session','catalog-ui',1,?,'2099-01-01T00:00:00.000Z')").run(request(),p.actor.id,await digest(session),at);
 const membership=request();p.sqlite.prepare("INSERT INTO archives(id,type,name,status,person_role,linked_account_id,created_by,created_at,updated_at) VALUES(?,'person',?,'已入伙','member',?,?,?,?)").run(membership,p.actor.name,p.actor.id,p.actor.id,at,at);
 k.sqlite.exec('UPDATE catalog_meta SET authority_ready=1');p.sqlite.exec("UPDATE resource_catalog_state SET mode='independent'");
 const env={KNOWLEDGE_DB:k.db,ENVIRONMENT:'staging',APP_ORIGIN:'https://knowledge.example',IDENTITY_ORIGIN:'https://identity.example',CATALOG_FILES:{async put(key,bytes){objects.set(key,Buffer.from(bytes));},async get(key){return objects.has(key)?{body:new Response(objects.get(key)).body}:null;}},IDENTITY:{fetch(req){if(req.redirect!=='manual')throw new Error('Identity redirects must never forward credentials');paths.push(new URL(req.url).pathname);return personnel.fetch(req,p.env,ctx);}}};
 p.env.CATALOG_ORIGIN=env.APP_ORIGIN;p.env.CATALOG={fetch(req){return worker.fetch(req,env,ctx);}};
 const call=async(path,body,headers={Authorization:'Bearer '+token})=>{const response=await worker.fetch(new Request(env.APP_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx);return {status:response.status,headers:response.headers,body:await response.json()};};
 async function close(){await Promise.allSettled(pending);k.close();p.close();}
 return {k,p,env,ctx,call,paths,token,session,membership,objects,close};
}
