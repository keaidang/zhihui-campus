// /api/ai/stream-probe — 流式能力探测（诊断用，需登录）
//
// 用途：验证 EdgeOne Node Functions 是否能把 ReadableStream **增量**推给客户端。
// 判定方法：打开后若 4 个 probe 事件**逐个出现（间隔约 400ms）**→ 平台支持真流式；
//           若**一次性全部出现**（总耗时≈1.6s 但内容同时到达）→ 平台缓冲，走降级路径。
// 结论决定 C1 问答接口用"真流式"还是"整段返回 + 前端打字机模拟"（见 docs/AI-FEATURES.md §8-5）。
import { preflight } from '../../lib/http.js';
import { requireRoles } from '../../lib/guard.js';
import { sseResponse, probeChunks } from '../../lib/sse.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  // 与全站一致：除 login/register 外都需要登录（API.md §2）
  await requireRoles(context);
  return sseResponse(probeChunks({ chunks: 4, gapMs: 400 }));
}
