import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Dev-only: lets `npm run dev` (a normal web page, no host permissions) reach the Blockbook
// indexers. Requests go out from Node; run with NODE_USE_ENV_PROXY=1 behind a proxy.
const DEV_UPSTREAMS: Record<string, string> = {
  mainnet: 'https://blockbook.pearlresearch.ai',
  testnet2: 'https://blockbook.testnet.pearlresearch.ai',
};
// mining pools (read-only GETs)
const DEV_POOLS: Record<string, string> = { pearlhash: 'https://pearlhash.xyz' };

function devIndexerProxy(): Plugin {
  return {
    name: 'akoya-dev-indexer-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__pool', async (req, res) => {
        const m = /^\/(\w+)(\/api\/[\w/-]+)$/.exec(req.url ?? '');
        if (!m || !DEV_POOLS[m[1]] || req.method !== 'GET') {
          res.statusCode = 404;
          return res.end();
        }
        try {
          const up = await fetch(DEV_POOLS[m[1]] + m[2]);
          res.statusCode = up.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(await up.text());
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: `dev proxy: ${String(e)}` }));
        }
      });
      server.middlewares.use('/__bb', async (req, res) => {
        const m = /^\/(mainnet|testnet2)(\/.*)$/.exec(req.url ?? '');
        if (!m) {
          res.statusCode = 404;
          return res.end();
        }
        try {
          const body = req.method === 'POST' ? await new Promise<string>(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b)); }) : undefined;
          const up = await fetch(DEV_UPSTREAMS[m[1]] + m[2], { method: req.method, body, headers: body ? { 'Content-Type': 'text/plain' } : undefined });
          res.statusCode = up.status;
          res.setHeader('Content-Type', up.headers.get('content-type') ?? 'application/json');
          res.end(await up.text());
        } catch (e) {
          const cause = (e as { cause?: { code?: string } }).cause?.code;
          res.statusCode = 502;
          res.end(JSON.stringify({ error: `dev proxy: ${String(e)}${cause ? ` (${cause})` : ''}${` — proxy=${(process.env.HTTPS_PROXY || process.env.https_proxy || 'unset').replace(/\/\/[^@/]*@/, '//***@')}`}` }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devIndexerProxy()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome120',
    modulePreload: { polyfill: false },
    // Loaded from the extension package, not the network — a single ~500 kB chunk is fine.
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      input: { popup: 'popup.html' },
      onwarn(warning, warn) {
        // @scure/base ships a /* @__PURE__ */ comment Rollup can't place; it is dropped harmlessly.
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/node_modules/@scure/base/')) return;
        warn(warning);
      },
    },
  },
  server: { port: 5199, strictPort: true },
});
