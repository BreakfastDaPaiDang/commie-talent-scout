import React from 'react';
import {KnowledgeWorkspace} from '../../../app/ui/KnowledgeWorkspace';
import {KnowledgePage} from '../../../app/client/KnowledgePage';
import {TopBar,AuxiliaryToolsNav,AgentNav} from '../../../app/ui/Workspace';
import {knowledgeDemo,knowledgeDemoIdentity} from './knowledge-demo';
const api=knowledgeDemo();
export default function KnowledgePreview(){return <div className="app"><TopBar onHome={()=>location.assign('/')} navigation={<>{['外部人物','组织','任务','社员','统计','知识库'].map(name=><button key={name} className={name==='知识库'?'active':''}>{name}</button>)}</>} tools={<><AuxiliaryToolsNav active={false} onClick={()=>location.assign('/')}/><AgentNav onClick={()=>location.assign('/?page=agent')}/><span>{knowledgeDemoIdentity.name}</span></>}/>{new URLSearchParams(location.search).has('connected')?<KnowledgePage/>:<KnowledgeWorkspace api={api} identity={knowledgeDemoIdentity}/>}</div>;}
