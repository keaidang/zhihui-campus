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
