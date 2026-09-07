import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { scrypt } from 'node:crypto';

// A disposable integration spike, not production application code.
type Env = { DB: D1Database; IMAGES: R2Bucket; PROBE_ADMIN: string };
type Actor = { id: string; role: 'admin' | 'member'; tokenHash: string };
type Source = 'web' | 'mcp';
type Entity = { id: string; name: string; state: string; closed: number; version: number };
type RecordRow = { id: string; entity_id: string; author_id: string; body: string; deleted: number; version: number };
const encoder = new TextEncoder();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function digest(value: string | Uint8Array) {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  const result = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(result)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
class Failure extends Error { constructor(public status: number, public code: string) { super(code); } }
async function actorFrom(request: Request, env: Env): Promise<Actor> {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)cts_session=([^;]+)/)?.[1];
  const token = bearer ?? cookie;
  if (!token) throw new Failure(401, 'UNAUTHENTICATED');
  const tokenHash = await digest(token);
  const member = await env.DB.prepare(`SELECT m.id,m.role FROM credentials c JOIN members m ON m.id=c.member_id
    WHERE c.hash=? AND c.auth_epoch=m.auth_epoch AND m.frozen=0`).bind(tokenHash).first<{id:string;role:'admin'|'member'}>();
  if (!member) throw new Failure(401, 'UNAUTHENTICATED');
  return { ...member, tokenHash };
}

class Archive {
  constructor(private env: Env, private actor: Actor, private source: Source) {}
  private stmt(sql: string, ...args: unknown[]) { return this.env.DB.prepare(sql).bind(...args); }
  // Revalidate the credential inside the transaction to cover concurrent freezes.
  private authGuard(commandId: string) {
    return this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(
      SELECT 1 FROM credentials c JOIN members m ON c.member_id=m.id
      WHERE c.hash=? AND m.id=? AND m.frozen=0 AND c.auth_epoch=m.auth_epoch
    ) THEN 1 ELSE 0 END)`, `${commandId}:auth`, this.actor.tokenHash, this.actor.id);
  }
  private guard(key: string, condition: string, args: unknown[]) {
    return this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN ${condition} THEN 1 ELSE 0 END)`, key, ...args);
  }
  private event(entityId: string | null, kind: string, subject: string) {
    return this.stmt(`INSERT INTO events(entity_id,actor_id,source,kind,subject_id,created_at) VALUES(?,?,?,?,?,?)`, entityId, this.actor.id, this.source, kind, subject, now());
  }
  private async transact(commandId: string, input: unknown, result: unknown, statements: D1PreparedStatement[]) {
    const requestHash = await digest(JSON.stringify(input));
    const cached = await this.stmt('SELECT * FROM commands WHERE id=?', commandId).first<{actor_id:string;request_hash:string;result_json:string}>();
    if (cached) {
      if (cached.actor_id !== this.actor.id || cached.request_hash !== requestHash) throw new Failure(409, 'IDEMPOTENCY_CONFLICT');
      return JSON.parse(cached.result_json);
    }
    try {
      await this.env.DB.batch([
        this.authGuard(commandId),
        ...statements,
        this.stmt('INSERT INTO commands VALUES(?,?,?,?)', commandId, this.actor.id, requestHash, JSON.stringify(result)),
        this.stmt('DELETE FROM mutation_guards WHERE id LIKE ?', `${commandId}:%`)
      ]);
      return result;
    } catch {
      const raced = await this.stmt('SELECT * FROM commands WHERE id=?', commandId).first<{actor_id:string;request_hash:string;result_json:string}>();
      if (raced?.actor_id === this.actor.id && raced.request_hash === requestHash) return JSON.parse(raced.result_json);
      throw new Failure(409, 'PRECONDITION_OR_CONCURRENT_CHANGE');
    }
  }
  async get(entityId: string) {
    const entity = await this.stmt('SELECT * FROM entities WHERE id=?', entityId).first();
    if (!entity) throw new Failure(404, 'NOT_FOUND');
    const records = await this.stmt('SELECT * FROM records WHERE entity_id=?', entityId).all();
    const events = await this.stmt('SELECT * FROM events WHERE entity_id=? ORDER BY seq', entityId).all();
    const revisions = await this.stmt('SELECT v.* FROM revisions v JOIN records r ON r.id=v.record_id WHERE r.entity_id=? ORDER BY v.version', entityId).all();
    const attachments = await this.stmt('SELECT id,record_id,bytes,sha256,uploaded FROM attachments WHERE entity_id=?', entityId).all();
    return { entity, records: records.results, events: events.results, revisions: revisions.results, attachments: attachments.results };
  }
  async createEntity(name: string, commandId: string) {
    const entityId = commandId;
    return this.transact(commandId, ['createEntity',name], { id:entityId, version:1 }, [
      this.stmt('INSERT INTO entities(id,name,updated_at) VALUES(?,?,?)', entityId, name, now()),
      this.event(entityId,'entity.created',entityId)
    ]);
  }
  async setState(entityId: string, state: string, expectedVersion: number, commandId: string) {
    if (!['observing','contacting','reviewing','joined','discarded'].includes(state)) throw new Failure(400,'INVALID_STATE');
    const closed = ['joined','discarded'].includes(state) ? 1 : 0;
    return this.transact(commandId, ['state',entityId,state,expectedVersion], { id:entityId, version:expectedVersion+1, closed }, [
      this.guard(`${commandId}:entity`, 'EXISTS(SELECT 1 FROM entities WHERE id=? AND version=?)', [entityId,expectedVersion]),
      this.event(entityId,'state.changed',state),
      this.stmt(`INSERT INTO events(entity_id,actor_id,source,kind,subject_id,created_at)
        SELECT id,?,?,?,id,? FROM entities WHERE id=? AND closed<>?`, this.actor.id,this.source,closed ? 'entity.closed':'entity.opened',now(),entityId,closed),
      this.stmt('UPDATE entities SET state=?,closed=?,version=version+1,updated_at=? WHERE id=?',state,closed,now(),entityId)
    ]);
  }
  async createRecord(entityId: string, body: string, attachmentIds: string[], commandId: string) {
    const recordId = commandId;
    const statements = [
      this.guard(`${commandId}:entity`,'EXISTS(SELECT 1 FROM entities WHERE id=? AND closed=0)',[entityId]),
      this.stmt('INSERT INTO records(id,entity_id,author_id,body) VALUES(?,?,?,?)',recordId,entityId,this.actor.id,body),
      this.stmt('INSERT INTO revisions VALUES(?,1,?,0,?,?)',recordId,body,this.actor.id,now()),
      ...attachmentIds.flatMap((attachmentId,index) => [
        this.guard(`${commandId}:attachment:${index}`,'EXISTS(SELECT 1 FROM attachments WHERE id=? AND entity_id=? AND uploader_id=? AND uploaded=1 AND record_id IS NULL)',[attachmentId,entityId,this.actor.id]),
        this.stmt('UPDATE attachments SET record_id=? WHERE id=?',recordId,attachmentId)
      ]),
      this.stmt('UPDATE entities SET updated_at=? WHERE id=?',now(),entityId),
      this.event(entityId,'record.created',recordId)
    ];
    return this.transact(commandId,['record.create',entityId,body,attachmentIds],{id:recordId,version:1},statements);
  }
  async changeRecord(recordId: string, operation: 'edit'|'delete'|'restore', body: string | undefined, expectedVersion: number, commandId: string) {
    const record = await this.stmt('SELECT * FROM records WHERE id=?',recordId).first<RecordRow>();
    if (!record) throw new Failure(404,'NOT_FOUND');
    if (record.author_id !== this.actor.id && this.actor.role !== 'admin') throw new Failure(403,'NOT_RECORD_AUTHOR');
    const deleted = operation === 'delete' ? 1 : 0;
    const nextBody = operation === 'edit' ? (body ?? '') : record.body;
    return this.transact(commandId,['record.change',recordId,operation,body ?? null,expectedVersion],{id:recordId,version:expectedVersion+1},[
      this.guard(`${commandId}:record`, `EXISTS(SELECT 1 FROM records r JOIN entities e ON r.entity_id=e.id JOIN members m ON m.id=?
        WHERE r.id=? AND r.version=? AND e.closed=0 AND (r.author_id=m.id OR m.role='admin') AND r.deleted=?)`,[this.actor.id,recordId,expectedVersion,operation==='restore'?1:0]),
      this.stmt('UPDATE records SET body=?,deleted=?,version=version+1 WHERE id=?',nextBody,deleted,recordId),
      this.stmt('INSERT INTO revisions VALUES(?,?,?,?,?,?)',recordId,expectedVersion+1,nextBody,deleted,this.actor.id,now()),
      this.stmt('UPDATE entities SET updated_at=? WHERE id=?',now(),record.entity_id),
      this.event(record.entity_id,`record.${operation}`,recordId)
    ]);
  }
  async prepareUpload(entityId: string, mime: string, bytes: number, sha256: string) {
    if (mime !== 'image/png' || bytes < 1 || bytes > 10*1024*1024) throw new Failure(400,'INVALID_IMAGE');
    const attachmentId = id();
    const ticket = id()+id();
    const commandId = id();
    await this.transact(commandId,['upload.prepare',entityId,mime,bytes,sha256],{id:attachmentId},[
      this.guard(`${commandId}:entity`,'EXISTS(SELECT 1 FROM entities WHERE id=? AND closed=0)',[entityId]),
      this.stmt(`INSERT INTO attachments(id,entity_id,uploader_id,object_key,mime,bytes,sha256,ticket_hash,ticket_expires,ticket_epoch)
        VALUES(?,?,?,?,?,?,?,?,?,(SELECT auth_epoch FROM members WHERE id=?))`,attachmentId,entityId,this.actor.id,`spike/${attachmentId}`,mime,bytes,sha256,await digest(ticket),new Date(Date.now()+300000).toISOString(),this.actor.id)
    ]);
    return { attachmentId, uploadPath:`/uploads/${attachmentId}`, uploadToken:ticket, method:'PUT', expiresInSeconds:300 };
  }
  async setMember(memberId: string, frozen: boolean, role: 'admin'|'member', commandId: string) {
    if (this.actor.role !== 'admin') throw new Failure(403,'ADMIN_REQUIRED');
    return this.transact(commandId,['member',memberId,frozen,role],{id:memberId,frozen,role},[
      this.guard(`${commandId}:admin`, "EXISTS(SELECT 1 FROM members WHERE id=? AND role='admin' AND frozen=0)",[this.actor.id]),
      this.guard(`${commandId}:last-admin`, `EXISTS(SELECT 1 FROM members WHERE id=?) AND
        (?=0 AND ?='admin' OR EXISTS(SELECT 1 FROM members WHERE id<>? AND role='admin' AND frozen=0))`,[memberId,frozen?1:0,role,memberId]),
      this.stmt('UPDATE members SET frozen=?,role=?,auth_epoch=auth_epoch+? WHERE id=?',frozen?1:0,role,frozen?1:0,memberId),
      this.event(null,'member.updated',memberId)
    ]);
  }
  async unread() {
    return (await this.stmt(`SELECT e.* FROM events e WHERE e.actor_id<>? AND NOT EXISTS(
      SELECT 1 FROM reads r WHERE r.member_id=? AND r.event_seq=e.seq) ORDER BY e.seq`,this.actor.id,this.actor.id).all()).results;
  }
  async markRead(seq: number) {
    await this.stmt('INSERT OR IGNORE INTO reads VALUES(?,?)',this.actor.id,seq).run();
    return {read:seq};
  }
}

async function putImage(request: Request, env: Env, attachmentId: string) {
  const rawTicket = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!rawTicket) throw new Failure(401,'UPLOAD_TICKET_REQUIRED');
  const ticketHash = await digest(rawTicket);
  const attachment = await env.DB.prepare(`SELECT a.*,m.frozen,e.closed FROM attachments a JOIN members m ON m.id=a.uploader_id
    JOIN entities e ON e.id=a.entity_id WHERE a.id=? AND a.ticket_hash=? AND a.uploaded=0 AND a.ticket_expires>? AND a.ticket_epoch=m.auth_epoch`)
    .bind(attachmentId,ticketHash,now()).first<{object_key:string;mime:string;bytes:number;sha256:string;frozen:number;closed:number}>();
  if (!attachment || attachment.frozen || attachment.closed) throw new Failure(403,'UPLOAD_NOT_ALLOWED');
  if (request.headers.get('Content-Type') !== attachment.mime) throw new Failure(400,'MIME_MISMATCH');
  const bytes = new Uint8Array(await request.arrayBuffer());
  const magic = [137,80,78,71,13,10,26,10];
  if (bytes.length!==attachment.bytes || magic.some((b,i)=>bytes[i]!==b) || await digest(bytes)!==attachment.sha256) throw new Failure(400,'IMAGE_MISMATCH');
  // The object is private. Only the authenticated read route below exposes it.
  await env.IMAGES.put(attachment.object_key,bytes,{httpMetadata:{contentType:attachment.mime}});
  const commandId=id();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(
        SELECT 1 FROM attachments a JOIN members m ON m.id=a.uploader_id JOIN entities e ON e.id=a.entity_id
        WHERE a.id=? AND a.ticket_hash=? AND a.uploaded=0 AND a.ticket_expires>? AND m.frozen=0 AND e.closed=0 AND a.ticket_epoch=m.auth_epoch
      ) THEN 1 ELSE 0 END)`).bind(commandId,attachmentId,ticketHash,now()),
      env.DB.prepare('UPDATE attachments SET uploaded=1,ticket_hash=NULL WHERE id=?').bind(attachmentId),
      env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(commandId)
    ]);
  } catch { throw new Failure(409,'UPLOAD_FINALIZATION_CONFLICT'); }
  return json({id:attachmentId,bytes:bytes.length,sha256:attachment.sha256});
}

function mcpServer(service: Archive, actor: Actor, origin: string) {
  const server=new McpServer({name:'cts-validation',version:'0.1.0'});
  const reply = async (action:()=>Promise<unknown>) => {
    try { const result=await action(); return {content:[{type:'text' as const,text:JSON.stringify(result)}]}; }
    catch(error) { return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:error instanceof Failure?error.code:'INTERNAL_ERROR'})}]}; }
  };
  server.registerTool('whoami',{description:'Return authenticated member identity. Synthetic validation service.',inputSchema:{}},async()=>({content:[{type:'text' as const,text:JSON.stringify({id:actor.id,role:actor.role})}]}));
  server.registerTool('create_entity',{description:'Create one synthetic test archive.',inputSchema:{name:z.string(),request_id:z.string()}},async({name,request_id})=>reply(()=>service.createEntity(name,request_id)));
  server.registerTool('get_entity',{description:'Read an archive, observation versions and history.',inputSchema:{entity_id:z.string()}},async({entity_id})=>reply(()=>service.get(entity_id)));
  server.registerTool('set_state',{description:'Change unordered state. Closed states lock content; open states reopen.',inputSchema:{entity_id:z.string(),state:z.enum(['observing','contacting','reviewing','joined','discarded']),expected_version:z.number(),request_id:z.string()}},async(a)=>reply(()=>service.setState(a.entity_id,a.state,a.expected_version,a.request_id)));
  server.registerTool('prepare_image_upload',{description:'Get a short-lived PUT upload URL and ticket for an image on disk. Upload bytes with a local HTTP tool before create_record. Ticket is not the account credential.',inputSchema:{entity_id:z.string(),mime:z.literal('image/png'),bytes:z.number(),sha256:z.string()}},async(a)=>reply(async()=>{const result=await service.prepareUpload(a.entity_id,a.mime,a.bytes,a.sha256);return {...result,uploadUrl:origin+result.uploadPath};}));
  server.registerTool('create_record',{description:'Create an observation with text and optional uploaded image IDs. Do not send local paths as images.',inputSchema:{entity_id:z.string(),body:z.string(),attachment_ids:z.array(z.string()).default([]),request_id:z.string()}},async(a)=>reply(()=>service.createRecord(a.entity_id,a.body,a.attachment_ids,a.request_id)));
  server.registerTool('change_record',{description:'Edit/delete/restore own observations. Admin can handle any. Closed archive rejects these operations.',inputSchema:{record_id:z.string(),operation:z.enum(['edit','delete','restore']),body:z.string().optional(),expected_version:z.number(),request_id:z.string()}},async(a)=>reply(()=>service.changeRecord(a.record_id,a.operation,a.body,a.expected_version,a.request_id)));
  server.registerTool('list_unread',{description:'Read the current member unread event list.',inputSchema:{}},async()=>reply(()=>service.unread()));
  return server;
}

const app=new Hono<{Bindings:Env}>();
app.onError((error)=>json({error:error instanceof Failure?error.code:'INTERNAL_ERROR'},error instanceof Failure?error.status:500));
app.get('/health',(c)=>json({ok:true,synthetic:true,country:c.req.raw.cf?.country,colo:c.req.raw.cf?.colo,asn:c.req.raw.cf?.asn,at:now()}));
// Disposable spike only: inventory before deleting verified synthetic objects.
app.get('/probe/cleanup',async(c)=>{
  if (!c.env.PROBE_ADMIN || c.req.header('X-Probe-Key')!==c.env.PROBE_ADMIN) throw new Failure(401,'UNAUTHENTICATED');
  const result=await c.env.IMAGES.list({prefix:'spike/',limit:1000});
  return json({keys:result.objects.map(o=>o.key),truncated:result.truncated});
});
app.post('/probe/cleanup',async(c)=>{
  if (!c.env.PROBE_ADMIN || c.req.header('X-Probe-Key')!==c.env.PROBE_ADMIN) throw new Failure(401,'UNAUTHENTICATED');
  const input=await c.req.json<{keys:string[]}>();
  if(!Array.isArray(input.keys)||input.keys.length>1000||input.keys.some(k=>typeof k!=='string'||!k.startsWith('spike/')))throw new Failure(400,'SYNTHETIC_KEYS_ONLY');
  if(input.keys.length)await c.env.IMAGES.delete(input.keys);
  return json({deleted:input.keys.length});
});
app.post('/probe/setup',async(c)=>{
  if (!c.env.PROBE_ADMIN || c.req.header('X-Probe-Key')!==c.env.PROBE_ADMIN) throw new Failure(401,'UNAUTHENTICATED');
  const input=await c.req.json<{members:{id:string;role:string;tokenHash:string}[]}>();
  const statements=['reads','events','revisions','attachments','records','entities','credentials','members','commands','mutation_guards'].map((t)=>c.env.DB.prepare(`DELETE FROM ${t}`));
  for(const member of input.members) {
    statements.push(c.env.DB.prepare('INSERT INTO members(id,role) VALUES(?,?)').bind(member.id,member.role));
    statements.push(c.env.DB.prepare('INSERT INTO credentials(hash,member_id) VALUES(?,?)').bind(member.tokenHash,member.id));
  }
  await c.env.DB.batch(statements);
  return json({ok:true});
});
app.post('/probe/password',async(c)=>{
  const actor=await actorFrom(c.req.raw,c.env); if(actor.role!=='admin')throw new Failure(403,'ADMIN_REQUIRED');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',encoder.encode('synthetic benchmark password'),'PBKDF2',false,['deriveBits']);
  const start=Date.now();
  try {
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},key,256);
    return json({algorithm:'PBKDF2-SHA256',iterations:600000,bytes:bits.byteLength,wallMs:Date.now()-start});
  } catch(error) {return json({algorithm:'PBKDF2-SHA256',iterations:600000,error:error instanceof Error?error.message:'FAILED'},422);}
});
app.post('/probe/scrypt',async(c)=>{
  const actor=await actorFrom(c.req.raw,c.env);if(actor.role!=='admin')throw new Failure(403,'ADMIN_REQUIRED');
  const start=Date.now();
  try {
    const result=await new Promise<Uint8Array>((resolve,reject)=>scrypt('synthetic benchmark password',crypto.getRandomValues(new Uint8Array(16)),64,{N:32768,r:8,p:3,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));
    return json({algorithm:'scrypt',N:32768,r:8,p:3,bytes:result.byteLength,wallMs:Date.now()-start});
  } catch(error) {return json({algorithm:'scrypt',error:error instanceof Error?error.message:'FAILED'},422);}
});
app.put('/uploads/:id',(c)=>putImage(c.req.raw,c.env,c.req.param('id')));
app.get('/images/:id',async(c)=>{
  await actorFrom(c.req.raw,c.env);
  const attachment=await c.env.DB.prepare('SELECT object_key,mime FROM attachments WHERE id=? AND uploaded=1').bind(c.req.param('id')).first<{object_key:string;mime:string}>();
  if(!attachment)throw new Failure(404,'NOT_FOUND');
  const object=await c.env.IMAGES.get(attachment.object_key);
  if(!object)throw new Failure(404,'NOT_FOUND');
  return new Response(object.body,{headers:{'Content-Type':attachment.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
});
app.all('/mcp',async(c)=>{
  const actor=await actorFrom(c.req.raw,c.env);
  const origin=new URL(c.req.url).origin;
  const service=new Archive(c.env,actor,'mcp');
  return createMcpHandler(()=>mcpServer(service,actor,origin),{corsOptions:false,allowedHostnames:[new URL(origin).hostname]})(c.req.raw,c.env,c.executionCtx as ExecutionContext);
});
app.all('/api/*',async(c)=>{
  // Cookie writes must be same-origin. Bearer callers do not rely on ambient browser credentials.
  if(c.req.method!=='GET' && !c.req.header('Authorization') && c.req.header('Origin')!==new URL(c.req.url).origin)throw new Failure(403,'ORIGIN_REJECTED');
  const actor=await actorFrom(c.req.raw,c.env);
  const service=new Archive(c.env,actor,'web');
  const route=c.req.path;
  if(route==='/api/whoami')return json({id:actor.id,role:actor.role});
  if(route==='/api/unread')return json(await service.unread());
  if(c.req.method==='GET' && route.startsWith('/api/entities/'))return json(await service.get(route.split('/').pop()!));
  const a=await c.req.json();
  if(route==='/api/entities')return json(await service.createEntity(a.name,a.request_id));
  if(route==='/api/state')return json(await service.setState(a.entity_id,a.state,a.expected_version,a.request_id));
  if(route==='/api/records')return json(await service.createRecord(a.entity_id,a.body,a.attachment_ids??[],a.request_id));
  if(route==='/api/records/change')return json(await service.changeRecord(a.record_id,a.operation,a.body,a.expected_version,a.request_id));
  if(route==='/api/uploads')return json(await service.prepareUpload(a.entity_id,a.mime,a.bytes,a.sha256));
  if(route==='/api/members')return json(await service.setMember(a.member_id,a.frozen,a.role,a.request_id));
  if(route==='/api/read')return json(await service.markRead(a.seq));
  throw new Failure(404,'NOT_FOUND');
});
export default app;
