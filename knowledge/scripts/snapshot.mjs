import {DatabaseSync} from 'node:sqlite';

// D1 exports tables with their rows, not necessarily in dependency order.
// Entries reference their active version and versions reference their entry.
// Import all schema/data first, then explicitly validate every foreign key.
export function snapshotKnowledge(sql){
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
 try{
  db.exec('BEGIN');db.exec(Buffer.isBuffer(sql)?sql.toString('utf8'):sql);db.exec('COMMIT');
  db.exec('PRAGMA foreign_keys=ON');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Knowledge backup foreign keys invalid');
  return db;
 }catch(error){db.close();throw error;}
}
