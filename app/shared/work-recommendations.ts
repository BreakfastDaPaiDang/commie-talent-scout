export type RecommendationKind='resource'|'person'|'task';
export type RecommendationTarget={kind:RecommendationKind;id:string;version:number;name:string;text:string;conditions:string[]};
export type WorkRecommendation=RecommendationTarget&{matches:string[];reason:string;fingerprint:string};
export type RecommendationEvidence={id:string;content_version:number;body:string;created_at:string};
export type RecommendationData={archive_version:number;evidence:RecommendationEvidence|null;candidates:WorkRecommendation[];assignees:{id:string;name:string}[];actor_id:string;accepted:{task_id:string;title:string;status:string;owner_name:string|null;result_text:string|null;target_name:string;target_kind:RecommendationKind;target_id:string;content_version:number;observation_id:string}[]};
export type RecommendationAcceptance={archive_id:string;title:string;purpose:string;delivery:string;deadline_at:string;handoff:{observation_id:string;content_version:number;target_kind:RecommendationKind;target_id:string;target_version:number;target_fingerprint:string;owner_id:string}};
export type RecommendationAPI={load:(archiveId:string,observationId?:string)=>Promise<RecommendationData>;accept:(input:RecommendationAcceptance)=>Promise<{id:string;reused?:boolean}>};

// Deliberately lexical: a shared topic is a reason to investigate, not proof of suitability.
const ignored=new Set('需要 希望 想要 最近 目前 已经 可以 参与 工作 项目 帮助 支持 联系 对接 情况 记录 观察 人员 资源 自己 一个 一些 这个 那个 我们 他们 对方 时间 进行 学习 愿意 没有 不想 不会 不能 暂时 能够 有人 本次 实际 相关 提供 找到 了解'.split(' '));
export function matchingTerms(body:string,text:string):string[]{
 const segments=new Intl.Segmenter('zh-CN',{granularity:'word'});
 const normalized=body.normalize('NFKC').toLowerCase(),words=[...segments.segment(normalized)];
 const terms=words.filter(s=>s.isWordLike).map(s=>s.segment);
 // ICU sometimes splits a Chinese word such as 剪辑 into individual characters.
 for(let i=0;i<words.length-1;i++)if(/^\p{Script=Han}$/u.test(words[i].segment)&&/^\p{Script=Han}$/u.test(words[i+1].segment))terms.push(words[i].segment+words[i+1].segment);
 const haystack=text.normalize('NFKC').toLowerCase();
 return [...new Set(terms)].filter(t=>t.length>=2&&!ignored.has(t)&&!/^\d+$/.test(t)&&haystack.includes(t)).filter(t=>{
  const index=normalized.lastIndexOf(t),before=normalized.slice(Math.max(0,index-12),index);
  return !/(?:不想|不愿|不再|拒绝|不需要|不考虑|不适合|暂不|无法|没兴趣|不感兴趣)[^，。；！？\n]{0,4}$/.test(before);
 }).slice(0,6);
}
export async function recommendFromObservation(evidence:RecommendationEvidence,targets:RecommendationTarget[]):Promise<WorkRecommendation[]>{
 const ranked=targets.map(t=>{const matches=matchingTerms(evidence.body,t.name+' '+t.text);return {...t,matches,reason:`观察与候选资料均提及「${matches.join('、')}」`};}).filter(t=>t.matches.length>0).sort((a,b)=>b.matches.length-a.matches.length||a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
 return Promise.all(ranked.map(async candidate=>({...candidate,fingerprint:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(candidate))))].map(b=>b.toString(16).padStart(2,'0')).join('')})));
}
