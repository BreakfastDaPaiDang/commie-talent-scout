export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: 'staging' | 'production';
  APP_ORIGIN: string;
};
export type Actor = {
  id: string; username: string; name: string; role: 'admin' | 'member'; frozen: number;
  auth_epoch: number; must_change_password: number; version: number;
  credential_id: string; credential_kind: 'session' | 'mcp'; qq: string | null; avatar_id: string | null;
};
export class Failure extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export async function digest(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function publicMember(actor: Actor) {
  return { id:actor.id, username:actor.username, name:actor.name, role:actor.role,
    must_change_password:!!actor.must_change_password, version:actor.version, qq:actor.qq, avatar_id:actor.avatar_id };
}
