import { KnowledgeError } from '../types.ts';
import type { ServiceContext } from './context.ts';
import { runCommand } from './command.ts';
import { workspaceSchemas } from './inputs.ts';

type Scope = {id: string; name: string | null};

function implicitScopes(context: ServiceContext): Scope[] {
  const scopes: Scope[] = [{id: 'org', name: '全组织通用'}, {id: 'hr', name: '人事组内'}];
  const {actor} = context;
  if (!('kind' in actor) && actor.membership_id) {
    scopes.push({id: 'personal:' + actor.membership_id, name: actor.membership_name ?? actor.name});
  }
  return scopes;
}

async function storedDefaults(context: ServiceContext) {
  const row = await context.stmt('SELECT version,additional_scope_ids_json FROM kw_reading_defaults WHERE actor_id=?', context.actor.id)
    .first<{version: number; additional_scope_ids_json: string}>();
  return {version: row?.version ?? 0, additional_scope_ids: row ? JSON.parse(row.additional_scope_ids_json) as string[] : []};
}

export async function readingDefaultsVersion(context: ServiceContext) {
  return await context.stmt('SELECT version FROM kw_reading_defaults WHERE actor_id=?', context.actor.id).first<number>('version') ?? 0;
}

export async function readingSelection(context: ServiceContext) {
  const stored = await storedDefaults(context);
  const implicit = implicitScopes(context);
  const reading_scope_ids = [...new Set([...implicit.map(scope => scope.id), ...stored.additional_scope_ids])];
  return {...stored, implicit, reading_scope_ids};
}

const publishedPersonalScopes = `WITH published_personal_scopes AS (
  SELECT s.scope_id AS id,s.scope_name AS name,
    ROW_NUMBER() OVER (PARTITION BY s.scope_id ORDER BY v.created_at DESC,v.id) AS position
  FROM kw_items i JOIN kw_versions v ON v.id=i.version_id JOIN kw_version_scopes s ON s.version_id=v.id
  WHERE i.branch_id='main' AND v.deleted=0 AND s.scope_name IS NOT NULL
)`;

async function resolvePersonalScopes(context: ServiceContext, scopeIds: string[]) {
  if (!scopeIds.length) return new Map<string, string | null>();
  const {results} = await context.stmt(`${publishedPersonalScopes}
    SELECT id,name FROM published_personal_scopes WHERE position=1 AND id IN (SELECT value FROM json_each(?))`,
    JSON.stringify(scopeIds)).all<Scope>();
  return new Map(results.map(({id, name}) => [id, name]));
}

export async function listReadingScopes(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.readingScopes.parse(input);
  const pattern = '%' + a.search.replace(/[!%_]/g, '!$&') + '%';
  const {results} = await context.stmt(`${publishedPersonalScopes}
    SELECT id,name FROM published_personal_scopes WHERE position=1 AND name LIKE ? ESCAPE '!'
    ORDER BY name,id LIMIT ? OFFSET ?`, pattern, a.limit + 1, a.offset).all<Scope>();
  return {scopes: results.slice(0, a.limit), next_offset: results.length > a.limit ? a.offset + a.limit : null};
}

export async function readReadingDefaults(context: ServiceContext) {
  if (context.guest || !context.actor.eligible) throw new KnowledgeError(403, 'FORMAL_MEMBER_REQUIRED', '仅正式成员可以查看自己的默认阅读范围');
  const {version, additional_scope_ids, reading_scope_ids, implicit} = await readingSelection(context);
  const names = await resolvePersonalScopes(context, additional_scope_ids);
  const scopes = new Map(implicit.map(scope => [scope.id, scope]));
  return {
    identity: context.identity,
    version,
    implicit_scope_ids: implicit.map(scope => scope.id),
    additional_scope_ids,
    reading_scope_ids,
    scopes: reading_scope_ids.map(id => scopes.get(id) ?? {id, name: names.get(id) ?? null})
  };
}

export async function setReadingDefaults(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.setReadingDefaults.parse(input);
  const requested = [...new Set(a.additional_scope_ids)].sort();
  const command = {...a, additional_scope_ids: requested};
  return runCommand(context, command, 'reading.defaults', async () => {
    const current = await storedDefaults(context);
    if (current.version !== a.expected_version) {
      throw new KnowledgeError(409, 'READING_DEFAULTS_CHANGED', '默认阅读范围已变化，请重新读取后再设置');
    }
    const implicit = new Set(implicitScopes(context).map(scope => scope.id));
    const additional_scope_ids = requested.filter(id => !implicit.has(id));
    const added = additional_scope_ids.filter(id => !current.additional_scope_ids.includes(id));
    const available = await resolvePersonalScopes(context, added);
    if (added.some(id => !available.has(id))) {
      throw new KnowledgeError(400, 'READING_SCOPE_UNAVAILABLE', '请从已有入库文档的个人范围中选取');
    }
    const scopesJson = JSON.stringify(additional_scope_ids);
    const changed = scopesJson !== JSON.stringify(current.additional_scope_ids);
    const version = current.version + Number(changed);
    const statements = changed ? [context.stmt(`INSERT INTO kw_reading_defaults(actor_id,version,additional_scope_ids_json) VALUES(?,?,?)
      ON CONFLICT(actor_id) DO UPDATE SET version=excluded.version,additional_scope_ids_json=excluded.additional_scope_ids_json`,
      context.actor.id, version, scopesJson)] : [];
    return {statements, result: {version, additional_scope_ids, changed}};
  });
}
