import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const target='staging';
const database='cts-staging';
const wrangler=resolve(root,'node_modules/wrangler/bin/wrangler.js');
const fixture=resolve(root,'tests/fixtures/images/shapes.png');
const credentialPath=resolve(root,'secrets/demo-local-accounts.json');
const sqlPath=resolve(root,'tmp/demo-seed.sql');
const reset=process.argv.includes('--reset');

const ids={
 admin:'10000000-0000-4000-8000-000000000001',
 member:'10000000-0000-4000-8000-000000000002',
 auditPerson:'20000000-0000-4000-8000-000000000001',
 friendPerson:'20000000-0000-4000-8000-000000000002',
 onboardingPerson:'20000000-0000-4000-8000-000000000003',
 org:'30000000-0000-4000-8000-000000000001',
 observation:'40000000-0000-4000-8000-000000000001',
 auditTask:'50000000-0000-4000-8000-000000000001',
 onboardingTask:'50000000-0000-4000-8000-000000000002',
 monthlyTask:'50000000-0000-4000-8000-000000000003',
 failedTask:'50000000-0000-4000-8000-000000000004',
 auditComment:'60000000-0000-4000-8000-000000000001',
 avatar:'70000000-0000-4000-8000-000000000001',
 observationImage:'70000000-0000-4000-8000-000000000002',
 personCategory:'80000000-0000-4000-8000-000000000001',
 directionTag:'90000000-0000-4000-8000-000000000001',
 identityTag:'90000000-0000-4000-8000-000000000002',
 orgCategory:'80000000-0000-4000-8000-000000000002',
 orgTag:'90000000-0000-4000-8000-000000000003',
};

const at=new Date().toISOString();
const plusDays=days=>new Date(Date.now()+days*86400000).toISOString();
const monthKey=at.slice(0,7);
const monthEnd=new Date(Date.UTC(Number(at.slice(0,4)),Number(at.slice(5,7)),0,23,59,59,999)).toISOString();
const sql=value=>value===null?'NULL':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
const statement=(table,columns,values)=>`INSERT OR IGNORE INTO ${table}(${columns.join(',')}) VALUES(${values.map(sql).join(',')});`;
const hashPassword=password=>{
 const salt=randomBytes(16),hash=scryptSync(password,salt,32,{N:32768,r:8,p:3,maxmem:64*1024*1024});
 const hex=bytes=>Buffer.from(bytes).toString('hex');
 return `scrypt$1$32768$8$3$${hex(salt)}$${hex(hash)}`;
};
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value);
const run=(args,options={})=>{
 const result=spawnSync(process.execPath,[wrangler,...args],{cwd:root,encoding:'utf8',stdio:options.stdio??'pipe'});
 if(result.status!==0){
  const detail=(result.stderr||result.stdout||'').replace(/\b(scrypt\$[^\s']+|cts_demo_[A-Za-z0-9_-]+)/g,'[redacted]').trim();
  throw new Error(`Wrangler command failed: ${args.join(' ')}${detail?`\n${detail}`:''}`);
 }
 return result.stdout??'';
};

function credentials(){
 if(!reset&&existsSync(credentialPath)){
  try{
   const saved=JSON.parse(readFileSync(credentialPath,'utf8'));
   if(saved.admin?.password&&saved.member?.password&&saved.admin?.mcp_token)return saved;
  }catch{}
 }
 return {
  environment:'local',
  generated_at:at,
  admin:{username:'demo_admin',name:'演示管理员',password:randomBytes(18).toString('base64url'),id:ids.admin},
  member:{username:'demo_member',name:'演示社员',password:randomBytes(18).toString('base64url'),id:ids.member},
  admin_mcp:{username:'demo_admin',id:ids.admin},
  mcp_token:'cts_demo_'+randomBytes(24).toString('base64url'),
 };
}

function resetStatements(){
 const archives=[ids.auditPerson,ids.friendPerson,ids.onboardingPerson,ids.org].map(sql).join(',');
 const tasks=[ids.auditTask,ids.onboardingTask,ids.monthlyTask,ids.failedTask].map(sql).join(',');
 const observations=[ids.observation].map(sql).join(',');
 const tags=[ids.directionTag,ids.identityTag,ids.orgTag].map(sql).join(',');
 const categories=[ids.personCategory,ids.orgCategory].map(sql).join(',');
 return [
  `DELETE FROM archive_reading_delivery_events WHERE delivery_id IN (SELECT id FROM archive_reading_deliveries WHERE archive_id IN (${archives}));`,
  `DELETE FROM event_read_marks WHERE event_id IN (SELECT id FROM archive_events WHERE archive_id IN (${archives}));`,
  `DELETE FROM reading_deliveries WHERE event_id IN (SELECT id FROM archive_events WHERE archive_id IN (${archives}));`,
  `DELETE FROM archive_reading_deliveries WHERE archive_id IN (${archives});`,
  `DELETE FROM observation_reads WHERE observation_id IN (${observations});`,
  `DELETE FROM tag_maintenance_previews WHERE member_id IN (${sql(ids.admin)},${sql(ids.member)});`,
  `DELETE FROM member_work_preferences WHERE member_id IN (${sql(ids.admin)},${sql(ids.member)});`,
  `DELETE FROM mcp_tasks WHERE member_id IN (${sql(ids.admin)},${sql(ids.member)});`,
  `DELETE FROM mcp_calls WHERE member_id IN (${sql(ids.admin)},${sql(ids.member)});`,
  `DELETE FROM messages WHERE task_id IN (${tasks});`,
  `DELETE FROM work_task_comments WHERE task_id IN (${tasks});`,
  `DELETE FROM work_task_comment_versions WHERE task_id IN (${tasks});`,
  `DELETE FROM work_task_events WHERE task_id IN (${tasks});`,
  `DELETE FROM work_task_pushes WHERE task_id IN (${tasks});`,
  `DELETE FROM work_tasks WHERE id IN (${tasks});`,
  `DELETE FROM version_attachments WHERE observation_id IN (${observations});`,
  `DELETE FROM avatar_history WHERE subject_id IN (${archives}) OR attachment_id IN (${sql(ids.avatar)},${sql(ids.observationImage)});`,
  `DELETE FROM attachments WHERE id IN (${sql(ids.avatar)},${sql(ids.observationImage)});`,
  `DELETE FROM archive_tags WHERE archive_id IN (${archives}) OR tag_id IN (${tags});`,
  `DELETE FROM archive_tag_snapshots WHERE archive_id IN (${archives});`,
  `DELETE FROM archive_events WHERE archive_id IN (${archives});`,
  `DELETE FROM observation_versions WHERE observation_id IN (${observations});`,
  `DELETE FROM observations WHERE id IN (${observations});`,
  `DELETE FROM archive_bindings WHERE archive_id IN (${archives});`,
  `DELETE FROM archives WHERE id IN (${archives});`,
  `DELETE FROM tag_definition_history WHERE id IN (${tags},${categories});`,
  `DELETE FROM tags WHERE id IN (${tags});`,
  `DELETE FROM tag_categories WHERE id IN (${categories});`,
  `DELETE FROM auth_events WHERE member_id IN (${sql(ids.admin)},${sql(ids.member)});`,
  `DELETE FROM credentials WHERE member_id IN (${sql(ids.admin)},${sql(ids.member)});`,
  `DELETE FROM members WHERE id IN (${sql(ids.admin)},${sql(ids.member)});`,
 ].join('\n');
}

function seedSql(account,metadata){
 const adminHash=hashPassword(account.admin.password),memberHash=hashPassword(account.member.password);
 const mcpCredential='a0000000-0000-4000-8000-000000000001';
 const image=metadata.image;
 const out=['PRAGMA foreign_keys = ON;','BEGIN TRANSACTION;'];
 if(reset)out.push(resetStatements());
 out.push(
  `DELETE FROM credentials WHERE member_id IN (${sql(ids.admin)},${sql(ids.member)});`,
  `INSERT INTO members(id,username,name,role,frozen,auth_epoch,password_hash,must_change_password,version,created_at) VALUES(${sql(ids.admin)},'demo_admin','演示管理员','admin',0,1,${sql(adminHash)},0,1,${sql(at)}) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name,role=excluded.role,frozen=0,auth_epoch=1,password_hash=excluded.password_hash,must_change_password=0,version=members.version+1;`,
  `INSERT INTO members(id,username,name,role,frozen,auth_epoch,password_hash,must_change_password,version,created_at) VALUES(${sql(ids.member)},'demo_member','演示社员','member',0,1,${sql(memberHash)},0,1,${sql(at)}) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name,role=excluded.role,frozen=0,auth_epoch=1,password_hash=excluded.password_hash,must_change_password=0,version=members.version+1;`,
  statement('credentials',['id','member_id','hash','kind','name','auth_epoch','created_at','expires_at'],[mcpCredential,ids.admin,digest(account.mcp_token),'mcp','本地演示 MCP',1,at,'2099-12-31T23:59:59.000Z']),
  statement('archives',['id','type','name','contacts_json','links_json','current_need','status','closed','created_by','created_at','updated_at','version'],[ids.auditPerson,'person','透明杂志',json([{type:'QQ',value:'100000001'}]),json([{label:'演示主页',url:'https://example.invalid/demo-magazine'}]),'了解对方当前意愿以及可参与的方向。','人事审核',0,ids.admin,at,at,1]),
  statement('archives',['id','type','name','contacts_json','links_json','current_need','status','closed','created_by','created_at','updated_at','version'],[ids.friendPerson,'person','北风社友',json([{type:'邮箱',value:'friend@example.invalid'}]),json([]),'保持稳定联系，了解未来合作机会。','外部社友',0,ids.admin,at,at,1]),
  statement('archives',['id','type','name','contacts_json','links_json','current_need','status','closed','created_by','created_at','updated_at','version'],[ids.onboardingPerson,'person','新加入的观察对象',json([{type:'QQ',value:'100000002'}]),json([]),'确认入社后的首次对接方向。','已加入待对接',0,ids.admin,at,at,1]),
  statement('archives',['id','type','name','contacts_json','links_json','current_need','status','closed','created_by','created_at','updated_at','version'],[ids.org,'org','红星社区互助组',json([{type:'网站',value:'https://example.invalid/red-star'}]),json([]),'确认组织交流窗口和长期联系人。','组织交流',0,ids.admin,at,at,1]),
  statement('archive_bindings',['archive_id','status','member_id'],[ids.auditPerson,'人事审核',ids.admin]),
  statement('archive_bindings',['archive_id','status','member_id'],[ids.onboardingPerson,'已加入待对接',ids.member]),
  statement('archive_bindings',['archive_id','status','member_id'],[ids.org,'组织交流',ids.member]),
  statement('tag_categories',['id','type','name','name_key','description','color','created_by','created_at','updated_at'],[ids.personCategory,'person','身份','身份','演示人物身份标签。','blue',ids.admin,at,at]),
  statement('tag_categories',['id','type','name','name_key','description','color','created_by','created_at','updated_at'],[ids.orgCategory,'org','关系','关系','演示组织关系标签。','sage',ids.admin,at,at]),
  statement('tags',['id','category_id','name','name_key','description','created_by','created_at','updated_at'],[ids.directionTag,ids.personCategory,'内容创作','内容创作','对内容创作方向有经验或兴趣。',ids.admin,at,at]),
  statement('tags',['id','category_id','name','name_key','description','created_by','created_at','updated_at'],[ids.identityTag,ids.personCategory,'二次元厌恶者','二次元厌恶者','对二次元内容创作保持明确距离。',ids.admin,at,at]),
  statement('tags',['id','category_id','name','name_key','description','created_by','created_at','updated_at'],[ids.orgTag,ids.orgCategory,'长期交流','长期交流','与组织保持稳定交流。',ids.admin,at,at]),
  statement('archive_tags',['archive_id','tag_id','added_by','added_at','confirmed_by','confirmed_at','evidence_json','focus'],[ids.auditPerson,ids.directionTag,ids.admin,at,ids.admin,at,json([{summary:'演示资料中的方向描述',source:'seed'}]),2]),
  statement('archive_tags',['archive_id','tag_id','added_by','added_at','confirmed_by','confirmed_at','evidence_json','focus'],[ids.auditPerson,ids.identityTag,ids.admin,at,ids.admin,at,json([{summary:'演示资料中的偏好描述',source:'seed'}]),1]),
  statement('archive_tags',['archive_id','tag_id','added_by','added_at','confirmed_by','confirmed_at','evidence_json','focus'],[ids.org,ids.orgTag,ids.admin,at,ids.admin,at,json([{summary:'演示组织交流记录',source:'seed'}]),2]),
  statement('observations',['id','archive_id','author_id','created_at','updated_at','version','content_version','deleted'],[ids.observation,ids.auditPerson,ids.member,at,at,1,1,0]),
  statement('observation_versions',['observation_id','version','body','occurred_at','editor_id','created_at'],[ids.observation,1,'这是本地演示观察记录：对方愿意了解组织，也在考虑内容创作方向。',at.slice(0,10),ids.member,at]),
  statement('archive_events',['id','archive_id','actor_id','source','kind','before_json','after_json','observation_id','created_at'],['b0000000-0000-4000-8000-000000000001',ids.auditPerson,ids.member,'web','archive.created',null,json({type:'person',name:'透明杂志',status:'人事审核'}),null,at]),
  statement('archive_events',['id','archive_id','actor_id','source','kind','before_json','after_json','observation_id','created_at'],['b0000000-0000-4000-8000-000000000002',ids.auditPerson,ids.member,'web','observation.created',null,json({version:1}),ids.observation,at]),
  statement('work_tasks',['id','archive_id','kind','title','purpose','delivery','source','status','owner_id','deadline_at','created_by','created_at','updated_at','version'],[ids.auditTask,ids.auditPerson,'audit','人事审核','了解对方情况、意愿以及可能参与的方向，形成有依据的审核结论。','把审核结论写入相关档案；联系不到时如实记录当前情况。','rule','open',null,plusDays(4),ids.admin,at,at,1]),
  statement('work_tasks',['id','archive_id','kind','title','purpose','delivery','source','status','owner_id','deadline_at','created_by','created_at','updated_at','version'],[ids.onboardingTask,ids.onboardingPerson,'onboarding','入社对接','确认新社员已经知道组织入口、当前协作方向和可以继续联系的人。','把对接结果写入相关档案；无需在任务评论中重复保存。','rule','open',ids.member,plusDays(2),ids.admin,at,at,1]),
  statement('work_tasks',['id','archive_id','kind','title','purpose','delivery','source','status','owner_id','deadline_at','created_by','created_at','updated_at','version','period_key'],[ids.monthlyTask,ids.friendPerson,'monthly','十月人事接触','了解本月对象的状态、需求和与组织继续联系的可能性。','把实际沟通结果写入档案；暂时联系不到也可以如实完成。','rule','open',ids.admin,monthEnd,ids.admin,at,at,1,monthKey]),
  statement('work_tasks',['id','archive_id','kind','title','purpose','delivery','source','status','owner_id','deadline_at','created_by','created_at','updated_at','version','result_kind','result_text','completed_at','closed_reason'],[ids.failedTask,ids.org,'custom','整理组织交流材料','整理一次组织交流的背景和现状，方便后续成员接手。','把整理结果写入组织档案。','manual','expired',ids.member,new Date(Date.now()-86400000).toISOString(),ids.admin,at,at,2,'expired','未在期限内完成。',null,'超过截止时间自动关闭'] ),
  statement('work_task_events',['id','task_id','actor_id','source','kind','before_json','after_json','reason','created_at'],['c0000000-0000-4000-8000-000000000001',ids.auditTask,ids.admin,'system','task.created',null,json({status:'open',owner_id:null}),null,at]),
  statement('work_task_events',['id','task_id','actor_id','source','kind','before_json','after_json','reason','created_at'],['c0000000-0000-4000-8000-000000000002',ids.onboardingTask,ids.member,'system','task.claimed',json({status:'open',owner_id:null}),json({status:'open',owner_id:ids.member}),null,at]),
  statement('work_task_events',['id','task_id','actor_id','source','kind','before_json','after_json','reason','created_at'],['c0000000-0000-4000-8000-000000000003',ids.failedTask,ids.member,'system','task.expired',json({status:'open'}),json({status:'expired'}),'超过截止时间自动关闭',new Date(Date.now()-86400000).toISOString()]),
  statement('work_task_comments',['id','task_id','author_id','body','references_json','created_at','updated_at','version'],[ids.auditComment,ids.onboardingTask,ids.member,'已确认对方知道入口，下一步补充具体协作方向。','[]',at,at,1]),
  statement('work_task_comment_versions',['comment_id','task_id','version','actor_id','source','body','references_json','created_at'],[ids.auditComment,ids.onboardingTask,1,ids.member,'system','已确认对方知道入口，下一步补充具体协作方向。','[]',at]),
  statement('messages',['id','recipient_id','kind','task_id','object_type','object_id','title','body','task_version','deadline_at','created_at'],['d0000000-0000-4000-8000-000000000001',ids.member,'task.deadline',ids.onboardingTask,'work_task',ids.onboardingTask,'入社对接即将到期','你负责的入社对接任务将在两天后到期。',1,plusDays(2),at]),
  statement('attachments',['id','owner_id','auth_epoch','credential_id','purpose','archive_id','mime_type','byte_size','sha256','ticket_hash','ticket_expires_at','state','object_key','width','height','created_at','ready_at'],[ids.avatar,ids.admin,1,mcpCredential,'archive_avatar',ids.auditPerson,'image/png',image.byteSize,image.sha256,digest('demo-avatar-ticket'),'2099-12-31T23:59:59.000Z','ready','demo/archive-avatar.png',image.width,image.height,at,at]),
  statement('attachments',['id','owner_id','auth_epoch','credential_id','purpose','archive_id','observation_id','mime_type','byte_size','sha256','ticket_hash','ticket_expires_at','state','object_key','width','height','created_at','ready_at'],[ids.observationImage,ids.admin,1,mcpCredential,'observation',ids.auditPerson,ids.observation,'image/png',image.byteSize,image.sha256,digest('demo-observation-ticket'),'2099-12-31T23:59:59.000Z','ready','demo/observation.png',image.width,image.height,at,at]),
  `UPDATE archives SET avatar_id=${sql(ids.avatar)},version=version+1,updated_at=${sql(at)} WHERE id=${sql(ids.auditPerson)};`,
  statement('avatar_history',['subject_type','subject_id','attachment_id','previous_attachment_id','actor_id','created_at'],['archive',ids.auditPerson,ids.avatar,null,ids.admin,at]),
  statement('version_attachments',['observation_id','content_version','attachment_id','position'],[ids.observation,1,ids.observationImage,0]),
 );
 out.push('COMMIT;');
 return out.join('\n');
}

function imageMetadata(){
 const bytes=readFileSync(fixture);
 return {byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:240,height:160};
}

function main(){
 if(!existsSync(wrangler))throw new Error('请先运行 npm ci');
 const account=credentials(),metadata={image:imageMetadata()};
 mkdirSync(resolve(root,'tmp'),{recursive:true});
 mkdirSync(resolve(root,'secrets'),{recursive:true});
 run(['d1','migrations','apply',database,'--env',target,'--local']);
 run(['r2','object','put','cts-staging-images/demo/archive-avatar.png','--local','--file',fixture,'--content-type','image/png','--force']);
 run(['r2','object','put','cts-staging-images/demo/observation.png','--local','--file',fixture,'--content-type','image/png','--force']);
 writeFileSync(sqlPath,seedSql(account,metadata),'utf8');
 try{run(['d1','execute',database,'--env',target,'--local','--file',sqlPath]);}
 finally{try{unlinkSync(sqlPath);}catch{}}
 writeFileSync(credentialPath,JSON.stringify({...account,status:'created'},null,2),{mode:0o600});
 console.log('本地演示环境已准备完成。');
 console.log('启动：npm run build && npm run dev:worker');
 console.log('网页：http://127.0.0.1:8790/');
 console.log(`账号：${account.admin.username} / ${account.admin.password}`);
 console.log(`普通社员：${account.member.username} / ${account.member.password}`);
 console.log(`MCP Token 已写入：${credentialPath}`);
 console.log(reset?'本次执行已重置演示数据。':'重复执行会刷新演示账号并保留演示数据；需要清空时加 --reset。');
}

try{main();}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
