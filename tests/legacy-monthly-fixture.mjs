import {randomUUID} from 'node:crypto';

// Historical rows are fixtures, not a second implementation of the removed generator.
export function legacyMonthlyTask(f,archiveId,period='2099-01'){
 const id=randomUUID(),at=new Date().toISOString();
 f.sqlite.prepare(`INSERT INTO work_tasks(id,archive_id,kind,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at,period_key)
 VALUES(?,?,'monthly','历史月度沟通','历史跟进事项','留档并交付','rule','open','2099-12-31T00:00:00.000Z',?,?,?,?)`).run(id,archiveId,f.actor.id,at,at,period);
 return f.sqlite.prepare('SELECT * FROM work_tasks WHERE id=?').get(id);
}
