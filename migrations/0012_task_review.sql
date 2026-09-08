ALTER TABLE mcp_tasks ADD COLUMN archive_id TEXT;
ALTER TABLE mcp_tasks ADD COLUMN reported_model TEXT;
ALTER TABLE mcp_tasks ADD COLUMN original_request_provided INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_tasks ADD COLUMN source_material_provided INTEGER NOT NULL DEFAULT 0;
UPDATE mcp_tasks SET original_request_provided=(original_request IS NOT NULL),source_material_provided=(source_material IS NOT NULL);

-- Only bounded IDs, versions, flags and counts; no business prose or credentials.
ALTER TABLE mcp_calls ADD COLUMN result_meta_json TEXT NOT NULL DEFAULT '{}';
UPDATE mcp_calls SET result_meta_json=json_object(
 'id',json_extract(result_json,'$.id'),'archive_id',json_extract(result_json,'$.archive_id'),
 'version',json_extract(result_json,'$.version'),'content_version',json_extract(result_json,'$.content_version'),
 'changed',json_extract(result_json,'$.changed'),'replayed',json_extract(result_json,'$.replayed'),
 'reused',json_extract(result_json,'$.reused'),'entity_type',json_extract(result_json,'$.entity_type'),
 'task_id',json_extract(result_json,'$.task_id'),'count',json_extract(result_json,'$.count'),
 'added',json(json_extract(result_json,'$.added')),'removed',json(json_extract(result_json,'$.removed')),
 'from_tag_id',json_extract(result_json,'$.from_tag_id'),'to_tag_id',json_extract(result_json,'$.to_tag_id')
) WHERE result_json IS NOT NULL AND json_valid(result_json);

CREATE TABLE mcp_daily_usage (
 day TEXT NOT NULL,tool TEXT NOT NULL,outcome TEXT NOT NULL,
 calls INTEGER NOT NULL,linked_calls INTEGER NOT NULL,changed_operations INTEGER NOT NULL,
 observations_created INTEGER NOT NULL,tags_created INTEGER NOT NULL,tags_reused INTEGER NOT NULL,
 tags_added INTEGER NOT NULL,tags_removed INTEGER NOT NULL,
 PRIMARY KEY(day,tool,outcome)
);
CREATE TABLE mcp_daily_tasks (
 day TEXT PRIMARY KEY,tasks INTEGER NOT NULL,original_provided INTEGER NOT NULL,source_provided INTEGER NOT NULL
);
