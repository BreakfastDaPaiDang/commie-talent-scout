import {DatabaseSync} from 'node:sqlite';

// D1 exports request deferred foreign keys and expect one import transaction.
// Autocommitting each INSERT loses that deferral, e.g. a merged tag whose target
// occurs later in the same table dump. Commit still rejects invalid references.
export function snapshotDatabase(sql){
 const database=new DatabaseSync(':memory:');
 try{database.exec('BEGIN');database.exec(Buffer.isBuffer(sql)?sql.toString('utf8'):sql);database.exec('COMMIT');return database;}
 catch(error){database.close();throw error;}
}
