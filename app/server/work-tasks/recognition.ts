import type { ServiceContext } from './context.ts';
import { referenceVisibility } from './references.ts';

export async function readReviewRecognition(context: ServiceContext, taskId: string, archiveId: string, archiveUrl: string) {
  const round = await context.stmt(`
    SELECT r.id, r.number, r.legacy, (
      SELECT e.seq FROM archive_events e
      WHERE e.archive_id=r.archive_id AND e.kind='personnel.recognized'
        AND json_extract(e.after_json,'$.task_id')=r.task_id
      ORDER BY e.seq DESC LIMIT 1
    ) trigger_seq
    FROM personnel_recognition_rounds r WHERE r.task_id=? AND r.archive_id=?
  `, taskId, archiveId).first<{ id: string; number: number; legacy: number; trigger_seq: number | null }>();
  if (!round) return null;
  const roundInfo = { round_id: round.id, round_number: round.number, legacy: !!round.legacy };
  if (round.trigger_seq === null) return { ...roundInfo, votes: [] };

  // Use the event sequence to recover eligibility at the instant this task was created.
  // Current observation visibility and withdrawal status are reported separately.
  const visibility = referenceVisibility(context.actor);
  const { results } = await context.stmt(`
    SELECT v.id,v.member_archive_id,m.name,v.created_at,v.withdrawn_at,
      v.observation_id,v.content_version,o.deleted evidence_deleted,(${visibility.sql}) evidence_visible,
      submitted.seq
    FROM personnel_recognitions v
    JOIN archives m ON m.id=v.member_archive_id
    JOIN observations o ON o.id=v.observation_id AND o.archive_id=?
    JOIN archives ar ON ar.id=o.archive_id
    JOIN archive_events submitted ON submitted.archive_id=o.archive_id AND submitted.observation_id=o.id
      AND submitted.kind='personnel.recognized' AND json_extract(submitted.after_json,'$.recognition_id')=v.id
    WHERE v.round_id=? AND submitted.seq<=?
      AND NOT EXISTS (
        SELECT 1 FROM archive_events e
        WHERE e.archive_id=o.archive_id AND e.observation_id=o.id AND e.seq<=?
          AND e.kind='personnel.recognition_withdrawn' AND json_extract(e.after_json,'$.recognition_id')=v.id
      )
      AND COALESCE((
        SELECT e.kind FROM archive_events e
        WHERE e.archive_id=o.archive_id AND e.observation_id=o.id AND e.seq<=?
          AND e.kind IN ('observation.deleted','observation.restored')
        ORDER BY e.seq DESC LIMIT 1
      ),'')<>'observation.deleted'
    ORDER BY submitted.seq
  `, ...visibility.args, archiveId, round.id, round.trigger_seq, round.trigger_seq, round.trigger_seq).all<{
    id: string;
    member_archive_id: string;
    name: string;
    created_at: string;
    withdrawn_at: string | null;
    observation_id: string;
    content_version: number;
    evidence_deleted: number;
    evidence_visible: number;
    seq: number;
  }>();
  return {
    ...roundInfo,
    votes: results.map(({ observation_id, content_version, evidence_visible, evidence_deleted, seq, ...vote }) => ({
      ...vote,
      triggered: seq === round.trigger_seq,
      evidence_deleted: !!evidence_deleted,
      evidence: evidence_visible ? {
        archive_id: archiveId,
        observation_id,
        content_version,
        url: `${archiveUrl}&observation=${observation_id}&version=${content_version}`
      } : null
    }))
  };
}
