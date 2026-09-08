import { defineConfig } from 'vite';
export default defineConfig({
  root: 'app/client', publicDir: '../../public',
  build: { outDir: '../../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8790', '/images': 'http://127.0.0.1:8790', '/mcp': 'http://127.0.0.1:8790' } },
});
