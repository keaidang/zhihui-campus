// src/api/ai.js — AI 能力的前端接入层
//
// 与 api/request.js 的分工：普通接口走 api()（自动续期/重试/统一错误）；
// **流式问答不能走 api()** —— api() 会 `res.json()` 把响应体读完，SSE 会被一次性吞掉。
// 因此问答单独实现流式读取，但令牌、401 续期语义与 api() 保持一致。
import { useAuthStore } from '../stores/auth';
import { api } from './request';

/** 版本 → 主标识色（全部浅色调，只换主色，布局完全复用；见 AI-FEATURES §1.4） */
export const AI_THEME = {
  standard: { accent: '#4a72c4', label: '标准版', tagline: '校园智能问答' },
  counselor: { accent: '#1d9e75', label: '审批版', tagline: '校园问答 + AI 审批助手' },
  leader: { accent: '#7f77dd', label: '校领导版', tagline: '校园问答 + 全校信息问数（只读）' },
  admin: { accent: '#c8a35f', label: '管理员版', tagline: '全部能力 + 对话式系统管理' },
};

export const themeOf = (variant) => AI_THEME[variant] || AI_THEME.standard;

/** 主色的浅色底（用户气泡 / 选中态用） */
export function softOf(accent) {
  const h = String(accent).replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, 0.10)`;
}

/** 拉取当前角色的 AI 能力清单 */
export function fetchAiStatus() {
  return api('/api/ai/status');
}

/**
 * C5 第一阶段：把一句话交给后端解析。
 * 返回 `{ kind:'none'|'read'|'write', ... }`：
 *   · none  → reply 是一句正常回答（可直接当助手消息展示）
 *   · read  → rows/summary 是查询结果
 *   · write → preview + confirmToken（**此时一行数据都没改**，需用户点确认）
 */
export function runAiAction(text) {
  return api('/api/ai/action', { method: 'POST', body: { text } });
}

/** C5 第二阶段：带确认令牌真正执行 */
export function confirmAiAction(confirmToken) {
  return api('/api/ai/action', { method: 'POST', body: { confirmToken } });
}

/**
 * 解析一个 SSE 事件块（`event: x\ndata: {...}`，data 可多行）
 * @returns {{type:string, data:any}|null}
 */
export function parseSseBlock(block) {
  let type = 'message';
  const data = [];
  for (const line of String(block).split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (!data.length) return null;
  const raw = data.join('\n');
  try {
    return { type, data: JSON.parse(raw) };
  } catch {
    return { type, data: raw };
  }
}

/**
 * 流式问答（C1）
 * @param {object} o
 * @param {string} o.question
 * @param {Array<{role:string,content:string}>} [o.history]
 * @param {AbortSignal} [o.signal]
 * @param {{onMeta?:Function,onDelta?:Function,onDone?:Function,onError?:Function}} [o.handlers]
 * @returns {Promise<{ok:boolean, code?:number, message?:string}>}
 *   ok:false 表示"根本没开始生成"（未登录/限流/未配置/上游失败），调用方把 message
 *   当作一条助手消息展示即可 —— 不要让整页报错（ADR-9：AI 挂了业务照常）。
 */
export async function streamChat({ question, history = [], signal, handlers = {} } = {}) {
  const auth = useAuthStore();
  const send = (token) =>
    fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ question, history }),
      signal,
    });

  try {
    let res = await send(auth.accessToken);

    // 令牌过期：续期一次并重放（与 api() 的 401 语义对齐）
    if (res.status === 401 && auth.refreshToken) {
      const refreshed = await auth.tryRefresh().catch(() => false);
      if (refreshed) res = await send(auth.accessToken);
      else {
        auth.clearSession();
        return { ok: false, code: 40103, message: '登录状态已失效，请重新登录' };
      }
    }

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/event-stream')) {
      const j = await res.json().catch(() => ({}));
      return {
        ok: false,
        code: j.code ?? res.status,
        message: j.message || '智能问答暂时不可用，请稍后再试',
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // 兼容 CRLF 的中间层（本项目服务端只发 \n，但网关不一定）
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const blocks = buf.split('\n\n');
      buf = blocks.pop() ?? '';
      for (const b of blocks) {
        const ev = parseSseBlock(b);
        if (!ev) continue;
        const fn = handlers[ev.type === 'delta' ? 'onDelta' : ev.type === 'meta' ? 'onMeta' : ev.type === 'done' ? 'onDone' : ev.type === 'error' ? 'onError' : null];
        if (fn) fn(ev.data);
      }
    }
    // 收尾：缓冲区若还有未闭合的事件（服务端异常断开），尽力解析一次
    if (buf.trim()) {
      const ev = parseSseBlock(buf);
      if (ev && ev.type === 'delta' && handlers.onDelta) handlers.onDelta(ev.data);
    }
    return { ok: true };
  } catch (e) {
    // 用户主动停止不算失败（调用方据此不弹错误提示）
    if (e?.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, code: -1, message: '网络异常，智能问答暂时不可用' };
  }
}
