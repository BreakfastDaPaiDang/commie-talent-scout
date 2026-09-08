import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
let active = false;
export class PasswordBusy extends Error {}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active) throw new PasswordBusy('密码验证繁忙，请稍后重试');
  if (Buffer.byteLength(password, 'utf8') > 1024) throw new Error('密码过长');
  active = true;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 32, parameters, (error, result) => error ? reject(error) : resolve(result));
    });
  } finally { active = false; }
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const result = await derive(password, salt);
  const hex=(bytes:Uint8Array)=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  return `scrypt$1$32768$8$3$${hex(salt)}$${hex(result)}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 7 || parts.slice(0, 5).join('$') !== 'scrypt$1$32768$8$3' ||
      !/^[a-f0-9]{32}$/.test(parts[5]) || !/^[a-f0-9]{64}$/.test(parts[6])) return false;
  return timingSafeEqual(await derive(password, Buffer.from(parts[5], 'hex')), Buffer.from(parts[6], 'hex'));
}
