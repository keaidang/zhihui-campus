// 统一认证状态（Pinia）：双令牌 + 自动续期
import { defineStore } from 'pinia';
import { api } from '../api/request';

const REFRESH_KEY = 'zc_refresh_token';

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
  },
  actions: {
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
      const res = await api('/api/auth/refresh', {
        method: 'POST',
        auth: false,
        body: { refreshToken: this.refreshToken },
      });
      if (res.code === 0) {
        this._applySession(res.data);
        return true;
      }
      return false;
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
