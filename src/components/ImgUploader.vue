<template>
  <div class="img-uploader">
    <div v-for="(u, i) in modelValue" :key="u" class="iu-item">
      <img :src="u" alt="已上传图片" />
      <button type="button" class="iu-del" @click="remove(i)">×</button>
    </div>
    <label v-if="modelValue.length < max" class="iu-add" :class="{ busy }">
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden @change="onPick" />
      <span v-if="!busy">＋<em>上传图片</em></span>
      <span v-else>上传中…</span>
    </label>
  </div>
  <p class="iu-tip">支持 jpg/png/webp/gif，单张 ≤ 3MB，最多 {{ max }} 张（自动压缩）</p>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api/request';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  max: { type: Number, default: 6 },
});
const emit = defineEmits(['update:modelValue']);
const busy = ref(false);

function remove(i) {
  const next = [...props.modelValue];
  next.splice(i, 1);
  emit('update:modelValue', next);
}

/** 压缩到最长边 1280px / JPEG 0.85（gif 跳过压缩） */
function compress(file) {
  return new Promise((resolve) => {
    if (file.type === 'image/gif' || file.size < 200 * 1024) return resolve(null);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function onPick(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) {
    // 超限且压不动（gif）→ 拒绝
    if (file.type === 'image/gif') return ElMessage.warning('GIF 不能超过 3MB');
  }
  busy.value = true;
  try {
    let b64 = await compress(file);
    let mime = 'image/jpeg';
    if (!b64) {
      mime = file.type || 'image/jpeg';
      b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(file);
      });
    }
    if (b64.startsWith('data:')) b64 = b64.slice(b64.indexOf(',') + 1);
    const res = await api('/api/blob', { method: 'POST', body: { base64: b64, mime } });
    if (res.code === 0 && res.data?.url) {
      emit('update:modelValue', [...props.modelValue, res.data.url]);
      ElMessage.success('图片已上传');
    } else {
      ElMessage.error(res.message || '上传失败');
    }
  } catch {
    ElMessage.error('上传失败，请重试');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.img-uploader { display: flex; flex-wrap: wrap; gap: 8px; }
.iu-item { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; border: 1px solid var(--zc-border, #dde3ec); }
.iu-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.iu-del {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%;
  border: none; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 12px; line-height: 18px;
  cursor: pointer; padding: 0;
}
.iu-add {
  width: 84px; height: 84px; border: 1.5px dashed var(--zc-border, #b9c3d4); border-radius: 8px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  color: var(--zc-text-sub, #64748b); font-size: 18px;
}
.iu-add em { font-style: normal; font-size: 12px; margin-left: 4px; }
.iu-add:hover { border-color: var(--zc-navy, #17325c); color: var(--zc-navy, #17325c); }
.iu-add.busy { opacity: 0.6; cursor: wait; }
.iu-tip { margin: 6px 0 0; font-size: 11.5px; color: var(--zc-text-sub, #94a3b8); }
</style>
