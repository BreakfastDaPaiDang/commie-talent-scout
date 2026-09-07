import { access, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

// Refuse to replace existing local authorization. Never print secret values.
for (const name of ['test-credentials.json', '.dev.vars']) {
  try { await access(name); throw new Error(`${name} already exists; initialization stopped`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const token = () => randomBytes(32).toString('base64url');
const credentials = {probeKey: token(), tokens: Object.fromEntries(['alice','bob','admin','admin2'].map(id=>[id,token()]))};
await writeFile('test-credentials.json', JSON.stringify(credentials,null,2), {flag:'wx',mode:0o600});
await writeFile('.dev.vars', `PROBE_ADMIN=${credentials.probeKey}\n`, {flag:'wx',mode:0o600});
await mkdir('test-output',{recursive:true});
console.log('Created ignored local credentials and output directory. No secrets printed.');
