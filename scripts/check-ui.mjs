import {preview} from 'vite';
import {spawn} from 'node:child_process';
const server=await preview({preview:{host:'127.0.0.1',port:8791,strictPort:true}});
try{for(const name of ['design-parity','ui-simplicity','visual-cards','attention-ui'])await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[`scripts/verify-${name}.mjs`],{stdio:'inherit',env:{...process.env,CTS_UI_BASE:'http://127.0.0.1:8791'},windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${name} failed`)));});}finally{await new Promise(resolve=>server.httpServer.close(resolve));}
