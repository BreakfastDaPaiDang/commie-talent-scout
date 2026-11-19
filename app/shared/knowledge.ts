export type KnowledgeBranch={id:string;name:string;owner_id:string;owner_name:string;visibility:'members'|'private';state:'open'|'merged'|'closed';head_id:string|null;base_head_id:string|null;version:number;created_at:string;updated_at:string};
export type KnowledgeCategory={id:string;name:string;definition:string;version:number;count:number;updated_at:string;independent?:number;pending?:number;definition_version_id?:string|null;branch_id?:string};
export type KnowledgeVersion={id:string;branch_id?:string;document_id:string;title:string;body:string;category_id:string|null;category_name?:string|null;tags?:{id:string;name:string;pending?:number}[];kind:string;source:string;deleted:number;author_id:string;author_name:string;created_at:string};
export type KnowledgeComment={id:string;branch_id:string|null;document_id:string|null;category_id:string|null;issue_id:string|null;parent_id:string|null;version_id:string|null;quote:string|null;start_offset:number|null;end_offset:number|null;prefix:string|null;suffix:string|null;body:string;author_id:string;author_name:string;created_at:string};
export type KnowledgeCommit={id:string;branch_id:string;parent_id:string|null;merge_parent_id:string|null;message:string;author_id:string;author_name:string;created_at:string};
export type KnowledgeCommitDetail = {
  commit: KnowledgeCommit;
  changes: {document_id: string; before: KnowledgeVersion | null; after: KnowledgeVersion | null}[];
};
export type KnowledgeDocumentTarget = {
  branch_id: string;
  document_id: string;
  review_id?: string;
  head_id?: string;
};
export type KnowledgeActivity = {
  id: string;
  author_id: string;
  author_name: string | null;
  created_at: string;
} & (
  {kind: 'comment'; body: string; comment_id: string; parent_author_name: string | null} |
  {kind: 'commit' | 'submission' | 'approval' | 'merge'; body: string | null; commit_id: string | null; commit_branch_id: string | null}
);
export type KnowledgeActivityPage = {entries: KnowledgeActivity[]; next_cursor: string | null};
export type KnowledgeMerge={id:string;branch_id:string;branch_name:string;head_id:string;current_head_id:string|null;title:string;reason:string;state:'open'|'merged'|'closed';author_id:string;author_name:string;version:number;created_at:string;updated_at:string;merged_at:string|null;selection_json:string|null;approval_count:number;approvers?:{id:string;name:string;created_at:string}[];approved_by_me:number;auto_promote?:number;expires_at?:string|null;expired?:boolean;voting_closed?:boolean;changes?:KnowledgeReviewDocument[];matches_search?:number};
export type KnowledgeIssue={id:string;number:number;title:string;body:string;document_id:string|null;state:'open'|'closed';author_id:string;author_name:string;version:number;resolution:string;selected_merge_id:string|null;candidates_json:string|null;created_at:string;updated_at:string;category_id?:string|null;source_comment_id?:string|null;source_json?:string|null};
export type KnowledgeIdentity={id:string;name:string;kind:'member'|'guest';can_write:boolean};
export type KnowledgeReviewDocument={document_id:string;title:string;tags:{id:string;name:string;pending?:number}[];deleted:boolean};
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

export type KnowledgeTagProposal = {
  id: string;
  category_id: string;
  name: string;
  definition: string;
  current_name: string;
  current_definition: string;
  pending: number;
  author_id: string;
  author_name: string;
  created_at: string;
  expires_at: string;
  state: 'pending' | 'approved' | 'expired';
  approvers: {id: string; name: string; created_at: string}[];
  approval_count: number;
  approved_by_me: number;
};

export function remainingVoteTime(deadline:string, now:number) {
  const minutes=Math.max(0,Math.ceil((Date.parse(deadline)-now)/60_000));
  if (!minutes) return '投票已截止';
  if (minutes<60) return '剩 '+minutes+' 分钟';
  const hours=Math.ceil(minutes/60);
  if (hours<24) return '剩 '+hours+' 小时';
  const remainder=hours%24;
  return '剩 '+Math.floor(hours/24)+' 天'+(remainder?' '+remainder+' 小时':'');
}
