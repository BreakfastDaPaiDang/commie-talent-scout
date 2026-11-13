import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {ZodError} from 'zod';
import {authenticate} from './identity.ts';
import {Knowledge,expire} from './service.ts';
import {handleMcp,guide} from './mcp.ts';
import {KnowledgeError,type Env,type Identity} from './types.ts';
import {catalogApp} from './catalog-http.ts';
import {catalogIdentity} from './catalog-auth.ts';
import {workspaceApp} from './workspace-http.ts';

const app=new Hono<{Bindings:Env;Variables:{identity:Identity;knowledge:Knowledge}}>();
app.use('*',async(c,next)=>{
 c.header('Cache-Control','private, no-store');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');c.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
 const url=new URL(c.req.url);
 if(url.protocol!=='https:'&&!(c.env.ENVIRONMENT==='staging'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new KnowledgeError(403,'HTTPS_REQUIRED','请使用 HTTPS');
 // No cross-origin credential sharing or browser-cookie authentication.
 if(c.req.header('Origin')&&c.req.header('Origin')!==url.origin)throw new KnowledgeError(403,'ORIGIN_REJECTED','来源不匹配');
 await next();
});
app.use('*',async(c,next)=>bodyLimit({maxSize:/^\/api\/catalog\/files\/[^/]+\/content$/.test(c.req.path)?10485760:256*1024,onError:c=>c.json({error:{code:'TOO_LARGE',message:'请求过大'}},413)})(c,next));
app.onError((error,c)=>{
 if(error instanceof KnowledgeError)return c.json({error:{code:error.code,message:error.message}},error.status as 400);
 if(error instanceof ZodError||error instanceof SyntaxError)return c.json({error:{code:'INVALID_INPUT',message:'输入格式不正确，请核对字段'}},400);
 console.error(JSON.stringify({event:'knowledge.request.failed',path:c.req.path}));
 return c.json({error:{code:'RESULT_UNKNOWN',message:'结果未确认，请查询原请求再重试'}},500);
});
app.get('/api/health',c=>c.json({ok:true,service:'commie-knowledge',version:'0.3.2',catalog:1,workspace:1,reviews:1,category_annotations:1,branch_deletion:1,environment:c.env.ENVIRONMENT}));
app.route('/api/catalog',catalogApp);
app.route('/api/knowledge-workspace',workspaceApp);
app.all('/mcp',async c=>handleMcp(c.req.raw,c.env,c.executionCtx as ExecutionContext,await catalogIdentity(c.req.raw,c.env)));
app.use('*',async(c,next)=>{const actor=await authenticate(c.req.raw,c.env);c.set('identity',actor);c.set('knowledge',new Knowledge(c.env.KNOWLEDGE_DB,actor,undefined,c.env.APP_ORIGIN));await next();});
app.get('/api/identity',c=>c.json(c.get('identity')));
app.get('/api/guide',c=>c.json({rules:guide}));
app.get('/api/tags',async c=>c.json(await c.get('knowledge').tags()));
const referenceOnly=()=>{throw new KnowledgeError(410,'REFERENCE_ONLY','旧文章流程仅保留参考；请使用知识库的分支与合并流程');};
app.post('/api/tags',referenceOnly);
app.get('/api/entries',async c=>c.json(await c.get('knowledge').list(c.req.query())));
app.get('/api/entries/:id',async c=>c.json(await c.get('knowledge').get({id:c.req.param('id')})));
app.get('/api/effective',async c=>c.json(await c.get('knowledge').effective(c.req.query())));
app.get('/api/changes',async c=>c.json(await c.get('knowledge').changes()));
app.get('/api/requests/:id',async c=>c.json({result:await c.get('knowledge').receipt(c.req.param('id'))}));
for(const path of ['/api/drafts','/api/proposals','/api/close-proposals','/api/endorsements'])app.post(path,referenceOnly);
export default {fetch:app.fetch};
