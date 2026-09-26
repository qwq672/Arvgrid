import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // 将第三方依赖单独拆分，提升浏览器缓存命中率
    rollupOptions: {
      output: {
        manualChunks: {
          // React 运行时单独拆分，版本稳定后用户更新代码无需重下 react
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
    // 警告阈值提高到 600KB，避免 lamejs 动态导入的 chunk 触发警告噪音
    chunkSizeWarningLimit: 600,
  },
});
