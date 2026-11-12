import {randomUUID} from 'node:crypto';

// Idempotent bridge for the first private import on a freshly migrated database.
// Existing workspace documents are never rewritten or re-added after user edits.
export async function ensureWorkspaceDrafts(send,input){
 const ids=input.items.map(item=>item.id),marks=ids.map(()=>'?').join(',');
 const rows=(await send({sql:`SELECT e.id FROM kb_entries e WHERE e.author_id=? AND e.id IN (${marks}) AND NOT EXISTS(SELECT 1 FROM kw_documents d WHERE d.id=e.id)`,params:[input.owner_id,...ids]}))[0].results;
 if(!rows.length)return {imported:0};
 const selected=rows.map(r=>r.id),selectedMarks=selected.map(()=>'?').join(','),branch='import-drafts-'+input.id,at=new Date().toISOString(),commit=randomUUID(),guard=randomUUID();
 const revision=(await send({sql:'SELECT revision FROM kw_meta WHERE id=1'}))[0].results[0].revision;
 const batch=[
  {sql:'INSERT INTO kw_guards VALUES(?,CASE WHEN (SELECT revision FROM kw_meta WHERE id=1)=? THEN 1 ELSE 0 END)',params:[guard,revision]},
  {sql:"INSERT OR IGNORE INTO kw_branches(id,name,owner_id,owner_name,visibility,created_at,updated_at) VALUES(?,?,?,?,'private',?,?)",params:[branch,'导入草稿 · '+input.owner_name+' · '+input.id.slice(0,8),input.owner_id,input.owner_name,at,at]},
  {sql:`INSERT INTO kw_documents SELECT id,author_id,author_name,created_at FROM kb_entries WHERE id IN (${selectedMarks})`,params:selected},
  {sql:`INSERT INTO kw_versions SELECT id,entry_id,title,body,NULL,'知识',source,0,author_id,author_name,created_at FROM kb_versions WHERE state='draft' AND author_id=? AND entry_id IN (${selectedMarks})`,params:[input.owner_id,...selected]},
  {sql:`INSERT INTO kw_items(branch_id,document_id,version_id) SELECT ?,entry_id,id FROM kb_versions v WHERE state='draft' AND author_id=? AND entry_id IN (${selectedMarks}) AND id=(SELECT x.id FROM kb_versions x WHERE x.state='draft' AND x.author_id=v.author_id AND x.entry_id=v.entry_id ORDER BY x.updated_at DESC,x.id DESC LIMIT 1)`,params:[branch,input.owner_id,...selected]},
  {sql:"INSERT INTO kw_commits SELECT ?,id,head_id,NULL,'导入私人参考稿',?,?,? FROM kw_branches WHERE id=?",params:[commit,input.owner_id,input.owner_name,at,branch]},
  {sql:`INSERT INTO kw_changes SELECT ?,document_id,NULL,version_id FROM kw_items WHERE branch_id=? AND document_id IN (${selectedMarks})`,params:[commit,branch,...selected]},
  {sql:'UPDATE kw_branches SET head_id=?,version=version+1,updated_at=? WHERE id=?',params:[commit,at,branch]},
  {sql:'UPDATE kw_meta SET revision=revision+1 WHERE id=1'},
  {sql:'DELETE FROM kw_guards WHERE id=?',params:[guard]},
 ];
 await send({batch});return {imported:rows.length};
}
