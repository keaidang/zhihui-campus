// 统一请求封装：自动携带 Token / 401 自动刷新 / 统一错误提示
import { useAuthStore } from '../stores/auth';

async function raw(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

export async function api(url, { method = 'GET', body, auth = true, retry = true } = {}) {
  const store = useAuthStore();
  const headers = { 'Content-Type': 'application/json' };
  if (auth && store.accessToken) headers.Authorization = `Bearer ${store.accessToken}`;

  const { status, body: data } = await raw(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 访问令牌过期 → 用刷新令牌续期一次并重放原请求
  if (status === 401 && auth && retry && store.refreshToken) {
    const refreshed = await store.tryRefresh();
    if (refreshed) return api(url, { method, body, auth, retry: false });
    store.clearSession();
    return data;
  }

  if (status >= 500) {
    return { code: 50000, message: data?.message || '服务暂不可用，请稍后再试' };
  }
  return data; // { code, message, data }
}
