<template>
  <!-- ============ 展开的对话面板 ============ -->
  <transition name="ai-panel">
    <section v-if="show && open" class="ai-panel" :style="{ '--ai-accent': ai.accent, '--ai-soft': ai.soft }">
      <header class="pl-head">
        <div class="pl-head-l">
          <span class="pl-badge"><el-icon :size="15"><ChatDotRound /></el-icon></span>
          <div>
            <b>AI 校园助手</b>
            <span class="pl-ver">{{ ai.theme.label }}</span>
          </div>
        </div>
        <div class="pl-head-r">
          <el-button link :icon="FullScreen" title="打开完整助手" @click="goFull" />
          <el-button link :icon="Close" title="收起" @click="close" />
        </div>
      </header>

      <div ref="scroller" class="pl-body">
        <div v-for="m in msgs" :key="m.id" class="pl-row" :class="m.role">
          <div v-if="m.role === 'assistant'" class="pl-ava">AI</div>
          <div class="pl-bubble" :class="{ 'is-error': m.error }">
            <!-- 多模态图片预览（用户提问带图） -->
            <div v-if="m.images && m.images.length" class="pl-bubble-imgs">
              <el-image
                v-for="(img, idx) in m.images"
                :key="idx"
                :src="img"
                :preview-src-list="m.images"
                :initial-index="idx"
                fit="cover"
                class="pl-bubble-img"
                preview-teleported
              />
            </div>
            <!-- 等待首字：上游首字延迟实测 3~10 秒，给出阶段提示而不是干转圈 -->
            <div v-if="m.pending && !m.content" class="pl-wait">
              <span>{{ m.waitHint || '正在思考…' }}</span>
              <span class="pl-dots"><i /><i /><i /></span>
            </div>
            <template v-else-if="m.content">
              <div class="pl-text" v-html="renderLite(m.content)" />
              <span v-if="m.streaming && m.content" class="pl-caret" />
            </template>
            <div v-if="m.sources && m.sources.length" class="pl-src">
              <span class="pl-src-label">参考</span>
              <em v-for="s in m.sources" :key="s.id">{{ s.title }}</em>
            </div>
            <!-- C14 问办合一：业务直达捷径 -->
            <div v-if="m.shortcuts && m.shortcuts.length" class="pl-shortcuts">
              <button
                v-for="(sc, sci) in m.shortcuts"
                :key="sci"
                class="pl-sc-btn"
                type="button"
                @click="onShortcut(sc)"
              >
                {{ sc.label }} →
              </button>
            </div>
          </div>
        </div>

        <div v-if="msgs.length <= 1 && !busy" class="pl-chips">
          <button v-for="(q, i) in chips" :key="i" type="button" @click="ask(q)">{{ q }}</button>
        </div>
      </div>

      <footer class="pl-foot">
        <!-- 多模态图片附件预览条 -->
        <div v-if="attachedImages.length > 0" class="pl-attach-bar">
          <div v-for="(img, idx) in attachedImages" :key="idx" class="pl-attach-item">
            <img :src="img" class="pl-attach-thumb" alt="附件缩略图" />
            <button type="button" class="pl-attach-del" title="移除图片" @click="removeImage(idx)">×</button>
          </div>
          <span class="pl-attach-count">{{ attachedImages.length }}/3</span>
        </div>

        <el-input
          v-model="draft"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 3 }"
          resize="none"
          maxlength="500"
          placeholder="问点什么，或发图片"
          @keydown="onKeydown"
          @paste="onPaste"
        />
        <div class="pl-actions">
          <input
            ref="fileInputRef"
            type="file"
            accept="image/*"
            multiple
            style="display: none"
            @change="onFilePicked"
          />
          <el-tooltip content="添加图片识别（可直接粘贴截图，最多3张）" placement="top">
            <el-button
              link
              :icon="Picture"
              :disabled="busy || attachedImages.length >= 3"
              class="pl-tool-btn"
              @click="triggerPickImage"
            />
          </el-tooltip>
          <span class="pl-hint">Enter 发送</span>
          <el-button v-if="busy" link :icon="CloseBold" title="停止" @click="stop" />
          <el-button
            type="primary"
            circle
            :icon="Promotion"
            :loading="busy"
            :disabled="!draft.trim() && attachedImages.length === 0"
            @click="send"
          />
        </div>
        <p class="pl-more" @click="goFull">需要系统管理、数据问数、学业助手？打开完整助手 →</p>
      </footer>
    </section>
  </transition>

  <!-- ============ 悬浮球 ============ -->
  <transition name="orb-fade">
    <button
      v-if="show"
      class="ai-orb"
      :class="{ 'is-open': open }"
      type="button"
      :style="{ '--ai-accent': ai.accent, '--ai-soft': ai.soft }"
      :title="open ? '收起 AI 助手' : `AI 助手 · ${ai.theme.label}`"
      aria-label="AI 助手"
      @click="toggle"
    >
      <span class="ai-orb-halo" aria-hidden="true" />
      <el-icon :size="24"><ChatDotRound /></el-icon>
      <span class="ai-orb-tip">{{ open ? '收起' : `${ai.theme.label} · 点我提问` }}</span>
    </button>
  </transition>
</template>

<script setup>
// components/AiOrb.vue — 门户悬浮球 + 快捷对话面板
//
// 为什么从"跳转按钮"升级成"可对话面板"（2026-10-09）：
//   悬浮球原来只是个入口，点了跳到 /ai。但本年度课题主线是「AI 融合」，
//   用户（以及答辩现场的评委）第一眼看到的 AI 入口应该是**能直接用的**，
//   而不是一个链接。所以：球放大、加呼吸光晕，点击原地展开对话面板。
//
// 边界（刻意保持轻量，避免和完整助手页打架）：
//   · 面板只做 **C1 校园问答**（这是全员能力，任何人都能用）；
//   · 系统管理（C5）、数据问数（C6）、学业助手（C7）等角色相关能力**引导到 /ai**，
//     因为它们的界面复杂度不是一个 380px 浮层装得下的；
//   · 流式渲染策略与 AIView 共用 utils/ai-typewriter.js —— 两个入口体验一致。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ChatDotRound, Close, CloseBold, FullScreen, Picture, Promotion } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { useAiStore } from '../stores/ai';
import { useIsMobile } from '../utils/device';
import { streamChat } from '../api/ai';
import { compressImageFile } from '../utils/img-compress';
import { clearWaitHint, disposeReply, newReplyMessage, setWaitHint, streamHandlers } from '../utils/ai-typewriter';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const ai = useAiStore();
const isMobile = useIsMobile();

const show = computed(() => ai.chatOn && route.path !== '/ai');

const WELCOME = '你好，我是「智汇校园」的 AI 校园助手。\n可以问我选课退课、请假审批、报修流程、图书借阅、宿舍管理、校园邮箱等各类问题。';

const open = ref(false);
const draft = ref('');
const attachedImages = ref([]);
const fileInputRef = ref(null);
const busy = ref(false);
const scroller = ref(null);
let seq = 0;
let controller = null;
const nextId = () => ++seq;

const msgs = ref([{ id: nextId(), role: 'assistant', content: WELCOME, sources: [] }]);

/** 候选问题取前 3 条：浮层空间有限，给太多反而不知点哪个 */
const chips = computed(() => (ai.suggestions || []).slice(0, 3));

async function refresh() {
  await ai.load(auth.user?.id ?? null);
}
onMounted(refresh);
watch(() => auth.user?.id, refresh);

function toggle() {
  open.value = !open.value;
  if (open.value) {
    nextTick(scrollToBottom);
    // 首次展开时才拉能力清单（避免每个页面加载都多一次请求）
    if (!ai.ready) refresh();
  }
}

function close() {
  open.value = false;
}

function goFull() {
  open.value = false;
  router.push('/ai');
}

function onShortcut(sc) {
  if (!sc?.path) return;
  router.push({ path: sc.path, query: sc.query || {} });
  open.value = false;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
/** 极简 Markdown：先整体转义再注入自有标签（无 XSS 面），与 AIView 的口径一致 */
function renderLite(text) {
  let h = esc(text);
  h = h.replace(/^#{1,6}\s*/gm, '');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/^\s*[-*+]\s+/gm, '· ');
  h = h.replace(/\n/g, '<br>');
  return h;
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

function triggerPickImage() {
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
    fileInputRef.value.click();
  }
}

async function handleImagesInput(files) {
  const fileArr = Array.from(files || []).filter((f) => f && f.type?.startsWith('image/'));
  if (!fileArr.length) return;
  const remaining = 3 - attachedImages.value.length;
  if (remaining <= 0) {
    ElMessage.warning('单次提问最多支持 3 张图片');
    return;
  }
  const toProcess = fileArr.slice(0, remaining);
  for (const f of toProcess) {
    const dataUrl = await compressImageFile(f);
    if (dataUrl) {
      attachedImages.value.push(dataUrl);
    }
  }
}

async function onFilePicked(e) {
  const files = e.target?.files;
  if (files && files.length) {
    await handleImagesInput(files);
  }
  if (fileInputRef.value) fileInputRef.value.value = '';
}

async function onPaste(e) {
  const items = e.clipboardData?.items;
  if (!items || !items.length) return;
  const imageFiles = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  if (imageFiles.length > 0) {
    e.preventDefault();
    await handleImagesInput(imageFiles);
  }
}

function removeImage(idx) {
  attachedImages.value.splice(idx, 1);
}

async function ask(q) {
  draft.value = q;
  await send();
}

async function send() {
  const q = draft.value.trim();
  const imgs = [...attachedImages.value];
  if ((!q && imgs.length === 0) || busy.value) return;

  // 历史只带本面板内的对话（最多 4 轮，浮层场景不需要长上下文）
  const history = msgs.value
    .filter((m) => !m.pending && !m.error && m.content)
    .slice(-4)
    .map((m) => ({ role: m.role, content: m.content }));

  draft.value = '';
  attachedImages.value = [];

  const displayText = q;
  const promptText = q || '请分析这幅图片中的内容';

  msgs.value.push({ id: nextId(), role: 'user', content: displayText, images: imgs, sources: [] });
  msgs.value.push(newReplyMessage(nextId()));
  // ★ 同 AIView：必须改数组里取回的 reactive 代理，改原始对象不会触发渲染
  const reply = msgs.value[msgs.value.length - 1];
  busy.value = true;
  setWaitHint(reply);
  await nextTick();
  scrollToBottom();

  controller = new AbortController();
  const res = await streamChat({
    question: promptText,
    history,
    images: imgs,
    signal: controller.signal,
    handlers: streamHandlers(reply, { onTick: scrollToBottom }),
  });

  reply.pending = false;
  reply._streamEnd = true;
  clearWaitHint(reply);
  // 与 AIView 同理：打字机没接管时必须兜底关掉 streaming，否则光标一直亮
  if (!reply._typer) reply.streaming = false;
  if (!res.ok) {
    if (!res.aborted) {
      reply.content = res.message || '智能问答暂时不可用，请稍后再试';
      reply.error = true;
      if (res.code === 40103) ElMessage.warning(res.message);
    } else if (!reply.content) {
      reply.content = '（已停止生成）';
    }
    reply.streaming = false;
  }

  busy.value = false;
  controller = null;
  scrollToBottom();
}

function stop() {
  controller?.abort();
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !isMobile.value) {
    e.preventDefault();
    send();
  }
}

// 组件卸载（切页/退出登录）时清掉定时器，避免打字机继续对已卸载的响应式对象写入
onUnmounted(() => {
  controller?.abort();
  for (const m of msgs.value) disposeReply(m);
});
</script>

<style scoped>
/* ================= 悬浮球 ================= */
.ai-orb {
  position: fixed;
  right: 26px;
  bottom: 30px;
  z-index: 31;
  width: 58px;
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: #fff;
  background: linear-gradient(140deg, var(--ai-accent), #7f77dd);
  box-shadow: 0 10px 26px rgba(23, 50, 92, 0.3);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}
.ai-orb:hover {
  transform: translateY(-2px) scale(1.06);
  box-shadow: 0 14px 34px rgba(23, 50, 92, 0.38);
}
.ai-orb:active {
  transform: scale(0.95);
}
.ai-orb.is-open {
  background: var(--zc-navy);
}
/* 呼吸光晕：让 AI 入口在静止状态下也有存在感（课题主线是 AI，值得被看见） */
.ai-orb-halo {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  background: var(--ai-accent);
  opacity: 0.28;
  animation: orb-breathe 2.6s ease-in-out infinite;
  pointer-events: none;
}
@keyframes orb-breathe {
  0%, 100% { transform: scale(1); opacity: 0.24; }
  50% { transform: scale(1.16); opacity: 0.1; }
}
@media (prefers-reduced-motion: reduce) {
  .ai-orb-halo { animation: none; }
}
.ai-orb-tip {
  position: absolute;
  right: 70px;
  white-space: nowrap;
  font-size: 12px;
  letter-spacing: 0.5px;
  padding: 5px 10px;
  border-radius: 8px;
  color: #fff;
  background: var(--ai-accent);
  opacity: 0;
  transform: translateX(6px);
  transition: opacity 0.18s ease, transform 0.18s ease;
  pointer-events: none;
}
.ai-orb:hover .ai-orb-tip {
  opacity: 1;
  transform: translateX(0);
}

/* ================= 对话面板 ================= */
.ai-panel {
  position: fixed;
  right: 26px;
  bottom: 100px;
  z-index: 30;
  width: 390px;
  max-width: calc(100vw - 32px);
  height: 560px;
  max-height: calc(100vh - 150px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid rgba(23, 50, 92, 0.1);
  border-radius: 16px;
  box-shadow: 0 18px 48px rgba(23, 50, 92, 0.22);
  overflow: hidden;
}
.pl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--zc-border);
  background: linear-gradient(180deg, #fbfcfe, #f5f8fc);
}
.pl-head-l { display: flex; align-items: center; gap: 10px; }
.pl-badge {
  width: 30px;
  height: 30px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: #fff;
  background: var(--ai-accent);
}
.pl-head-l b { font-size: 14px; color: var(--zc-navy); display: block; line-height: 1.3; }
.pl-ver { font-size: 11.5px; color: var(--ai-accent); }
.pl-head-r :deep(.el-button) { color: var(--zc-text-sub); }
.pl-head-r :deep(.el-button:hover) { color: var(--ai-accent); }

.pl-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  background: #f7f9fc;
  -webkit-overflow-scrolling: touch;
}
.pl-row { display: flex; gap: 8px; margin-bottom: 12px; align-items: flex-start; }
.pl-row.user { justify-content: flex-end; }
.pl-ava {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 700;
  color: #fff;
  background: var(--ai-accent);
}
.pl-bubble {
  max-width: 82%;
  padding: 9px 12px;
  border-radius: 11px;
  background: #fff;
  border: 1px solid var(--zc-border);
  color: var(--zc-text);
  font-size: 13.5px;
  line-height: 1.72;
  word-break: break-word;
}
.pl-row.user .pl-bubble {
  background: var(--ai-soft);
  border-color: var(--ai-accent);
}
.pl-bubble-imgs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.pl-row.user .pl-bubble-imgs {
  justify-content: flex-end;
}
.pl-bubble-img {
  width: 90px;
  height: 90px;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  background: var(--el-fill-color-light);
}
.pl-bubble.is-error { background: #fff7ed; border-color: #fdba74; color: #9a3412; }
.pl-text :deep(strong) { color: var(--zc-navy); }
.pl-text :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(23, 50, 92, 0.08);
  font-size: 12px;
}
.pl-caret {
  display: inline-block;
  width: 2px;
  height: 13px;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--ai-accent);
  animation: pl-blink 1s steps(2, start) infinite;
}
@keyframes pl-blink { to { visibility: hidden; } }
.pl-src {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(23, 50, 92, 0.14);
}
.pl-src-label { font-size: 11px; color: var(--zc-text-sub); }
.pl-src em {
  font-style: normal;
  font-size: 11px;
  color: var(--ai-accent);
  border: 1px solid var(--ai-accent);
  border-radius: 999px;
  padding: 1px 7px;
}
.pl-shortcuts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; padding-top: 6px; border-top: 1px dashed rgba(23, 50, 92, 0.12); }
.pl-sc-btn {
  display: inline-flex;
  align-items: center;
  font-size: 11.5px;
  padding: 3px 9px;
  background: #fff;
  color: var(--ai-accent);
  border: 1px solid var(--ai-accent);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.pl-sc-btn:hover { background: var(--ai-accent); color: #fff; }

/* 等待首字 */
.pl-wait { display: flex; align-items: center; gap: 7px; }
.pl-wait > span:first-child { font-size: 12.5px; color: var(--zc-text-sub); }
.pl-dots { display: flex; gap: 4px; }
.pl-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ai-accent);
  opacity: 0.35;
  animation: pl-dot 1.2s infinite ease-in-out;
}
.pl-dots i:nth-child(2) { animation-delay: 0.18s; }
.pl-dots i:nth-child(3) { animation-delay: 0.36s; }
@keyframes pl-dot { 0%, 80%, 100% { opacity: 0.28; } 40% { opacity: 1; } }

.pl-chips { display: flex; flex-wrap: wrap; gap: 7px; padding-left: 34px; }
.pl-chips button {
  padding: 5px 11px;
  font-size: 12.5px;
  color: var(--zc-text);
  background: #fff;
  border: 1px solid var(--zc-border);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.18s ease;
}
.pl-chips button:hover { color: var(--ai-accent); border-color: var(--ai-accent); }

.pl-foot { padding: 10px 12px 8px; border-top: 1px solid var(--zc-border); background: #fff; }
.pl-attach-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--el-fill-color-light);
  border-radius: 7px;
  margin-bottom: 6px;
  border: 1px dashed var(--zc-border);
}
.pl-attach-item {
  position: relative;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
}
.pl-attach-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 5px;
  border: 1px solid var(--zc-border);
}
.pl-attach-del {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 16px;
  height: 16px;
  background: #f56c6c;
  color: #fff;
  border-radius: 50%;
  border: none;
  font-size: 11px;
  line-height: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.pl-attach-count {
  font-size: 11px;
  color: var(--zc-text-sub);
}
.pl-foot :deep(.el-textarea__inner) {
  border-radius: 9px;
  box-shadow: none;
  border-color: var(--zc-border);
  font-size: 13.5px;
  line-height: 1.65;
  padding: 8px 11px;
}
.pl-foot :deep(.el-textarea__inner:focus) { border-color: var(--ai-accent); }
.pl-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 7px; }
.pl-hint { margin-right: auto; font-size: 11px; color: var(--zc-text-sub); }
.pl-tool-btn {
  color: var(--zc-text-sub);
  padding: 4px;
}
.pl-tool-btn:hover {
  color: var(--ai-accent);
}
.pl-actions :deep(.el-button--primary) { background: var(--ai-accent); border-color: var(--ai-accent); }
.pl-more {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--ai-accent);
  cursor: pointer;
  text-align: center;
}
.pl-more:hover { text-decoration: underline; }

/* 动效 */
.orb-fade-enter-active, .orb-fade-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.orb-fade-enter-from, .orb-fade-leave-to { opacity: 0; transform: scale(0.8); }
.ai-panel-enter-active, .ai-panel-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.ai-panel-enter-from, .ai-panel-leave-to { opacity: 0; transform: translateY(12px) scale(0.97); }

/* 窄屏：面板几乎全宽，球略微缩小，适配 iPhone 底部手势横条与动态视口高度 */
@media (max-width: 820px) {
  .ai-orb {
    right: 14px;
    bottom: calc(18px + env(safe-area-inset-bottom, 0px));
    width: 52px;
    height: 52px;
  }
  .ai-orb-tip { display: none; }
  .ai-panel {
    right: 10px;
    left: 10px;
    bottom: calc(78px + env(safe-area-inset-bottom, 0px));
    width: auto;
    height: 68vh;
    height: min(72dvh, 560px);
    max-height: calc(100dvh - 100px);
    border-radius: 14px;
  }
  .pl-foot :deep(.el-textarea__inner) {
    font-size: 16px; /* 关键：防止 iOS Safari 获得焦点时自动放大页面 */
    padding: 8px 10px;
  }
  .pl-bubble { font-size: 13px; }
  .pl-hint { display: none; }
}

@media (max-width: 480px) {
  .ai-panel {
    right: 8px;
    left: 8px;
    bottom: calc(72px + env(safe-area-inset-bottom, 0px));
  }
  .pl-head {
    padding: 10px 12px;
  }
  .pl-body {
    padding: 10px;
  }
  .pl-chips {
    padding-left: 0;
  }
  .pl-chips button {
    font-size: 12px;
    padding: 4px 10px;
  }
}
</style>
