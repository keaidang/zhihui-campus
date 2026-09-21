// vitest 配置 —— 只跑纯逻辑单测
//
// 定位（重要）：本层**不做组件测试**，因此不加载 vue 插件，也不依赖 jsdom。
//   需要"真实页面/真实接口"的验证走 scripts/e2e-smoke.mjs（Playwright + 线上环境）。
//   这样单测保持秒级、无环境依赖，才能进 pre-commit 与 npm run check。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.js'],
    environment: 'node',
    restoreMocks: true,
    // 时区说明：time.spec.js 采用「语义断言 + 本机为 UTC+8 时的强断言」两级策略，
    // 不依赖执行机时区（详见该文件顶部注释），故此处不强制 TZ。
  },
});
