import type {McpServer} from '@modelcontextprotocol/server';
import type {Actor,Env} from './types.ts';
import {Failure} from './types.ts';
import type {McpReply} from './mcp-members.ts';
import {catalogOrigin} from './catalog-bridge.ts';
import {workspaceGuide,workspaceTools} from '../../knowledge/src/workspace-tools.ts';
import type {KnowledgeWorkspace} from '../../knowledge/src/workspace.ts';

const reads:Record<string,(args:any[])=>string>={branches:()=>'/branches',list:([a])=>'/documents?'+new URLSearchParams(Object.entries(a).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])),get:([branch,id])=>'/documents/'+id+'?branch_id='+encodeURIComponent(branch),diff:([branch])=>'/diff?branch_id='+encodeURIComponent(branch),mergeRequests:()=>'/merges',issues:([offset])=>'/issues?offset='+offset,comments:([a])=>'/comments?'+new URLSearchParams(a),history:([branch,offset])=>'/history?branch_id='+encodeURIComponent(branch)+'&offset='+offset,receipt:([id])=>'/requests/'+id};
const writes:Record<string,string>={submitReview:'/reviews',editCategory:'/categories',issueFromComment:'/issues/from-comment',createBranch:'/branches',shareBranch:'/branches/share',deleteBranch:'/branches/delete',save:'/documents',remove:'/documents/remove',defineCategory:'/categories/definition',propose:'/merges',approve:'/merges/approve',accept:'/merges/accept',resolveConflict:'/branches/resolve',createIssue:'/issues',setIssueState:'/issues/state',comment:'/comments'};
function toolsFor(call:(method:string,args:any[])=>Promise<any>){return workspaceTools(new Proxy({} as KnowledgeWorkspace,{get:(_,key)=> (...args:any[])=>call(String(key),args)}));}
export const knowledgeToolNames=toolsFor(async()=>null).map(t=>t.name),knowledgeGuides=workspaceGuide;
export function registerKnowledgeTools(server:McpServer,env:Env,actor:Actor,reply:McpReply){
 const tools=toolsFor(async(method,args)=>{
  if(!env.CATALOG)throw new Failure(503,'KNOWLEDGE_UNAVAILABLE','知识服务暂不可用');const origin=catalogOrigin(env),path=reads[method]?.(args)??writes[method];if(!path)throw new Failure(400,'UNKNOWN_OPERATION','未知知识操作');
  const write=!!writes[method],headers=new Headers(actor.catalog_headers);headers.set('Origin',origin);if(write)headers.set('Content-Type','application/json');
  let response:Response;try{response=await env.CATALOG.fetch(new Request(origin+'/api/knowledge-workspace'+path,{method:write?'POST':'GET',headers,body:write?JSON.stringify(args[0]):undefined,redirect:'manual',signal:AbortSignal.timeout(30000)}));}catch{throw new Failure(503,'KNOWLEDGE_UNAVAILABLE','知识服务暂不可用，请先查询原请求结果');}
  const data=await response.json() as Record<string,any>;if(!response.ok)throw new Failure(response.status,String(data.error?.code??'KNOWLEDGE_UNAVAILABLE'),String(data.error?.message??'知识操作未完成'));return method==='receipt'?data.result:data;
 });
 for(const tool of tools)server.registerTool(tool.name,{description:tool.description,inputSchema:tool.schema,annotations:{readOnlyHint:!tool.write,destructiveHint:tool.name==='knowledge_delete_branch',idempotentHint:true,openWorldHint:false}},(args:unknown)=>reply(async()=>tool.run(args),r=>({id:r.id??null})));
}
