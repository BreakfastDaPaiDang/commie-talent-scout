import React,{type ReactNode} from 'react';
import './tags.css';

export type TagCatalogEntry={id:string;name:string;category_name?:string;color?:string;description:string;meta?:ReactNode;state?:string};

export function TagChip({tag}:{tag:{name:string;category_name?:string;color?:string;focus?:number}}){
 const title=tag.category_name?`${tag.category_name}：${tag.name}`:tag.name;
 return <span className={'tag-chip tag-'+(tag.color??'slate')} title={title}>{tag.category_name&&<span className="tag-category">{tag.category_name}：</span>}<span className="tag-name">{tag.name}</span></span>;
}

// Shared catalogue presentation; each library supplies its own authorized data and commands.
export function TagCatalog({query,onQuery,items,loading,busy=false,selectedIds=[],selectLabel='选择',onSelect,onInspect,onMore,onCreate,createForm,feedback,searchPlaceholder='搜索类别、名称或描述',createLabel='没有适用词义？新建标签'}:{query:string;onQuery:(value:string)=>void;items:TagCatalogEntry[];loading:boolean;busy?:boolean;selectedIds?:string[];selectLabel?:'添加'|'选择';onSelect?:(id:string)=>void;onInspect?:(id:string)=>void;onMore?:()=>void;onCreate?:()=>void;createForm?:ReactNode;feedback?:ReactNode;searchPlaceholder?:string;createLabel?:string}){
 return <div className="tag-chooser"><label className="tag-search">查找已有词义<input autoFocus value={query} onChange={e=>onQuery(e.target.value)} placeholder={searchPlaceholder} maxLength={200} disabled={busy}/></label>{feedback}
  <div className="tag-choice-list">{items.map(t=><article key={t.id}><div><TagChip tag={t}/>{t.state&&<small> {t.state}</small>}<p>{t.description}</p>{t.meta!==undefined&&<small>{t.meta}</small>}</div>{onInspect&&<button type="button" className="button" disabled={busy} onClick={()=>onInspect(t.id)}>查看与维护</button>}{onSelect&&<button type="button" className="button" disabled={busy||selectedIds.includes(t.id)} onClick={()=>onSelect(t.id)}>{selectedIds.includes(t.id)?(selectLabel==='选择'?'已选择':'已绑定'):selectLabel}</button>}</article>)}</div>
  {loading?<p role="status">正在检索词库…</p>:onMore?<button type="button" className="button" disabled={busy} onClick={onMore}>加载更多标签</button>:!items.length&&<p>{query?(onCreate||createForm?'没有找到适用词条，可在下方新建。':'没有找到符合条件的词条。'):'词库暂为空。'}</p>}
  {createForm??(onCreate&&<button type="button" className="button quiet tag-create-toggle" disabled={busy} onClick={onCreate}>{createLabel}</button>)}
 </div>;
}

export function TagDefinitionFields({name,onName,description,onDescription,busy=false,nameLabel='标签名称',nameLimit=40,descriptionLabel='词义说明',descriptionRequired=true,descriptionLimit=160,autoFocus=false,placeholder='可以仅适用于一个对象；说明词义，具体来源与范围写在绑定依据中'}:{name:string;onName:(value:string)=>void;description:string;onDescription:(value:string)=>void;busy?:boolean;nameLabel?:string;nameLimit?:number;descriptionLabel?:string;descriptionRequired?:boolean;descriptionLimit?:number;autoFocus?:boolean;placeholder?:string}){
 return <><label className="tag-definition-field">{nameLabel}<input autoFocus={autoFocus} required maxLength={nameLimit} value={name} onChange={e=>onName(e.target.value)} disabled={busy}/></label><label className="tag-definition-field">{descriptionLabel}<textarea required={descriptionRequired} rows={3} maxLength={descriptionLimit} placeholder={placeholder} value={description} onChange={e=>onDescription(e.target.value)} disabled={busy}/></label></>;
}
