import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';

// Verify what the live server actually serves, without claiming layout/paint coverage.
const base=process.argv.includes('--remote')?'https://scout-staging.dapaidang.org':(process.env.CTS_UI_BASE??'http://127.0.0.1:8790');
const html=readFileSync('dist/index.html','utf8'),cssPath=html.match(/href="([^" ]+\.css)"/)?.[1];
assert.ok(cssPath,'build first');
const css=readFileSync('dist'+cssPath,'utf8'),served=await fetch(base).then(r=>r.text());
assert.ok(served.includes(cssPath),'server must serve the current build');
assert.ok(await fetch(base+cssPath).then(r=>r.text())===css,'server must serve the exact built stylesheet');
const artPath='/art/observation-pause-v3.png',art=await fetch(base+artPath);assert.ok(art.headers.get('content-type')?.startsWith('image/png'),'empty-state illustration must be served as an image, not SPA fallback');assert.deepEqual(Buffer.from(await art.arrayBuffer()),readFileSync('public'+artPath));
const dom=new JSDOM('<style>'+css+'</style><span class="tag-chip tag-teal">测试标签</span>',{virtualConsole:new VirtualConsole()});
try{
 const style=dom.window.getComputedStyle(dom.window.document.querySelector('.tag-chip'));
 assert.equal(style.backgroundColor,'rgb(223, 240, 234)');assert.equal(style.borderRadius,'2px');
 console.log(JSON.stringify({base,stylesheet:cssPath,tagBackground:style.backgroundColor,tagRadius:style.borderRadius,exactBuiltStylesheet:true}));
}finally{dom.window.close();}
