// Matches isMemberArchive. Legacy rows are interpreted, never silently rewritten.
export const memberArchiveSql=(alias='a')=>`(${alias}.type='person' AND COALESCE(${alias}.person_role,CASE WHEN ${alias}.status='已入伙' THEN 'member' ELSE 'external' END)='member')`;
