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

/**
 * 看门狗：生成开始后超过这个毫秒数还没收尾，就强制收尾。
 *
 * 为什么需要它（2026-10-09 线上实测"光标闪几十秒"）：
 *   光标元素由 `v-if="m.streaming && m.content"` 控制，只有 `streaming` 变 false 才会消失。
 *   而 `streaming` 由打字机在**追平缓冲后**才关 —— 只要出现下面任一情况，打字机就永远不会收尾：
 *     · 末尾残留了未闭合的 SSE 块，`done` 事件没被解析到（`_streamEnd` 永远是 false）
 *     · 调用方在别处改动了 `content`，导致 `shown >= target.length` 判断失真
 *   结果就是**光标靠 CSS 动画一直闪**，用户以为还在生成。
 *   加一个与流无关的兜底：到点就收工，宁可少显示几个字，也不能让界面停在"还在思考"。
 */
export const WATCHDOG_MS = 90_000;

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
  reply._typerWatch = setTimeout(() => {
    // 到点仍没收尾（done 没到 / 判断失真）：把缓冲全部显示出来并强制收尾，
    // 绝不让界面停在"还在思考"（见 WATCHDOG_MS 注释）
    if (reply.streaming || reply._typer) {
      if (reply._buf) reply.content = reply._buf;
      reply.pending = false;
      reply.streaming = false;
      stopTypewriter(reply);
      tick?.(reply);
    }
  }, WATCHDOG_MS);
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
    // 追赶步长（2026-10-09 模拟实测后调整）：
    //   初版用 积压/6，流还在传时约 45 字/秒，模拟里 267 字要拖 6 秒才显示完 —— 太慢，
    //   用户会以为"卡住"。现在改为按**绝对下限**推进：流还在传时每帧至少 2 字、
    //   最多 6 字；流已结束每帧至少 6 字、最多 20 字。这样既保留打字观感，又不拖时间。
    const [min, max] = reply._streamEnd ? [6, 20] : [2, 6];
    const step = Math.max(min, Math.min(max, Math.ceil(backlog / 4)));
    reply.content = target.slice(0, shown + step);
    tick?.(reply);
  }, TICK_MS);
}

export function stopTypewriter(reply) {
  if (reply?._typer) {
    clearInterval(reply._typer);
    reply._typer = null;
  }
  // 看门狗必须一起清掉，否则它会在 90 秒后把早已收尾的消息又改一次
  if (reply?._typerWatch) {
    clearTimeout(reply._typerWatch);
    reply._typerWatch = null;
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
