export type KnowledgeBranch={id:string;name:string;owner_id:string;owner_name:string;visibility:'members'|'private';state:'open'|'merged'|'closed';head_id:string|null;base_head_id:string|null;version:number;created_at:string;updated_at:string};
export type KnowledgeCategory={id:string;name:string;definition:string;version:number;count:number;updated_at:string};
export type KnowledgeVersion={id:string;document_id:string;title:string;body:string;category_id:string|null;category_name?:string|null;kind:string;source:string;deleted:number;author_id:string;author_name:string;created_at:string};
export type KnowledgeComment={id:string;branch_id:string|null;document_id:string|null;category_id:string|null;issue_id:string|null;parent_id:string|null;version_id:string|null;quote:string|null;start_offset:number|null;end_offset:number|null;prefix:string|null;suffix:string|null;body:string;author_id:string;author_name:string;created_at:string};
export type KnowledgeCommit={id:string;branch_id:string;parent_id:string|null;merge_parent_id:string|null;message:string;author_id:string;author_name:string;created_at:string};
export type KnowledgeMerge={id:string;branch_id:string;branch_name:string;head_id:string;current_head_id:string|null;title:string;reason:string;state:'open'|'merged'|'closed';author_id:string;author_name:string;version:number;created_at:string;updated_at:string;merged_at:string|null;selection_json:string|null;approval_count:number;approved_by_me:number};
export type KnowledgeIssue={id:string;number:number;title:string;body:string;document_id:string|null;state:'open'|'closed';author_id:string;author_name:string;version:number;resolution:string;selected_merge_id:string|null;candidates_json:string|null;created_at:string;updated_at:string};
export type KnowledgeIdentity={id:string;name:string;kind:'member'|'guest';can_write:boolean};
export type KnowledgeDiff={document_id:string;base:KnowledgeVersion|null;current:KnowledgeVersion|null;proposed:KnowledgeVersion;conflict:boolean};
export type KnowledgeApi={read<T=any>(path:string):Promise<T>;write<T=any>(path:string,body:Record<string,unknown>):Promise<T>};

// Offsets use JavaScript UTF-16, exactly like DOM Range. A changed quote is never guessed.
export function locateAnnotation(body:string,comment:KnowledgeComment,versionId:string):{start:number;end:number}|null{
 if(!comment.quote||comment.start_offset===null||comment.end_offset===null)return null;
 if(comment.version_id===versionId&&body.slice(comment.start_offset,comment.end_offset)===comment.quote)return {start:comment.start_offset,end:comment.end_offset};
 const matches:number[]=[];let position=body.indexOf(comment.quote);
 while(position!==-1){matches.push(position);position=body.indexOf(comment.quote,position+1);}
 if(matches.length===1)return {start:matches[0],end:matches[0]+comment.quote.length};
 const exact=matches.filter(start=>(!comment.prefix||body.slice(Math.max(0,start-comment.prefix.length),start)===comment.prefix)&&(!comment.suffix||body.slice(start+comment.quote!.length,start+comment.quote!.length+comment.suffix.length)===comment.suffix));
 return exact.length===1?{start:exact[0],end:exact[0]+comment.quote.length}:null;
}
