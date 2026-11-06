import React,{useCallback,useState} from 'react';
import {WorkOverview,type OverviewSave} from '../../../app/ui/WorkOverview';
import {overviewDemo} from '../../../app/shared/work-overview-demo';
import type {OverviewResource,OverviewGap,OverviewPlacement} from '../../../app/shared/work-overview';
import {TopBar} from '../../../app/ui/Workspace';
export default function WorkOverviewPreview(){
 const [data,setData]=useState(overviewDemo),[notice,setNotice]=useState('');
 const load=useCallback(async(type:'person'|'org')=>({...data,people:type==='person'?data.people:[]}),[data]);
 const save=useCallback(async(input:OverviewSave)=>{setData(old=>{const next=structuredClone(old),value={...input,version:input.expected_version+1};if(input.entity==='resource'){next.resources=next.resources.filter(r=>r.id!==input.id).concat(value as unknown as OverviewResource);}else if(input.entity==='gap')next.gaps=next.gaps.filter(g=>g.id!==input.id).concat(value as unknown as OverviewGap);else for(const p of next.people)if(p.id===input.archive_id)for(const s of p.segments)if(s.id===input.event_id)s.placements=[value as unknown as OverviewPlacement];return next;});},[]);
 return <><TopBar onHome={()=>location.href='/'} navigation={<><button>档案</button><button>社员</button><button>任务</button><button className="active">统计</button></>}/>{notice&&<p role="status">{notice}</p>}<WorkOverview preview load={load} save={save} onArchive={p=>setNotice(`示例档案：${p.name}`)} onTask={()=>setNotice('示例任务：正式站打开现有任务详情')} onCreateTask={()=>setNotice('示例发布：正式站打开关联档案的任务表单')}/></>;
}
