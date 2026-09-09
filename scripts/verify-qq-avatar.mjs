import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setDefaultResultOrder} from 'node:dns';
import {setDefaultAutoSelectFamily} from 'node:net';
import {chromium} from 'playwright-core';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
setDefaultResultOrder('ipv4first');setDefaultAutoSelectFamily(false);
const production=process.argv.includes('--production'),environment=production?'production':'staging';
const qq=process.env.CTS_QQ_AVATAR_QQ,username=process.env.CTS_QQ_AVATAR_USERNAME;
assert.match(qq??'',/^\d{5,20}$/,'Provide CTS_QQ_AVATAR_QQ for the requested avatar');if(production)assert.ok(username,'Provide CTS_QQ_AVATAR_USERNAME for the production read-only check');
const base=production?'https://scout.dapaidang.org':'https://scout-staging.dapaidang.org';
const admin=JSON.parse(readFileSync(production?'secrets/development-test-admin.json':'secrets/bootstrap-staging-remote-admin.json','utf8'));
let cookie,fixture,connection,client,browser;
async function http(path,body){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();assert.equal(r.status,200,result.error?.code);return {body:result,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
try{
 const login=await http('/auth/login',{username:admin.username,password:admin.password});cookie=login.cookie;
 let member;
 if(production){member=(await http('/admin/members')).body.members.find(m=>m.username===username);assert.ok(member);}
 else{fixture=(await http('/admin/members/create',{username:'qqcheck-'+randomUUID().slice(0,8),name:'虚构 QQ 头像验收',qq,temporary_password:randomUUID()+'Aa9!',request_id:randomUUID()})).body;member=fixture;}
 assert.equal(member.qq,qq);const path='/avatars/members/'+member.id+'?v='+member.version;
 const image=await fetch(base+path,{headers:{Cookie:cookie}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');const bytes=(await image.arrayBuffer()).byteLength;assert.ok(bytes>1000);
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),[name,...value]=cookie.split('=');await context.addCookies([{name,value:value.join('='),url:base}]);const page=await context.newPage();
 const out='tmp/verification/qq-avatar-'+environment;mkdirSync(out,{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(base+'/admin/members');const avatar=page.locator('img[src*="/avatars/members/'+member.id+'"]');await avatar.first().waitFor();await avatar.first().evaluate(async image=>{await image.decode();if(image.naturalWidth!==640||image.naturalHeight!==640)throw new Error('QQ image did not decode at its original dimensions');});assert.deepEqual(await page.locator('.avatar').evaluateAll(avatars=>avatars.flatMap(avatar=>{const filters=[];for(let e=avatar;e;e=e.parentElement){const filter=getComputedStyle(e).filter;if(/grayscale|saturate/.test(filter))filters.push(filter);}return filters;})),[],'Avatars must retain the source colors, including the account menu');await page.screenshot({path:out+'/'+width+'.png'});}
 connection=(await http('/connections',{name:'开发验收：QQ头像与管理工具清单',days:1})).body;client=new Client({name:'cts-avatar-verification',version:'0.1.0'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.secret}}}));
 const names=new Set((await client.listTools()).tools.map(t=>t.name)),required=['delete_archive','restore_archive','create_member','set_member_frozen'];for(const name of required)assert.ok(names.has(name),name+' missing');
 writeFileSync(out+'/result.json',JSON.stringify({environment,image_status:200,bytes,decoded:[640,640],widths:[1440,390],mcp_tools:required},null,2));console.log(JSON.stringify({environment,avatar:'decoded',bytes,mcp_tools:required}));
}finally{
 if(browser)await browser.close();if(client)await client.close();if(connection?.id)await http('/connections/revoke',{id:connection.id});
 if(fixture){const member=(await http('/admin/members/'+fixture.id)).body.member;const updated=(await http('/admin/members/profile',{id:member.id,expected_version:member.version,name:member.name,qq:null,request_id:randomUUID()})).body;await http('/admin/members/frozen',{id:member.id,expected_version:updated.version,frozen:true,request_id:randomUUID()});}
 if(cookie)await http('/auth/logout',{});
}
