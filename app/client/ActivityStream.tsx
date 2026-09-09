import React,{useState,type ReactNode} from 'react';
import {groupActivities,type ActivityEvent,type ActivityGroup} from '../shared/activity-groups';
const labels:Record<string,string>={'archive.deleted':'删除档案','archive.restored':'恢复档案','archive.created':'建档','archive.profile_changed':'资料','archive.state_changed':'状态','archive.members_changed':'成员','archive.closed':'关闭','archive.reopened':'重新开启','archive.avatar_changed':'头像','archive.tags_changed':'标签','observation.created':'新增观察','observation.edited':'编辑观察','observation.deleted':'删除观察','observation.restored':'恢复观察'};
type Event=ActivityEvent&{actor_name:string;observation:unknown};
export function ActivityStream<T extends Event>({events,renderRecord,renderEvent}:{events:T[];renderRecord:(e:T)=>ReactNode;renderEvent:(e:T)=>ReactNode}){
 return <>{groupActivities(events).map(group=><ActivityBatch key={group.id} group={group} renderRecord={renderRecord} renderEvent={renderEvent}/>)}</>;
}
function ActivityBatch<T extends Event>({group,renderRecord,renderEvent}:{group:ActivityGroup<T>;renderRecord:(e:T)=>ReactNode;renderEvent:(e:T)=>ReactNode}){
 const[open,setOpen]=useState(false),records=group.events.filter(e=>e.observation),operations=group.events.filter(e=>!e.observation);
 if(group.events.length===1)return <>{records.length?renderRecord(group.events[0]):renderEvent(group.events[0])}</>;
 const summary=[...new Set(operations.map(e=>labels[e.kind]??'更新'))].join('、'),when=new Date(group.ended_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 return <section className="activity-group" data-activity-group={group.id}>{records.map(e=><React.Fragment key={e.id}>{renderRecord(e)}</React.Fragment>)}{operations.length>0&&<details className="activity-batch" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary><strong>{group.events[0].actor_name}</strong><span>{records.length?'同时更新':'更新'}{summary} · {operations.length} 项操作</span><small>{when}</small></summary>{open&&<div className="activity-batch-content">{operations.map(e=><React.Fragment key={e.id}>{renderEvent(e)}</React.Fragment>)}</div>}</details>}</section>;
}
