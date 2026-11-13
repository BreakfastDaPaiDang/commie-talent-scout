import test from 'node:test';
import assert from 'node:assert/strict';
import {installRandomUUID} from '../app/shared/browser-crypto.ts';

test('a native randomUUID stays intact, including after repeated startup',()=>{
 const native=crypto.randomUUID;
 installRandomUUID(crypto);installRandomUUID(crypto);
 assert.equal(crypto.randomUUID,native);
});

test('missing randomUUID uses secure browser randomness and produces distinct valid request IDs',()=>{
 const target:Partial<Crypto>={getRandomValues:crypto.getRandomValues.bind(crypto)};
 installRandomUUID(target);
 const fallback=target.randomUUID!;
 installRandomUUID(target);assert.equal(target.randomUUID,fallback);
 const ids=Array.from({length:256},()=>fallback());
 for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(new Set(ids).size,ids.length);
});

test('fallback preserves the crypto receiver and full random bytes except UUID version/variant',()=>{
 const target:Partial<Crypto>={getRandomValues(bytes){
  assert.equal(this,target);
  assert.ok(bytes instanceof Uint8Array);assert.equal(bytes.byteLength,16);
  bytes.set([0,1,2,3,4,5,6,7,255,9,10,11,12,13,14,15]);
  return bytes;
 }};
 installRandomUUID(target);
 assert.equal(target.randomUUID!(),'00010203-0405-4607-bf09-0a0b0c0d0e0f');
});

test('no weak random fallback when cryptographic randomness is unavailable or fails',()=>{
 const unavailable:Partial<Crypto>={};
 installRandomUUID(undefined);installRandomUUID(unavailable);
 assert.equal(unavailable.randomUUID,undefined);
 const target:Partial<Crypto>={getRandomValues(){throw new Error('secure randomness unavailable');}};
 installRandomUUID(target);
 assert.throws(()=>target.randomUUID!(),/secure randomness unavailable/);
});
