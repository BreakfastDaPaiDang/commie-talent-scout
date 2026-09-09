import { defineConfig,type ProxyOptions } from 'vite';
import {pdfAssets} from './scripts/lib/pdf-assets.mjs';
const workerProxy:ProxyOptions={target:'http://127.0.0.1:8790',changeOrigin:true,configure(proxy){proxy.on('proxyReq',(request,incoming)=>{if(['http://127.0.0.1:5190','http://localhost:5190'].includes(String(incoming.headers.origin)))request.setHeader('Origin','http://127.0.0.1:8790');});}};
export default defineConfig({
  plugins:[pdfAssets()],
  root: 'app/client', publicDir: '../../public',
  build: { outDir: '../../dist', emptyOutDir: true },
  server: { proxy: Object.fromEntries(['/api','/images','/avatars','/uploads','/mcp','/materials','/material-uploads'].map(path=>[path,workerProxy])) },
});
