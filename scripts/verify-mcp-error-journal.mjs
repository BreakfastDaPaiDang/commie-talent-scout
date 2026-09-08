import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('mcp-error-journal'),checks=[];let archive;
try{
 archive=await v.call('create_archive',{type:'person',name:'虚构调用拒绝分类 '+randomUUID().slice(0,8),request_id:randomUUID()});const record=await v.call('create_observation',{archive_id:archive.id,body:'虚构日志分类验收',request_id:randomUUID()});const a=(await v.call('get_archive',{id:archive.id})).archive;await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:randomUUID()});
 const requestId=randomUUID(),r=await v.client.callTool({name:'delete_observation',arguments:{id:record.id,expected_version:1,request_id:requestId}});assert.equal(r.isError,true);assert.equal(r.structuredContent.error.code,'ARCHIVE_CLOSED');
 let calls=(await v.http('/admin/calls?limit=100')).body.calls;const rejected=calls.find(c=>c.request_id===requestId);assert.ok(rejected);assert.equal(rejected.outcome,'rejected');assert.equal(rejected.error_code,'ARCHIVE_CLOSED','Streaming completion must preserve the specific business rejection');checks.push('SSE response finishing after handleMcp returns preserves ARCHIVE_CLOSED in the administrator journal');
 const invalidId=randomUUID();try{await v.client.callTool({name:'delete_observation',arguments:{id:record.id,request_id:invalidId}});}catch{}
 calls=(await v.http('/admin/calls?limit=100')).body.calls;assert.equal(calls.find(c=>c.request_id===invalidId)?.error_code,'INVALID_TOOL_REQUEST');checks.push('Invalid tool arguments still receive the protocol fallback classification');
}finally{await v.close(checks);}
