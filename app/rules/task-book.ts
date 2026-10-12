export type TaskProcessingState='failed'|'cancelled'|'ready'|'active'|'waiting'|'closed';
type TaskRecord={id:string;status:string;owner_id:string|null;ready_to_submit?:boolean;priority?:string;created_at:string;updated_at?:string;completed_at?:string|null};

export function taskProcessingState(task:Pick<TaskRecord,'status'|'owner_id'|'ready_to_submit'>):TaskProcessingState{
 return task.status==='expired'?'failed':task.status==='cancelled'?'cancelled':task.status!=='open'?'closed':task.owner_id===null?'waiting':task.ready_to_submit?'ready':'active';
}
const stateOrder:Record<TaskProcessingState,number>={failed:0,cancelled:1,ready:2,active:3,waiting:4,closed:5};
export function compareTaskBook(a:TaskRecord,b:TaskRecord){
 return stateOrder[taskProcessingState(a)]-stateOrder[taskProcessingState(b)]
  ||(a.priority??'P2').localeCompare(b.priority??'P2')
  ||Date.parse(b.updated_at??b.created_at)-Date.parse(a.updated_at??a.created_at)
  ||a.id.localeCompare(b.id);
}
export function monthStartInBeijing(at=Date.now()){
 const date=new Date(at+8*60*60*1000);
 return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1)-8*60*60*1000;
}
export function personalTaskCompletions(tasks:readonly TaskRecord[],ownerId:string,at=Date.now()){
 const completed=tasks.filter(task=>task.status==='completed'&&task.owner_id===ownerId&&task.completed_at&&Date.parse(task.completed_at)<=at);
 const month=completed.filter(task=>Date.parse(task.completed_at!)>=monthStartInBeijing(at));
 return {month:month.length,total:completed.length,p0:month.filter(task=>task.priority==='P0').length,p1:month.filter(task=>task.priority==='P1').length};
}
