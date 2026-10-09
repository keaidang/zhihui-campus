<template>
  <PortalShell active="ai">
    <section class="ai-page" :style="{ '--ai-accent': ai.accent, '--ai-soft': ai.soft }">
      <header class="ai-head">
        <div class="ai-head-l">
          <span class="ai-badge"><el-icon :size="16"><ChatDotRound /></el-icon></span>
          <div>
            <h2>AI 校园助手<span class="ai-ver">{{ ai.theme.label }}</span></h2>
            <p>{{ ai.theme.tagline }}</p>
          </div>
        </div>
        <div class="ai-head-r">
          <el-button link :icon="Delete" :disabled="busy || msgs.length <= 1" @click="clearChat">清空对话</el-button>
        </div>
      </header>

      <!-- 降级横幅：能进来说明入口没被隐藏，但能力确实不可用，要如实告知 -->
      <el-alert
        v-if="ai.status?.degraded"
        class="ai-alert"
        type="warning"
        :closable="false"
        show-icon
        :title="ai.status?.degradedReason || 'AI 服务暂时不可用'"
        description="其余功能不受影响，你仍可正常使用平台的其他模块。"
      />

      <div ref="scroller" class="ai-chat">
        <div v-for="m in msgs" :key="m.id" class="ai-row" :class="m.role">
          <div v-if="m.role === 'assistant'" class="ai-ava">AI</div>
          <div class="ai-bubble" :class="{ 'is-error': m.error, 'is-wide': m.kind === 'read' || m.kind === 'write' || m.kind === 'data' }">
            <div v-if="m.pending && !m.content" class="ai-typing"><i /><i /><i /></div>

            <!-- C5 写操作：影响清单 + 二次确认（点确认前一行数据都没改） -->
            <template v-else-if="m.kind === 'write' && m.preview">
              <p class="ai-op-head">
                <b>{{ m.label }}</b> · 将影响 <b class="ai-op-num">{{ m.preview.count }}</b> 项
                <span class="ai-op-tip">（确认后才会真正执行）</span>
              </p>
              <ul class="ai-op-list">
                <li v-for="it in m.preview.items" :key="it.id">{{ it.label }}</li>
              </ul>
              <p v-if="m.preview.truncated" class="ai-op-more">仅列出前 50 项，其余会一并处理</p>
              <ul v-if="m.preview.warnings && m.preview.warnings.length" class="ai-op-warn">
                <li v-for="(w, i) in m.preview.warnings" :key="i">{{ w }}</li>
              </ul>
              <ul v-if="m.preview.skipped && m.preview.skipped.length" class="ai-op-skip">
                <li v-for="(s, i) in m.preview.skipped" :key="i">跳过 {{ s.label }}：{{ s.reason }}</li>
              </ul>
              <div class="ai-op-btns">
                <el-button size="small" round :disabled="m.opState === 'done'" @click="cancelOp(m)">取消</el-button>
                <el-button
                  size="small"
                  round
                  type="primary"
                  :loading="m.opState === 'running'"
                  :disabled="m.opState === 'done'"
                  @click="confirmOp(m)"
                >
                  确认执行
                </el-button>
              </div>
            </template>

            <!-- C5 只读查询：结果表 -->
            <template v-else-if="m.kind === 'read' || m.kind === 'data'">
              <p class="ai-op-head">
                <b>{{ m.label || '查询结果' }}</b>
                <span v-if="m.periodLabel" class="ai-op-tip">· {{ m.periodLabel }}</span>
              </p>
              <p class="ai-text">{{ m.summary || '查询完成' }}</p>
              <div v-if="m.rows && m.rows.length" class="ai-table-wrap">
                <table class="ai-table">
                  <thead>
                    <tr><th v-for="k in Object.keys(m.rows[0])" :key="k">{{ k }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, i) in m.rows" :key="i">
                      <td v-for="k in Object.keys(m.rows[0])" :key="k">{{ r[k] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- 附加明细（如"最活跃用户""按状态"），key 是子表标题 -->
              <template v-if="m.extra">
                <div v-for="(sub, title) in m.extra" :key="title" class="ai-extra">
                  <p class="ai-op-more">{{ title }}</p>
                  <div class="ai-table-wrap">
                    <table class="ai-table">
                      <thead><tr><th v-for="k in Object.keys(sub[0] || {})" :key="k">{{ k }}</th></tr></thead>
                      <tbody>
                        <tr v-for="(r, i) in sub" :key="i">
                          <td v-for="k in Object.keys(sub[0] || {})" :key="k">{{ r[k] }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </template>
            </template>

            <!-- 模型输出经 escape 后再注入有限标签，见 renderLite -->
            <div v-else class="ai-text" v-html="renderLite(m.content)" />

            <span v-if="m.streaming && m.content" class="ai-caret" />
            <div v-if="m.sources && m.sources.length" class="ai-src">
              <span class="ai-src-label">参考</span>
              <el-tag v-for="s in m.sources" :key="s.id" size="small" effect="plain" round>{{ s.title }}</el-tag>
            </div>
          </div>
        </div>

        <!-- 空态：给候选问题，避免"不知道能问什么" -->
        <div v-if="msgs.length <= 1 && !busy" class="ai-start">
          <p class="ai-start-t">试试这样问</p>
          <div class="ai-chips">
            <button v-for="(q, i) in ai.suggestions" :key="i" class="ai-chip" type="button" @click="ask(q)">
              {{ q }}
            </button>
          </div>
        </div>
      </div>

      <footer class="ai-input">
        <el-input
          v-model="draft"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 5 }"
          resize="none"
          maxlength="500"
          :placeholder="canRunActions ? '可以直接下指令，例如「查看所有待审批的请假」「禁用账号 student01」' : '问点校园里的问题，例如「怎么选课」「请假要谁批」'"
          @keydown="onKeydown"
        />
        <div class="ai-actions">
          <span class="ai-hint">{{ isMobile ? '点击发送' : 'Enter 发送 · Shift+Enter 换行' }}</span>
          <el-button v-if="busy" round :icon="CloseBold" @click="stop">停止</el-button>
          <el-button type="primary" round :icon="Promotion" :loading="busy" :disabled="!draft.trim()" @click="send">
            发送
          </el-button>
        </div>
      </footer>
    </section>
  </PortalShell>
</template>

<script setup>
// views/AIView.vue — C1 校园智能问答（面向全部登录账号）
//
// 设计要点（docs/AI-FEATURES.md §5.1）：
//   · 真流式打字机：平台已实测支持 SSE 增量推送（working/stream-probe-live.mjs），
//     不命中时 api/ai.js 会自动走"整段返回 + 一次性渲染"，前端代码无需分支
//   · 同一套页面按角色换主色（--ai-accent），**不按角色复制页面**
//   · 失败不报错：把服务端的友好文案当成一条助手消息渲染，页面其他功能照常
import { computed, nextTick, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { ChatDotRound, CloseBold, Delete, Promotion } from '@element-plus/icons-vue';
import PortalShell from '../components/PortalShell.vue';
import { useAuthStore } from '../stores/auth';
import { useAiStore } from '../stores/ai';
import { streamChat, runAiAction, runAiInsight, confirmAiAction } from '../api/ai';
import { useIsMobile } from '../utils/device';

const auth = useAuthStore();
const ai = useAiStore();
const isMobile = useIsMobile();

/**
 * 三条链路的选路（优先级从高到低）：
 *   1. `/api/ai/action`  —— 有可执行动作的角色（管理员/辅导员/教师）。
 *      **一条链路三用**：解析出动作就预览/执行、解析出问数模板就出统计、都不匹配就用同一份
 *      知识库把问题答掉。这样管理员问一句普通问题也只付一次费。
 *   2. `/api/ai/insight` —— 只有问数权限、没有动作的角色（校领导）：模板选择 + 知识问答。
 *   3. `/api/ai/chat`    —— 其余（学生/教师以外没有管理能力者）：纯流式知识问答。
 */
const routeOf = () => {
  if ((ai.status?.actions?.length || 0) > 0) return 'action';
  if ((ai.status?.insights?.length || 0) > 0) return 'insight';
  return 'chat';
};

/** 模板里用它切换输入框提示语（有可执行动作的角色提示"可以直接下指令"） */
const canRunActions = computed(() => (ai.status?.actions?.length || 0) > 0);

let seq = 0;
const nextId = () => ++seq;

const WELCOME = '你好，我是「智汇校园」的 AI 校园助手。\n可以问我学校的院系部门、选课退课、请假审批、报修流程、图书借阅、宿舍管理、校园邮箱等各类问题。';

const msgs = ref([{ id: nextId(), role: 'assistant', content: WELCOME, sources: [] }]);
const draft = ref('');
const busy = ref(false);
const scroller = ref(null);
let controller = null;

/** 生成请求用的历史（不含正在生成的这条，最多 6 轮） */
const historyForRequest = () =>
  msgs.value
    .filter((m) => !m.pending && !m.error && m.content)
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content }));

/** 极简 Markdown 渲染：先整体转义，再只注入我们自己的标签（无 XSS 面） */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function renderLite(text) {
  let h = esc(text);
  h = h.replace(/^#{1,6}\s*/gm, '');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/^\s*[-*+]\s+/gm, '· ');
  h = h.replace(/^\s*(\d+)\.\s+/gm, '$1. ');
  return h.replace(/\n/g, '<br>');
}

let raf = 0;
function scrollToBottom() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function ask(question) {
  draft.value = question;
  await send();
}

async function send() {
  const q = draft.value.trim();
  if (!q || busy.value) return;

  const history = historyForRequest();
  draft.value = '';
  msgs.value.push({ id: nextId(), role: 'user', content: q, sources: [] });
  const reply = { id: nextId(), role: 'assistant', content: '', sources: [], pending: true, streaming: false };
  msgs.value.push(reply);
  busy.value = true;
  await nextTick();
  scrollToBottom();

  const route = routeOf();
  if (route === 'action') await sendViaAction(q, reply);
  else if (route === 'insight') await sendViaInsight(q, reply);
  else await sendViaChat(q, history, reply);

  reply.pending = false;
  reply.streaming = false;
  busy.value = false;
  controller = null;
  scrollToBottom();
}

/** C5：一条结构化链路（可执行 / 可查询 / 纯回答） */
async function sendViaAction(text, reply) {
  const res = await runAiAction(text);
  reply.pending = false;

  if (res.code !== 0) {
    reply.content = res.message || '操作解析失败，请稍后再试';
    reply.error = true;
    if (res.code === 40103) ElMessage.warning(res.message);
    return;
  }
  const d = res.data || {};
  reply.kind = d.kind;
  reply.opLabel = d.intent?.label || '';
  reply.label = d.intent?.label || '';
  reply.sources = d.sources || [];

  if (d.kind === 'read') {
    reply.label = d.intent?.label || '';
    reply.summary = d.summary || '';
    reply.rows = d.rows || [];
    // 表格内容也存一份纯文本，保证"清空/回看历史"时不丢上下文
    reply.content = `${d.intent?.label || ''} ${d.summary || ''}`.trim();
  } else if (d.kind === 'data') {
    reply.kind = 'data';
    reply.label = d.intent?.label || '';
    reply.periodLabel = d.periodLabel || '';
    reply.summary = d.summary || '';
    reply.rows = d.rows || [];
    reply.extra = d.extra || null;
    reply.content = `${reply.label} ${reply.summary}`.trim();
  } else if (d.kind === 'write') {
    reply.preview = d.preview;
    reply.confirmToken = d.confirmToken;
    reply.opState = 'idle';
    reply.label = d.intent?.label || '';
  } else {
    reply.content = d.reply || '';
    if (!reply.content) {
      reply.content = '我没理解这是一条系统管理指令。可以说得更具体些，例如"禁用账号 student01"。';
    }
  }
}

/** C6：问数（模板选择 + 参数抽取都在服务端完成） */
async function sendViaInsight(text, reply) {
  const res = await runAiInsight(text);
  reply.pending = false;
  if (res.code !== 0) {
    reply.content = res.message || '问数服务暂时不可用，请稍后再试';
    reply.error = true;
    return;
  }
  const d = res.data || {};
  if (d.kind === 'data') {
    reply.kind = 'data';
    reply.label = d.intent?.label || '';
    reply.periodLabel = d.periodLabel || '';
    reply.summary = d.summary || '';
    reply.rows = d.rows || [];
    reply.extra = d.extra || null;
    reply.content = `${reply.label} ${reply.summary}`.trim();
  } else {
    reply.kind = 'none';
    reply.content = d.reply || '我不确定你想看哪项数据。';
    reply.sources = d.sources || [];
  }
}

/** C1：流式知识问答 */
async function sendViaChat(question, history, reply) {
  controller = new AbortController();
  const res = await streamChat({
    question,
    history,
    signal: controller.signal,
    handlers: {
      onMeta: (d) => {
        reply.sources = d?.sources || [];
      },
      onDelta: (d) => {
        if (reply.pending) reply.pending = false;
        reply.streaming = true;
        reply.content += d?.text ?? '';
        scrollToBottom();
      },
      onDone: () => {
        reply.streaming = false;
        reply.pending = false;
      },
      onError: (d) => {
        reply.streaming = false;
        reply.pending = false;
        if (d?.message && !reply.content) {
          reply.content = d.message;
          reply.error = true;
        }
      },
    },
  });

  reply.pending = false;
  reply.streaming = false;

  if (!res.ok) {
    if (res.aborted) {
      // 用户主动停止：保留已生成的部分，不要清空也不要报错
      if (!reply.content) reply.content = '（已停止生成）';
    } else {
      reply.content = res.message || '智能问答暂时不可用，请稍后再试';
      reply.error = true;
      if (res.code === 40103) ElMessage.warning(res.message);
    }
  }
}

/** C5 第二步：用户点"确认执行" */
async function confirmOp(m) {
  if (!m.confirmToken || m.opState === 'running') return;
  m.opState = 'running';
  const res = await confirmAiAction(m.confirmToken);
  m.opState = 'done';
  if (res.code === 0) {
    const d = res.data?.result || {};
    m.content = [d.message, ...(d.affected || []).map((x) => `· ${x}`)].join('\n');
    m.preview = null; // 收起确认卡，换成执行结果
    m.kind = 'none';
    ElMessage.success(d.message || '已执行');
  } else {
    m.content = res.message || '执行失败';
    m.error = true;
    m.preview = null;
    m.kind = 'none';
  }
  scrollToBottom();
}

/** C5 取消：什么都不做，只是收起确认卡（此时服务端从未执行） */
function cancelOp(m) {
  m.opState = 'done';
  m.preview = null;
  m.kind = 'none';
  m.content = '已取消，未执行任何操作。';
}

function stop() {
  controller?.abort();
}

function onKeydown(e) {
  // 移动端 Enter 换行（软键盘上"发送"由按钮承担），桌面端 Enter 直接发送
  if (e.key === 'Enter' && !e.shiftKey && !isMobile.value) {
    e.preventDefault();
    send();
  }
}

function clearChat() {
  msgs.value = [{ id: nextId(), role: 'assistant', content: WELCOME, sources: [] }];
}

onMounted(async () => {
  // 能力清单由 store 缓存：同一用户只拉一次（悬浮球与菜单共用同一份）
  await ai.load(auth.user?.id ?? null);
  if (!ai.chatOn) ElMessage.warning('智能问答当前不可用，请稍后再试');
  scrollToBottom();
});
</script>

<style scoped>
.ai-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 210px);
  min-height: 460px;
  background: #fff;
  border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 14px;
  box-shadow: 0 6px 24px rgba(23, 50, 92, 0.07);
  overflow: hidden;
}
.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--zc-border);
  background: linear-gradient(180deg, #fbfcfe, #f6f8fb);
}
.ai-head-l { display: flex; align-items: center; gap: 12px; }
.ai-badge {
  width: 36px;
  height: 36px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #fff;
  background: var(--ai-accent);
}
.ai-head h2 { margin: 0 0 3px; font-size: 17px; color: var(--zc-navy); letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px; }
.ai-ver {
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--ai-accent);
  background: var(--ai-soft);
  border: 1px solid var(--ai-accent);
  border-radius: 999px;
  padding: 1px 8px;
}
.ai-head p { margin: 0; font-size: 12.5px; color: var(--zc-text-sub); }
.ai-alert { border-radius: 0; }

/* ---------- 对话区 ---------- */
.ai-chat {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #f7f9fc;
  -webkit-overflow-scrolling: touch;
}
.ai-row { display: flex; gap: 10px; margin-bottom: 16px; align-items: flex-start; }
.ai-row.user { justify-content: flex-end; }
.ai-ava {
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 700;
  color: #fff;
  background: var(--ai-accent);
  letter-spacing: 0.5px;
}
.ai-bubble {
  max-width: min(76%, 680px);
  padding: 11px 14px;
  border-radius: 12px;
  background: #f1f3f7;
  color: var(--zc-text);
  font-size: 14px;
  line-height: 1.75;
  word-break: break-word;
}
.ai-row.user .ai-bubble {
  background: var(--ai-soft);
  border: 1px solid var(--ai-accent);
  color: var(--zc-text);
}
.ai-bubble.is-error { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; }
/* 查询结果表/确认清单需要更宽，否则列被压成竖排 */
.ai-bubble.is-wide { max-width: min(94%, 860px); }
.ai-text :deep(strong) { color: var(--zc-navy); }
.ai-text :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(23, 50, 92, 0.08);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12.5px;
}
.ai-src { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 9px; padding-top: 8px; border-top: 1px dashed rgba(23, 50, 92, 0.14); }
.ai-src-label { font-size: 11.5px; color: var(--zc-text-sub); letter-spacing: 0.5px; }
.ai-src :deep(.el-tag) { color: var(--ai-accent); border-color: var(--ai-accent); background: #fff; }

/* 打字光标 */
.ai-caret {
  display: inline-block;
  width: 2px;
  height: 14px;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--ai-accent);
  animation: ai-blink 1s steps(2, start) infinite;
}
@keyframes ai-blink { to { visibility: hidden; } }

/* ---------- C5 操作卡（查询结果 / 确认执行） ---------- */
.ai-op-head { margin: 0 0 8px; font-size: 13.5px; }
.ai-op-num { color: var(--ai-accent); font-size: 15px; }
.ai-op-tip { color: var(--zc-text-sub); font-size: 12px; }
.ai-op-list {
  margin: 0 0 8px;
  padding: 8px 10px 8px 26px;
  max-height: 190px;
  overflow-y: auto;
  list-style: disc;
  background: #fff;
  border: 1px solid var(--zc-border);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.9;
}
.ai-op-more { margin: 0 0 6px; font-size: 12px; color: var(--zc-text-sub); }
.ai-op-warn, .ai-op-skip {
  margin: 0 0 6px;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.8;
}
.ai-op-warn { color: #9a6a00; }
.ai-op-skip { color: var(--zc-text-sub); }
.ai-op-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.ai-op-btns :deep(.el-button--primary) { background: var(--ai-accent); border-color: var(--ai-accent); }

.ai-table-wrap { max-width: 100%; overflow-x: auto; border-radius: 8px; border: 1px solid var(--zc-border); background: #fff; }
.ai-table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.ai-table th, .ai-table td {
  padding: 7px 10px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--zc-border);
}
.ai-table th { background: #f6f8fb; color: var(--zc-navy); font-weight: 600; }
.ai-table tbody tr:last-child td { border-bottom: none; }
.ai-extra { margin-top: 10px; }

/* 等待首字：三点呼吸 */
.ai-typing { display: flex; gap: 5px; padding: 3px 0; }
.ai-typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ai-accent);
  opacity: 0.35;
  animation: ai-dot 1.2s infinite ease-in-out;
}
.ai-typing i:nth-child(2) { animation-delay: 0.18s; }
.ai-typing i:nth-child(3) { animation-delay: 0.36s; }
@keyframes ai-dot { 0%, 80%, 100% { opacity: 0.28; } 40% { opacity: 1; } }

/* 空态候选问题 */
.ai-start { padding: 4px 2px 0 40px; }
.ai-start-t { margin: 0 0 10px; font-size: 12.5px; color: var(--zc-text-sub); letter-spacing: 0.5px; }
.ai-chips { display: flex; flex-wrap: wrap; gap: 9px; }
.ai-chip {
  padding: 7px 14px;
  font-size: 13px;
  color: var(--zc-text);
  background: #fff;
  border: 1px solid var(--zc-border);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}
.ai-chip:hover { color: var(--ai-accent); border-color: var(--ai-accent); background: var(--ai-soft); }

/* ---------- 输入区 ---------- */
.ai-input { padding: 12px 16px 14px; border-top: 1px solid var(--zc-border); background: #fff; }
.ai-input :deep(.el-textarea__inner) {
  border-radius: 10px;
  box-shadow: none;
  border-color: var(--zc-border);
  font-size: 14px;
  line-height: 1.7;
  padding: 9px 12px;
}
.ai-input :deep(.el-textarea__inner:focus) { border-color: var(--ai-accent); }
.ai-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 10px; }
.ai-hint { margin-right: auto; font-size: 11.5px; color: var(--zc-text-sub); }
.ai-actions :deep(.el-button--primary) {
  background: var(--ai-accent);
  border-color: var(--ai-accent);
}

/* ---------- 窄屏 ---------- */
@media (max-width: 820px) {
  .ai-page { height: calc(100vh - 180px); min-height: 380px; border-radius: 12px; }
  .ai-head { padding: 12px 14px; }
  .ai-head p { display: none; }
  .ai-chat { padding: 14px 12px; }
  .ai-bubble { max-width: 86%; font-size: 13.5px; }
  .ai-start { padding-left: 0; }
  .ai-chip { padding: 6px 12px; font-size: 12.5px; }
  .ai-input { padding: 10px 12px 12px; }
  .ai-hint { display: none; }
}
</style>
