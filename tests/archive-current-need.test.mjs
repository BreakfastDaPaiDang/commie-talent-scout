import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';

const status={member:'\u5df2\u5165\u4f19',friend:'\u5916\u90e8\u793e\u53cb',orgContact:'\u4e2a\u4eba\u63a5\u89e6',orgExchange:'\u7ec4\u7ec7\u4ea4\u6d41'};
const create=(service,input)=>service.create({type:'person',name:'\u865a\u6784\u9700\u6c42 '+uuid().slice(0,8),contacts:[],links:[],request_id:uuid(),...input});

test('current need round-trips, omitted updates preserve it, and explicit clearing is distinct',async t=>{
 const f=fixture();t.after(f.close);const service=new Archives(f.env,f.actor,'web');
 const made=await create(service,{status:status.member,current_need:'\u9700\u8981\u4e00\u4f4d\u540c\u5fd7\u534f\u52a9\u627e\u623f\u5b50',contacts:[{type:'QQ',value:'123456789',note:''}]});
 assert.equal(made.contact_reminder.count,1);assert.equal(made.contact_reminder.needed,true);
 let detail=(await service.detail(made.id)).archive;assert.equal(detail.current_need,'需要一位同志协助找房子');assert.equal(detail.contact_reminder.needed,true);
 const mcp=new Archives(f.env,f.actor,'mcp');assert.equal((await mcp.get(made.id)).current_need,'需要一位同志协助找房子');
 const preserved=await service.update({id:made.id,expected_version:detail.version,name:detail.name,contacts:[...detail.contacts,{type:'邮箱',value:'need@example.invalid',note:''}],links:[],request_id:uuid()});
 assert.equal(preserved.contact_reminder.needed,false);detail=await service.get(made.id);assert.equal(detail.current_need,'需要一位同志协助找房子');assert.equal((await mcp.get(made.id)).contact_reminder.needed,false);
 const cleared=await mcp.update({id:made.id,expected_version:detail.version,name:detail.name,current_need:'',contacts:detail.contacts,links:[],request_id:uuid()});
 assert.equal(cleared.changed,true);assert.equal((await service.detail(made.id)).archive.current_need,'');
});

test('contact reminder only applies to the requested states and deduplicates the same channel/account',async t=>{
 const f=fixture();t.after(f.close);const service=new Archives(f.env,f.actor,'web');
 const org=await create(service,{type:'org',name:'\u865a\u6784\u7ec4\u7ec7',status:status.orgContact,contacts:[{type:'邮箱',value:'same@example.invalid',note:''},{type:'邮箱',value:'same@example.invalid',note:'重复'}]});
 assert.equal(org.contact_reminder.eligible,true);assert.equal(org.contact_reminder.count,1);assert.equal(org.contact_reminder.needed,true);
 const person=await create(service,{status:'\u4e2a\u4eba\u63a5\u89e6',contacts:[]});assert.equal(person.contact_reminder.eligible,false);assert.equal(person.contact_reminder.needed,false);
 const exchange=await service.create({type:'org',name:'\u865a\u6784\u4ea4\u6d41\u7ec4\u7ec7',status:status.orgExchange,member_ids:[f.actor.id],contacts:[{type:'QQ',value:'123456789',note:''},{type:'邮箱',value:'org@example.invalid',note:''}],links:[],current_need:'',request_id:uuid()});
 assert.equal(exchange.contact_reminder.needed,false);
});
