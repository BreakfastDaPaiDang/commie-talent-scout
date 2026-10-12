import {z} from 'zod';

// Typed caller-facing results. Passthrough preserves additive service fields.
export const mutationResult=z.object({id:z.string(),version:z.number(),changed:z.boolean()}).passthrough();
export const uploadPrepared=z.object({upload_id:z.string(),method:z.literal('PUT'),url:z.string(),headers:z.record(z.string(),z.string()),expires_at:z.string(),byte_size:z.number(),sha256:z.string()}).passthrough();
export const attachmentInfo=z.object({id:z.string(),mime_type:z.string(),byte_size:z.number(),width:z.number(),height:z.number(),url:z.string()}).passthrough();
export const imageStatus=z.object({upload_id:z.string(),state:z.string().describe('ready 可引用；pending/uploading 尚未完成；expired 需重新准备。'),attachment:attachmentInfo.nullable(),expires_at:z.string(),retry_after:z.string().nullable()}).passthrough();
export const materialInfo=z.object({id:z.string(),archive_id:z.string(),owner_id:z.string(),owner_name:z.string(),name:z.string(),description:z.string(),mime_type:z.string(),byte_size:z.number(),sha256:z.string(),state:z.string(),deleted:z.boolean(),version:z.number(),created_at:z.string(),updated_at:z.string(),editable:z.boolean(),download_url:z.string(),preview_url:z.string().nullable(),reference_url:z.string()}).passthrough();
export const materialCapacity=z.object({limit_bytes:z.number(),used_bytes:z.number(),reserved_bytes:z.number(),available_bytes:z.number(),version:z.number(),count:z.number(),default_bytes:z.number(),max_file_bytes:z.number()}).passthrough();
export const materialStatus=z.object({upload_id:z.string(),state:z.string(),expires_at:z.string(),material:materialInfo.nullable()}).passthrough();
