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
          <div class="ai-bubble" :class="{ 'is-error': m.error }">
            <div v-if="m.pending && !m.content" class="ai-typing"><i /><i /><i /></div>
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
          placeholder="问点校园里的问题，例如「怎么选课」「请假要谁批」"
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
import { nextTick, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { ChatDotRound, CloseBold, Delete, Promotion } from '@element-plus/icons-vue';
import PortalShell from '../components/PortalShell.vue';
import { useAuthStore } from '../stores/auth';
import { useAiStore } from '../stores/ai';
import { streamChat } from '../api/ai';
import { useIsMobile } from '../utils/device';

const auth = useAuthStore();
const ai = useAiStore();
const isMobile = useIsMobile();

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

  controller = new AbortController();
  const res = await streamChat({
    question: q,
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
  busy.value = false;
  controller = null;
  scrollToBottom();
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
