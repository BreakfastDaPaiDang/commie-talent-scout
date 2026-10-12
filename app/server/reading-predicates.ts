import type {Actor} from './types.ts';
import {evidenceVisibilitySql} from './tag-state.ts';
// The same visibility predicate is used before pagination, in counts and at confirmation.
export function eventVisibility(actor:Actor,alias='e'){
 const one=(column:string)=>`EXISTS(SELECT 1 FROM json_each(${alias}.${column}) binding WHERE ${evidenceVisibilitySql("json_extract(binding.value,'$.evidence')")})`;
 return {sql:`(${alias}.kind<>'archive.tags_changed' OR ${one('before_json')} OR ${one('after_json')})`,args:[actor.id,actor.role,actor.id,actor.role]};
}
export function recipientPredicate(actor:Actor,alias='e'){
 const visible=eventVisibility(actor,alias);
 return {sql:`EXISTS(SELECT 1 FROM archives readable WHERE readable.id=${alias}.archive_id AND readable.deleted=0) AND ${alias}.actor_id<>? AND ${alias}.created_at>=(SELECT created_at FROM members WHERE id=?) AND ${visible.sql}`,args:[actor.id,actor.id,...visible.args]};
}

export function unreadPredicate(actor:Actor,alias='e'){const p=recipientPredicate(actor,alias);return {sql:`${p.sql} AND NOT EXISTS(SELECT 1 FROM event_read_marks mark WHERE mark.member_id=? AND mark.event_id=${alias}.id)`,args:[...p.args,actor.id]};}
