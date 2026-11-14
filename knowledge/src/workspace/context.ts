import type { CatalogActor } from '../catalog.ts';
export function createWorkspaceContext(db: D1Database, actor: CatalogActor, clock: () => string) {
  return {
    db,
    actor,
    clock,
    get guest() { return 'kind' in actor; },
    stmt: (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args),
    get identity() {
      const guest = 'kind' in actor;
      return {
        id: actor.id,
        name: actor.name,
        kind: guest ? 'guest' : 'member',
        can_write: !guest && actor.eligible
      };
    }
  };
}
export type ServiceContext = ReturnType<typeof createWorkspaceContext>;
