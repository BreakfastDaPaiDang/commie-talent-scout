import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import { authenticate, changePassword, login, sessionCookie } from './auth.ts';
import { PasswordBusy } from './password.ts';
import { Failure, now, publicMember, type Env } from './types.ts';
import {createCredential,listCredentials,revokeCredential} from './credentials.ts';
import {cleanupJournal,getCall,listCalls} from './mcp-journal.ts';
import {handleMcp} from './mcp.ts';
import {Members} from './members.ts';
import {getRequestResult} from './commands.ts';
import {Archives} from './archives.ts';
import {Observations} from './observations.ts';
import {Tags} from './tags.ts';
import {Drafts} from './drafts.ts';

const app=new Hono<{Bindings:Env}>();
app.use('/api/*',bodyLimit({maxSize:1024*1024,onError:c=>c.json({error:{code:'REQUEST_TOO_LARGE',message:'请求内容过大'}},413)}));
app.use('/mcp',bodyLimit({maxSize:1024*1024,onError:c=>c.json({error:{code:'REQUEST_TOO_LARGE',message:'请求内容过大'}},413)}));
app.use('*',async(c,next)=>{
  c.header('X-Content-Type-Options','nosniff');
  c.header('Referrer-Policy','same-origin');
  c.header('X-Frame-Options','DENY');
  c.header('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (c.req.path.startsWith('/api') || c.req.path==='/mcp') c.header('Cache-Control','private, no-store');
  if (!['GET','HEAD','OPTIONS'].includes(c.req.method) && c.req.path.startsWith('/api')) {
    if (c.req.header('Origin')!==new URL(c.req.url).origin) throw new Failure(403,'ORIGIN_REJECTED','请求来源不匹配，请从本站重新操作');
    const length=Number(c.req.header('Content-Length')??0);
    if(length>1024*1024) throw new Failure(413,'REQUEST_TOO_LARGE','请求内容过大');
  }
  await next();
});
app.onError((error,c)=>{
  if(error instanceof SyntaxError) return c.json({error:{code:'INVALID_JSON',message:'请求内容不是有效的 JSON'}},400);
  if(error instanceof Failure) return c.json({error:{code:error.code,message:error.message}},error.status as 400);
  if(error instanceof ZodError) return c.json({error:{code:'INVALID_INPUT',message:error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('；')}},400);
  if(error instanceof PasswordBusy) return c.json({error:{code:'PASSWORD_BUSY',message:'密码验证繁忙，请稍后重试'}},429);
  console.error(JSON.stringify({event:'request.failed',path:c.req.path,code:'INTERNAL_ERROR'}));
  return c.json({error:{code:'INTERNAL_ERROR',message:'服务暂时不可用，请稍后重试'}},500);
});
app.get('/api/health',c=>c.json({ok:true,version:'0.1.0',environment:c.env.ENVIRONMENT}));
app.post('/api/auth/login',async c=>{
  const {secret,member}=await login(c.req.raw,c.env,await c.req.json());
  c.header('Set-Cookie',sessionCookie(secret,c.req.raw));
  return c.json({member:publicMember(member)});
});
app.get('/api/auth/me',async c=>c.json({member:publicMember(await authenticate(c.req.raw,c.env,true))}));
app.post('/api/auth/password',async c=>{
  const actor=await authenticate(c.req.raw,c.env,true);
  const result=await changePassword(c.env,actor,await c.req.json());
  c.header('Set-Cookie',sessionCookie('',c.req.raw,true));
  return c.json(result);
});
app.post('/api/auth/logout',async c=>{
  try {
    const actor=await authenticate(c.req.raw,c.env,true);
    await c.env.DB.prepare('UPDATE credentials SET revoked_at=? WHERE id=?').bind(now(),actor.credential_id).run();
  } catch(error) { if(!(error instanceof Failure&&error.status===401)) throw error; }
  c.header('Set-Cookie',sessionCookie('',c.req.raw,true));
  return c.json({ok:true});
});
app.get('/api/workspace',async c=>{const actor=await authenticate(c.req.raw,c.env);return c.json({member:publicMember(actor)});});
app.get('/api/connections',async c=>c.json(await listCredentials(c.env,await authenticate(c.req.raw,c.env))));
app.post('/api/connections',async c=>c.json(await createCredential(c.env,await authenticate(c.req.raw,c.env),await c.req.json())));
app.post('/api/connections/revoke',async c=>c.json(await revokeCredential(c.env,await authenticate(c.req.raw,c.env),await c.req.json())));
app.get('/api/admin/calls',async c=>c.json(await listCalls(c.env,await authenticate(c.req.raw,c.env),c.req.query())));
app.get('/api/admin/calls/:id',async c=>c.json(await getCall(c.env,await authenticate(c.req.raw,c.env),c.req.param('id'))));
app.get('/api/admin/members',async c=>c.json(await new Members(c.env,await authenticate(c.req.raw,c.env),'web').list(c.req.query())));
app.post('/api/admin/members/create',async c=>c.json(await new Members(c.env,await authenticate(c.req.raw,c.env),'web').create(await c.req.json())));
app.post('/api/admin/members/reset-password',async c=>c.json(await new Members(c.env,await authenticate(c.req.raw,c.env),'web').resetPassword(await c.req.json())));
app.post('/api/admin/members/frozen',async c=>c.json(await new Members(c.env,await authenticate(c.req.raw,c.env),'web').setFrozen(await c.req.json())));
app.post('/api/admin/members/role',async c=>c.json(await new Members(c.env,await authenticate(c.req.raw,c.env),'web').setRole(await c.req.json())));
app.post('/api/admin/members/profile',async c=>c.json(await new Members(c.env,await authenticate(c.req.raw,c.env),'web').updateProfile(await c.req.json())));
app.get('/api/admin/members/:id/history',async c=>c.json(await new Members(c.env,await authenticate(c.req.raw,c.env),'web').history(c.req.param('id'))));
app.get('/api/admin/members/:id',async c=>c.json(await new Members(c.env,await authenticate(c.req.raw,c.env),'web').detail(c.req.param('id'))));
app.get('/api/commands/:id',async c=>c.json(await getRequestResult(c.env,await authenticate(c.req.raw,c.env),c.req.param('id'))));
app.get('/api/archives',async c=>c.json(await new Archives(c.env,await authenticate(c.req.raw,c.env),'web').list(c.req.query())));
app.get('/api/members',async c=>c.json(await new Members(c.env,await authenticate(c.req.raw,c.env),'web').directory(c.req.query())));
app.post('/api/archives/state',async c=>c.json(await new Archives(c.env,await authenticate(c.req.raw,c.env),'web').setState(await c.req.json())));
app.post('/api/archives/reopen',async c=>c.json(await new Archives(c.env,await authenticate(c.req.raw,c.env),'web').reopen(await c.req.json())));
app.post('/api/archives/create',async c=>c.json(await new Archives(c.env,await authenticate(c.req.raw,c.env),'web').create(await c.req.json())));
app.post('/api/archives/update',async c=>c.json(await new Archives(c.env,await authenticate(c.req.raw,c.env),'web').update(await c.req.json())));
app.get('/api/archives/:id/events',async c=>c.json(await new Archives(c.env,await authenticate(c.req.raw,c.env),'web').events({...c.req.query(),id:c.req.param('id')})));
app.get('/api/archives/:id',async c=>c.json(await new Archives(c.env,await authenticate(c.req.raw,c.env),'web').detail(c.req.param('id'))));
app.post('/api/observations/create',async c=>c.json(await new Observations(c.env,await authenticate(c.req.raw,c.env),'web').create(await c.req.json())));
app.get('/api/drafts',async c=>c.json(await new Drafts(c.env,await authenticate(c.req.raw,c.env)).list()));
app.get('/api/drafts/:id',async c=>c.json(await new Drafts(c.env,await authenticate(c.req.raw,c.env)).get(c.req.param('id'))));
app.post('/api/drafts/save',async c=>c.json(await new Drafts(c.env,await authenticate(c.req.raw,c.env)).save(await c.req.json())));
app.post('/api/observations/update',async c=>c.json(await new Observations(c.env,await authenticate(c.req.raw,c.env),'web').update(await c.req.json())));
app.get('/api/observations',async c=>c.json(await new Observations(c.env,await authenticate(c.req.raw,c.env),'web').list(c.req.query())));
app.get('/api/observations/:id/versions',async c=>c.json(await new Observations(c.env,await authenticate(c.req.raw,c.env),'web').versions({...c.req.query(),id:c.req.param('id')})));
app.get('/api/observations/:id',async c=>c.json(await new Observations(c.env,await authenticate(c.req.raw,c.env),'web').detail(c.req.param('id'))));
app.get('/api/archives/:id/timeline',async c=>c.json(await new Observations(c.env,await authenticate(c.req.raw,c.env),'web').timeline({...c.req.query(),id:c.req.param('id')})));
app.get('/api/tag-categories',async c=>c.json(await new Tags(c.env,await authenticate(c.req.raw,c.env),'web').categories(c.req.query('type'))));
app.get('/api/tags',async c=>c.json(await new Tags(c.env,await authenticate(c.req.raw,c.env),'web').list({...c.req.query(),include_disabled:c.req.query('include_disabled')==='true'})));
app.post('/api/tag-categories/create',async c=>c.json(await new Tags(c.env,await authenticate(c.req.raw,c.env),'web').createCategory(await c.req.json())));
app.post('/api/tags/create',async c=>c.json(await new Tags(c.env,await authenticate(c.req.raw,c.env),'web').create(await c.req.json())));
app.post('/api/archive-tags/update',async c=>c.json(await new Tags(c.env,await authenticate(c.req.raw,c.env),'web').batch(await c.req.json())));
app.get('/api/archives/:id/tags',async c=>c.json(await new Tags(c.env,await authenticate(c.req.raw,c.env),'web').bindings(c.req.param('id'))));
app.all('/api/*',c=>c.json({error:{code:'NOT_FOUND',message:'接口不存在'}},404));
app.all('/mcp',c=>handleMcp(c.req.raw,c.env,c.executionCtx as ExecutionContext));
app.all('/images/*',async c=>{await authenticate(c.req.raw,c.env);return c.notFound();});
app.all('/uploads/*',c=>c.notFound());
app.get('*',c=>c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch:app.fetch,
  async scheduled(_event:ScheduledController,env:Env) {
    await cleanupJournal(env);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM observation_drafts WHERE updated_at<?').bind(new Date(Date.now()-30*86400000).toISOString()),
      env.DB.prepare('DELETE FROM auth_rates WHERE expires_at<?').bind(Math.floor(Date.now()/1000)),
      env.DB.prepare('DELETE FROM credentials WHERE expires_at<? OR revoked_at<?').bind(new Date(Date.now()-86400000).toISOString(),new Date(Date.now()-86400000).toISOString()),
    ]);
  },
};
