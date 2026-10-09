<template>
  <transition name="orb-fade">
    <button
      v-if="show"
      class="ai-orb"
      type="button"
      :style="{ '--ai-accent': ai.accent, '--ai-soft': ai.soft }"
      :title="`AI 助手 · ${ai.theme.label}`"
      aria-label="打开 AI 助手"
      @click="go"
    >
      <el-icon :size="22"><ChatDotRound /></el-icon>
      <span class="ai-orb-tip">{{ ai.theme.label }}</span>
    </button>
  </transition>
</template>

<script setup>
// components/AiOrb.vue — 门户悬浮球（AI 助手入口）
// 只在"问答能力可用 + 不在 /ai 页面本身"时出现；主色随角色变化（AI-FEATURES §1.4）。
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChatDotRound } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { useAiStore } from '../stores/ai';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const ai = useAiStore();

const show = computed(() => ai.chatOn && route.path !== '/ai');

async function refresh() {
  await ai.load(auth.user?.id ?? null);
}

onMounted(refresh);
// 登录用户变化（切换账号 / 首次拿到 me）时重拉，避免沿用上一个角色的配色与能力
watch(() => auth.user?.id, refresh);

function go() {
  router.push('/ai');
}
</script>

<style scoped>
.ai-orb {
  position: fixed;
  right: 26px;
  bottom: 30px;
  z-index: 30;
  width: 46px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: #fff;
  background: var(--ai-accent);
  box-shadow: 0 8px 22px rgba(15, 35, 66, 0.26);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}
.ai-orb:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 12px 28px rgba(15, 35, 66, 0.32);
}
.ai-orb:active {
  transform: scale(0.96);
}
/* 悬停时浮出角色版本文案，鼠标移开即收起（不占布局） */
.ai-orb-tip {
  position: absolute;
  right: 56px;
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
.orb-fade-enter-active,
.orb-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.orb-fade-enter-from,
.orb-fade-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

/* 窄屏：贴边更近，且不遮挡底部备案信息 */
@media (max-width: 820px) {
  .ai-orb {
    right: 14px;
    bottom: 18px;
    width: 44px;
    height: 44px;
  }
  .ai-orb-tip {
    display: none;
  }
}
</style>
