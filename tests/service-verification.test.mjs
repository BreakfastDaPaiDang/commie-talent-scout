import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fixture} from './d1-fixture.mjs';
import {authenticate,login} from '../app/server/auth.ts';
import {credentialActor} from '../app/server/authority.ts';
import {createCredential,listCredentials} from '../app/server/credentials.ts';
import {issueVerificationCredential,verificationSession,revokeVerificationCredential} from '../app/server/service-verification.ts';
import {Members} from '../app/server/members.ts';
import {Archives} from '../app/server/archives.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {Images} from '../app/server/images.ts';
import {Materials} from '../app/server/materials.ts';
import {startAttempt,listCalls} from '../app/server/mcp-journal.ts';
import {getRequestResult} from '../app/server/commands.ts';
import {zaojiSubject} from '../app/rules/service-subjects.ts';

async function setup(t){
 const f=fixture();t.after(f.close);f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);
 const sessionId=uuid();f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'session','真人管理员',1,?,'2099-01-01T00:00:00.000Z')").run(sessionId,f.actor.id,uuid(),new Date().toISOString());
 f.actor=await credentialActor(f.env,sessionId);
 const grant=await issueVerificationCredential(f.env,f.actor,{name:'开发验收',days:30});
 const root=await authenticate(new Request('https://fixture.invalid/mcp',{headers:{Authorization:'Bearer '+grant.secret}}),f.env);
 const session=await verificationSession(f.env,root,{name:'测试运行'}),connection=await createCredential(f.env,session.member,{name:'测试 MCP',days:90});
 const agent=await authenticate(new Request('https://fixture.invalid/mcp',{headers:{Authorization:'Bearer '+connection.secret}}),f.env);
 return {...f,grant,root,session,connection,agent};
}
test('verification grant authenticates service on web/MCP without a password or changing its member role; records execution purpose',async t=>{
 const f=await setup(t);assert.equal(f.agent.role,'admin');assert.equal(f.agent.identity_kind,'service');assert.equal(f.agent.execution_purpose,'verification');
 assert.equal(f.sqlite.prepare('SELECT role FROM members WHERE id=?').get(zaojiSubject.id).role,'member');
 assert.ok(Date.parse(f.connection.expires_at)<=Date.parse(f.session.expires_at));assert.ok(Date.parse(f.session.expires_at)<=Date.now()+3600000);
 const web=await authenticate(new Request('https://fixture.invalid/api/workspace',{headers:{Cookie:'cts_session='+f.session.secret}}),f.env);assert.equal(web.id,zaojiSubject.id);
 await assert.rejects(login(new Request('https://fixture.invalid/api/auth/login'),f.env,{username:'zaoji-hr',password:'!service-no-password'}),{code:'INVALID_LOGIN'});
 const request_id=uuid(),archive=await new Archives(f.env,f.agent,'mcp').create({type:'person',name:'虚构验收档案',status:'个人接触',member_ids:[f.agent.id],request_id});
 assert.equal((await getRequestResult(f.env,f.agent,request_id)).execution_purpose,'verification');
 const receipt=f.sqlite.prepare('SELECT operation,credential_id,execution_purpose FROM commands WHERE request_id=?').get(request_id);assert.equal(receipt.credential_id,f.connection.id);assert.equal(receipt.operation,'archive.create');
 await startAttempt(f.env,f.agent,'get_archive',{id:archive.id});assert.equal((await listCalls(f.env,f.actor,{})).calls[0].execution_purpose,'verification');
});
test('only a human admin session can issue root grants; no service password, human verification scope, or descendant authority escalation',async t=>{
 const f=await setup(t);
 await assert.rejects(issueVerificationCredential(f.env,f.session.member,{name:'不能自授'}),{code:'HUMAN_ADMIN_SESSION_REQUIRED'});
 await assert.rejects(issueVerificationCredential(f.env,{...f.actor,role:'member'},{name:'不能提权'}),{code:'ADMIN_REQUIRED'});
 await assert.rejects(verificationSession(f.env,f.agent,{name:'不能从子连接派生会话'}),{code:'VERIFICATION_ROOT_REQUIRED'});
 assert.throws(()=>f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at,purpose) VALUES(?,?,?,'mcp','bad',1,'2026-01-01','2099-01-01','verification')").run(uuid(),f.actor.id,uuid()),/scope mismatch/);
 assert.throws(()=>f.sqlite.prepare("UPDATE credentials SET purpose='interactive' WHERE id=?").run(f.grant.id),/immutable/);
 assert.throws(()=>f.sqlite.prepare("UPDATE credentials SET expires_at='2099-01-01' WHERE id=?").run(f.grant.id),/immutable/);
});
test('root revocation invalidates all child authentication and in-flight image/material tickets and commands',async t=>{
 const f=await setup(t),archives=new Archives(f.env,f.agent,'mcp');const a=await archives.create({type:'person',name:'虚构上传授权',request_id:uuid()});
 const bytes=readFileSync('tests/fixtures/images/shapes.png'),ticket=await new Images(f.env,f.agent,'mcp').prepare({purpose:'archive_avatar',archive_id:a.id,mime_type:'image/png',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 const material=await new Materials(f.env,f.agent,'mcp').prepare({archive_id:a.id,name:'验收.txt',mime_type:'text/plain',byte_size:1,sha256:createHash('sha256').update('x').digest('hex')});
 await revokeVerificationCredential(f.env,f.actor,{id:f.grant.id});
 assert.equal(await credentialActor(f.env,f.agent.credential_id),null);assert.equal(await credentialActor(f.env,f.session.member.credential_id),null);
 await assert.rejects(new Archives(f.env,f.agent,'mcp').create({type:'person',name:'不能用已撤销身份写入',request_id:uuid()}),{code:'PRECONDITION_CHANGED'});
 await assert.rejects(Images.receive(f.env,ticket.upload_id,new Request(ticket.url,{method:'PUT',headers:{...ticket.headers,'Content-Length':String(bytes.length)},body:bytes})),{code:'UPLOAD_AUTH_EXPIRED'});
 await assert.rejects(Materials.receive(f.env,material.upload_id,new Request(material.url,{method:'PUT',headers:{...material.headers,'Content-Length':'1'},body:'x'})),{code:'UPLOAD_AUTH_EXPIRED'});
 assert.equal((await listCredentials(f.env,f.root)).credentials.find(c=>c.id===f.connection.id).active,0);
});
test('service admin capability uses ordinary task and upload guards; stale human admin role is rejected at commit',async t=>{
 const f=await setup(t),tasks=new WorkTasks(f.env,f.actor,'web');const task=await tasks.create({kind:'custom',title:'真人创建',purpose:'目的',delivery:'交付',deadline_at:'2099-01-01T00:00:00Z',request_id:uuid()});
 const updated=await new WorkTasks(f.env,f.agent,'mcp').edit({id:task.id,expected_version:1,title:'服务验收修改',purpose:'目的',delivery:'交付',request_id:uuid()});assert.equal(updated.version,2);
 const bytes=readFileSync('tests/fixtures/images/shapes.png'),images=new Images(f.env,f.agent,'mcp');const ticket=await images.prepare({purpose:'member_avatar',member_id:f.actor.id,mime_type:'image/png',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 await Images.receive(f.env,ticket.upload_id,new Request(ticket.url,{method:'PUT',headers:{...ticket.headers,'Content-Length':String(bytes.length)},body:bytes}));assert.equal((await images.status(ticket.upload_id)).state,'ready');
 f.sqlite.prepare("UPDATE members SET role='member' WHERE id=?").run(f.actor.id);
 await assert.rejects(tasks.edit({id:task.id,expected_version:2,title:'过时管理员身份',purpose:'目的',delivery:'交付',request_id:uuid()}),{code:'PRECONDITION_CHANGED'});
});
test('freezing service invalidates verification credentials permanently; unfreeze requires a new grant',async t=>{
 const f=await setup(t),members=new Members(f.env,f.actor,'web');await members.setFrozen({id:zaojiSubject.id,expected_version:1,frozen:true,request_id:uuid()});
 assert.equal(await credentialActor(f.env,f.root.credential_id),null);await members.setFrozen({id:zaojiSubject.id,expected_version:2,frozen:false,request_id:uuid()});assert.equal(await credentialActor(f.env,f.root.credential_id),null);
});
