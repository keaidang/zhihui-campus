<template>
  <div class="sunny-backdrop" :class="{ plain }" aria-hidden="true">
    <!--
      ★ 背景图方案（用户已确认）：public/web-pc.webp 桌面端 / web-phont.png 移动端
      ★ 登录页（plain=true）：无纱罩纯虚化实景（参考统一身份认证截图）
      ★ 首页：保留浅白渐变纱罩保证浅色内容可读性
    -->
    <div class="overlay"></div>
  </div>
</template>

<script setup>
defineProps({
  plain: { type: Boolean, default: false },
});
</script>
