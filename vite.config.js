import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // 本地开发代理：/api 转发说明见 docs/ARCHITECTURE.md
    proxy: {
      // 开发期直接用 edgeone pages dev 时无需此代理，纯 vite 调试用
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
