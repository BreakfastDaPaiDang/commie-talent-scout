import React from 'react';
import {KnowledgeWorkspace} from '../../../app/ui/KnowledgeWorkspace';
import {KnowledgePage} from '../../../app/client/KnowledgePage';
import {TopBar,AuxiliaryToolsNav,AgentNav} from '../../../app/ui/Workspace';
import {knowledgeDemo} from './knowledge-demo';
const api=knowledgeDemo();
export default function KnowledgePreview(){return <div className="app"><TopBar onHome={()=>location.assign('/')} navigation={<>{['外部人物','组织','任务','社员','统计','知识库'].map(name=><button key={name} className={name==='知识库'?'active':''}>{name}</button>)}</>} tools={<><AuxiliaryToolsNav active={false} onClick={()=>location.assign('/')}/><AgentNav onClick={()=>location.assign('/?page=agent')}/><span>示例成员</span></>}/>{new URLSearchParams(location.search).has('connected')?<KnowledgePage/>:<KnowledgeWorkspace api={api} identity={{id:'preview-member',name:'示例成员',kind:'member',can_write:true}}/>}</div>;}
