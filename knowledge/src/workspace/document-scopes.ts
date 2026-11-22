import type { KnowledgeVersion } from '../../../app/shared/knowledge.ts';
import { KnowledgeError } from '../types.ts';
import type { ServiceContext } from './context.ts';

export function inheritDocumentScopes(context: ServiceContext, versionId: string, fromId: string) {
  return context.stmt(`INSERT INTO kw_version_scopes(version_id,scope_id,scope_name)
    SELECT ?,scope_id,scope_name FROM kw_version_scopes WHERE version_id=?`, versionId, fromId);
}

export function prepareDocumentScopes(
  context: ServiceContext, versionId: string, previous: KnowledgeVersion | null, selections?: readonly string[],
) {
  if (!selections) return previous ? [inheritDocumentScopes(context, versionId, previous.id)] : [];

  const retained = previous?.scopes?.find(scope => scope.startsWith('personal:'));
  const member = context.identity;
  const ownScope = member.membership_id ? 'personal:' + member.membership_id : null;
  if (selections.some(scope => scope.startsWith('personal:') && scope !== ownScope && scope !== retained)) {
    throw new KnowledgeError(403, 'PERSONAL_SCOPE_OWNER_REQUIRED', '新增个人范围时，只能选择本人绑定的社员档案');
  }
  if (selections.includes('personal') && !ownScope) {
    throw new KnowledgeError(403, 'FORMAL_MEMBER_REQUIRED', '个人范围需要当前绑定的正式社员档案');
  }
  const scopes = [...new Set(selections.map(scope => scope === 'personal' && ownScope ? ownScope : scope))];
  const personal = scopes.filter(scope => scope.startsWith('personal:'));
  if (personal.length > 1) throw new KnowledgeError(400, 'ONE_PERSONAL_SCOPE_REQUIRED', '每篇文档只能有一个个人范围');

  const personalScope = personal[0];
  const currentName = personalScope === ownScope ? member.membership_name?.trim() : null;
  const scopeName = currentName || (personalScope === retained ? previous?.personal_scope_name : null) || null;
  if (personalScope && !scopeName) {
    throw new KnowledgeError(503, 'MEMBERSHIP_NAME_UNAVAILABLE', '暂时无法核对社员档案姓名，请刷新后重试');
  }
  return scopes.map(scope => context.stmt('INSERT INTO kw_version_scopes(version_id,scope_id,scope_name) VALUES(?,?,?)',
    versionId, scope, scope === personalScope ? scopeName : null));
}
