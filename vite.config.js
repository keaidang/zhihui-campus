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
    rollupOptions: {
      output: {
        // 大依赖拆独立 chunk：业务代码变更不再打爆整包，三方库缓存命中率高
        manualChunks: {
          'element-plus': ['element-plus', '@element-plus/icons-vue'],
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'lucide': ['lucide-vue-next'],
          'dompurify': ['dompurify'],
        },
      },
    },
  },
});
