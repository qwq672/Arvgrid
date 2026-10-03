import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cloudflare Rocket Loader bypass：给所有 script 标签加 data-cfasync="false"
// Rocket Loader 会拦截 script 异步加载，干扰 AudioWorklet 消息传递
function cfBypassPlugin() {
  return {
    name: 'cf-bypass',
    transformIndexHtml(html) {
      return html.replace(
        /<script(\s+type="module")?(\s+crossorigin)?(\s+src=)/g,
        '<script$1$2 data-cfasync="false"$3'
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), cfBypassPlugin()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
    target: 'es2018',
  },
  worker: {
    format: 'es',
  },
});
