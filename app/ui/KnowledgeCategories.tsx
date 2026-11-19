import React,{useEffect,useRef,useState} from 'react';
import type {KnowledgeApi,KnowledgeCategory,KnowledgeIdentity,KnowledgeVersion} from '../shared/knowledge';
import {KnowledgeDocumentBody} from './KnowledgeComments';
import {Modal,ModalActions} from './Modal';
import {Icon} from './icons';
import {TagCatalog,TagDefinitionFields} from './TagCatalog';

type EditorProps={
  api:KnowledgeApi;
  branchId:string;
  category?:KnowledgeCategory;
  initialName?:string;
  startCreating?:boolean;
  close:()=>void;
  done:(category:KnowledgeCategory)=>void;
};

function normalize(text:string) {
  return text.normalize('NFKC').trim().toLocaleLowerCase();
}

export function KnowledgeCategoryEditor({api,branchId,category,initialName='',startCreating=false,close,done}:EditorProps) {
  const [name,setName]=useState(category?.name??initialName);
  const [definition,setDefinition]=useState(category?.definition??'');
  const [query,setQuery]=useState(initialName);
  const [items,setItems]=useState<KnowledgeCategory[]>([]);
  const [creating,setCreating]=useState(startCreating);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(!category);
  const [revision,setRevision]=useState(0);

  useEffect(()=>{
    if (category) return;
    let current=true;
    setLoading(true);
    setError('');
    api.read<{categories:KnowledgeCategory[]}>('/categories?'+new URLSearchParams({branch_id:branchId}))
      .then(r=>{if(current)setItems(r.categories);})
      .catch(e=>{if(current)setError(e.message);})
      .finally(()=>{if(current)setLoading(false);});
    return ()=>{current=false;};
  },[api,branchId,category,revision]);

  async function propose(event:React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if(!category&&items.some(c=>normalize(c.name)===normalize(name))) throw new Error('已有同名标签，请选择已有词条。');
      const result=await api.write('/categories',{
        branch_id:branchId,...(category?{id:category.id,expected_version:category.version}:{}),name,definition,
      });
      // For a rename, the effective version stays visible until the ballot passes.
      done(category??{...result,name:name.trim(),definition,count:0,updated_at:new Date().toISOString()});
    } catch(e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }

  const feedback=error&&<p role="alert" className="form-error">{error}{!category&&!creating&&
    <button type="button" className="text-button" onClick={()=>setRevision(n=>n+1)}>重试</button>}</p>;
  const form=<form className={'manage-form'+(category?'':' tag-create-form')} onSubmit={propose}>
    {!category&&<h3>新建标签</h3>}
    <TagDefinitionFields autoFocus name={name} onName={setName} description={definition} onDescription={setDefinition}
      busy={busy} nameLabel="标签名称" descriptionLabel="标签解释" descriptionRequired={false} descriptionLimit={4000}
      placeholder="说明这个标签的含义与适用范围"/>
    {feedback}
    <ModalActions>
      {!category&&<button type="button" className="button quiet" disabled={busy} onClick={()=>{setCreating(false);setError('');}}>返回查找</button>}
      <button className="button primary" disabled={busy}>{busy?'正在提交…':category?'提交标签修改':'提议新标签'}</button>
    </ModalActions>
  </form>;
  return <Modal title={category?'编辑标签':'标签库'} onClose={close} busy={busy}>
    <div className="tag-catalog-dialog">
      {category||creating?form:<TagCatalog query={query} onQuery={setQuery}
        items={items.filter(c=>normalize(c.name+' '+c.definition).includes(normalize(query))).map(c=>({
          id:c.id,name:c.name,pending:c.pending,description:c.definition,meta:<>当前分支 {c.count} 篇文档</>,
        }))}
        loading={loading} busy={busy} onSelect={id=>{const selected=items.find(c=>c.id===id);if(selected)done(selected);}}
        feedback={feedback} onCreate={()=>{setName(query.trim());setCreating(true);setError('');}}
        searchPlaceholder="搜索标签名称或解释" createLabel="没有适用词义？新建标签"/>}
    </div>
  </Modal>;
}

type DrawerProps={
  api:KnowledgeApi;
  category:KnowledgeCategory;
  branchId:string;
  identity:KnowledgeIdentity;
  close:()=>void;
  onChanged:(category:KnowledgeCategory)=>void;
  onIssue:(id:string)=>void;
};

export function KnowledgeCategoryDrawer({api,category,branchId,identity,close,onChanged,onIssue}:DrawerProps) {
  const ref=useRef<HTMLElement>(null);
  const [editing,setEditing]=useState(false);
  const [submitted,setSubmitted]=useState(false);
  useEffect(()=>{
    const previous=document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const pointer=(e:PointerEvent)=>{
      if (!ref.current?.contains(e.target as Node)&&!(e.target as Element)?.closest('.kb-categories,.kb-help-button')) close();
    };
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'&&!ref.current?.querySelector('dialog[open],.kb-annotation-menu,.kb-annotation-form'))close();
    };
    document.addEventListener('pointerdown',pointer);
    document.addEventListener('keydown',key);
    return ()=>{
      document.removeEventListener('pointerdown',pointer);
      document.removeEventListener('keydown',key);
      if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();
    };
  },[]);
  const definitionDocument:KnowledgeVersion={
    id:category.definition_version_id??'category-empty-'+category.id,document_id:'category-'+category.id,
    title:category.name,body:category.definition,category_id:category.id,kind:'标签解释',source:'',deleted:0,
    author_id:'',author_name:'',created_at:category.updated_at,
  };
  return <aside className="kb-category-drawer" ref={ref} role="dialog" aria-label={category.name+'标签定义与留言'}>
    <header>
      <h2>{category.name}</h2>{!!category.pending&&<span className="kb-proposed-tag">待认可</span>}
      {identity.can_write&&<button aria-label="编辑标签" title="编辑标签" onClick={()=>setEditing(true)}><Icon name="edit" size={18}/></button>}
      <button aria-label="关闭标签侧栏" onClick={close}>×</button>
    </header>
    {submitted&&<p role="status" className="kb-muted">标签修改已提交认可。</p>}
    {!category.definition&&<p className="kb-muted kb-definition-empty">还没有标签解释</p>}
    {category.pending?<p className="kb-pending-definition">{category.definition}</p>:
      <KnowledgeDocumentBody key={definitionDocument.id} api={api} identity={identity} document={definitionDocument}
        categoryId={category.id} branchId={branchId} writable={identity.can_write} onIssue={onIssue}/>}
    {editing&&<KnowledgeCategoryEditor api={api} branchId={branchId} category={category} close={()=>setEditing(false)}
      done={updated=>{setEditing(false);setSubmitted(true);onChanged(updated);}}/>}
  </aside>;
}
