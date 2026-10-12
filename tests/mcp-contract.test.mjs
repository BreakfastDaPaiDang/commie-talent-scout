import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid,createHash} from 'node:crypto';
import {z} from 'zod';
import {guides,guideTopicSchema} from '../app/server/mcp.ts';
import {registerMaterialTools} from '../app/server/mcp-materials.ts';
import {registerImageTools} from '../app/server/mcp-images.ts';
import {Archives} from '../app/server/archives.ts';
import {Materials} from '../app/server/materials.ts';
import {fixture} from './d1-fixture.mjs';

test('every advertised guide topic is accepted by the public input schema',()=>{
 assert.ok(guideTopicSchema.options.includes('work_tasks'));
 assert.deepEqual(guideTopicSchema.options.sort(),Object.keys(guides).sort());
 for(const topic of Object.keys(guides)){assert.equal(guideTopicSchema.parse(topic),topic);assert.ok(guides[topic].length);}
});

test('image/material tool outputs validate actual prepare, pending, ready and mutation results',async t=>{
 const f=fixture();t.after(f.close);f.actor.role='admin';f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);
 f.env.IMAGES.put=async(key,body)=>{const bytes=Buffer.from(await new Response(body).arrayBuffer());f.objects.set(key,bytes);return {size:bytes.length};};
 const tools=new Map(),server={registerTool(name,config,handler){assert.ok(config.outputSchema,name);tools.set(name,{config,handler});}};
 const reply=async action=>({structuredContent:await action(),content:[]});
 registerImageTools(server,f.env,f.actor,reply);registerMaterialTools(server,f.env,f.actor,reply);
 const call=async(name,args)=>{const {config,handler}=tools.get(name);const input=config.inputSchema instanceof z.ZodType?config.inputSchema:z.object(config.inputSchema);const result=await handler(input.parse(args));config.outputSchema.parse(result.structuredContent);return result.structuredContent;};
 const archive=await new Archives(f.env,f.actor,'mcp').create({type:'person',name:'虚构输出契约',request_id:uuid()});
 const bytes=Buffer.from('虚构材料'),input={archive_id:archive.id,name:'fixture.txt',mime_type:'text/plain',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const p=await call('prepare_material_upload',input);await call('get_material_upload_status',{id:p.upload_id});
 await Materials.receive(f.env,p.upload_id,new Request(p.url,{method:'PUT',headers:{...p.headers,'Content-Length':String(bytes.length)},body:bytes}));
 await call('get_material_upload_status',{id:p.upload_id});await call('list_materials',{archive_id:archive.id});
 const file=(await call('get_material',{id:p.upload_id})).material;
 let changed=await call('update_material',{id:file.id,expected_version:file.version,name:'updated.txt',description:'说明',request_id:uuid()});
 changed=await call('delete_material',{id:file.id,expected_version:changed.version,request_id:uuid()});
 changed=await call('restore_material',{id:file.id,expected_version:changed.version,request_id:uuid()});
 changed=await call('delete_material',{id:file.id,expected_version:changed.version,request_id:uuid()});
 const purge={id:file.id,expected_version:changed.version,request_id:uuid()},remove=f.env.IMAGES.delete;
 f.env.IMAGES.delete=async()=>{throw new Error('temporary object failure');};assert.equal((await call('purge_material',purge)).state,'purging');
 f.env.IMAGES.delete=remove;assert.equal((await call('purge_material',purge)).state,'purged');
 const pending=await call('prepare_material_upload',input);await call('cancel_material_upload',{id:pending.upload_id,request_id:uuid()});
 const capacity=await call('get_material_capacity',{archive_id:archive.id});await call('set_material_capacity',{archive_id:archive.id,expected_version:capacity.version,limit_bytes:200000000,request_id:uuid()});
 const image=await call('prepare_image_upload',{purpose:'observation',archive_id:archive.id,mime_type:'image/png',byte_size:20,sha256:'a'.repeat(64)});await call('get_upload_status',{upload_id:image.upload_id});
 const a=await new Archives(f.env,f.actor,'mcp').get(archive.id);await call('set_avatar',{subject_type:'archive',id:a.id,expected_version:a.version,attachment_id:null,request_id:uuid()});
 await call('update_own_profile',{id:f.actor.id,expected_version:f.actor.version,name:f.actor.name,qq:f.actor.qq,request_id:uuid()});
});
