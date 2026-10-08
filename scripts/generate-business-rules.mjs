import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {archiveStatePolicy} from '../app/shared/archive-states.ts';
import {archiveLifecycleModule,archiveTransitionRules,assertReopenAllowed,assertStateAndResponsibility,transitionChanged,planArchiveEffects,auditCancellationTarget} from '../app/server/rules/archive-lifecycle.ts';
import {planRules} from '../app/server/rules/contract.ts';

const root=new URL('../',import.meta.url),output=new URL('docs/generated/archive-rules.md',root);
const lifecycle='app/server/rules/archive-lifecycle.ts';
function link(file,name){
 const lines=readFileSync(new URL(file,root),'utf8').split(/\r?\n/);
 const line=lines.findIndex(s=>new RegExp(`function ${name}[<(]|^ *(?:private )?(?:async )?${name}\\(`).test(s));
 if(line<0)throw new Error(`Cannot locate executable source: ${file}#${name}`);
 return `[${name}](../../${file}#L${line+1})`;
}
const source=fn=>fn.toString().replace(/\r\n/g,'\n').split('\n').map(l=>l.trimEnd()).join('\n');

export function renderBusinessRules(){
 const lines=['# 档案生命周期规则（自动生成）','','运行 `npm run rules:generate` 更新；`npm run rules:check` 检查。不要手工修改本文件。',
  '','这是当前分支可执行的档案生命周期行为。1.0.0 将入社身份变化与工作任务推进分开：已入伙保持开启，任务联动由各自的事务入口执行。',
  '','## 状态策略','','直接读取 [archiveStatePolicy](../../app/shared/archive-states.ts)：网页/MCP 可选状态、状态校验、关闭和负责成员要求均使用该定义。',
  '','| 状态 | 档案类型 | 自动关闭 | 要求负责成员 |','| --- | --- | --- | --- |'];
 for(const p of archiveStatePolicy)lines.push(`| ${p.status} | ${p.types.map(t=>t==='person'?'人物':'组织').join('、')} | ${p.closed?'是':'否'} | ${p.requiresMembers?'是':'否'} |`);
 const module=archiveLifecycleModule,v=module.verification;
 lines.push('','## 共同契约', '',`模块：\`${module.id}\`；计划器：${link('app/server/rules/contract.ts',planRules.name)}。计划按规则顺序返回 steps 和 statements，不执行提交。`,
  '',`触发入口：${module.triggers.map(t=>link(t.file,t.entry)).join('、')}。`,
  `事务提交：${link(v.transaction.file,v.transaction.entry)}；版本保护：${link(v.guard.file,v.guard.entry)}。`,
  `幂等边界：${v.idempotency}`,`失败边界：${v.failure}`,
  '',...v.tests.map(file=>{readFileSync(new URL(file,root));return `- 验证：[${file}](../../${file})`;}),
  '','这些边界说明是模块内的维护元数据，并非自动推导的证明；条件、实际影响及顺序以以下执行函数与行为测试为准。');
 lines.push('','## 触发与事务边界','',
  '网页 HTTP 与 MCP 的状态修改、显式重开都进入 '+link('app/server/archives.ts','transition')+'。该入口调用下表定义产生 SQL，最后一起提交；规则不单独写库。',
  '',`- 读取与预校验：${link('app/server/archives.ts','get')}（存在性、删除权限、关闭锁定、版本）。`,
  `- 关联成员：${link('app/server/archives.ts','planBindings')}（存在、冻结及原归属保留；事务内再次校验）。`,
  `- 档案事务条件：${link('app/server/archives.ts','guard')}。`,
  `- 授权、原子提交与重试收据：${link('app/server/commands.ts','command')}。`,
  '- 重开时词义差异、历史与权限：由上述 transition 调用 [TagState](../../app/server/tag-state.ts) 读取；不在生成器中解释 SQL 或任意函数。',
  `- 取消自动审核任务：${link('app/server/work-tasks.ts','cancel')} 通过 ${link('app/server/work-tasks.ts','restoreCancelledAudit')} 调用 ${link(lifecycle,'auditCancellationTarget')} 取得本次引荐前的外部关系，复用同一 planArchiveEffects 并在任务事务中提交。历史无法确认或档案已变更身份时不猜测退回状态。`,
  '','以下条件和结果来自实际参与执行的函数引用及函数体。源码链接供追溯，不把人工说明作为规则来源。',
  '','## 按顺序执行的联动','','| 标识 | 条件函数 | 结果函数 |','| --- | --- | --- |');
 for(const rule of archiveTransitionRules)lines.push(`| ${rule.id} | ${link(lifecycle,rule.when.name)} | ${link(lifecycle,rule.apply.name)} |`);
 lines.push('','```mermaid','flowchart TD','  start["archive.state / archive.reopen"] --> checks["get / assertReopenAllowed / planBindings"]');
 archiveTransitionRules.forEach((r,i)=>{
  lines.push(`  ${i?'next'+(i-1):'checks'} --> cond${i}{"${r.when.name}"}`,`  cond${i} -->|成立| effect${i}["${r.apply.name}"]`,`  cond${i} -->|不成立| next${i}["继续"]`,`  effect${i} --> next${i}`);
 });
 lines.push(`  next${archiveTransitionRules.length-1} --> batch["command: 权限与版本复核 / 原子写入 / 收据"]`,'```',
  '','## 执行条件与结果的源码','');
 const funcs=new Set([assertReopenAllowed,assertStateAndResponsibility,transitionChanged,planArchiveEffects,auditCancellationTarget,...archiveTransitionRules.flatMap(r=>[r.when,r.apply])]);
 for(const fn of funcs)lines.push(`### ${fn.name}`,'',link(lifecycle,fn.name),'','```javascript',source(fn),'```','');
 return lines.join('\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const expected=renderBusinessRules();
 if(process.argv.includes('--check')){
  if(readFileSync(output,'utf8').replace(/\r\n/g,'\n')!==expected)throw new Error('规则视图已过期，请运行 npm run rules:generate 并提交结果');
  console.log('Executable business-rule view is current');
 }else{mkdirSync(new URL('docs/generated/',root),{recursive:true});writeFileSync(output,expected);console.log('Generated docs/generated/archive-rules.md');}
}
