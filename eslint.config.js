// eslint.config.js —— 只启用「能当场落地」的规则
//
// 设计取舍（别随手加规则，违反者会让 lint 被无视）：
//   目标 = 拦住真实缺陷：未定义变量、未使用变量、Vue 模板解析错误、误用 await 等；
//   不目标 = 代码风格统一：缩进/引号/换行/属性排序一律不管 —— 项目已有既定风格，
//            引入格式类规则只会产生几百条历史噪音，最终结果是"没人再看 lint"。
//   因此规则集用 vue 的 **flat/essential**（错误级），而不是 flat/recommended（含大量格式规则）。
//
// 排除范围：一次性运维脚本（scripts/、.shots/）与构建产物不强求风格一致。
import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'working/**', // 会话调试产物
      '.shots/**', // 本地验证脚本（截图/探针，用完即弃）
      'scripts/**', // 一次性运维脚本（seed/migrate/冒烟），写法各异
    ],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // 显式下划线前缀表示"故意不用"（如 (_, i) => ...）
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 项目大量使用 `catch { /* 注释说明 */ }` 做尽力而为的兜底，空块是有意为之
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
      // 常见写法 `let x = 初值; try { x = ... } catch { x = ... }` 会被本规则判为
      // "初始赋值无用" —— 属误报（且是刻意的防御性写法），关闭
      'no-useless-assignment': 'off',
    },
  },
  {
    // 云端运行时：没有 window，使用 Node 全局
    files: ['node-functions/**/*.js', 'edge-functions/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // EdgeOne 边缘函数由平台注入的绑定：KV 命名空间（本项目绑定名 zhihuicampus）
    files: ['edge-functions/**/*.js'],
    languageOptions: { globals: { zhihuicampus: 'readonly' } },
  },
];
