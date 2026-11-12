import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotKnowledge} from '../scripts/snapshot.mjs';

const exported=`PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE kb_entries(id TEXT PRIMARY KEY,active_version_id TEXT REFERENCES kb_versions(id));
INSERT INTO kb_entries VALUES('entry','version');
CREATE TABLE kb_versions(id TEXT PRIMARY KEY,entry_id TEXT REFERENCES kb_entries(id));
INSERT INTO kb_versions VALUES('version','entry');`;
test('knowledge backup accepts D1 export with rows before the referenced table exists',()=>{
 const db=snapshotKnowledge(exported);try{assert.equal(db.prepare('SELECT active_version_id FROM kb_entries').get().active_version_id,'version');assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
});
test('knowledge backup still rejects missing referenced data after loading the full schema',()=>{
 assert.throws(()=>snapshotKnowledge(exported.replace("VALUES('version','entry')","VALUES('wrong-version','entry')")),/foreign keys invalid/);
});
