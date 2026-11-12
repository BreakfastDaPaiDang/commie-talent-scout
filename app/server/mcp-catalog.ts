import type {McpServer} from '@modelcontextprotocol/server';
import type {Env,Actor} from './types.ts';
import type {McpReply} from './mcp-members.ts';
import {catalogCall} from './catalog-bridge.ts';
import {catalogTools,catalogGuide} from '../../knowledge/src/catalog-tools.ts';
export const catalogToolNames=catalogTools.map(t=>t.name),catalogGuides=catalogGuide;
export function registerCatalogTools(server:McpServer,env:Env,actor:Actor,reply:McpReply){
 for(const t of catalogTools)server.registerTool(t.name,{description:t.description,inputSchema:t.schema,annotations:{readOnlyHint:!t.write,destructiveHint:false,idempotentHint:true,openWorldHint:false}},(args:unknown)=>reply(async()=>{
  const data=await catalogCall<Record<string,unknown>>(env,actor,t.path(args),t.write?args:undefined);if(t.name==='catalog_prepare_file')data.upload_url=env.APP_ORIGIN+'/api/catalog/files/'+data.id+'/content';return data;
 },r=>({id:r.id??null,version:r.version??null})));
}
