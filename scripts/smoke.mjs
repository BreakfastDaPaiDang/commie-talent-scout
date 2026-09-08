import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectConfig} from './lib/cloudflare-admin.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
export async function smoke(environment,{compareAssets=true}={}){
 const {release}=projectConfig(),origin=release.environments[environment]?.origin;if(!origin)throw new Error('Unknown smoke environment');
 const request=(path,init={})=>fetch(origin+path,{...init,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Connection:'close','Cache-Control':'no-cache',...init.headers}});
 const health=await request('/api/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true,version:'0.1.0',environment});
 const html=await request('/');assert.equal(html.status,200);assert.ok(html.headers.get('content-security-policy')?.includes("default-src 'self'"));const text=await html.text();assert.ok(text.includes('id="root"'));
 if(compareAssets){const local=readFileSync('dist/index.html','utf8'),assets=[...local.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m=>m[1]);assert.ok(assets.length>=2);for(const asset of assets){assert.ok(text.includes(asset),'Deployed HTML must reference this build');const response=await request(asset);assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(readFileSync('dist'+asset)),'Deployed asset bytes differ');}}
 for(const path of ['/api/auth/me','/images/'+randomUUID(),'/mcp']){const response=await request(path);assert.equal(response.status,401,'Private route must require authentication');await response.arrayBuffer();}
 const login=await request('/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'smoke-'+randomUUID(),password:randomUUID()})});assert.equal(login.status,401);assert.equal((await login.json()).error.code,'INVALID_LOGIN');
 console.log(JSON.stringify({smoke:'passed',environment,asset_bytes_checked:compareAssets,private_routes:3,d1_login_path:true}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2);if(!args.includes('--env'))throw new Error('Use --env staging|production');await smoke(args[args.indexOf('--env')+1]);}
