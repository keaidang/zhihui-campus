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
    // 瞬时 500 兜底：自动重试一次（选课/退课等业务幂等，重试安全）
    if (retry && method !== 'GET') {
      await new Promise((s) => setTimeout(s, 800));
      return api(url, { method, body, auth, retry: false });
    }
    return { code: 50000, message: data?.message || '服务暂不可用，请稍后再试' };
  }
  return data; // { code, message, data }
}

/** 带鉴权的文件下载（CSV 导出等）：fetch → blob → 触发浏览器保存 */
export async function download(url, filename) {
  const store = useAuthStore();
  const res = await fetch(url, {
    headers: store.accessToken ? { Authorization: `Bearer ${store.accessToken}` } : {},
  });
  if (!res.ok) throw new Error(`下载失败 (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
