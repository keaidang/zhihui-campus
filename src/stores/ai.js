// src/stores/ai.js — AI 能力状态（角色相关，全站共享一次拉取）
//
// 为什么要有这个 store：悬浮球出现在**每个门户页面**，如果各页面各自拉一次
// `/api/ai/status`，切一次页就多一次请求。这里做"按用户记忆"的缓存：
// 同一用户只拉一次；用户变了（重新登录/切换账号）自动重拉。
import { defineStore } from 'pinia';
import { fetchAiStatus, softOf, themeOf } from '../api/ai';

let loadInFlight = null;

export const useAiStore = defineStore('ai', {
  state: () => ({
    status: null,
    /** 该状态属于哪个用户（防止切换账号后沿用上一个角色的权限与配色） */
    forUser: null,
    loading: false,
  }),
  getters: {
    /** 是否已加载完成（无论成功与否，避免无限重试） */
    ready: (s) => !!s.status,
    variant: (s) => s.status?.variant || 'standard',
    theme: (s) => themeOf(s.status?.variant),
    accent: (s) => themeOf(s.status?.variant).accent,
    soft: (s) => softOf(themeOf(s.status?.variant).accent),
    features: (s) => s.status?.features || {},
    /** 问答是否可用（决定悬浮球与菜单是否出现） */
    chatOn: (s) => Boolean(s.status?.features?.chat),
    suggestions: (s) => s.status?.suggestions || [],
  },
  actions: {
    /**
     * 拉取能力清单（幂等）
     * @param {number|string|null} userId 当前用户 id；与缓存不一致时强制重拉
     * @param {boolean} force
     */
    async load(userId = null, force = false) {
      if (!force && this.status && this.forUser === userId) return this.status;
      if (loadInFlight) return loadInFlight;
      this.loading = true;
      loadInFlight = (async () => {
        try {
          const res = await fetchAiStatus();
          if (res.code === 0) {
            this.status = res.data;
            this.forUser = userId;
          }
        } catch {
          /* 静默失败：AI 入口不出现即可，不影响页面其他功能 */
        } finally {
          this.loading = false;
          loadInFlight = null;
        }
        return this.status;
      })();
      return loadInFlight;
    },

    /** 退出登录时清掉，避免下个账号看到上一个账号的配色/能力 */
    reset() {
      this.status = null;
      this.forUser = null;
      loadInFlight = null;
    },
  },
});
