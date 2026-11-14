import type {CatalogActor} from '../catalog.ts';
export function createWorkspaceContext(db:D1Database,actor:CatalogActor,clock:()=>string){
 const guest='kind' in actor;
 return {db,actor,clock,guest,stmt:(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args),
  get identity(){return {id:actor.id,name:actor.name,kind:guest?'guest':'member',can_write:!guest&&actor.eligible};}
 };
}
export type ServiceContext=ReturnType<typeof createWorkspaceContext>;
