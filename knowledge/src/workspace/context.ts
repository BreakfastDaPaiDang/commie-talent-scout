import type { CatalogActor } from '../catalog.ts';
export function createWorkspaceContext(db: D1Database, actor: CatalogActor, clock: () => string, showPendingTags = true) {
  return {
    db,
    actor,
    clock,
    showPendingTags: showPendingTags && !('kind' in actor),
    get guest() { return 'kind' in actor; },
    stmt: (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args),
    get identity() {
      const guest = 'kind' in actor;
      return {
        id: actor.id,
        name: actor.name,
        membership_id: guest ? null : actor.membership_id,
        membership_name: guest ? null : actor.membership_name ?? null,
        kind: guest ? 'guest' : 'member',
        can_write: !guest && actor.eligible
      };
    }
  };
}
export type ServiceContext = ReturnType<typeof createWorkspaceContext>;
