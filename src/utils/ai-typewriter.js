// src/utils/ai-typewriter.js — 流式回答的「平滑打字机」与等待提示（AI 助手的公共渲染策略）
//
// 为什么抽成公共模块：AIView（完整助手页）与 AiOrb（悬浮对话面板）都要用**同一套**
// 流式渲染策略，复制两份必然漂移 —— 改了一处忘另一处，两个入口的体验就不一致了。
//
// ── 背景：为什么"真流式"还要做打字机 ──────────────────────────
// 2026-10-09 实测（working/stream-timing.mjs）：
//   · 后端**确实是真流式** —— 一次问答探测到 31 个分片逐个到达；
//   · 但上游**首字延迟 3~10 秒**（同一 prompt 实测 3.1s~17.2s 波动，属上游排队，
//     与 prompt 大小无关：prompt 仅约 1000 token）；
//   · 一旦开始吐字，267 个字在 **2 秒内**全部到达。
// 直接"到达即渲染"的结果：卡 9 秒 → 2 秒刷完 → 人眼看就是"一次性出现"，
// 用户会以为没做流式。把到达的文本放进缓冲、按固定节奏推进显示，
// 既保留真实流式观感，又不会因为上游突发而整段跳出。
//
// ── 两个关键取值 ────────────────────────────────────────────
//   TICK_MS = 26：约 38 帧/秒，肉眼看到的是连续打字而不是跳字。
//   追赶步长：流还在传 → 积压/6（从容）；流已结束 → 积压/3（快速补齐，不让用户干等）。

export const TICK_MS = 26;

/** 超过这个毫秒数就把等待文案从"检索中"换成"组织回答中"，让长时间等待有信息量 */
export const WAIT_HINT_DELAY = 2500;

export const WAIT_HINT_FIRST = '正在检索校园资料…';
export const WAIT_HINT_SECOND = '正在组织回答…';

/**
 * 启动打字机（幂等：已在跑就直接返回）
 * @param {object} reply 消息对象，读写 `_buf`（已收到全文）/ `content`（已显示文本）
 * @param {{onTick?:Function}} [opts] 每次推进后的回调（用于滚动到底部）
 */
export function ensureTypewriter(reply, opts = {}) {
  const tick = opts.onTick;
  if (reply._typer) return;
  reply._typer = setInterval(() => {
    const target = reply._buf || '';
    const shown = reply.content.length;
    if (shown >= target.length) {
      // 追平：流已结束就收工（此时才关掉光标），否则等下一批
      if (reply._streamEnd) {
        reply.streaming = false;
        stopTypewriter(reply);
        tick?.(reply);
      }
      return;
    }
    const backlog = target.length - shown;
    const step = reply._streamEnd ? Math.max(3, Math.ceil(backlog / 3)) : Math.max(1, Math.ceil(backlog / 6));
    reply.content = target.slice(0, shown + step);
    tick?.(reply);
  }, TICK_MS);
}

export function stopTypewriter(reply) {
  if (reply?._typer) {
    clearInterval(reply._typer);
    reply._typer = null;
  }
}

/** 等待首字的阶段提示（上游首字 3~10 秒，只转圈会让人以为卡死） */
export function setWaitHint(reply) {
  reply.waitHint = WAIT_HINT_FIRST;
  reply._waitTimer = setTimeout(() => {
    if (reply.pending) reply.waitHint = WAIT_HINT_SECOND;
  }, WAIT_HINT_DELAY);
}

export function clearWaitHint(reply) {
  if (reply?._waitTimer) {
    clearTimeout(reply._waitTimer);
    reply._waitTimer = null;
  }
}

/** 清空对话前必须调用：否则定时器继续跑（泄漏 + 对已销毁的响应式对象写入） */
export function disposeReply(reply) {
  stopTypewriter(reply);
  clearWaitHint(reply);
}

/**
 * 统一构造 SSE 事件处理器 —— 两处入口都用它，保证行为一致
 * @param {object} reply
 * @param {{onTick?:Function, onMeta?:Function}} [opts]
 */
export function streamHandlers(reply, opts = {}) {
  const { onTick, onMeta } = opts;
  return {
    onMeta: (d) => {
      reply.sources = d?.sources || [];
      onMeta?.(d);
    },
    onDelta: (d) => {
      // 先入缓冲，由打字机决定"什么时候显示几个字"
      reply._buf = (reply._buf || '') + (d?.text ?? '');
      if (reply.pending) {
        reply.pending = false;
        clearWaitHint(reply);
      }
      reply.streaming = true;
      ensureTypewriter(reply, { onTick });
    },
    onDone: () => {
      reply.pending = false;
      clearWaitHint(reply);
      // ★ 不在这里关 streaming：让打字机把缓冲追平后再关，
      //   否则光标先消失、文字还在往外冒，看起来像 bug
      reply._streamEnd = true;
      ensureTypewriter(reply, { onTick });
    },
    onError: (d) => {
      reply.pending = false;
      clearWaitHint(reply);
      reply._streamEnd = true;
      if (d?.message && !reply.content && !reply._buf) {
        reply.content = d.message;
        reply.error = true;
      }
    },
  };
}

/** 新建一条"正在生成"的助手消息（字段齐备，避免各处漏写 _buf 导致首字丢失） */
export function newReplyMessage(id) {
  return {
    id,
    role: 'assistant',
    content: '',
    sources: [],
    pending: true,
    streaming: false,
    _buf: '',
  };
}
