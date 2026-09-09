import {z} from 'zod';
import {personStates} from '../shared/archive-states.ts';
import {DAY_MS,reminderDays} from '../shared/archive-reminders.ts';
import {Failure} from './types.ts';

const shortStates=personStates.filter(s=>reminderDays('person',s)===7).map(s=>`'${s}'`).join(',');
// SQLite's Julian conversion is rounded to the stored millisecond precision.
const updatedMs="CAST(round((julianday(a.updated_at)-2440587.5)*86400000) AS INTEGER)";
export const archiveOrderCte=`WITH clock(as_of) AS (VALUES (?)), deadlines AS (
 SELECT a.*,${updatedMs} _updated_ms,CASE WHEN a.closed=0 AND a.deleted=0 THEN ${updatedMs}+(CASE WHEN a.type='person' AND a.status IN (${shortStates}) THEN 7 ELSE 30 END)*${DAY_MS} ELSE NULL END _due FROM archives a
), ranked AS (
 SELECT d.*,CASE WHEN _due<(SELECT as_of FROM clock) THEN 0 ELSE 1 END _priority,
 CASE WHEN _due<(SELECT as_of FROM clock) THEN _due ELSE -_updated_ms END _sort FROM deadlines d
)`;
const position=z.tuple([z.number().int().nonnegative().max(8.64e15),z.union([z.literal(0),z.literal(1)]),z.number().int().min(-8.64e15).max(8.64e15),z.uuid()]);
export function archiveCursor(cursor?:string){
 if(!cursor)return {at:Date.now(),after:null};
 try{if(!cursor.startsWith('r1:'))throw new Error();const [at,priority,sort,id]=position.parse(JSON.parse(atob(cursor.slice(3))));if(at>Date.now())throw new Error();return {at,after:{priority,sort,id}};}
 catch{throw new Failure(400,'INVALID_CURSOR','分页位置已失效，请刷新列表');}
}
export function nextArchiveCursor(at:number,row:{_priority:number;_sort:number;id:string}){return 'r1:'+btoa(JSON.stringify([at,row._priority,row._sort,row.id]));}
