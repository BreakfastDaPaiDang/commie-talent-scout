import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {watchSession} from '../app/client/session-refresh';

test('restored pages recheck uncached sessions; expired, transient and superseded responses stay distinct',async()=>{
 const dom=new JSDOM('',{url:'https://example.invalid',pretendToBeVisual:true}),w=dom.window;
 Object.assign(globalThis,{window:w,document:w.document});
 const results:unknown[]=[],pending:((r:Response)=>void)[]=[],options:RequestInit[]=[];
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{options.push(init!);return await new Promise<Response>(resolve=>pending.push(resolve));};
 const restore=()=>{const e=new w.Event('pageshow');Object.defineProperty(e,'persisted',{value:true});w.dispatchEvent(e);};
 const flush=()=>new Promise(resolve=>setTimeout(resolve,0));const record=(value:unknown)=>{results.push(value);};let stop=watchSession(record);
 try{
  restore();assert.equal(options[0].cache,'no-store');pending.shift()!(Response.json({error:{code:'UNAUTHENTICATED'}},{status:401}));await flush();assert.deepEqual(results,[null]);
  restore();pending.shift()!(Response.json({error:{code:'TEMPORARY_FAILURE'}},{status:503}));await flush();assert.deepEqual(results,[null]);
  restore();const late=pending.shift()!;stop();stop=watchSession(record);restore();pending.shift()!(Response.json({member:{id:'new-session',version:1}}));await flush();late(Response.json({member:{id:'old-session',version:1}}));await flush();assert.deepEqual(results,[null,{id:'new-session',version:1}]);
 }finally{stop();globalThis.fetch=oldFetch;dom.window.close();}
});
