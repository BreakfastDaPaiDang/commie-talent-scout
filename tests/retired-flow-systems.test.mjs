import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../app/server/index.ts';
import {fixture} from './d1-fixture.mjs';
import {digest} from '../app/server/types.ts';

test('retired flow and resource HTTP endpoints are absent',async()=>{
 for(const [method,path] of [['GET','/api/personnel-map'],['GET','/api/internal-resources'],['GET','/api/internal-resources/example'],['GET','/api/internal-resources/example/history'],['POST','/api/internal-resources/save'],['POST','/api/archives/resource-transfer']]){
   const r=await worker.fetch(new Request('https://scout.dapaidang.org'+path,{method,headers:{Origin:'https://scout.dapaidang.org'}}),{}, {waitUntil(){}});
   assert.equal(r.status,404,path);assert.equal((await r.json()).error.code,'NOT_FOUND');
 }
});

test('MCP discovery no longer offers retired graph, resource or transfer tools',async t=>{
 const f=fixture();t.after(f.close);const token='retired-tools-fixture';
 f.sqlite.prepare('UPDATE credentials SET hash=? WHERE id=?').run(await digest(token),f.actor.credential_id);
 const pending=[],ctx={waitUntil(p){pending.push(p);}};
 const headers={Host:'scout.dapaidang.org',Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 async function rpc(body){const r=await worker.fetch(new Request('https://scout.dapaidang.org/mcp',{method:'POST',headers,body:JSON.stringify(body)}),f.env,ctx);const text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text.startsWith('{')?text:text.split('\n').find(x=>x.startsWith('data:')).slice(5));}
 const init=await rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'removal-check',version:'1'}}});
 headers['MCP-Protocol-Version']=init.result.protocolVersion;
 const list=await rpc({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
 const names=list.result.tools.map(x=>x.name);
 for(const name of ['get_personnel_map','list_internal_resources','get_internal_resource','save_internal_resource','list_internal_resource_history','transfer_archive_resource'])assert.ok(!names.includes(name),name);
 for(const name of ['whoami','get_archive','create_observation','complete_work_task'])assert.ok(names.includes(name),name);
 const update=list.result.tools.find(x=>x.name==='update_archive');assert.ok(!Object.hasOwn(update.inputSchema.properties,'resources'));
 await Promise.all(pending);
});
