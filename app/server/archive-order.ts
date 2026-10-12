export {archiveOrderCte} from '../rules/archive-reminder-query.ts';
import {z} from 'zod';
import {Failure} from './types.ts';

const position=z.tuple([z.number().int().nonnegative().max(8.64e15),z.union([z.literal(0),z.literal(1)]),z.number().int().min(-8.64e15).max(8.64e15),z.uuid()]);
export function archiveCursor(cursor?:string){
 if(!cursor)return {at:Date.now(),after:null};
 try{if(!cursor.startsWith('r1:'))throw new Error();const [at,priority,sort,id]=position.parse(JSON.parse(atob(cursor.slice(3))));if(at>Date.now())throw new Error();return {at,after:{priority,sort,id}};}
 catch{throw new Failure(400,'INVALID_CURSOR','分页位置已失效，请刷新列表');}
}
export function nextArchiveCursor(at:number,row:{_priority:number;_sort:number;id:string}){return 'r1:'+btoa(JSON.stringify([at,row._priority,row._sort,row.id]));}
