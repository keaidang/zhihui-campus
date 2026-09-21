import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  plugins: [
    vue(),
    // ★ Element Plus 按需引入（2026-09-21）
    // 原先 app.use(ElementPlus) 全量注册，产物里 EP 单包 1.09MB（gzip 341KB），
    // 而项目实际只用到 36 个 el-* 组件。改为模板里出现哪个组件就打包哪个（含其样式）。
    // 注意：有三类东西模板插件捕获不到，必须在 main.js 显式引入 ——
    //   ① ElMessage / ElMessageBox 等函数式 API 的样式（JS 调用，不在模板里）
    //   ② v-loading 指令的注册与样式
    //   ③ 中文 locale（改由 App.vue 的 <el-config-provider> 提供）
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: false, // 纯 JS 项目，不生成 auto-imports.d.ts
    }),
    Components({
      dirs: [], // 只做 EP 组件解析；本地组件项目一直显式 import，不做目录自动注册
      resolvers: [ElementPlusResolver()],
      dts: false,
    }),
  ],
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
        // 大依赖拆独立 chunk：业务代码变更不再打爆整包，三方库缓存命中率高。
        // ⚠ 不能再用 'element-plus': ['element-plus'] —— 那会把整个包拉进单个 chunk，
        //   直接废掉按需引入。EP 组件现在跟随各自页面自然分包。
        manualChunks: {
          'ep-icons': ['@element-plus/icons-vue'], // 图标仍整体引入（:is 字符串组件名无法按需解析）
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'lucide': ['lucide-vue-next'],
          'dompurify': ['dompurify'],
        },
      },
    },
  },
});
