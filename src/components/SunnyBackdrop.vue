<template>
  <div class="sunny-backdrop" aria-hidden="true">
    <!--
      ★ 临时背景（占位设计）：天空渐变 + 光晕 + 山丘剪影，纯 CSS/SVG 自绘
      ★ 用户确认背景图后：删除本组件内装饰元素，改为 <img> 或 background-image 即可
    -->
    <div class="glow"></div>
    <div class="sun"></div>
    <svg class="hills" viewBox="0 0 1440 320" preserveAspectRatio="none" height="260">
      <path fill="rgba(14, 165, 233, 0.10)" d="M0,192 C240,96 480,288 720,224 C960,160 1200,64 1440,160 L1440,320 L0,320 Z" />
      <path fill="rgba(37, 99, 235, 0.08)" d="M0,256 C320,160 640,320 960,256 C1200,208 1320,240 1440,224 L1440,320 L0,320 Z" />
      <path fill="rgba(245, 158, 11, 0.06)" d="M0,288 C360,240 720,336 1080,288 C1260,264 1350,288 1440,272 L1440,320 L0,320 Z" />
    </svg>
  </div>
</template>
