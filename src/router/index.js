import { createRouter, createWebHistory } from 'vue-router';
import { ElMessage } from 'element-plus';
import HomeView from '../views/HomeView.vue';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    {
      path: '/overview',
      name: 'overview',
      component: () => import('../views/OverviewView.vue'),
      alias: '/architecture',
    },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { gate: true } },
    {
      path: '/workbench',
      name: 'workbench',
      component: () => import('../views/WorkbenchView.vue'),
      meta: { requiresAuth: true },
    },
    // ---- AI 助手（C1 校园智能问答；能力与配色按角色在前端动态渲染）----
    {
      path: '/ai',
      name: 'ai',
      component: () => import('../views/AIView.vue'),
      meta: { requiresAuth: true },
    },
    // ---- AI 管理控制台（仅超管；开关/审核队列/知识库/告警/用量）----
    {
      path: '/admin/ai',
      name: 'admin-ai',
      component: () => import('../views/admin/AiAdminView.vue'),
      meta: { requiresAuth: true, roles: ['admin'] },
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      component: () => import('../views/admin/UserManageView.vue'),
      meta: { requiresAuth: true, roles: ['admin', 'counselor'] },
    },
    {
      path: '/admin/students',
      name: 'admin-students',
      component: () => import('../views/admin/StudentManageView.vue'),
      meta: { requiresAuth: true, roles: ['admin', 'counselor'] },
    },
    {
      path: '/admin/courses',
      name: 'admin-courses',
      component: () => import('../views/admin/CourseManageView.vue'),
      meta: { requiresAuth: true, roles: ['admin'] },
    },
    {
      path: '/admin/org',
      name: 'admin-org',
      component: () => import('../views/admin/OrgManageView.vue'),
      meta: { requiresAuth: true, roles: ['admin', 'counselor'] },
    },
    // ---- 教务线（M1）----
    {
      path: '/edu/elect',
      name: 'edu-elect',
      component: () => import('../views/edu/ElectView.vue'),
      meta: { requiresAuth: true, roles: ['student'] },
    },
    {
      path: '/edu/scores',
      name: 'edu-scores',
      component: () => import('../views/edu/ScoresView.vue'),
      meta: { requiresAuth: true, roles: ['student'] },
    },
    {
      path: '/edu/teach',
      name: 'edu-teach',
      component: () => import('../views/edu/TeachView.vue'),
      meta: { requiresAuth: true, roles: ['teacher', 'admin'] },
    },
    {
      path: '/edu/score-entry',
      name: 'edu-score-entry',
      component: () => import('../views/edu/ScoreEntryView.vue'),
      meta: { requiresAuth: true, roles: ['teacher', 'admin'] },
    },
    // ---- 学工线（M2）----
    {
      path: '/af/leave',
      name: 'af-leave',
      component: () => import('../views/af/LeaveView.vue'),
      meta: { requiresAuth: true, roles: ['student'] },
    },
    {
      path: '/af/approve',
      name: 'af-approve',
      component: () => import('../views/af/ApproveView.vue'),
      // ★ leader 必须在这里（2026-11-23）：请假流程改成两级后，第二级「院系复核」
      //   的处理角色是 leader（见 lib/services/leave.js 的 LEAVE_NODES）。
      //   后端 APPROVERS 已放开、节点也流转到了 leader，但前端路由没同步 ——
      //   结果是"功能做了没有入口"：leader 登录后访问 /af/approve 被守卫打回工作台。
      meta: { requiresAuth: true, roles: ['counselor', 'leader', 'admin'] },
    },
    {
      path: '/af/repair',
      redirect: '/dorm',
    },
    {
      path: '/af/repair-manage',
      name: 'af-repair-manage',
      component: () => import('../views/af/RepairManageView.vue'),
      meta: { requiresAuth: true, roles: ['counselor', 'admin'] },
    },
    {
      path: '/af/notice',
      name: 'af-notice',
      component: () => import('../views/af/NoticeView.vue'),
      meta: { requiresAuth: true },
    },
    // ---- 校园邮箱 ----
    {
      path: '/mail',
      name: 'mail',
      component: () => import('../views/MailView.vue'),
      meta: { requiresAuth: true },
    },
    // ---- M3 生活服务 ----
    {
      path: '/library',
      name: 'library',
      component: () => import('../views/m3/LibraryView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/lost-found',
      name: 'lost-found',
      component: () => import('../views/m3/LostFoundView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/club',
      name: 'club',
      component: () => import('../views/m3/ClubView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/forum',
      name: 'forum',
      component: () => import('../views/m3/ForumView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/forum/:id(\\d+)',
      name: 'forum-thread',
      component: () => import('../views/m3/ForumThreadView.vue'),
      meta: { requiresAuth: true },
    },
    // ---- 宿舍管理（schema-010，替代独立"宿舍报修"入口）----
    {
      path: '/dorm',
      name: 'dorm',
      component: () => import('../views/dorm/DormView.vue'),
      meta: { requiresAuth: true },
    },
    // ---- 站内信 / 站内通知（schema-011）----
    {
      path: '/messages',
      name: 'messages',
      component: () => import('../views/MessageView.vue'),
      meta: { requiresAuth: true },
    },
    // ---- M4 驾驶舱 ----
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('../views/admin/DashboardView.vue'),
      meta: { requiresAuth: true, roles: ['admin', 'leader'] },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

// 路由守卫：登录态 + 角色（角色以 /auth/me 返回的数据库角色为准）
router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true;
  const auth = useAuthStore();
  if (!auth.accessToken) {
    await auth.restoreSession().catch(() => {});
  }
  if (!auth.accessToken) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (!auth.user) {
    await auth.fetchMe().catch(() => {});
  }
  if (to.meta.roles && !auth.hasRole(to.meta.roles)) {
    // ★ 不要静默重定向（2026-11-23 改）：
    //   原来直接 return { name:'workbench' }，用户看到的是"点了没反应/自己回到了工作台"，
    //   既不知道为什么，也无法区分"链接过期"与"我没权限"。
    //   这里明确提示一次 —— 注意这**只是体验层**：真正的拦截在服务端
    //   （每个接口都按角色 + 数据范围拼 SQL），前端提示不构成任何安全边界。
    ElMessage.warning({
      message: `无权访问该页面 —— 当前角色（${(auth.user?.roles || []).join('/') || '未识别'}）不具备此权限`,
      duration: 4000,
    });
    return { name: 'workbench' };
  }
  return true;
});

// 懒加载 chunk 失败兜底（2026-09-21 补）：本项目部署频繁，用户停留在旧页面时
// 再点新路由，旧 chunk 已被新产物替换 → 动态 import 404 → 此前表现为整页白屏。
// 这里自动硬刷新一次拿最新 index.html；用标志位防刷新循环（刷新后仍失败则不再重试）。
let chunkReloaded = false;
router.onError((err) => {
  const msg = String(err?.message || '');
  if (/Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|dynamically imported module/i.test(msg)) {
    if (!chunkReloaded) {
      chunkReloaded = true;
      window.location.reload();
    }
  }
});

export default router;
