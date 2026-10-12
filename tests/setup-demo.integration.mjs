import assert from 'node:assert/strict';
import {existsSync,readFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import test from 'node:test';

const root=resolve(import.meta.dirname,'..');
const node=process.execPath;
const wrangler=resolve(root,'node_modules/wrangler/bin/wrangler.js');
const run=(args)=>spawnSync(node,args,{cwd:root,encoding:'utf8'});
const query=(sql)=>{
 const r=run([wrangler,'d1','execute','cts-staging','--env','staging','--local','--command',sql,'--json']);
 assert.equal(r.status,0,r.stderr);
 const start=r.stdout.indexOf('[');
 assert.notEqual(start,-1,r.stdout);
 return JSON.parse(r.stdout.slice(start));
};

test('local demo setup creates isolated accounts, records, tasks and images',()=>{
 const setup=run(['scripts/setup-demo.mjs','--reset']);
 assert.equal(setup.status,0,setup.stderr||setup.stdout);
 const accounts=JSON.parse(readFileSync(resolve(root,'secrets/demo-local-accounts.json'),'utf8'));
 assert.equal(accounts.environment,'local');
 assert.match(accounts.admin.password,/^.{20,}$/);
 assert.match(accounts.member.password,/^.{20,}$/);
 assert.match(accounts.mcp_token,/^cts_demo_/);
 assert.match(JSON.stringify(accounts),/demo_admin/);
 const rows=query(`SELECT
   (SELECT count(*) FROM members WHERE id IN ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')) AS members,
   (SELECT count(*) FROM archives WHERE id IN ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001')) AS archives,
   (SELECT count(*) FROM work_tasks WHERE id IN ('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004')) AS tasks,
   (SELECT count(*) FROM attachments WHERE id IN ('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002') AND state='ready') AS images;`);
 const row=rows[0].results[0];
 assert.deepEqual({members:row.members,archives:row.archives,tasks:row.tasks,images:row.images},{members:2,archives:5,tasks:4,images:2});
 const output=resolve(root,'tmp/demo-test-image.png');
 const image=run([wrangler,'r2','object','get','cts-staging-images/demo/archive-avatar.png','--local','--file',output]);
 assert.equal(image.status,0,image.stderr);
 assert.ok(existsSync(output));
 assert.ok(readFileSync(output).length>100);
 unlinkSync(output);
});
