import React, {useState, type ReactNode} from 'react';
import type {TagLabel} from '../shared/tags';
import {TagChip} from './TagCatalog';

// The same authorized tags describe an object in lists, details and tasks.
export function ObjectFeatures<T extends TagLabel>({tags,total=tags.length,compact=false,limit=6,renderFeature}:{tags:T[];total?:number;compact?:boolean;limit?:number;renderFeature?:(tag:T)=>ReactNode}) {
  const [expanded,setExpanded]=useState(false);
  if(!tags.length)return null;
  const ordered=[...tags].sort((a,b)=>(a.focus||4)-(b.focus||4));
  const shown=expanded?ordered:ordered.slice(0,limit),remaining=Math.max(0,total-shown.length);
  return <div className={`object-features ${compact?'tag-summary':'tag-bindings'}`} role="group" aria-label="对象特征">
    {shown.map(tag=><React.Fragment key={tag.tag_id}>{renderFeature?renderFeature(tag):<TagChip tag={tag}/>}</React.Fragment>)}
    {remaining>0&&(compact||tags.length<=shown.length?<span className="tag-more" aria-label={`另有 ${remaining} 项特征`}>+{remaining}</span>:<button type="button" className="text-button object-features-toggle" aria-expanded={false} onClick={()=>setExpanded(true)}>展开其余 {remaining} 项</button>)}
    {!compact&&expanded&&ordered.length>limit&&<button type="button" className="text-button object-features-toggle" aria-expanded={true} onClick={()=>setExpanded(false)}>收起特征</button>}
  </div>;
}
