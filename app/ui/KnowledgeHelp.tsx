import React,{useEffect,useId,useRef,useState} from 'react';
import {Modal} from './Modal';

export type KnowledgeHelpTopic='reading'|'publishing'|'comments'|'categories'|'branches'|'issues'|'history';
type HelpEntry={label:string;description:string;members?:boolean};
type HelpSection={id:KnowledgeHelpTopic;title:string;entries:HelpEntry[];members?:boolean};

const sections:HelpSection[]=[
 {id:'reading',title:'阅读与查找',entries:[
  {label:'简 / 繁',description:'简适合阅读；繁增加页面导航和分支切换。两种视图使用同一份内容，切换不会发布或修改文档。'},
  {label:'主要',description:'查看主分支中已经通过共同认可的现行内容。日常引用以这里为准。'},
  {label:'公开',description:'查看面向正式成员的候审文档。公开并不表示已经通过审核。',members:true},
  {label:'草稿',description:'查看自己尚未提交的私人草稿；其他成员看不到这些内容。',members:true},
  {label:'搜索框',description:'在当前范围内搜索文档标题和正文，可与分类筛选一起使用。'},
  {label:'全部 / 分类名称',description:'点击类别筛选文档；点击“全部”清除分类筛选。搜索无结果不会删除分类。'},
  {label:'条目卡片 / 内容',description:'点击左侧条目打开正文；繁模式的“内容”返回当前文档。手机点击“← 条目”返回列表。'},
  {label:'分享',description:'复制当前文档的链接。收到链接的人仍需具有相应的阅读权限；分享链接不会公开私人草稿。'},
  {label:'加载更多条目',description:'接着读取当前范围内尚未显示的条目。'},
 ]},
 {id:'publishing',title:'草稿与审核',members:true,entries:[
  {label:'＋ 新条目',description:'填写分类、条目类型、标题、正文和修改说明，创建自己的草稿。来源可以不填。'},
  {label:'建议修改 / 在分支中修改',description:'编辑当前文档。从主分支发起时先建立私人草稿；已有可修改分支则保存到该分支。改写公开候审内容后，需要重新提交并重新征求同意。'},
  {label:'保存草稿 / 保存到分支',description:'保存这次修改。保存本身不会使文档通过审核，也不会直接改写主分支。'},
  {label:'提交到审核',description:'草稿正文底部的红色按钮。打开提交页，核对当前这一篇文档和提交说明。'},
  {label:'公开并提交审核',description:'确认后将这一篇快照公开给正式成员审核。同分支的其他私人草稿、批注和中间历史不会随之公开。'},
  {label:'点赞同意 / 已点赞',description:'表示本人认可当前提交。同一人只计一次，作者不会自动获得一票；内容修改后，旧同意不能用于新版本。'},
  {label:'查看审核',description:'进入分支页查看同意数、变更对比及尚未合入的原因。新单篇审核获得三名不同正式成员同意，且没有冲突或并行候选时自动进入主分支。'},
  {label:'移除文档 / 确认移除',description:'从当前非主分支移除这篇文档，需要填写理由。主分支在合入前保持原状，历史版本保留。'},
 ]},
 {id:'comments',title:'评论与批注',entries:[
  {label:'文末评论 / 发送',description:'在文档下方写一般讨论，点击“发送”发布；分类留言和议题讨论也使用同样的操作。',members:true},
  {label:'回复',description:'在对应评论下继续讨论；回复不会改写正文。',members:true},
  {label:'圈选文字 → 批注',description:'拖选一句或一段原文，手机长按选字，再点浮出的“批注”。输入框会出现在引用原句下方。分类解释也可这样批注。',members:true},
  {label:'发布批注 / 取消批注',description:'输入框旁的箭头发布批注，也可按 Ctrl 或 Command + Enter；× 取消本次输入。',members:true},
  {label:'引用原文 / 批注框',description:'点击引用原文或对应批注，对应文段会加粗，方便对照。点击别处或按 Esc 恢复。'},
  {label:'复制',description:'选中文字后，浮出的“复制”只复制选中的原文。'},
  {label:'回复批注 / 发起议题',description:'右键批注框，手机长按批注框，或聚焦后按 Shift + F10 打开菜单。“发起议题”会保留原引用和批注，供进一步讨论。私人分支中的批注需先共享来源分支，才能发为成员议题。',members:true},
  {label:'原文已变更的批注',description:'展开查看无法继续定位的旧批注及原引用；这些批注不会被错误挂到其他句子下。'},
 ]},
 {id:'categories',title:'分类与解释',entries:[
  {label:'分类旁的 ＋',description:'单独创建分类，填写名称和解释，不必同时创建文档。独立创建的空分类会保留。',members:true},
  {label:'右键分类 / 长按分类',description:'打开这个类别的解释与留言侧栏。也可聚焦类别后按 Shift + F10；侧栏不会常驻。'},
  {label:'编辑分类（铅笔）',description:'在分类侧栏修改名称与解释。改名不会切断已有文档的分类关系，解释可以圈选批注。',members:true},
  {label:'创建分类 / 保存分类',description:'保存分类名称与解释；解释更新后，已有批注仍保留原引用。',members:true},
  {label:'关闭分类侧栏（×）',description:'收起定义与留言。点击侧栏外部也可以关闭。'},
 ]},
 {id:'branches',title:'分支与合并',members:true,entries:[
  {label:'当前分支',description:'繁模式左上方的下拉框用于切换正在查看的分支。“主分支”是现行共识，标有“私人”的分支只对作者可见。'},
  {label:'分支',description:'打开分支页，查看分支图、变更对比、合并请求和当前所处分支；切换分支不会改变主分支内容。'},
  {label:'＋ 新建分支 / 新建分支',description:'输入名称，从当前主分支建立一份可独立修改的分支。这个入口新建的是正式成员可见分支；普通“新条目”会先建立私人草稿。'},
  {label:'共享此分支 / 确认共享',description:'由创建者把私人分支整体开放给正式成员，包含其中的全部文档和批注。只想公开单篇时，使用正文底部的“提交到审核”。'},
  {label:'提交合并请求 / 更新合并请求 / 提交',description:'把整个分支的当前修改提交给成员认可，填写标题和理由。修改内容后需更新请求，旧版本的票不会带到新版本。'},
  {label:'同意这次修改 / 我已同意',description:'对当前整分支提交表达同意。同意绑定这次具体修改，不是对这个分支今后所有内容的授权。'},
  {label:'合入主分支 / 确认合入',description:'至少三名不同正式成员同意且没有内容冲突后，才可确认合入。若有多个达标候选，需记录会议结论或选择已有结论的议题；其他候选保留。整分支请求需要明确执行合入。'},
  {label:'保留主分支版本 / 保留分支版本',description:'出现冲突时，明确这一篇文档采用哪一侧内容；处理后需更新合并请求，重新征求同意。'},
  {label:'删除分支 / 确认删除',description:'只有当前正式成员中的分支创建者可以删除自己的非主分支。确认后关闭未完成审核，保留已合入主分支的内容和历史。删除候审分支后，原私人草稿仍在时可以再次提交。'},
 ]},
 {id:'issues',title:'议题与结论',members:true,entries:[
  {label:'议题 / 查看议题',description:'讨论需要单独澄清的问题、规则或候选方案。议题本身不会修改知识文档。'},
  {label:'＋ 新议题 / 提交议题',description:'写明标题、问题与依据，发起成员讨论；也可以从某条批注发起并保留来源。'},
  {label:'议题条目 / ← 全部议题',description:'点击条目阅读问题与讨论；“← 全部议题”返回列表。'},
  {label:'记录结论 / 保存结论',description:'写下讨论结论并关闭议题。涉及多个达标候选时可选定合入对象，但保存结论不会替代分支页的合入操作。'},
  {label:'重新开启',description:'让已关闭的议题重新进入讨论，必要时填写说明。'},
 ]},
 {id:'history',title:'历史与通用操作',entries:[
  {label:'历史 / 历史版本',description:'查看当前可见分支的提交记录；点击某条记录阅读当时的修改内容，不会恢复或覆盖现行版本。'},
  {label:'更早的记录 / 加载更多',description:'继续查看尚未显示的历史或议题，不改变已有内容。'},
  {label:'取消 / 关闭对话框（×）',description:'退出当前弹窗，不提交本次输入。保存进行中需等待操作结束。'},
  {label:'重试',description:'重新读取未能加载的内容。'},
  {label:'关闭提示（×）',description:'收起操作提示，不撤销已经成功保存的结果。'},
  {label:'右上角的 ？',description:'随时打开本教程。可以按按钮名称搜索；关闭后回到刚才的位置。'},
 ]},
];

export function KnowledgeHelpButton({onClick,list=false}:{onClick:()=>void;list?:boolean}){
 return <button type="button" className={'kb-help-button'+(list?' kb-list-help':'')} aria-label="知识库教程" title="知识库教程" aria-haspopup="dialog" onClick={onClick}><span aria-hidden="true">?</span></button>;
}

export function KnowledgeHelp({topic,writable,close}:{topic:KnowledgeHelpTopic;writable:boolean;close:()=>void}){
 const [search,setSearch]=useState(''),[expanded,setExpanded]=useState<KnowledgeHelpTopic|null>(topic),intro=useRef<HTMLDivElement>(null),id=useId();
 useEffect(()=>{intro.current?.focus({preventScroll:true});},[]);
 const query=search.trim().toLocaleLowerCase(),allowed=sections.filter(s=>writable||!s.members).map(s=>({...s,entries:s.entries.filter(e=>writable||!e.members)})),labelMatch=!!query&&allowed.some(s=>s.entries.some(e=>e.label.toLocaleLowerCase().includes(query)));
 const visible=allowed.map(s=>({...s,entries:s.entries.filter(e=>!query||(labelMatch?e.label:s.title+' '+e.label+' '+e.description).toLocaleLowerCase().includes(query))})).filter(s=>s.entries.length);
 return <Modal title="知识库使用教程" onClose={close}><div className="kb-help" onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.preventDefault();e.stopPropagation();close();}}}>
  <div ref={intro} tabIndex={-1} className="kb-help-intro">
   {writable?<><ol className="kb-help-flow" aria-label="文档成为共识的流程"><li>草稿</li><li>公开审核</li><li>主分支</li></ol><p>主分支是现行已通过的知识。新单篇审核需三名不同正式成员同意；没有冲突或并行候选时自动合入。</p><p>多个达标候选保留并存，通过会议或议题确定本次合入对象。</p></>:<p>你可以阅读主分支已通过的文档、评论与历史。编辑、评论、提交和投票仅向正式成员开放。</p>}
  </div>
  <label className="kb-help-search">查找按钮<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="输入按钮名称或想做的事"/></label>
  <div className="kb-help-sections">{visible.map(section=>{const open=!!query||expanded===section.id;return <section key={section.id}><h3><button type="button" aria-expanded={open} aria-controls={id+'-'+section.id} onClick={()=>{if(query){setSearch('');setExpanded(section.id);}else setExpanded(open?null:section.id);}}>{section.title}<span aria-hidden="true">{open?'−':'＋'}</span></button></h3><dl id={id+'-'+section.id} hidden={!open}>{section.entries.map(entry=><div key={entry.label}><dt>{entry.label}</dt><dd>{entry.description}</dd></div>)}</dl></section>;})}{!visible.length&&<p role="status" className="kb-help-no-results">没有找到相关说明，试试“批注”“提交”或“历史”。</p>}</div>
 </div></Modal>;
}
