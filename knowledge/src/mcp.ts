import {McpServer} from '@modelcontextprotocol/server';
import {createMcpHandler} from 'agents/mcp/server';
import {z} from 'zod';
import {Knowledge,schemas} from './service.ts';
import {KnowledgeError,type Env} from './types.ts';
import type {CatalogActor} from './catalog.ts';
import {catalogApp} from './catalog-http.ts';
import {catalogGuide,catalogTools} from './catalog-tools.ts';
import {KnowledgeWorkspace} from './workspace.ts';
import {workspaceGuide,workspaceTools} from './workspace-tools.ts';
export const guide=[...workspaceGuide,...catalogGuide];
export async function handleMcp(request:Request,env:Env,ctx:ExecutionContext,actor:CatalogActor){
 const server=new McpServer({name:'commie-knowledge',version:'0.3.0'},{instructions:guide.join('\n')});
 function register(name:string,description:string,schema:z.ZodType,run:(args:any)=>Promise<unknown>,write=false){
  server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:!write,destructiveHint:name==='knowledge_delete_branch',idempotentHint:true,openWorldHint:false}},async(args:unknown)=>{
   try{const data=await run(args);return {content:[{type:'text' as const,text:JSON.stringify(data)}],structuredContent:data as Record<string,unknown>};}
   catch(error){const known=error instanceof KnowledgeError,data={error:{code:known?error.code:error instanceof z.ZodError?'INVALID_INPUT':'RESULT_UNKNOWN',message:known?error.message:'请核对输入并先查询原请求结果'}};return {isError:true,content:[{type:'text' as const,text:JSON.stringify(data)}],structuredContent:data};}
  });
 }
 register('catalog_guide','读取生产资源库范围、权限与操作指南',z.object({}).strict(),async()=>({rules:guide}));
 for(const tool of workspaceTools(new KnowledgeWorkspace(env.KNOWLEDGE_DB,actor)))register(tool.name,tool.description,tool.schema,tool.run,tool.write);
 for(const t of catalogTools)register(t.name,t.description,t.schema,async args=>{
  const headers=new Headers(request.headers);headers.set('Origin',env.APP_ORIGIN);headers.delete('Content-Length');headers.set('Content-Type','application/json');
  const response=await catalogApp.fetch(new Request(env.APP_ORIGIN+t.path(args),{method:t.write?'POST':'GET',headers,body:t.write?JSON.stringify(args):undefined}),env,ctx),data=await response.json() as Record<string,any>;
  if(!response.ok)throw new KnowledgeError(response.status,String(data.error?.code??'RESULT_UNKNOWN'),String(data.error?.message??'操作失败'));
  if(t.name==='catalog_prepare_file')data.upload_url=env.APP_ORIGIN+'/api/catalog/files/'+data.id+'/content';return data;
 },t.write);
 if(!('kind' in actor)){
  const legacy=new Knowledge(env.KNOWLEDGE_DB,actor,undefined,env.APP_ORIGIN);
  register('knowledge_list','检索历史参考文章；其旧认可规则不适用于当前生产资源业务。',schemas.list,a=>legacy.list(a));
  register('knowledge_get','读取可见历史参考文章和原版本，私人草稿仍只对作者可见。',schemas.get,a=>legacy.get(a));
 }
 return createMcpHandler(()=>server,{corsOptions:false,allowedHostnames:[new URL(env.APP_ORIGIN).hostname,'127.0.0.1','localhost']})(request,env,ctx);
}
