import { onMounted, onUnmounted, ref } from 'vue';

/**
 * 设备 / 视口检测（移动端布局开关）
 *
 * 设计口径（2026-09-20）：
 * - **唯一判据是视口宽度** `matchMedia('(max-width: 820px)')`，不用 UA 嗅探。
 *   原因：UA 在平板、折叠屏、桌面浏览器缩窗口、手机浏览器"桌面模式"下全都不可靠；
 *   而 CSS 媒体查询实际生效的依据就是视口宽度 —— JS 与 CSS 必须用同一个判据，
 *   否则会出现"JS 判定为手机、CSS 判定为桌面"的错位（布局半死不活）。
 * - 820px 与 PortalShell 既有断点一致；PC 全屏（常见 ≥1280px）永不命中，
 *   因此 PC 端布局与样式不受本机制任何影响。
 * - 旋转屏幕 / 拖动窗口跨越断点时会自动更新，无需刷新页面。
 */

/** 移动端断点上限（必须与 src/mobile.css 里的媒体查询保持一致） */
export const MOBILE_MAX_WIDTH = 820;

const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

/** 当前视口是否为移动端宽度（非响应式一次性判断） */
export function isMobileViewport() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * 组合式：返回响应式的"是否移动端视口"
 * 用法：const isMobile = useIsMobile();  // 模板里 v-if="isMobile" 切换移动端专属结构
 */
export function useIsMobile() {
  const isMobile = ref(isMobileViewport());

  let mq = null;
  const onChange = (e) => { isMobile.value = e.matches; };

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    mq = window.matchMedia(MOBILE_QUERY);
    isMobile.value = mq.matches;
    mq.addEventListener('change', onChange);
  });

  onUnmounted(() => {
    if (mq) mq.removeEventListener('change', onChange);
  });

  return isMobile;
}
