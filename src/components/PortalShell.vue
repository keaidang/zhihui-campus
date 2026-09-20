<template>
  <div class="shell">
    <!-- 校园实景背景（与登录页同源），微虚化 + 极轻纱罩，让实景清晰透出 -->
    <div class="shell-bg" aria-hidden="true"></div>
    <div class="shell-veil" aria-hidden="true"></div>

    <!-- 顶栏 -->
    <header class="shell-top">
      <div class="shell-top-inner">
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
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <div class="shell-body">
      <!-- 侧边菜单（按角色过滤） -->
      <aside class="shell-side">
        <nav>
          <div
            v-for="m in menus"
            :key="m.key"
            class="shell-menu"
            :class="{ active: m.key === active }"
            @click="$router.push(m.path)"
          >
            <el-icon :size="16"><component :is="m.icon" /></el-icon>
            <span>{{ m.label }}</span>
          </div>
          <template v-if="pendingMenus.length">
            <div class="shell-menu-group">即将上线</div>
            <div v-for="m in pendingMenus" :key="m.label" class="shell-menu disabled">
              <el-icon :size="16"><component :is="m.icon" /></el-icon>
              <span>{{ m.label }}</span>
              <em>筹备中</em>
            </div>
          </template>
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

    <footer class="shell-foot">
      清北大学 · 智汇校园一站式服务平台 © 2026 ·
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2026056678号</a>
      ·
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">鲁ICP备2025186072号</a>
    </footer>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Bell } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { api } from '../api/request';

const props = defineProps({
  active: { type: String, default: 'workbench' },
});

const router = useRouter();
const auth = useAuthStore();

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
  { key: 'workbench', label: '工作台', icon: 'HomeFilled', path: '/workbench', roles: null },
  { key: 'dashboard', label: '数据驾驶舱', icon: 'DataAnalysis', path: '/dashboard', roles: ['admin', 'leader'] },
  { key: 'messages', label: '消息中心', icon: 'ChatLineRound', path: '/messages', roles: null },
  { key: 'forum', label: '校园论坛', icon: 'ChatDotRound', path: '/forum', roles: null },
  { key: 'library', label: '图书借阅', icon: 'Reading', path: '/library', roles: null },
  { key: 'club', label: '社团活动', icon: 'Flag', path: '/club', roles: null },
  { key: 'lf', label: '失物招领', icon: 'Search', path: '/lost-found', roles: null },
  { key: 'mail', label: '校园邮箱', icon: 'Promotion', path: '/mail', roles: null },
  { key: 'dorm', label: '宿舍管理', icon: 'House', path: '/dorm', roles: null },
  { key: 'edu-elect', label: '课程选课', icon: 'Notebook', path: '/edu/elect', roles: ['student'] },
  { key: 'edu-scores', label: '成绩课表', icon: 'Collection', path: '/edu/scores', roles: ['student'] },
  { key: 'af-leave', label: '我的请假', icon: 'Clock', path: '/af/leave', roles: ['student'] },
  { key: 'edu-teach', label: '我的课程', icon: 'Notebook', path: '/edu/teach', roles: ['teacher'] },
  { key: 'edu-entry', label: '成绩录入', icon: 'EditPen', path: '/edu/score-entry', roles: ['teacher'] },
  { key: 'af-approve', label: '请假审批', icon: 'Checked', path: '/af/approve', roles: ['counselor', 'admin'] },
  { key: 'af-repair-m', label: '报修处理', icon: 'SetUp', path: '/af/repair-manage', roles: ['counselor', 'admin'] },
  { key: 'af-notice', label: '公告中心', icon: 'Bell', path: '/af/notice', roles: null },
  { key: 'admin-students', label: '学生管理', icon: 'User', path: '/admin/students', roles: ['admin', 'counselor'] },
  { key: 'admin-org', label: '系部与班级', icon: 'OfficeBuilding', path: '/admin/org', roles: ['admin', 'counselor'] },
  { key: 'admin-courses', label: '课程与排课', icon: 'Reading', path: '/admin/courses', roles: ['admin'] },
  { key: 'admin-users', label: '账号管理', icon: 'UserFilled', path: '/admin/users', roles: ['admin', 'counselor'] },
];

const menus = computed(() => MENUS.filter((m) => !m.roles || auth.hasRole(m.roles)));

// 全部模块已上线，不再有"筹备中"占位
const pendingMenus = computed(() => []);

async function onCommand(cmd) {
  if (cmd === 'logout') {
    await auth.logout();
    ElMessage.success('已退出登录');
    router.push('/login');
  } else if (cmd === 'workbench') {
    router.push('/workbench');
  } else if (cmd === 'home') {
    router.push('/');
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
});
onUnmounted(() => clearInterval(unreadTimer));
</script>

<style scoped>
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
  width: 196px;
  flex: none;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 14px;
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  min-height: 420px;
  box-shadow: 0 10px 34px rgba(15, 35, 66, 0.1);
}
.shell-menu {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 9px;
  font-size: 14px;
  color: var(--zc-text);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.shell-menu:hover { background: rgba(23, 50, 92, 0.07); }
.shell-menu.active {
  background: linear-gradient(120deg, var(--zc-navy), #234a85);
  color: #fff;
  box-shadow: 0 6px 18px rgba(23, 50, 92, 0.28);
}
.shell-menu.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 22%;
  height: 56%;
  width: 3px;
  border-radius: 3px;
  background: var(--zc-gold);
}
.shell-menu.disabled { color: var(--zc-text-sub); cursor: not-allowed; }
.shell-menu.disabled em { margin-left: auto; font-size: 11px; font-style: normal; opacity: 0.7; }
.shell-menu-group { margin: 16px 0 6px; padding: 0 12px; font-size: 12px; color: var(--zc-text-sub); letter-spacing: 1px; }
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

@media (max-width: 820px) {
  .shell-body { flex-direction: column; gap: 14px; padding: 16px; }
  .shell-side { width: 100%; min-height: 0; }
  .shell-side-foot { display: none; }
  .shell-brand-sub { display: none; }
}
</style>
