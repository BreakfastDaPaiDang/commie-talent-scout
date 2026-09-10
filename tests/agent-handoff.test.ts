import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {bootstrapPrompt} from '../app/shared/agent-handoff.ts';

test('copied handoff supplies usable HTTP credentials without making persistence a prerequisite',()=>{
 const prompt=bootstrapPrompt(readFileSync('app/shared/bootstrap-prompt.txt','utf8'),'https://scout.example.invalid',{secret:'fixture-only',expires_at:'2026-12-01T00:00:00Z'}).replace(/\r\n/g,'\n');
 const config=JSON.parse(prompt.split('认证配置：\n')[1].split('\n凭据到期：')[0]).mcpServers.commie_talent_scout;
 assert.deepEqual(config,{url:'https://scout.example.invalid/mcp',headers:{Authorization:'Bearer fixture-only'}});
 assert.ok(!prompt.includes('{{'));
 assert.ok(!prompt.includes('先检查已有连接，并询问我是否需要持久配置'));
 assert.ok(prompt.indexOf('直接调用 whoami')<prompt.indexOf('默认先完成当前会话连接'));
 assert.ok(prompt.includes('持久化不是前置步骤'));
 assert.ok(prompt.includes('平台权限明确阻止请求'));
 assert.ok(prompt.includes('连接授权、修改草稿均不等于发布确认'));
});
