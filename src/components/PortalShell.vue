<template>
  <div class="shell">
    <!-- 顶栏 -->
    <header class="shell-top">
      <div class="shell-top-inner">
        <div class="shell-brand" @click="$router.push('/')">
          <img src="/logo.png" alt="清北大学校徽" />
          <span class="shell-brand-text">智汇校园</span>
          <span class="shell-brand-sub">清北大学</span>
        </div>
        <div class="shell-user">
          <span class="shell-role">{{ roleLabel }}</span>
          <el-dropdown @command="onCommand">
            <span class="shell-user-btn">
              <el-avatar :size="28" style="background: var(--zc-navy)">
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
      <!-- 侧边菜单 -->
      <aside class="shell-side">
        <nav>
          <div
            v-for="m in menus"
            :key="m.path"
            class="shell-menu"
            :class="{ active: m.key === active }"
            @click="$router.push(m.path)"
          >
            <el-icon :size="16"><component :is="m.icon" /></el-icon>
            <span>{{ m.label }}</span>
          </div>
          <div v-if="pendingMenus.length" class="shell-menu-group">即将上线</div>
          <div v-for="m in pendingMenus" :key="m.label" class="shell-menu disabled">
            <el-icon :size="16"><component :is="m.icon" /></el-icon>
            <span>{{ m.label }}</span>
            <em>筹备中</em>
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

    <footer class="shell-foot">
      清北大学 · 智汇校园一站式服务平台 © 2026 ·
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2026056678号</a>
    </footer>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth';

defineProps({
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

const menus = computed(() => {
  const list = [{ key: 'workbench', label: '工作台', path: '/workbench', icon: 'HomeFilled' }];
  if (auth.hasRole(['admin', 'counselor'])) {
    list.push({ key: 'admin-users', label: '用户管理', path: '/admin/users', icon: 'UserFilled' });
  }
  return list;
});

// 按角色预告后续模块（一期 M1/M2 即将落地）
const pendingMenus = computed(() => {
  if (auth.hasRole(['admin', 'counselor'])) {
    return [
      { label: '院系班级', icon: 'OfficeBuilding' },
      { label: '公告管理', icon: 'Bell' },
      { label: '数据看板', icon: 'DataAnalysis' },
    ];
  }
  if (auth.hasRole(['teacher'])) {
    return [
      { label: '我的课程', icon: 'Notebook' },
      { label: '成绩录入', icon: 'EditPen' },
      { label: '公告发布', icon: 'Bell' },
    ];
  }
  if (auth.hasRole(['leader'])) {
    return [
      { label: '数据驾驶舱', icon: 'DataAnalysis' },
      { label: '统计报表', icon: 'Histogram' },
    ];
  }
  return [
    { label: '课程选课', icon: 'Notebook' },
    { label: '成绩课表', icon: 'Collection' },
    { label: '请销假', icon: 'Clock' },
    { label: '宿舍报修', icon: 'Tools' },
  ];
});

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
</script>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--zc-bg);
}
.shell-top {
  position: sticky;
  top: 0;
  z-index: 20;
  background: #fff;
  border-bottom: 1px solid var(--zc-border);
  box-shadow: 0 1px 8px rgba(23, 50, 92, 0.06);
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
.shell-role {
  font-size: 12px;
  color: #fff;
  background: var(--zc-navy);
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
  background: #fff;
  border: 1px solid var(--zc-border);
  border-radius: 12px;
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  min-height: 420px;
}
.shell-menu {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--zc-text);
  cursor: pointer;
  transition: background 0.2s;
}
.shell-menu:hover { background: #f2f6fb; }
.shell-menu.active { background: var(--zc-navy); color: #fff; }
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
