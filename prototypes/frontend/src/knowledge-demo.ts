import type {KnowledgeActivity,KnowledgeActivityPage,KnowledgeApi,KnowledgeTagProposal,KnowledgeVersion} from '../../../app/shared/knowledge';
// Preview data only. Formal identity, consent and persistence are enforced by the service.
export function knowledgeDemo():KnowledgeApi{
 const actor={id:'preview-member',name:'示例成员',kind:'member',can_write:true},at='2026-11-13T04:00:00.000Z',main:any={id:'main',name:'主分支',owner_id:actor.id,owner_name:actor.name,visibility:'members',state:'open',head_id:'preview-initial',base_head_id:null,version:1,created_at:at,updated_at:at};
 const branches:any[]=[main],categories:any[]=[{id:crypto.randomUUID(),name:'知性',definition:'理解经验、解释行为并形成判断的能力。',version:1,updated_at:at},{id:crypto.randomUUID(),name:'组织',definition:'表达共同活动中的需求与协作关系。',version:1,updated_at:at}];
 for(const c of categories)c.definition_version_id=crypto.randomUUID();
 const titles=['审核应该了解什么','验证目标的理论能力','从实际作品展开追问','已知信息不必重复询问','资料整理需要校对协作'],kinds=['共识','方法','方法','共识','需求'];
 const initial=titles.map((title,i)=>({id:crypto.randomUUID(),document_id:crypto.randomUUID(),title,body:i===0?'从参与意愿、能力与投入、协作与支持三个方面，梳理审核需要重点了解的内容。\n\n## 参与意愿\n了解对方加入的动机与期望，确认其对组织定位与现状有基本认识。\n\n## 能力与投入\n结合过往经历或作品判断实际水平。了解可以投入的时间与精力。\n\n## 协作与支持\n了解沟通方式与协作习惯，以及所需的资源、工具和指导。':['','通过提问、举例与小任务，了解理解深度。','围绕作品、经历与具体情境展开交流。','先整理已有材料，明确仍需了解的问题。','参与条件与联系入口见正文。'][i],category_id:categories[i===4?1:0].id,category_name:categories[i===4?1:0].name,kind:kinds[i],source:'',deleted:0,author_id:actor.id,author_name:actor.name,created_at:at}));
 const documents=new Map<string,any[]>([['main',initial]]),bases=new Map<string,any[]>(),comments:any[]=[],merges:any[]=[],issues:any[]=[],commits:any[]=[{id:main.head_id,branch_id:'main',parent_id:null,merge_parent_id:null,message:'示例共识',author_id:actor.id,author_name:actor.name,created_at:at}],changes=new Map<string,any[]>();
 changes.set(main.head_id,initial.map(after=>({document_id:after.document_id,before:null,after})));
 const tagProposals:KnowledgeTagProposal[]=[];
 const hasTag=(doc:KnowledgeVersion,id:string|null)=>doc.category_id===id || !!doc.tags?.some(tag=>tag.id===id);
 const version=()=>crypto.randomUUID(),date=()=>new Date().toISOString(),visible=(branch:string)=>documents.get(branch)??[],cats=(branch:string)=>categories.map(c=>({...c,count:visible(branch).filter(d=>!d.deleted&&hasTag(d,c.id)).length})).filter(c=>c.independent||c.count>0);
 function commit(branch:any,message:string,before:any,after:any){const id=version();commits.unshift({id,branch_id:branch.id,parent_id:branch.head_id,merge_parent_id:null,message,author_id:actor.id,author_name:actor.name,created_at:date()});changes.set(id,[{document_id:after.document_id,before,after}]);branch.head_id=id;branch.version++;return id;}
 const expires=()=>new Date(Date.now()+7*86400000).toISOString();
 const diff=(branch:string)=>branch==='main'?[]:visible(branch).filter(doc=>{
  const base=bases.get(branch)?.find(v=>v.document_id===doc.document_id);
  return base?.id!==doc.id&&(!doc.deleted||!!base&&!base.deleted);
 }).map(proposed=>({document_id:proposed.document_id,base:bases.get(branch)?.find(v=>v.document_id===proposed.document_id)??null,current:visible('main').find(v=>v.document_id===proposed.document_id)??null,proposed,conflict:false}));
 function reviewState(merge:any) {
  const current_head_id=branches.find(branch=>branch.id===merge.branch_id)?.head_id;
  const voting_closed=merge.state==='open'&&merge.expires_at<=date();
  const changes=merge.state==='open'&&merge.head_id===current_head_id?diff(merge.branch_id).map(({proposed})=>({
   document_id:proposed.document_id,title:proposed.title,deleted:!!proposed.deleted,
   tags:(proposed.tags??[]).map((tag:{id:string;name:string})=>({id:tag.id,name:tag.name,pending:categories.find(c=>c.id===tag.id)?.pending??0})),
  })):[];
  return {...merge,current_head_id,voting_closed,expired:voting_closed&&merge.approval_count<3,changes};
 }
 const active=(merge:any)=>merge.state==='open'&&merge.head_id===merge.current_head_id&&!merge.expired;
 const reviewed=(source:string)=>merges.some(row=>row.source_key===source&&(row.state==='merged'||active(reviewState(row))));
 function makeReview(branch:any,title:string,reason:string) {
  const at=date();
  return {id:version(),branch_id:branch.id,branch_name:branch.name,head_id:branch.head_id,title,reason,state:'open',
   approval_count:0,approved_by_me:0,approvers:[],author_id:actor.id,author_name:actor.name,version:1,created_at:at,updated_at:at,expires_at:expires()};
 }
 function reviewedDocument(branchId:string, documentId:string, reviewId:string|null, headId:string|null) {
  const review=reviewId&&merges.find(m=>m.id===reviewId&&m.branch_id===branchId&&m.head_id===headId);
  const branch=branches.find(b=>b.id===branchId&&b.state!=='closed');
  const doc=review&&branch?.head_id===headId&&diff(branchId).find(change=>change.document_id===documentId)?.proposed;
  if(!review||!doc)throw new Error('候选版本不存在、已更新或不可见');
  return {review,doc};
 }
 function ancestry(branchId:string) {
  const ids=new Set<string>();
  const pending=[branches.find(b=>b.id===branchId)?.head_id];
  while(pending.length){
   const id=pending.pop();
   if(!id||ids.has(id))continue;
   const commit=commits.find(c=>c.id===id);
   if(commit){ids.add(id);pending.push(commit.parent_id,commit.merge_parent_id);}
  }
  return commits.filter(c=>ids.has(c.id));
 }
 function acceptedReviews(branchId:string,documentId:string) {
  return ancestry(branchId).flatMap(commit=>{
   if(commit.branch_id!=='main'||!commit.merge_parent_id)return [];
   const review=merges.find(row=>row.state==='merged'&&row.head_id===commit.merge_parent_id&&row.merged_at===commit.created_at&&
    branches.find(branch=>branch.id===row.branch_id)?.visibility==='members');
   const doc=changes.get(commit.id)?.find(change=>change.document_id===documentId)?.after;
   return review&&doc?[{review,doc}]:[];
  });
 }
 function commentsForDocument(branchId:string,documentId:string,snapshot:ReturnType<typeof reviewedDocument>|null) {
  const accepted=branchId==='main'?acceptedReviews('main',documentId):[];
  return comments.filter(c=>c.document_id===documentId&&(
   c.branch_id===branchId&&(!snapshot||c.version_id===snapshot.doc.id)||
   accepted.some(({review,doc})=>review.branch_id===c.branch_id&&doc.id===c.version_id)
  ));
 }
 function documentActivity(q:URLSearchParams,branchId:string):KnowledgeActivityPage {
  const documentId=q.get('document_id')!;
  const snapshot=q.has('review_id')?reviewedDocument(branchId,documentId,q.get('review_id'),q.get('head_id')):null;
  const entries:KnowledgeActivity[]=[];
  for(const c of commentsForDocument(branchId,documentId,snapshot).filter(c=>!c.quote)){
   entries.push({kind:'comment',id:'comment:'+c.id,comment_id:c.id,created_at:c.created_at,author_id:c.author_id,author_name:c.author_name,
    body:c.body,parent_author_name:comments.find(parent=>parent.id===c.parent_id)?.author_name??null});
  }
  const versions=ancestry(branchId).filter(c=>changes.get(c.id)?.some(change=>change.document_id===documentId&&
   (!snapshot||c.branch_id===branchId&&change.after.id===snapshot.doc.id)));
  if(snapshot?.review.state==='merged'){
   const merged=ancestry('main').find(c=>c.merge_parent_id===snapshot.review.head_id&&c.created_at===snapshot.review.merged_at&&
    changes.get(c.id)?.some(change=>change.document_id===documentId&&change.after.id===snapshot.doc.id));
   if(merged)versions.push(merged);
  }
  const reviews=snapshot?[snapshot]:acceptedReviews(branchId,documentId);
  const submittedCommits=new Map(reviews.filter(({review})=>review.auto_promote)
   .map(({review})=>[review.id,versions.find(c=>c.id===review.head_id)]));
  for(const c of versions){
   if([...submittedCommits.values()].includes(c))continue;
   const merged=c.branch_id==='main'&&!!c.merge_parent_id;
   entries.push({kind:merged?'merge':'commit',id:'commit:'+c.id,created_at:c.created_at,author_id:c.author_id,author_name:c.author_name,
    body:c.message,commit_id:c.id,commit_branch_id:merged?'main':null});
  }
  for(const {review:m} of reviews){
   const submittedCommit=submittedCommits.get(m.id);
   entries.push({kind:'submission',id:'submission:'+m.id,created_at:submittedCommit?.created_at??m.created_at,author_id:m.author_id,author_name:m.author_name,
    body:m.reason,commit_id:submittedCommit?.id??null,commit_branch_id:null});
   for(const a of m.approvers){
    entries.push({kind:'approval',id:'approval:'+m.id+':'+a.id,created_at:a.created_at,author_id:a.id,author_name:a.name,
     body:null,commit_id:null,commit_branch_id:null});
   }
  }
  entries.sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
  return {entries,next_cursor:null};
 }
 return {async read<T=any>(path:string):Promise<T>{const url=new URL(path,'https://preview.invalid'),q=url.searchParams,b=q.get('branch_id')??'main';let result:any;
  if(url.pathname==='/branches')result={branches:branches.filter(b=>b.state!=='closed'),identity:actor};
  else if(url.pathname==='/documents'){
   const scope=q.get('scope'),term=(q.get('search')??'').toLowerCase(),categoryId=q.get('category_id');
   const selected=scope==='drafts'?branches.filter(x=>x.visibility==='private'&&x.owner_id===actor.id&&x.state==='open'):
    scope==='public'?branches.filter(x=>merges.some(row=>{const review=reviewState(row);return review.branch_id===x.id&&active(review)&&review.changes.length===1;})):
    branches.filter(x=>x.id===(scope==='main'?'main':b));
   const all=selected.flatMap(x=>visible(x.id).filter(d=>!d.deleted&&(!['drafts','public'].includes(scope??'')||!bases.get(x.id)?.some(v=>v.id===d.id))&&(scope!=='drafts'||!reviewed(x.id+':'+d.id))).map(d=>({...d,branch_id:x.id})));
   const rows=all.filter(d=>(!categoryId||hasTag(d,categoryId))&&[d.title,d.body].some(value=>value.toLowerCase().includes(term)));
   rows.sort((a,b)=>b.created_at.localeCompare(a.created_at));
   const offset=Number(q.get('offset')??0),limit=Number(q.get('limit')??40);
   result={branch:branches.find(x=>x.id===b),documents:rows.slice(offset,offset+limit),next_offset:rows.length>offset+limit?offset+limit:null,
    categories:categories.map(c=>{const tagged=all.filter(d=>hasTag(d,c.id));return {...c,count:tagged.length,branch_id:tagged[0]?.branch_id};}).filter(c=>c.independent||c.count)};
  }
  else if(url.pathname.startsWith('/documents/'))result={document:visible(b).find(d=>d.document_id===url.pathname.split('/').pop())};
  else if(url.pathname==='/tag-proposals')result={proposals:tagProposals.filter(p=>p.state==='pending'&&p.expires_at>date())};
  else if(url.pathname.startsWith('/tag-proposals/')){
   const proposal=tagProposals.find(p=>p.id===url.pathname.split('/').pop());
   if(!proposal)throw new Error('找不到这份标签提议。');
   result={proposal:{...proposal,state:proposal.state==='pending'&&proposal.expires_at<=date()?'expired':proposal.state}};
  }
  else if(url.pathname==='/categories')result={categories:cats(b)};
  else if(url.pathname==='/comments'){
   const documentId=q.get('document_id');
   const snapshot=documentId&&q.has('review_id')?reviewedDocument(b,documentId,q.get('review_id'),q.get('head_id')):null;
   const rows=documentId?commentsForDocument(b,documentId,snapshot):comments.filter(c=>
    ['category_id','issue_id'].every(k=>!q.get(k)||c[k]===q.get(k))&&(!q.get('branch_id')||c.branch_id===b));
   result={comments:q.has('annotations')?rows.filter(c=>c.quote).reverse():rows,next_offset:null};
  }
  else if(url.pathname==='/activity')result=documentActivity(q,b);
  else if(url.pathname==='/merges'){
   const term=(q.get('search')??'').toLowerCase();
   result={merges:merges.filter(m=>branches.find(b=>b.id===m.branch_id)?.state!=='closed').map(reviewState).map(review=>{
    if(!term)return review;
    const proposed=active(review)?diff(review.branch_id).flatMap(({proposed})=>[proposed.title,proposed.body,...(proposed.tags??[]).map((tag:{name:string})=>tag.name)]):[];
    const matches=[review.title,review.reason,...proposed].some(value=>value.toLowerCase().includes(term));
    return {...review,matches_search:Number(matches)};
   }).sort((a,b)=>b.updated_at.localeCompare(a.updated_at))};
  }
  else if(url.pathname==='/issues')result={issues,next_offset:null};
  else if(url.pathname.startsWith('/issues/'))result={issue:issues.find(i=>i.id===url.pathname.split('/').pop())};
  else if(url.pathname.startsWith('/history/')){
   const id=url.pathname.split('/').pop()!, documentId=q.get('document_id'),commit=ancestry(b).find(c=>c.id===id);
   if(!commit)throw new Error('版本不存在或不可见');
   result={commit,changes:(changes.get(id)??[]).filter(change=>!documentId||change.document_id===documentId)};
  }
  else if(url.pathname==='/history')result={commits:ancestry(b),next_offset:null};
  else if(url.pathname==='/diff')result={branch:branches.find(x=>x.id===b),main,changes:diff(b)};
  else result={result:null};return structuredClone(result) as T;
 },async write<T=any>(path:string,input:Record<string,unknown>):Promise<T>{const a:any=input,b=branches.find(b=>b.id===a.branch_id);let result:any={};
  if(path==='/branches'){const created={...main,id:version(),name:a.name,visibility:a.visibility??'members',base_head_id:main.head_id,version:1,updated_at:date()};branches.push(created);documents.set(created.id,structuredClone(visible('main')));bases.set(created.id,structuredClone(visible('main')));result={id:created.id,version:1};}
  else if(path==='/branches/delete'){if(!b||b.id==='main'||b.owner_id!==actor.id)throw new Error('不能删除这个分支');if(b.version!==a.expected_version)throw new Error('分支已变化，请刷新后核对');b.state='closed';b.version++;for(const m of merges)if(m.branch_id===b.id&&m.state==='open'){m.state='closed';}result={id:b.id,version:b.version,deleted:true};}
  else if(path==='/documents'){if(a.branch_id==='main')throw new Error('请在分支中修改');let category=categories.find(c=>c.name===a.category);if(!category){category={id:version(),name:a.category,definition:'',version:1,updated_at:date()};categories.push(category);}const rows=visible(a.branch_id),old=rows.find(d=>d.document_id===a.document_id),doc={...a,id:version(),document_id:a.document_id??version(),category_id:category.id,category_name:category.name,tags:[category,...(a.additional_tags??[]).map((name:string)=>categories.find(c=>c.name===name)).filter(Boolean)].map(c=>({id:c.id,name:c.name,pending:c.pending})),deleted:0,author_id:actor.id,author_name:actor.name,created_at:date()};documents.set(a.branch_id,[...rows.filter(d=>d.document_id!==doc.document_id),doc]);const id=commit(b,a.message,old,doc);result={id:doc.document_id,version:b.version,commit_id:id};}
  else if(path==='/comments'){
   const snapshot=a.review_id?reviewedDocument(a.branch_id,a.document_id,a.review_id,a.head_id):null;
   const parent=comments.find(c=>c.id===a.parent_id);
   const branchId=a.branch_id??'main';
   if(a.document_id&&a.parent_id&&!commentsForDocument(branchId,a.document_id,snapshot).includes(parent))throw new Error('回复对象不属于这篇文档的讨论');
   const doc=snapshot?.doc??(a.category_id?{body:categories.find(c=>c.id===a.category_id)?.definition}:visible(branchId).find(d=>d.document_id===a.document_id));
   const row={id:version(),document_id:null,category_id:null,issue_id:null,parent_id:null,
    quote:null,start_offset:null,end_offset:null,version_id:a.document_id?doc?.id??null:null,prefix:null,suffix:null,
    ...(parent?{quote:parent.quote,version_id:parent.version_id,start_offset:parent.start_offset,end_offset:parent.end_offset,prefix:parent.prefix,suffix:parent.suffix}:{}),
    ...a,branch_id:a.document_id?parent?.branch_id??branchId:a.branch_id??null,
    author_id:actor.id,author_name:actor.name,created_at:date()};
   if(a.quote){row.prefix=doc.body.slice(Math.max(0,a.start_offset-40),a.start_offset);row.suffix=doc.body.slice(a.end_offset,a.end_offset+40);}
   comments.push(row);result={id:row.id};
  }
  else if(path==='/categories'||path==='/categories/definition'){
    let c=categories.find(c=>c.id===a.id);
    if(!c){c={id:version(),name:a.name,definition:a.definition,version:1,pending:1,independent:1,updated_at:date()};categories.push(c);}
    const p:KnowledgeTagProposal={id:version(),category_id:c.id,name:a.name??c.name,definition:a.definition,current_name:c.name,current_definition:c.definition,
      pending:c.pending??0,state:'pending',author_id:actor.id,author_name:actor.name,created_at:date(),expires_at:expires(),approval_count:0,approved_by_me:0,approvers:[]};
    tagProposals.push(p);result={id:c.id,version:c.version,pending:c.pending,proposal_id:p.id,expires_at:p.expires_at};
  }
  else if(path==='/tag-proposals/approve'){
    const p=tagProposals.find(t=>t.id===a.id);
    if(!p||p.state!=='pending'||p.expires_at<=date())throw new Error('本轮标签认可已结束');
    if(!p.approved_by_me){
      p.approval_count++;
      p.approved_by_me=1;
      p.approvers.push({id:actor.id,name:actor.name,created_at:date()});
    }
    if(p.approval_count>=3){
      p.state='approved';
      const tag=categories.find(c=>c.id===p.category_id);
      Object.assign(tag,{name:p.name,definition:p.definition,pending:0,version:tag.version+1,updated_at:date()});
    }
    result={id:p.id,approval_count:p.approval_count,approved_by_me:1,adopted:p.state==='approved'};
  }
  else if(path==='/reviews'){
   const doc=visible(a.branch_id).find(d=>d.document_id===a.document_id);
   if(!b||b.version!==a.expected_version||!doc||doc.id!==a.version_id)throw new Error('草稿内容已变化，请重新核对');
   const source_key=b.id+':'+doc.id;
   const existing=merges.find(row=>row.source_key===source_key&&(row.state==='merged'||active(reviewState(row))));
   if(existing) result={id:existing.id,branch_id:existing.branch_id,head_id:existing.head_id,document_id:doc.document_id,expires_at:existing.expires_at};
   else {
    const created={...main,id:version(),name:doc.title+' · '+version().slice(0,6),visibility:'members',version:1};
    branches.push(created);
    bases.set(created.id,structuredClone(visible('main')));
    documents.set(created.id,[...structuredClone(visible('main')).filter(d=>d.document_id!==doc.document_id),doc]);
    commit(created,a.reason||'提交审核',visible('main').find(d=>d.document_id===doc.document_id),doc);
    const m={...makeReview(created,doc.title,a.reason||'提交审核'),auto_promote:1,source_key};
    merges.push(m);
    result={id:m.id,branch_id:m.branch_id,head_id:m.head_id,document_id:doc.document_id,expires_at:m.expires_at};
   }
  }
  else if(path==='/issues/from-comment'){const c=comments.find(c=>c.id===a.comment_id),cat=categories.find(x=>x.id===c.category_id),doc=visible(c.branch_id).find(d=>d.document_id===c.document_id),row={...a,id:version(),number:issues.length+1,state:'open',author_id:actor.id,author_name:actor.name,version:1,source_json:JSON.stringify({kind:cat?'category':'document',title:cat?.name??doc?.title,quote:c.quote,comment:c.body,author_name:c.author_name})};issues.unshift(row);result={id:row.id};}
  else if(path==='/issues'){const row={...a,id:version(),number:issues.length+1,state:'open',author_id:actor.id,author_name:actor.name,version:1,resolution:'',created_at:date(),updated_at:date()};issues.unshift(row);result={id:row.id};}
  else if(path==='/issues/state'){Object.assign(issues.find(i=>i.id===a.id),a);result={id:a.id};}
  else if(path==='/merges'){
   if(!b||b.visibility!=='members'||b.version!==a.expected_version)throw new Error('分支已变化，请重新核对');
   if(diff(b.id).length!==1)throw new Error('审核须按文档分别提交');
   const old=merges.find(row=>row.branch_id===b.id&&row.state==='open');
   let m=old;
   if(!m||reviewState(m).expired&&m.head_id===b.head_id){
    if(m)m.state='closed';
    m=makeReview(b,a.title,a.reason);
    merges.push(m);
   }else{
    const newHead=m.head_id!==b.head_id;
    Object.assign(m,{head_id:b.head_id,title:a.title,reason:a.reason,updated_at:date(),version:m.version+1});
    if(newHead)Object.assign(m,{approval_count:0,approved_by_me:0,approvers:[],expires_at:expires()});
   }
   result={id:m.id,head_id:m.head_id,expires_at:m.expires_at};
  }
  else if(path==='/merges/approve'){
   const m=merges.find(row=>row.id===a.id),state=m&&reviewState(m);
   if(!state||!active(state)||state.head_id!==a.head_id||state.voting_closed)throw new Error('审核已更新或投票已截止');
   if(!m.approved_by_me){m.approval_count++;m.approved_by_me=1;m.approvers=[{id:actor.id,name:actor.name,created_at:date()}];}
   result={id:m.id,approval_count:m.approval_count,merged:false};
  }
  else if(path==='/documents/remove'){const rows=visible(a.branch_id),old=rows.find(d=>d.document_id===a.document_id),doc={...old,id:version(),deleted:1};documents.set(b.id,rows.map(d=>d.document_id===doc.document_id?doc:d));commit(b,a.message,old,doc);}
  else throw new Error('此操作请在连接真实接口的验收环境中验证');return structuredClone(result) as T;
 }};
}
