import {Hono} from 'hono';
import {z} from 'zod';
import {catalogIdentity} from './catalog-auth.ts';
import {KnowledgeWorkspace} from './workspace.ts';
import type {Env} from './types.ts';

export const workspaceApp=new Hono<{Bindings:Env;Variables:{workspace:KnowledgeWorkspace}}>();
workspaceApp.use('*',async(c,next)=>{c.set('workspace',new KnowledgeWorkspace(c.env.KNOWLEDGE_DB,await catalogIdentity(c.req.raw,c.env)));await next();});
const branch=(value:string|undefined)=>z.string().min(1).max(180).default('main').parse(value);
const offset=(value:string|undefined)=>z.coerce.number().int().min(0).default(0).parse(value);
workspaceApp.get('/branches',async c=>c.json(await c.get('workspace').branches()));
workspaceApp.get('/documents',async c=>c.json(await c.get('workspace').list(c.req.query())));
workspaceApp.get('/documents/:id',async c=>c.json(await c.get('workspace').get(branch(c.req.query('branch_id')),c.req.param('id'))));
workspaceApp.get('/categories',async c=>c.json(await c.get('workspace').categories(branch(c.req.query('branch_id')))));
workspaceApp.get('/diff',async c=>c.json(await c.get('workspace').diff(branch(c.req.query('branch_id')))));
workspaceApp.get('/merges',async c=>c.json(await c.get('workspace').mergeRequests()));
workspaceApp.get('/issues',async c=>c.json(await c.get('workspace').issues(offset(c.req.query('offset')))));
workspaceApp.get('/issues/:id',async c=>c.json({issue:await c.get('workspace').issue(c.req.param('id'))}));
workspaceApp.get('/comments',async c=>{const query=z.object({branch_id:z.string().max(180).optional(),document_id:z.uuid().optional(),category_id:z.uuid().optional(),issue_id:z.uuid().optional(),offset:z.coerce.number().int().min(0).optional()}).strict().parse(c.req.query());return c.json(await c.get('workspace').comments(query));});
workspaceApp.get('/history',async c=>c.json(await c.get('workspace').history(branch(c.req.query('branch_id')),offset(c.req.query('offset')))));
workspaceApp.get('/history/:id',async c=>c.json(await c.get('workspace').commitDetail(branch(c.req.query('branch_id')),c.req.param('id'))));
workspaceApp.get('/requests/:id',async c=>c.json({result:await c.get('workspace').receipt(c.req.param('id'))}));
const commands={
 '/branches':'createBranch','/branches/share':'shareBranch','/branches/delete':'deleteBranch','/documents':'save','/documents/remove':'remove',
 '/categories/definition':'defineCategory','/categories':'editCategory','/reviews':'submitReview','/issues/from-comment':'issueFromComment','/merges':'propose','/merges/approve':'approve','/merges/accept':'accept',
 '/branches/resolve':'resolveConflict','/issues':'createIssue','/issues/state':'setIssueState','/comments':'comment',
} as const;
for(const [path,method] of Object.entries(commands))workspaceApp.post(path,async c=>c.json(await c.get('workspace')[method](await c.req.json())));
