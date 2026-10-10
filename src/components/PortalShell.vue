<template>
  <div class="shell">
    <!-- 校园实景背景（与登录页同源），微虚化 + 极轻纱罩，让实景清晰透出 -->
    <div class="shell-bg" aria-hidden="true"></div>
    <div class="shell-veil" aria-hidden="true"></div>

    <!-- 顶栏 -->
    <header class="shell-top">
      <div class="shell-top-inner">
        <!-- 移动端专属：汉堡按钮（PC 视口下 v-if 为假，DOM 不存在） -->
        <button
          v-if="isMobile"
          class="shell-burger"
          type="button"
          aria-label="打开菜单"
          @click="drawerOpen = true"
        >
          <el-icon :size="20"><Menu /></el-icon>
        </button>
        <div class="shell-brand" @click="$router.push('/')">
          <img src="/logo.webp" alt="清北大学校徽" />
          <span class="shell-brand-text">智汇校园</span>
          <span class="shell-brand-sub">清北大学</span>
        </div>
        <div class="shell-user">
          <span class="shell-role">{{ roleLabel }}</span>
          <!-- 站内信未读提醒 -->
          <span class="shell-bell" title="消息中心" @click="$router.push('/messages')">
            <el-badge :value="unread" :hidden="unread === 0" :max="99">
              <el-icon :size="18"><Bell /></el-icon>
            </el-badge>
          </span>
          <el-dropdown @command="onCommand">
            <span class="shell-user-btn">
              <el-avatar :size="28" :style="{ background: 'var(--zc-navy)' }">
                {{ auth.user?.realName?.charAt(0) || 'U' }}
              </el-avatar>
              <span class="shell-username">{{ auth.user?.realName || auth.user?.username }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="workbench">工作台</el-dropdown-item>
                <el-dropdown-item command="home">返回首页</el-dropdown-item>
                <el-dropdown-item command="password">修改登录密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <div class="shell-body">
      <!-- 侧边菜单（按角色过滤 + 逻辑分组 + Sticky吸顶固定） -->
      <aside class="shell-side">
        <nav class="shell-nav">
          <div
            v-for="g in menuGroups"
            :key="g.key"
            class="shell-menu-group-block"
          >
            <div class="shell-menu-group-title">{{ g.label }}</div>
            <div
              v-for="m in g.items"
              :key="m.key"
              class="shell-menu"
              :class="{ active: m.key === active }"
              @click="$router.push(m.path)"
            >
              <el-icon :size="16"><component :is="m.icon" /></el-icon>
              <span>{{ m.label }}</span>
            </div>
          </div>
        </nav>
        <footer class="shell-side-foot">
          {{ auth.user?.deptName || '清北大学' }}
        </footer>
      </aside>

      <!-- 内容 -->
      <main class="shell-main">
        <slot />
      </main>
    </div>

    <!-- 移动端专属：抽屉菜单（PC 视口下 v-if 为假，DOM 与样式均不存在） -->
    <div v-if="isMobile && drawerOpen" class="shell-mask" @click="drawerOpen = false">
      <aside class="shell-drawer" @click.stop>
        <div class="shell-drawer-head">
          <img src="/logo.webp" alt="清北大学校徽" />
          <div class="shell-drawer-id">
            <div class="shell-drawer-title">智汇校园</div>
            <div class="shell-drawer-sub">{{ roleLabel }} · {{ auth.user?.realName || auth.user?.username || '' }}</div>
          </div>
        </div>
        <nav class="shell-drawer-nav">
          <div v-for="g in menuGroups" :key="g.key" class="shell-drawer-group-block">
            <div class="shell-drawer-group-title">{{ g.label }}</div>
            <div
              v-for="m in g.items"
              :key="m.key"
              class="shell-drawer-item"
              :class="{ active: m.key === active }"
              @click="goDrawer(m.path)"
            >
              <el-icon :size="18"><component :is="m.icon" /></el-icon>
              <span>{{ m.label }}</span>
            </div>
          </div>
        </nav>
        <div class="shell-drawer-foot">{{ auth.user?.deptName || '清北大学' }}</div>
      </aside>
    </div>

    <!-- 页脚：窄屏由 mobile.css 改为纵向排列（站点名一行、两个备案号各一行）。
         span 之间不留空白，保证 PC 端渲染与改动前逐字节一致。 -->
    <footer class="shell-foot"><span class="ft-main">清北大学 · 智汇校园一站式服务平台 © 2026</span><span class="ft-sep"> · </span><a class="ft-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2026056678号</a><span class="ft-sep"> · </span><a class="ft-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">鲁ICP备2025186072号</a></footer>

    <!-- 修改登录密码（自助改密；成功后服务端已吊销全部会话，故清本地令牌并回登录页） -->
    <el-dialog v-model="pwdDlg" title="修改登录密码" width="420px">
      <el-form label-position="top">
        <el-form-item label="原密码">
          <el-input v-model="pwdForm.oldPassword" type="password" show-password placeholder="当前登录密码" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="8~64 位" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="pwdForm.confirm" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
      </el-form>
      <p class="pwd-tip">修改成功后，其他设备的登录状态会失效，需要用新密码重新登录。</p>
      <template #footer>
        <el-button @click="pwdDlg = false">取消</el-button>
        <el-button type="primary" :loading="pwdSaving" @click="submitPwd">确认修改</el-button>
      </template>
    </el-dialog>

    <!-- AI 助手悬浮球（主色随角色变化；不在 /ai 页面本身出现） -->
    <AiOrb />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Bell, Menu } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { useAiStore } from '../stores/ai';
import { api } from '../api/request';
import { useIsMobile } from '../utils/device';
import AiOrb from './AiOrb.vue';

// 组件 props 仅在模板中按名使用（active 用于菜单高亮），脚本内无需引用故不赋值
defineProps({
  active: { type: String, default: 'workbench' },
});

const router = useRouter();
const auth = useAuthStore();
const ai = useAiStore();

// ---- 移动端布局开关：PC 全屏视口恒为 false，不渲染任何移动端 DOM ----
const isMobile = useIsMobile();
const drawerOpen = ref(false);

function goDrawer(path) {
  drawerOpen.value = false;
  router.push(path);
}

const ROLE_LABEL = {
  admin: '超级管理员',
  leader: '校领导',
  counselor: '辅导员',
  teacher: '教师',
  student: '学生',
};

const roleLabel = computed(() => ROLE_LABEL[auth.primaryRole] || '用户');

/** 统一菜单表：ALL = 全角色；具体能力由路由守卫 + 后端 scope 双重兜底 */
const MENUS = [
  { key: 'workbench', label: '工作台', icon: 'HomeFilled', path: '/workbench', roles: null, group: 'core' },
  // gate:'ai' → 仅当 AI 问答能力可用时才出现（未配置密钥/被管理员关闭时整体隐藏入口）
  { key: 'ai', label: 'AI 助手', icon: 'ChatDotRound', path: '/ai', roles: null, gate: 'ai', group: 'core' },
  { key: 'messages', label: '消息中心', icon: 'ChatLineRound', path: '/messages', roles: null, group: 'core' },

  { key: 'edu-elect', label: '课程选课', icon: 'Notebook', path: '/edu/elect', roles: ['student'], group: 'edu' },
  { key: 'edu-scores', label: '成绩课表', icon: 'Collection', path: '/edu/scores', roles: ['student'], group: 'edu' },
  { key: 'af-leave', label: '我的请假', icon: 'Clock', path: '/af/leave', roles: ['student'], group: 'edu' },
  { key: 'edu-teach', label: '我的课程', icon: 'Notebook', path: '/edu/teach', roles: ['teacher'], group: 'edu' },
  { key: 'edu-entry', label: '成绩录入', icon: 'EditPen', path: '/edu/score-entry', roles: ['teacher'], group: 'edu' },
  { key: 'af-approve', label: '请假审批', icon: 'Checked', path: '/af/approve', roles: ['counselor', 'admin'], group: 'edu' },
  { key: 'af-repair-m', label: '报修处理', icon: 'SetUp', path: '/af/repair-manage', roles: ['counselor', 'admin'], group: 'edu' },
  { key: 'af-notice', label: '公告中心', icon: 'Bell', path: '/af/notice', roles: null, group: 'edu' },

  { key: 'forum', label: '校园论坛', icon: 'ChatDotRound', path: '/forum', roles: null, group: 'life' },
  { key: 'library', label: '图书借阅', icon: 'Reading', path: '/library', roles: null, group: 'life' },
  { key: 'club', label: '社团活动', icon: 'Flag', path: '/club', roles: null, group: 'life' },
  { key: 'lf', label: '失物招领', icon: 'Search', path: '/lost-found', roles: null, group: 'life' },
  { key: 'dorm', label: '宿舍管理', icon: 'House', path: '/dorm', roles: null, group: 'life' },
  { key: 'mail', label: '校园邮箱', icon: 'Promotion', path: '/mail', roles: null, group: 'life' },

  { key: 'dashboard', label: '数据驾驶舱', icon: 'DataAnalysis', path: '/dashboard', roles: ['admin', 'leader'], group: 'admin' },
  { key: 'admin-students', label: '学生管理', icon: 'User', path: '/admin/students', roles: ['admin', 'counselor'], group: 'admin' },
  { key: 'admin-org', label: '系部与班级', icon: 'OfficeBuilding', path: '/admin/org', roles: ['admin', 'counselor'], group: 'admin' },
  { key: 'admin-courses', label: '课程与排课', icon: 'Reading', path: '/admin/courses', roles: ['admin'], group: 'admin' },
  { key: 'admin-users', label: '账号管理', icon: 'UserFilled', path: '/admin/users', roles: ['admin', 'counselor'], group: 'admin' },
  // 仅超管 + AI 管理控制台能力可用时出现
  { key: 'admin-ai', label: 'AI 管理控制台', icon: 'Setting', path: '/admin/ai', roles: ['admin'], gate: 'aiConsole', group: 'admin' },
];

const GROUPS = [
  { key: 'core', label: '常用核心' },
  { key: 'edu', label: '教务学工' },
  { key: 'life', label: '生活服务' },
  { key: 'admin', label: '管理运维' },
];

const menus = computed(() =>
  MENUS.filter((m) => {
    if (m.roles && !auth.hasRole(m.roles)) return false;
    if (m.gate === 'ai') return ai.chatOn;
    if (m.gate === 'aiConsole') return Boolean(ai.features.adminConsole);
    return true;
  }),
);

const menuGroups = computed(() => {
  const visible = menus.value;
  return GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: visible.filter((m) => m.group === g.key),
  })).filter((g) => g.items.length > 0);
});


// ---- 自助修改登录密码 ----
// 后端在改密成功后会吊销该用户**全部** refresh token，因此本地必须同步清会话并回登录页，
// 否则界面还是"已登录"样子、但任何刷新都会失败，用户会以为系统坏了。
const pwdDlg = ref(false);
const pwdSaving = ref(false);
const pwdForm = ref({ oldPassword: '', newPassword: '', confirm: '' });

async function submitPwd() {
  const f = pwdForm.value;
  if (!f.oldPassword || !f.newPassword) {
    ElMessage.warning('请填写原密码与新密码');
    return;
  }
  if (f.newPassword.length < 8 || f.newPassword.length > 64) {
    ElMessage.warning('新密码长度须为 8~64 位');
    return;
  }
  if (f.newPassword !== f.confirm) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  pwdSaving.value = true;
  try {
    const res = await api('/api/me/password', {
      method: 'POST',
      body: { oldPassword: f.oldPassword, newPassword: f.newPassword },
    });
    if (res.code !== 0) {
      ElMessage.error(res.message || '修改失败');
      return;
    }
    pwdDlg.value = false;
    ElMessage.success('密码已修改，请用新密码重新登录');
    auth.clearSession();
    router.push('/login');
  } finally {
    pwdSaving.value = false;
  }
}

async function onCommand(cmd) {
  if (cmd === 'logout') {
    await auth.logout();
    ai.reset(); // 清掉 AI 能力缓存，避免下个账号看到上一个账号的配色与能力项
    ElMessage.success('已退出登录');
    router.push('/login');
  } else if (cmd === 'workbench') {
    router.push('/workbench');
  } else if (cmd === 'home') {
    router.push('/');
  } else if (cmd === 'password') {
    pwdForm.value = { oldPassword: '', newPassword: '', confirm: '' };
    pwdDlg.value = true;
  }
}

// ---- 站内信未读数轮询（登录后每 60s 拉一次，静默失败不打扰用户） ----
const unread = ref(0);
let unreadTimer = null;

async function pollUnread() {
  if (!auth.accessToken) return;
  try {
    const res = await api('/api/notice/messages?scope=unread&page=1');
    if (res.code === 0) unread.value = res.data.unread;
  } catch { /* ignore */ }
}

onMounted(() => {
  if (auth.accessToken) pollUnread();
  unreadTimer = setInterval(pollUnread, 60_000);
  // AI 能力清单：菜单项与悬浮球都依赖它；store 内按用户去重，多页切换不会重复请求
  ai.load(auth.user?.id ?? null);
});
onUnmounted(() => clearInterval(unreadTimer));
</script>

<style scoped>
/* 改密对话框的提示文字 */
.pwd-tip {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--zc-text-sub);
}
.shell {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
/* 校园实景背景：微虚化，实景清晰可辨 */
.shell-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  background: url('/web-pc.webp') center / cover no-repeat;
  filter: blur(2px) saturate(1.05);
  transform: scale(1.03);
}
.shell-veil {
  position: fixed;
  inset: 0;
  z-index: 0;
  background: linear-gradient(180deg, rgba(240, 246, 252, 0.55) 0%, rgba(233, 241, 250, 0.62) 55%, rgba(226, 236, 248, 0.7) 100%);
}
.shell-top,
.shell-body,
.shell-foot {
  position: relative;
  z-index: 1;
}
.shell-top {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(23, 50, 92, 0.08);
  box-shadow: 0 1px 8px rgba(23, 50, 92, 0.05);
}
.shell-top-inner {
  height: 60px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.shell-brand { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.shell-brand img { width: 34px; height: 34px; object-fit: contain; }
.shell-brand-text { font-size: 18px; font-weight: 700; color: var(--zc-navy); letter-spacing: 2px; }
.shell-brand-sub { font-size: 12px; color: var(--zc-text-sub); padding-left: 10px; border-left: 1px solid var(--zc-border); letter-spacing: 1px; }
.shell-user { display: flex; align-items: center; gap: 14px; }
.shell-bell { display: flex; align-items: center; cursor: pointer; color: var(--zc-navy); padding: 4px; }
.shell-bell:hover { opacity: 0.8; }
.shell-role {
  font-size: 12px;
  color: var(--zc-navy);
  background: rgba(23, 50, 92, 0.07);
  border: 1px solid rgba(23, 50, 92, 0.18);
  border-radius: 999px;
  padding: 3px 12px;
  letter-spacing: 1px;
}
.shell-user-btn { display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--zc-text); }
.shell-username { font-size: 14px; }

.shell-body {
  flex: 1;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 22px 24px 40px;
  display: flex;
  gap: 22px;
  align-items: flex-start;
}
.shell-side {
  width: 204px;
  flex: none;
  position: sticky;
  top: 80px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  overflow-x: hidden;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 14px;
  padding: 12px 10px 14px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 30px rgba(15, 35, 66, 0.08);
  scrollbar-width: thin;
  scrollbar-color: rgba(23, 50, 92, 0.15) transparent;
}
.shell-side::-webkit-scrollbar {
  width: 4px;
}
.shell-side::-webkit-scrollbar-thumb {
  background: rgba(23, 50, 92, 0.15);
  border-radius: 4px;
}
.shell-nav {
  display: flex;
  flex-direction: column;
}
.shell-menu-group-block {
  margin-bottom: 12px;
}
.shell-menu-group-block:last-child {
  margin-bottom: 0;
}
.shell-menu-group-title {
  padding: 4px 10px 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--zc-text-sub);
  letter-spacing: 0.8px;
  opacity: 0.75;
}
.shell-menu {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--zc-text);
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
  margin-bottom: 2px;
}
.shell-menu:hover {
  background: rgba(23, 50, 92, 0.06);
  color: var(--zc-navy);
}
.shell-menu.active {
  background: linear-gradient(120deg, var(--zc-navy), #234a85);
  color: #fff;
  box-shadow: 0 4px 14px rgba(23, 50, 92, 0.22);
}
.shell-menu.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 20%;
  height: 60%;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--zc-gold);
}
.shell-side-foot {
  margin-top: auto;
  padding: 12px;
  font-size: 12px;
  color: var(--zc-text-sub);
  border-top: 1px solid var(--zc-border);
}
.shell-main { flex: 1; min-width: 0; }
.shell-foot {
  text-align: center;
  padding: 16px 0 26px;
  font-size: 12.5px;
  color: var(--zc-text-sub);
  letter-spacing: 1px;
}
.shell-foot a { color: inherit; text-decoration: none; }
.shell-foot a:hover { text-decoration: underline; }

/* ============ 移动端（≤820px）============
   本块仅作用于窄屏视口，PC 全屏布局完全不受影响 */
@media (max-width: 820px) {
  /* 侧边栏改由抽屉承载，不再堆叠在内容上方 */
  .shell-body { flex-direction: column; gap: 14px; padding: 14px 12px 28px; }
  .shell-side { display: none; }
  .shell-brand-sub { display: none; }

  /* 顶栏精简：汉堡 + 品牌 + 铃铛 + 头像 */
  .shell-top-inner { height: 54px; padding: 0 12px; gap: 8px; }
  .shell-burger {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; flex: none; padding: 0;
    border: none; border-radius: 9px; background: transparent;
    color: var(--zc-navy); cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .shell-burger:active { background: rgba(23, 50, 92, 0.08); }
  .shell-brand { margin-right: auto; gap: 8px; }
  .shell-brand img { width: 30px; height: 30px; }
  .shell-brand-text { font-size: 16px; letter-spacing: 1px; }
  .shell-role { display: none; }
  .shell-username { display: none; }

  /* 抽屉菜单 */
  .shell-mask {
    position: fixed; inset: 0; z-index: 60;
    background: rgba(12, 24, 44, 0.42);
    -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  }
  .shell-drawer {
    position: absolute; left: 0; top: 0; bottom: 0;
    width: 76%; max-width: 300px;
    display: flex; flex-direction: column;
    background: #fff;
    box-shadow: 6px 0 28px rgba(15, 35, 66, 0.22);
    animation: shell-drawer-in 0.22s ease-out;
  }
  @keyframes shell-drawer-in {
    from { transform: translateX(-100%); }
    to { transform: translateX(0); }
  }
  .shell-drawer-head {
    display: flex; align-items: center; gap: 10px;
    padding: 16px 16px 14px;
    border-bottom: 1px solid var(--zc-border);
    background: linear-gradient(120deg, var(--zc-navy), #234a85);
    color: #fff;
  }
  .shell-drawer-head img { width: 34px; height: 34px; object-fit: contain; }
  .shell-drawer-title { font-size: 16px; font-weight: 700; letter-spacing: 1.5px; }
  .shell-drawer-sub { font-size: 12px; opacity: 0.85; margin-top: 2px; }
  .shell-drawer-nav { flex: 1; overflow-y: auto; padding: 12px 10px; -webkit-overflow-scrolling: touch; }
  .shell-drawer-group-block { margin-bottom: 12px; }
  .shell-drawer-group-title {
    padding: 4px 10px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--zc-text-sub);
    letter-spacing: 0.8px;
    opacity: 0.75;
  }
  .shell-drawer-item {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px; border-radius: 8px;
    font-size: 14.5px; color: var(--zc-text); cursor: pointer;
    margin-bottom: 2px;
  }
  .shell-drawer-item:active { background: rgba(23, 50, 92, 0.07); }
  .shell-drawer-item.active {
    background: linear-gradient(120deg, var(--zc-navy), #234a85);
    color: #fff;
  }
  .shell-drawer-foot {
    padding: 12px 16px;
    font-size: 12px; color: var(--zc-text-sub);
    border-top: 1px solid var(--zc-border);
  }
}
</style>
