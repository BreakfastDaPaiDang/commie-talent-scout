import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotDatabase} from '../scripts/lib/snapshot-database.mjs';

test('D1 snapshot import preserves a merge reference to a target inserted later',()=>{
 const db=snapshotDatabase(`PRAGMA defer_foreign_keys=TRUE;
 CREATE TABLE tags(id TEXT PRIMARY KEY,merged_into TEXT REFERENCES tags(id));
 INSERT INTO tags VALUES('source','target');
 INSERT INTO tags VALUES('target',NULL);`);
 try{assert.equal(db.prepare("SELECT merged_into FROM tags WHERE id='source'").get().merged_into,'target');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.throws(()=>db.exec("INSERT INTO tags VALUES('bad','missing')"),/FOREIGN KEY/);}finally{db.close();}
});

test('snapshot commit rejects genuinely missing targets instead of disabling foreign keys',()=>{
 assert.throws(()=>snapshotDatabase(`PRAGMA defer_foreign_keys=TRUE;
 CREATE TABLE tags(id TEXT PRIMARY KEY,merged_into TEXT REFERENCES tags(id));
 INSERT INTO tags VALUES('source','missing');`),/FOREIGN KEY/);
});
