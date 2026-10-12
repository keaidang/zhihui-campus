// src/utils/img-compress.js —— 前端多模态图片压缩与 Data URL 转换
//
// 作用：用户在聊天界面上传或粘贴图片时，统一在客户端压缩至适中分辨率与体积（最长边 1280px、JPEG 0.85），
// 既显著减少网络传输耗时，又降低大模型视觉 Token 消耗与处理延迟。
// 注意：DashScope Qwen 要求图片宽与高均大于 10px，此处最小边限制保底 12px。

export function compressImageFile(file, maxSide = 1280, quality = 0.85) {
  return new Promise((resolve) => {
    if (!file || !(file instanceof Blob) || !file.type?.startsWith('image/')) {
      return resolve(null);
    }
    if (file.type === 'image/gif') {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = Math.max(img.width, img.height);
      const scale = maxDim > maxSide ? maxSide / maxDim : 1;
      const w = Math.max(12, Math.round(img.width * scale));
      const h = Math.max(12, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
