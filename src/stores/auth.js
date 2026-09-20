// 统一认证状态（Pinia）：双令牌 + 自动续期
import { defineStore } from 'pinia';
import { api } from '../api/request';

const REFRESH_KEY = 'zc_refresh_token';

// 模块级单飞 Promise：多调用方（main.js 启动恢复 / 路由守卫 / 401 拦截器）
// 并发触发时共享同一次刷新，避免旋转令牌被二次使用而误踢登录
let refreshInFlight = null;
let restoreInFlight = null;

export const useAuthStore = defineStore('auth', {
  state: () => ({
    // 访问令牌只放内存（不落 localStorage，降低 XSS 窃取面）
    accessToken: '',
    // 刷新令牌存 localStorage（XSS 风险与 UX 的折中；后续可升级 HttpOnly Cookie 方案）
    refreshToken: localStorage.getItem(REFRESH_KEY) || '',
    user: null, // { id, username, realName, roles[] }
  }),
  getters: {
    isLoggedIn: (s) => !!s.accessToken,
    roles: (s) => s.user?.roles || [],
    isAdmin: (s) => (s.user?.roles || []).includes('admin'),
    isStaff: (s) =>
      (s.user?.roles || []).some((r) => ['admin', 'counselor', 'teacher', 'leader'].includes(r)),
    primaryRole: (s) => {
      const order = ['admin', 'leader', 'counselor', 'teacher', 'student'];
      const mine = s.user?.roles || [];
      return order.find((r) => mine.includes(r)) || 'student';
    },
  },
  actions: {
    /** 是否拥有任一角色 */
    hasRole(list) {
      const mine = this.user?.roles || [];
      return list.some((r) => mine.includes(r));
    },
    async login(username, password) {
      const res = await api('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: { username, password },
      });
      if (res.code === 0) {
        this._applySession(res.data);
        await this.fetchMe();
      }
      return res;
    },

    async register(form) {
      return api('/api/auth/register', { method: 'POST', auth: false, body: form });
    },

    async fetchMe() {
      const res = await api('/api/auth/me');
      if (res.code === 0) this.user = res.data;
      return res;
    },

    async tryRefresh() {
      if (!this.refreshToken) return false;
      // 单飞：并发调用共享同一次刷新（refresh 令牌是一次性旋转的，两次并发必有一次失败）
      if (!refreshInFlight) {
        refreshInFlight = this._doRefresh().finally(() => { refreshInFlight = null; });
      }
      return refreshInFlight;
    },

    async _doRefresh() {
      // 瞬时错误(50000)退避重试：TiDB 抖动导致的刷新失败不应把用户踢回登录页；
      // 40100=令牌真失效（无效/过期/重放），重试无意义
      for (let i = 0; i < 3; i++) {
        const res = await api('/api/auth/refresh', {
          method: 'POST',
          auth: false,
          body: { refreshToken: this.refreshToken },
        }).catch(() => ({ code: 50000, message: 'network' }));
        if (res.code === 0) {
          this._applySession(res.data);
          return true;
        }
        if (res.code !== 50000) return false;
        await new Promise((s) => setTimeout(s, 600 * (i + 1)));
      }
      return false;
    },

    /** 页面加载时的会话恢复：F5 后 accessToken 已丢失，用 refreshToken 静默换回 */
    async restoreSession() {
      if (this.accessToken || !this.refreshToken) return;
      // 单飞 + 可等待：路由守卫与 main.js 共享同一次恢复，守卫会等它完成而不是拿到"未完成"状态
      if (!restoreInFlight) {
        restoreInFlight = (async () => {
          const okRefresh = await this.tryRefresh().catch(() => false);
          if (okRefresh) await this.fetchMe().catch(() => {});
        })().finally(() => { restoreInFlight = null; });
      }
      await restoreInFlight;
    },

    async logout() {
      try {
        await api('/api/auth/logout', {
          method: 'POST',
          body: { refreshToken: this.refreshToken },
        });
      } finally {
        this.clearSession();
      }
    },

    clearSession() {
      this.accessToken = '';
      this.refreshToken = '';
      this.user = null;
      localStorage.removeItem(REFRESH_KEY);
    },

    _applySession(data) {
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.user = data.user || this.user;
      localStorage.setItem(REFRESH_KEY, this.refreshToken);
    },
  },
});
