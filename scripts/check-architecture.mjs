import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '@babel/parser';

export function sourceDependencies(source) {
  const tree=parse(source,{sourceType:'module',plugins:['typescript','jsx']});
  return tree.program.body.flatMap(node=>{
    if(!['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)||!node.source)return [];
    const typeOnly=node.importKind==='type'||node.exportKind==='type'||!!node.specifiers?.length&&node.specifiers.every(s=>s.importKind==='type'||s.exportKind==='type');
    return [{path:node.source.value,typeOnly,line:node.loc.start.line}];
  });
}

export function dependencyCycles(graph) {
  const visited=new Set(),active=new Set(),stack=[],cycles=[];
  function visit(file) {
    if(active.has(file)){cycles.push([...stack.slice(stack.indexOf(file)),file]);return;}
    if(visited.has(file))return;
    visited.add(file);active.add(file);stack.push(file);
    for(const next of graph.get(file)??[])visit(next);
    stack.pop();active.delete(file);
  }
  for(const file of graph.keys())visit(file);
  return cycles;
}

export function boundaryViolation(file,target,typeOnly) {
  if(file.startsWith('app/shared/')&&(target.startsWith('app/server/')||target.startsWith('app/client/')||target.startsWith('knowledge/src/')))return '共享数据契约不能依赖业务实现';
  if(!typeOnly&&(file.startsWith('app/client/')||file.startsWith('app/ui/'))&&(target.startsWith('app/server/')||target.startsWith('knowledge/src/')))return '浏览器模块不能加载服务端实现';
  if(file.startsWith('app/ui/')&&target.startsWith('app/client/'))return '共享界面不能反向依赖正式站适配器';
  if(file.startsWith('app/server/work-tasks/')&&target==='app/server/work-tasks.ts')return '任务内部模块不能回调总入口';
  if(file.startsWith('knowledge/src/workspace/')&&target==='knowledge/src/workspace.ts')return '知识库内部模块不能回调总入口';
  return null;
}

export function checkArchitecture(root=process.cwd()) {
  const files=[];
  function collect(dir){for(const item of readdirSync(resolve(root,dir),{withFileTypes:true})){const file=dir+'/'+item.name;if(item.isDirectory())collect(file);else if(/\.(?:ts|tsx|js|jsx)$/.test(file))files.push(file);}}
  for(const dir of ['app','knowledge/src','prototypes/frontend/src'])if(existsSync(resolve(root,dir)))collect(dir);
  const known=new Set(files),graph=new Map(),errors=[];
  for(const file of files){
    const edges=[];
    for(const dependency of sourceDependencies(readFileSync(resolve(root,file),'utf8'))){
      if(!dependency.path.startsWith('.'))continue;
      const base=posix.normalize(posix.join(posix.dirname(file),dependency.path));
      const target=[base,...['.ts','.tsx','.js','.jsx','/index.ts','/index.tsx'].map(ext=>base+ext)].find(candidate=>known.has(candidate));
      if(!target)continue;
      const violation=boundaryViolation(file,target,dependency.typeOnly);
      if(violation)errors.push(`${file}:${dependency.line} → ${target}：${violation}`);
      if(!dependency.typeOnly)edges.push(target);
    }
    graph.set(file,edges);
  }
  for(const cycle of dependencyCycles(graph))errors.push('循环依赖：'+cycle.join(' → '));
  return {files:files.length,errors};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=checkArchitecture();
  if(result.errors.length){console.error(result.errors.join('\n'));process.exitCode=1;}
  else console.log(`Architecture boundaries passed (${result.files} source files, no runtime import cycles).`);
}
