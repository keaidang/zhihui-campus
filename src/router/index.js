import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { gate: true } },
    {
      path: '/workbench',
      name: 'workbench',
      component: () => import('../views/WorkbenchView.vue'),
      meta: { requiresAuth: true },
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
      meta: { requiresAuth: true, roles: ['counselor', 'admin'] },
    },
    {
      path: '/af/repair',
      name: 'af-repair',
      component: () => import('../views/af/RepairView.vue'),
      meta: { requiresAuth: true, roles: ['student'] },
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
    return { name: 'workbench' };
  }
  return true;
});

export default router;
