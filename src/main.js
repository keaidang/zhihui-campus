import { createApp } from 'vue';
import { createPinia } from 'pinia';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import { ElLoading } from 'element-plus';
// ★ Element Plus 按需引入（2026-09-21）：模板里的 el-* 组件及其样式改由
//   unplugin-vue-components 按需打包（见 vite.config.js），不再 app.use(ElementPlus) 全量注册。
//   以下三类模板插件捕获不到，必须显式引入：
//     ① 函数式 API 的样式（ElMessage / ElMessageBox 在 JS 里调用，不出现在模板中）
//     ② v-loading 指令的样式（指令注册见下方 app.use(ElLoading)）
//     ③ 中文 locale —— 改由 App.vue 的 <el-config-provider> 提供
import 'element-plus/es/components/message/style/css';
import 'element-plus/es/components/message-box/style/css';
import 'element-plus/es/components/loading/style/css';

import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';
import './styles.css';
// 移动端适配层：只含窄屏媒体查询，PC 端零影响（详见文件头铁律）
import './mobile.css';

const app = createApp(App);

// 图标仍整体注册：菜单卡片的图标用 `:is="m.icon"`（字符串组件名）动态渲染，
// 按需插件解析不了字符串形式，故该包保持全量（已在 vite.config 单独分包 ep-icons）
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component);
}

// v-loading 指令：指令不会被模板按需插件自动注册，需手动 use（样式已在顶部显式引入）
app.use(ElLoading);

const pinia = createPinia();
app.use(pinia);
app.use(router);
// ElementPlus 不再全量 use —— 组件按需打包；中文 locale 由 App.vue 的 el-config-provider 提供

// 全局错误兜底（2026-09-21 补）：此前未捕获的组件异常会中断渲染、表现为整页白屏。
// 这里只做"兜住 + 记录"，不弹窗打扰用户（业务错误已由 api/request.js 统一提示）。
app.config.errorHandler = (err, _instance, info) => {
  console.error('[vue-error]', info, err);
};
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled-rejection]', e.reason);
});

// ============================================================
// 首屏挂载门控（2026-10-12 修「白屏」）
// ------------------------------------------------------------
// 此前：`auth.restoreSession().finally(() => app.mount('#app'))`
//   → 挂载被「会话恢复」单条链路阻塞，而 restoreSession 内部是
//     tryRefresh() → fetchMe() 两次**串行**网络往返；期间 #app 是空 div，
//     index.html 里也没有任何占位 → 用户看到的是**整页白屏**（实测 6 秒级）。
//
// 现在：门控等「会话恢复」与「首个路由就绪」**两者都完成**，然后挂载。
//   ★ 两个都要等，缺一不可：
//     - 只等 router.isReady()：首页 `/` 不需要鉴权、守卫立即放行，会带着
//       auth.user === null 挂载 → HomeView / PortalShell 先渲染**游客态**，
//       等会话恢复回来再跳成登录态（肉眼可见的闪烁）。
//     - 只等 restoreSession()：路由 chunk 尚未就绪，首帧仍可能空白。
//   ★ 等待期间由 index.html 的启动页顶着（随文档到达即绘制），
//     「白屏」被替换为「有品牌的加载态」——这才是本次修复的可见效果。
//   ★ 真实耗时下降来自服务端：/api/auth/refresh 现已返回与 /auth/me 同构的
//     完整用户信息，restoreSession 不再需要第二次往返（详见 stores/auth.js）。
const auth = useAuthStore(pinia);
const sessionReady = auth.restoreSession().catch(() => {});
const routeReady = router.isReady().catch(() => {});
Promise.all([sessionReady, routeReady]).finally(() => app.mount('#app'));
