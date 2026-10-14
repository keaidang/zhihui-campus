// 统一请求封装：自动携带 Token / 401 自动刷新 / 统一错误提示
import { useAuthStore } from '../stores/auth';

async function raw(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// 5xx 自动重试白名单：**只有确认幂等的写操作才允许重放**。
// ★ 为什么不能按「非 GET」一刀切（2026-10-14 收窄）：
//   原实现对所有非 GET 请求遇 5xx 都重试一次，但大量写操作是**非幂等**的——
//   注册、发送验证码邮件、发帖、社团报名、请假申请、新建课程……
//   服务端返回 500 时副作用可能已产生一半（邮件已发出、记录已写入），
//   无条件重试会造成重复发信/重复建单/重复报名。
// ★ 为什么按「URL + body.action」而不是只按 URL：
//   /api/edu/course 同时承载幂等的选课/退课与非幂等的课程管理，
//   单看 URL 无法区分。
const IDEMPOTENT_WRITE = [
  { url: '/api/edu/course', action: 'enroll' }, // 选课：服务端 upsert 重激活 + 条件 UPDATE，天然可重入
  { url: '/api/edu/course', action: 'drop' }, // 退课：同上
];

/** 该请求在 5xx 后能否安全重放一次。GET 维持原行为（不重试），非幂等写操作一律不重试。 */
export function canRetry5xx(url, method, body) {
  if (method === 'GET') return false;
  if (!body || typeof body !== 'object') return false;
  return IDEMPOTENT_WRITE.some((r) => url === r.url && body.action === r.action);
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
    // 瞬时 500 兜底：**仅幂等写操作**（选课/退课）自动重试一次，见 IDEMPOTENT_WRITE。
    // 非幂等写操作（发码/注册/发帖/报名/请假…）重试会产生重复副作用，直接返回错误交给用户重试。
    if (retry && canRetry5xx(url, method, body)) {
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
