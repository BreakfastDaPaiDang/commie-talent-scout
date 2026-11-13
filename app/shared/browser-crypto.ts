// Some mobile browsers expose secure random bytes but not randomUUID. Load this
// before UI modules so request IDs and local draft IDs use the same UUID contract.
export function installRandomUUID(target?: Partial<Pick<Crypto,'randomUUID'|'getRandomValues'>>): void {
 if(!target||typeof target.randomUUID==='function'||typeof target.getRandomValues!=='function')return;
 const randomBytes=target.getRandomValues.bind(target);
 Object.defineProperty(target,'randomUUID',{
  configurable:true,enumerable:true,writable:true,
  value:():ReturnType<Crypto['randomUUID']>=>{
   const bytes=randomBytes(new Uint8Array(16));
   bytes[6]=(bytes[6]&0x0f)|0x40;
   bytes[8]=(bytes[8]&0x3f)|0x80;
   const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
   return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}` as ReturnType<Crypto['randomUUID']>;
  }
 });
}

installRandomUUID(globalThis.crypto);
