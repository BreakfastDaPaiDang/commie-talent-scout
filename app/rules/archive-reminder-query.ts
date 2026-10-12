import {memberArchiveSql} from './person-identity.ts';
import {personStates} from './archive-states.ts';
import {DAY_MS,reminderDays} from './archive-reminders.ts';

const shortStates=personStates.filter(s=>reminderDays('person',s)===7).map(s=>`'${s}'`).join(',');
// SQLite's Julian conversion is rounded to the stored millisecond precision.
const updatedMs="CAST(round((julianday(a.updated_at)-2440587.5)*86400000) AS INTEGER)";
export const archiveOrderCte=`WITH clock(as_of) AS (VALUES (?)), deadlines AS (
 SELECT a.*,${updatedMs} _updated_ms,CASE WHEN a.closed=0 AND a.deleted=0 AND NOT ${memberArchiveSql()} THEN ${updatedMs}+(CASE WHEN a.type='person' AND a.status IN (${shortStates}) THEN 7 ELSE 30 END)*${DAY_MS} ELSE NULL END _due FROM archives a
), ranked AS (
 SELECT d.*,CASE WHEN _due<(SELECT as_of FROM clock) THEN 0 ELSE 1 END _priority,
 CASE WHEN _due<(SELECT as_of FROM clock) THEN _due ELSE -_updated_ms END _sort FROM deadlines d
)`;
