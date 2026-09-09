import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Tags} from '../app/server/tags.ts';
import {Archives} from '../app/server/archives.ts';
import {TagMaintenance} from '../app/server/tag-maintenance.ts';

test('category backfill preserves edited definitions and old history and is safe to replay',()=>{
 const db=new DatabaseSync(':memory:'),directory=new URL('../migrations/',import.meta.url);
 try{
  for(const file of readdirSync(directory).filter(x=>x.endsWith('.sql')&&!x.startsWith('0014')).sort())db.exec(readFileSync(new URL(file,directory),'utf8'));
  db.exec("UPDATE tag_categories SET description='保留用户自定范围',version=2 WHERE type='person' AND name='技能'");
  const sql=readFileSync(new URL('0014_category_boundaries.sql',directory),'utf8');db.exec(sql);db.exec(sql);
  assert.equal(db.prepare("SELECT description FROM tag_categories WHERE type='person' AND name='技能'").get().description,'保留用户自定范围');
  assert.equal(db.prepare("SELECT count(*) n FROM tag_categories WHERE description<>''").get().n,14);
  const direction=db.prepare("SELECT * FROM tag_categories WHERE type='person' AND name='发展方向'").get();assert.match(direction.description,/职业/);assert.equal(direction.version,2);
  const history=db.prepare("SELECT version,definition_json FROM tag_definition_history WHERE id=? AND entity_type='category' ORDER BY version").all(direction.id);
  assert.equal(history.length,2);assert.equal(JSON.parse(history[0].definition_json).description,'');assert.equal(JSON.parse(history[1].definition_json).description,direction.description);
 }finally{db.close();}
});

test('tag queries carry category meaning while closed and legacy snapshots keep their original meaning',async t=>{
 const f=fixture();t.after(f.close);const tags=new Tags(f.env,f.actor,'web'),archives=new Archives(f.env,f.actor,'web'),maintenance=new TagMaintenance(f.env,f.actor,'web');
 const category=await tags.createCategory({type:'person',name:'虚构边界',description:'原范围',request_id:randomUUID()}),tag=await tags.create({category_id:category.id,name:'虚构特征',description:'具体特征',request_id:randomUUID()});
 const open=await archives.create({type:'person',name:'虚构开启',request_id:randomUUID()}),closed=await archives.create({type:'person',name:'虚构关闭',request_id:randomUUID()});
 for(const a of [open,closed])await tags.batch({archive_id:a.id,expected_version:1,changes:[{tag_id:tag.id,action:'add'}],request_id:randomUUID()});
 await archives.setState({id:closed.id,expected_version:2,status:'已弃用',member_ids:[],request_id:randomUUID()});
 const preview=await maintenance.preview({entity_type:'category',id:category.id,name:'虚构边界',description:'澄清后范围',color:'sage',reason:'补充边界'});await maintenance.apply({preview_id:preview.preview_id,request_id:randomUUID()});
 assert.equal((await tags.list({type:'person',category_id:category.id})).tags[0].category_description,'澄清后范围');
 assert.equal((await tags.bindings(open.id)).tags[0].category_description,'澄清后范围');
 assert.equal((await tags.bindings(closed.id)).tags[0].category_description,'原范围');
 f.sqlite.prepare("UPDATE archive_tag_snapshots SET data_json=json_remove(data_json,'$.category_description') WHERE archive_id=?").run(closed.id);
 assert.equal((await tags.bindings(closed.id)).tags[0].category_description,undefined);
});
