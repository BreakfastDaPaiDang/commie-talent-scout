import type { KnowledgeVersion } from '../../shared/knowledge';

export const documentScopeOptions = [
  {id: 'org', name: '全组织通用'},
  {id: 'hr', name: '人事组内'},
];

export function documentScopes(version?: KnowledgeVersion) {
  return version?.scopes ?? ['hr'];
}

export function isPersonalScope(id: string) {
  return id === 'personal' || id.startsWith('personal:');
}

export function personalScopeLabel(name?: string | null) {
  return name ? '个人：' + name : '个人';
}

export function KnowledgeDocumentScopes({version}: {version: KnowledgeVersion}) {
  const scopes = documentScopes(version);
  const names = documentScopeOptions.filter(scope => scopes.includes(scope.id)).map(scope => scope.name);
  if (scopes.some(isPersonalScope)) names.push(personalScopeLabel(version.personal_scope_name));
  return names.length > 0 && <dl className="kb-document-scopes">
    <dt>文档范围</dt><dd>{names.join('、')}</dd>
  </dl>;
}
