import React,{useEffect,useState} from 'react';
import {KnowledgeWorkspace} from '../ui/KnowledgeWorkspace';
import {knowledgeRead,knowledgeWrite} from './knowledge-api';
import {catalogRead} from './catalog-api';
import type {KnowledgeIdentity} from '../shared/knowledge';
const api={read:knowledgeRead,write:knowledgeWrite};
export function KnowledgePage(){
 const [identity,setIdentity]=useState<KnowledgeIdentity|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;setIdentity(null);setError('');void(async()=>{const gift=new URLSearchParams(location.hash.slice(1)).get('gift');if(gift){history.replaceState(null,'',location.pathname+location.search);await catalogRead('/access/session',{key:gift});}const r=await knowledgeRead('/branches');if(active)setIdentity(r.identity);})().catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[revision]);
 if(error)return <main className="resource-tool"><h1>知识库</h1><p className="form-error" role="alert">{error}</p><button className="button" onClick={()=>setRevision(v=>v+1)}>重试</button> <a className="button quiet" href="/">返回主站登录</a></main>;
 if(!identity)return <main className="initial-loading" role="status">正在打开知识库…</main>;
 return <KnowledgeWorkspace key={identity.kind+identity.id} api={api} identity={identity}/>;
}
