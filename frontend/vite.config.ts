import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Reads only VITE_API_PROXY from the shared root .env. Vite's loadEnv() is not
 * used here: it also picks up NODE_ENV=development from that file and would
 * make `vite build` produce a development bundle.
 */
function apiProxyTarget() {
  if (process.env.VITE_API_PROXY) return process.env.VITE_API_PROXY;
  try {
    const text = fs.readFileSync(path.resolve(import.meta.dirname, '..', '.env'), 'utf8');
    const m = /^\s*VITE_API_PROXY\s*=\s*["']?([^"'\r\n#]+)/m.exec(text);
    return m?.[1].trim();
  } catch {
    return undefined;
  }
}

export default defineConfig(() => {
  const proxyTarget = apiProxyTarget();
  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: {
      port: 5173,
      // In development the SPA calls /api on its own origin; Vite forwards to the API.
      proxy: { '/api': { target: proxyTarget || 'http://127.0.0.1:4000', changeOrigin: false } },
    },
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 1200,
      rolldownOptions: {
        output: {
          // The framework changes rarely, so it gets its own long-cached chunk; a
          // release then only invalidates the much smaller application code.
          codeSplitting: {
            groups: [{ name: 'framework', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@tanstack)[\\/]/ }],
          },
        },
      },
    },
  };
});
