import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,request,draft} from './fixture.mjs';
import {ensureWorkspaceDrafts} from '../scripts/workspace-import.mjs';
import {KnowledgeWorkspace} from '../src/workspace.ts';

test('private import never appends to an already shared legacy branch or restores an edited workspace document',async()=>{
 const f=fixture();try{
  const owner=f.actors[0],d=await draft(f.services[0]),input={id:request(),owner_id:owner.id,owner_name:owner.name,items:[{id:d.entry_id}]};
  const entry=f.sqlite.prepare('SELECT entry_id FROM kb_versions WHERE id=?').get(d.id);input.items[0].id=entry.entry_id;
  f.sqlite.prepare("INSERT INTO kw_branches(id,name,owner_id,owner_name,visibility,created_at,updated_at) VALUES(?,?,?,?,'members',?,?)").run('legacy-'+owner.id,'已共享旧稿',owner.id,owner.name,f.clock(),f.clock());
  const send=async({sql,params=[],batch})=>{if(batch){f.sqlite.exec('BEGIN');try{for(const q of batch)f.sqlite.prepare(q.sql).run(...(q.params??[]));f.sqlite.exec('COMMIT');return [];}catch(e){f.sqlite.exec('ROLLBACK');throw e;}}return [{results:f.sqlite.prepare(sql).all(...params)}];};
  assert.equal((await ensureWorkspaceDrafts(send,input)).imported,1);
  const w=new KnowledgeWorkspace(f.db,owner),branch='import-drafts-'+input.id;
  assert.equal((await w.branch(branch)).visibility,'private');assert.equal((await w.list({branch_id:'legacy-'+owner.id})).documents.length,0);
  await assert.rejects(new KnowledgeWorkspace(f.db,f.actors[1]).list({branch_id:branch}),e=>e.code==='NOT_FOUND');
  await w.remove({branch_id:branch,expected_version:(await w.branch(branch)).version,document_id:entry.entry_id,message:'作者撤回',request_id:request()});
  assert.equal((await ensureWorkspaceDrafts(send,input)).imported,0);assert.equal((await w.list({branch_id:branch})).documents.length,0);
  await w.deleteBranch({branch_id:branch,expected_version:(await w.branch(branch)).version,request_id:request()});
  assert.equal((await ensureWorkspaceDrafts(send,input)).imported,0);assert.equal((await w.branches()).branches.some(b=>b.id===branch),false);
 }finally{f.close();}
});
