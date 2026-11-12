import test from 'node:test';
import assert from 'node:assert/strict';
import {smoke} from '../scripts/smoke.mjs';

function transport(state){return async(url)=>{const path=new URL(url).pathname;if(path==='/api/health')return Response.json(state);if(path==='/')return new Response('<div id="root"></div>',{headers:{'Content-Security-Policy':"default-src 'self'"}});return Response.json({error:{code:'INVALID_LOGIN'}},{status:401});};}
test('release smoke allows additive health capabilities in both environments',async t=>{
 for(const environment of ['staging','production']){t.mock.method(globalThis,'fetch',transport({ok:true,version:'1.0.0',environment,catalog_bridge:1,knowledge_workspace:1}));await smoke(environment,{compareAssets:false});}
});
test('release smoke still rejects wrong environment, product version and health status',async t=>{
 for(const override of [{environment:'production'},{version:'wrong'},{ok:false}]){t.mock.method(globalThis,'fetch',transport({ok:true,version:'1.0.0',environment:'staging',...override}));await assert.rejects(smoke('staging',{compareAssets:false}),{code:'ERR_ASSERTION'});}
});
