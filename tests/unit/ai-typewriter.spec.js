// 打字机与流式渲染策略的单测（src/utils/ai-typewriter.js）
//
// 为什么这些值得测：2026-10-09 线上出现「文字一次性输出 + 光标闪几十秒」，
// 根因是**改了 push 进数组的原始对象而不是 reactive 代理**（Vue 3 里
// ref([obj]) 暴露给模板的是代理，改原始对象不触发渲染）。
// 那个 bug 在组件里，本文件锁不住；但它导致的**下游后果**可以锁：
//   ① done 没到 / 判断失真时，看门狗必须强制收尾，绝不能让 streaming 永远为 true
//   ② 收尾时必须把缓冲全部显示出来，不能少显示
//   ③ 定时器必须成对清理（stopTypewriter 要连看门狗一起清）
//   ④ 流未结束时不能提前把 content 推到超过缓冲长度
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  TICK_MS,
  WAIT_HINT_FIRST,
  WAIT_HINT_SECOND,
  WAIT_HINT_DELAY,
  WATCHDOG_MS,
  clearWaitHint,
  disposeReply,
  ensureTypewriter,
  newReplyMessage,
  setWaitHint,
  stopTypewriter,
  streamHandlers,
} from '../../src/utils/ai-typewriter.js';

/** 用真实定时器跑，避免 fake timer 与 interval 混用的坑；量级很小（毫秒级） */
const tick = (ms = TICK_MS + 5) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  vi.useRealTimers();
});

describe('newReplyMessage · 字段齐备', () => {
  it('必须带 _buf（漏了会让第一个 delta 被吞）', () => {
    const m = newReplyMessage(1);
    expect(m._buf).toBe('');
    expect(m.pending).toBe(true);
    expect(m.streaming).toBe(false);
  });

  it('每次调用返回独立对象（不共享引用）', () => {
    expect(newReplyMessage(1)).not.toBe(newReplyMessage(2));
  });
});

describe('ensureTypewriter · 逐字推进', () => {
  it('★ 先入缓冲、不直接显示；随后按 tick 逐步显示', async () => {
    const m = newReplyMessage(1);
    m._buf = 'abcdefghij';
    m.streaming = true;
    ensureTypewriter(m);
    expect(m.content).toBe(''); // 刚启动时还没显示任何字
    await tick();
    expect(m.content.length).toBeGreaterThan(0);
    expect(m.content.length).toBeLessThan(10); // 没一次性全出
    stopTypewriter(m);
  });

  it('★ 内容永不超过已收到的缓冲（不能凭空多出字）', async () => {
    const m = newReplyMessage(1);
    m._buf = 'abcdefghij';
    m.streaming = true;
    ensureTypewriter(m);
    await tick();
    await tick();
    expect(m.content.length).toBeLessThanOrEqual(10);
    stopTypewriter(m);
  });

  it('幂等：重复调用不会起第二个 interval', async () => {
    const m = newReplyMessage(1);
    m._buf = 'abcdefghij';
    m.streaming = true;
    ensureTypewriter(m);
    const first = m._typer;
    ensureTypewriter(m);
    expect(m._typer).toBe(first);
    stopTypewriter(m);
  });

  it('★ 流未结束（_streamEnd=false）时即使已追平也不能关光标', async () => {
    const m = newReplyMessage(1);
    m._buf = 'ab';
    m.streaming = true;
    ensureTypewriter(m);
    // 反复 tick 让它追上缓冲
    for (let i = 0; i < 10; i += 1) await tick();
    expect(m.content).toBe('ab'); // 内容追平了
    expect(m.streaming).toBe(true); // 但流还没结束，光标必须留着
    stopTypewriter(m);
  });

  it('流结束（_streamEnd=true）后追平则关光标并停机', async () => {
    const m = newReplyMessage(1);
    m._buf = 'ab';
    m.streaming = true;
    ensureTypewriter(m);
    m._streamEnd = true;
    for (let i = 0; i < 10; i += 1) await tick();
    expect(m.content).toBe('ab');
    expect(m.streaming).toBe(false);
    expect(m._typer).toBeNull();
  });
});

describe('★ 看门狗（对应线上"光标闪几十秒"）', () => {
  it('★ done 一直没到时，到点强制收尾：streaming=false 且缓冲全部显示', async () => {
    vi.useFakeTimers();
    const m = newReplyMessage(1);
    m._buf = '这是一段本该被完整显示的回答';
    m.streaming = true;
    ensureTypewriter(m);

    // 模拟"流事件丢了"：只把缓冲塞进去，_streamEnd 永远是 false
    vi.advanceTimersByTime(WATCHDOG_MS + 10);

    expect(m.streaming).toBe(false); // 光标必须灭
    expect(m.content).toBe(m._buf); // 且不能少显示
    expect(m._typer).toBeNull();
    expect(m._typerWatch).toBeNull();
    vi.useRealTimers();
  });

  it('正常收尾后看门狗被清除，不会二次改动', async () => {
    vi.useFakeTimers();
    const m = newReplyMessage(1);
    m._buf = 'ab';
    m.streaming = true;
    ensureTypewriter(m);
    m._streamEnd = true;
    vi.advanceTimersByTime(TICK_MS * 30);
    expect(m.streaming).toBe(false);

    const snap = m.content;
    vi.advanceTimersByTime(WATCHDOG_MS + 10); // 若看门狗没被清，会在这里再跑一次
    expect(m.content).toBe(snap);
    vi.useRealTimers();
  });
});

describe('stopTypewriter / disposeReply', () => {
  it('★ stopTypewriter 必须连看门狗一起清（否则 90 秒后旧消息被改一次）', () => {
    const m = newReplyMessage(1);
    m._buf = 'x';
    m.streaming = true;
    ensureTypewriter(m);
    expect(m._typerWatch).toBeTruthy();
    stopTypewriter(m);
    expect(m._typer).toBeNull();
    expect(m._typerWatch).toBeNull();
  });

  it('对未启动的消息调用不报错（幂等）', () => {
    const m = newReplyMessage(1);
    expect(() => stopTypewriter(m)).not.toThrow();
    expect(() => clearWaitHint(m)).not.toThrow();
    expect(() => disposeReply(m)).not.toThrow();
    expect(() => stopTypewriter(null)).not.toThrow();
  });
});

describe('等待提示', () => {
  it('先给"检索"，延时后仍在等待才换"组织回答"', () => {
    vi.useFakeTimers();
    const m = newReplyMessage(1);
    setWaitHint(m);
    expect(m.waitHint).toBe(WAIT_HINT_FIRST);
    vi.advanceTimersByTime(WAIT_HINT_DELAY + 10);
    expect(m.waitHint).toBe(WAIT_HINT_SECOND);
    vi.useRealTimers();
  });

  it('★ 已经开始出字后，延时器不得再改文案（避免"组织回答"盖掉正文）', () => {
    vi.useFakeTimers();
    const m = newReplyMessage(1);
    setWaitHint(m);
    m.pending = false; // 已出字
    vi.advanceTimersByTime(WAIT_HINT_DELAY + 10);
    expect(m.waitHint).toBe(WAIT_HINT_FIRST); // 未被改成 SECOND
    vi.useRealTimers();
  });

  it('clearWaitHint 后不再有残留计时器', () => {
    vi.useFakeTimers();
    const m = newReplyMessage(1);
    setWaitHint(m);
    expect(m._waitTimer).toBeTruthy();
    clearWaitHint(m);
    expect(m._waitTimer).toBeNull();
    vi.useRealTimers();
  });
});

describe('streamHandlers · 事件到消息的映射', () => {
  it('onMeta 写入 sources', () => {
    const m = newReplyMessage(1);
    streamHandlers(m).onMeta({ sources: [{ id: 1, title: '选课规则' }] });
    expect(m.sources).toEqual([{ id: 1, title: '选课规则' }]);
  });

  it('★ onDelta 只进缓冲、不直接写 content（由打字机决定显示节奏）', () => {
    const m = newReplyMessage(1);
    streamHandlers(m).onDelta({ text: '你好' });
    expect(m._buf).toBe('你好');
    expect(m.content).toBe('');
    expect(m.pending).toBe(false);
    expect(m.streaming).toBe(true);
    stopTypewriter(m);
  });

  it('★ onDone 不立刻关 streaming（要等打字机追平，否则光标先消失、文字还在冒）', () => {
    const m = newReplyMessage(1);
    streamHandlers(m).onDelta({ text: 'abc' });
    streamHandlers(m).onDone();
    expect(m.streaming).toBe(true);
    expect(m._streamEnd).toBe(true);
    stopTypewriter(m);
  });

  it('★ onError 时若无任何内容，把错误消息显示出来（并标 error）', () => {
    const m = newReplyMessage(1);
    streamHandlers(m).onError({ message: '智能问答暂时不可用' });
    expect(m.content).toBe('智能问答暂时不可用');
    expect(m.error).toBe(true);
    expect(m.pending).toBe(false);
  });

  it('★ onError 时若已有内容（部分输出后失败），保留已输出内容不覆盖', () => {
    const m = newReplyMessage(1);
    streamHandlers(m).onDelta({ text: '已经写了一半' });
    streamHandlers(m).onError({ message: '然后断了' });
    expect(m.content).toBe(''); // 打字机还没来得及显示，但内容不为空说明有缓冲
    expect(m.error).toBeUndefined(); // 不该把已有输出的消息标成错误
    stopTypewriter(m);
  });

  it('onTick 回调被调用（用于滚动到底部）', async () => {
    const m = newReplyMessage(1);
    let ticks = 0;
    streamHandlers(m, { onTick: () => (ticks += 1) }).onDelta({ text: 'abcdefghij' });
    await tick();
    expect(ticks).toBeGreaterThan(0);
    stopTypewriter(m);
  });

  it('delta 缺少 text 字段时不崩（脏上游数据）', () => {
    const m = newReplyMessage(1);
    expect(() => streamHandlers(m).onDelta({})).not.toThrow();
    expect(() => streamHandlers(m).onDelta(null)).not.toThrow();
    stopTypewriter(m);
  });
});