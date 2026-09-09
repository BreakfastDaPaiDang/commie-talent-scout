// Read references from the exported snapshot, never from a later live database state.
export function backupObjects(sqlite){
 const objects=sqlite.prepare("SELECT object_key,sha256,byte_size FROM attachments WHERE state='ready' AND (EXISTS(SELECT 1 FROM version_attachments v WHERE v.attachment_id=attachments.id) OR EXISTS(SELECT 1 FROM draft_attachments d WHERE d.attachment_id=attachments.id) OR EXISTS(SELECT 1 FROM avatar_history h WHERE h.attachment_id=attachments.id OR h.previous_attachment_id=attachments.id) OR EXISTS(SELECT 1 FROM archives a WHERE a.avatar_id=attachments.id) OR EXISTS(SELECT 1 FROM members m WHERE m.avatar_id=attachments.id)) ORDER BY object_key").all();
 if(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='materials'").get())objects.push(...sqlite.prepare("SELECT object_key,sha256,byte_size FROM materials WHERE state='ready' ORDER BY object_key").all());
 return objects;
}
