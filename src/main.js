import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import 'element-plus/dist/index.css';

import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';
import './styles.css';
// 移动端适配层：只含窄屏媒体查询，PC 端零影响（详见文件头铁律）
import './mobile.css';

const app = createApp(App);

for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component);
}

const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(ElementPlus, { locale: zhCn });

// 挂载前静默恢复会话：F5 后用 refreshToken 换回 accessToken，避免"刷新页面就掉线"
const auth = useAuthStore(pinia);
auth.restoreSession().catch(() => {}).finally(() => app.mount('#app'));
