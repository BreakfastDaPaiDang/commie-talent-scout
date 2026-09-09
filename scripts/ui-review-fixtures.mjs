import {createHash} from 'node:crypto';
import {initialEntities,initialMembers,isClosed} from '../prototypes/frontend/src/model.js';
export const uuid=value=>{const h=createHash('sha256').update(value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;},date=value=>`2026-${value.replace(' ','T')}:00+08:00`;
const members=initialMembers.map(m=>({...m,id:uuid(m.id),version:1,qq:null,avatar_id:null,must_change_password:false}));
export const archives=initialEntities.map(e=>({id:uuid(e.id),type:e.type,name:e.name,status:e.state,closed:isClosed(e.state),version:1,contacts:e.contacts.map(c=>({...c,note:''})),links:[],members:(e.owners[e.state]??[]).map(id=>members.find(m=>m.id===uuid(id))),bindings:Object.fromEntries(Object.entries(e.owners).map(([state,ids])=>[state,ids.map(id=>members.find(m=>m.id===uuid(id)))])),tags:[],avatar_id:null,observation_count:e.records.filter(r=>!r.deleted).length,latest_observation:e.records.find(r=>!r.deleted)?.body,updated_at:date(e.updated)}));
const fixtureTags=[{tag_id:uuid('tag-skill'),category_id:uuid('skill'),category_name:'技能',name:'视频剪辑',color:'blue',focus:1,enabled:1,category_enabled:1,description:'能够完成视频剪辑。',evidence:[],confirmed_at:'2026-09-08T12:00:00Z'},{tag_id:uuid('tag-collaboration'),category_id:uuid('collaboration'),category_name:'协作',name:'主动沟通',color:'teal',focus:0,enabled:1,category_enabled:1,description:'协作时主动说明进展和困难。',evidence:[],confirmed_at:'2026-09-08T12:00:00Z'}];
archives[0].tags=fixtureTags;archives[0].tag_summary={tags:fixtureTags,total:2};archives[0].links=[{label:'作品集',url:'https://example.org/portfolio'}];
const observations=initialEntities.flatMap(e=>e.records.map(r=>({id:uuid(r.id),archive_id:uuid(e.id),author_id:uuid(r.author),author_name:initialMembers.find(m=>m.id===r.author)?.name,author_avatar_url:'/avatars/fixture',body:r.body,created_at:date(r.time),updated_at:date(r.time),version:1,content_version:1,occurred_at:null,deleted:r.deleted,deleted_at:null,deleted_by:null,deleted_by_name:null,editable:!r.deleted,deletable:!r.deleted,restorable:r.deleted,attachments:[]})));
const readingEvents=observations.filter(o=>!o.deleted&&o.author_id!==members[0].id).slice(0,3).map((o,i)=>({id:uuid('unread'+o.id),seq:100-i,archive_id:o.archive_id,archive_name:archives.find(a=>a.id===o.archive_id).name,type:archives.find(a=>a.id===o.archive_id).type,closed:false,actor_id:o.author_id,actor_name:o.author_name,kind:'observation.created',created_at:o.created_at,observation_id:o.id}));
export const apiRequests=[],errors=[],drafts=new Map(),confirmed=new Set();
export async function fixture(route){const request=route.request(),url=new URL(request.url()),p=url.pathname.slice(4);apiRequests.push({path:p,method:request.method()});let body;
 if(p.startsWith('/material-capacity/'))body={count:0};
 else if(p==='/auth/me')body={member:members[0]};
 else if(p==='/members')body={members,next_cursor:null};
 else if(p==='/reading')body={total:readingEvents.filter(e=>!confirmed.has(e.id)).length};
 else if(p==='/reading/events')body={events:readingEvents.filter(e=>!confirmed.has(e.id)),snapshot:100,next_cursor:null};
 else if(p.startsWith('/events/')){const event=readingEvents.find(e=>e.id===p.split('/')[2]),reading={event_id:event.id,ticket:event.id};body={event:{...event,reading,observation:{...observations.find(o=>o.id===event.observation_id),reading}}};}
 else if(p==='/reading/confirm'){const tickets=request.postDataJSON().tickets;tickets.forEach(ticket=>confirmed.add(ticket));body={confirmed:tickets.map(ticket=>({ticket,event_id:ticket})),unconfirmed:[]};}
 else if(p==='/drafts')body={drafts:[]};
 else if(p==='/drafts/save'){const data=request.postDataJSON();drafts.set(data.archive_id,{...data,version:(drafts.get(data.archive_id)?.version??0)+1,publish_request_id:uuid('publish')});body={version:drafts.get(data.archive_id).version,publish_request_id:uuid('publish')};}
 else if(p.startsWith('/drafts/'))body={draft:drafts.get(p.split('/')[2])??null,published:null};
 else if(p==='/archive-tags/update'){const data=request.postDataJSON(),archive=archives.find(a=>a.id===data.archive_id);archive.tags.push({tag_id:uuid('extra-tag'),category_name:'协作',name:'整理材料',color:'teal',focus:0,enabled:1,category_enabled:1,evidence:[],description:'整理材料'});archive.version++;body={changed:true};}
 else if(p==='/archives/update'||p==='/archives/state'){const data=request.postDataJSON(),archive=archives.find(a=>a.id===data.id);if(p.endsWith('update'))Object.assign(archive,{name:data.name,contacts:data.contacts,links:data.links});else Object.assign(archive,{status:data.status,members:members.filter(m=>data.member_ids.includes(m.id)),bindings:{...archive.bindings,[data.status]:members.filter(m=>data.member_ids.includes(m.id))}});archive.version++;body={id:archive.id,changed:true,version:archive.version};}
 else if(p==='/archives'){const type=url.searchParams.get('type'),query=url.searchParams.get('query');body={counts:{all:137,mine:42,unread:11},archives:archives.filter(a=>a.type===type&&(!query||a.name.includes(query))),next_cursor:null};}
 else if(/^\/archives\/[^/]+\/timeline$/.test(p)){const id=p.split('/')[2];body={events:observations.filter(r=>r.archive_id===id&&!r.deleted).map((r,i)=>({id:uuid('event'+r.id),archive_id:id,actor_id:r.author_id,actor_name:r.author_name,kind:'observation.created',created_at:r.created_at,seq:100-i,source:'web',observation_id:r.id,observation:r})),next_cursor:null};}
 else if(/^\/archives\/[^/]+$/.test(p))body={archive:archives.find(a=>a.id===p.split('/')[2])};
 else if(p==='/observations')body={observations:observations.filter(r=>r.archive_id===url.searchParams.get('archive_id')&&r.deleted===(url.searchParams.get('deleted')==='true')),next_cursor:null};
 else if(/^\/observations\/[^/]+\/versions$/.test(p)){const record=observations.find(r=>r.id===p.split('/')[2]);body={versions:[{...record,editor_name:record.author_name}],next_cursor:null};}
 else if(p==='/tags')body={tags:[...fixtureTags,{tag_id:uuid('extra-tag'),category_name:'协作',name:'整理材料',description:'整理材料',color:'teal',enabled:1,category_enabled:1}].map(t=>({...t,id:t.tag_id,version:1,binding_count:1})),next_cursor:null};
 else if(p==='/tag-categories')body={categories:fixtureTags.map(t=>({id:t.category_id,name:t.category_name,enabled:1,color:t.color}))};
 else {errors.push('Unhandled fixture '+p);return route.fulfill({status:500,json:{error:{message:'Unhandled fixture'}}});}
 return route.fulfill({json:body});
}
