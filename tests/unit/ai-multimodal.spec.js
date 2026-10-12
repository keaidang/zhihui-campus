// tests/unit/ai-multimodal.spec.js — 多模态图片视觉能力单测
import { describe, it, expect } from 'vitest';
import { compressImageFile } from '../../src/utils/img-compress.js';

describe('AI 多模态图片输入 · 纯函数与数据流', () => {
  it('compressImageFile 非图片/非法输入安全兜底返回 null', async () => {
    expect(await compressImageFile(null)).toBeNull();
    expect(await compressImageFile(undefined)).toBeNull();
    expect(await compressImageFile('not-a-file')).toBeNull();
    expect(await compressImageFile(new Blob(['hello'], { type: 'text/plain' }))).toBeNull();
  });

  it('多模态图片数组校验与截断（最多 3 张，过滤非法前缀）', () => {
    const rawImages = [
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'https://example.com/photo.jpg',
      'javascript:alert(1)',
      'data:image/jpeg;base64,abcd',
      'http://example.com/extra.png',
    ];

    const sanitized = rawImages
      .filter((img) => typeof img === 'string' && (img.startsWith('data:image/') || img.startsWith('http://') || img.startsWith('https://')))
      .slice(0, 3);

    expect(sanitized.length).toBe(3);
    expect(sanitized[0]).toContain('data:image/png');
    expect(sanitized[1]).toBe('https://example.com/photo.jpg');
    expect(sanitized[2]).toBe('data:image/jpeg;base64,abcd');
    expect(sanitized.includes('javascript:alert(1)')).toBe(false);
  });

  it('多模态消息体组装：无图片时为纯文本，有图片时转为 OpenAI/DashScope 标准 content 数组', () => {
    function formatUserMessage(question, images = []) {
      if (images && images.length > 0) {
        const userContent = [{ type: 'text', text: question || '请分析这幅图片中的内容' }];
        for (const img of images) {
          userContent.push({
            type: 'image_url',
            image_url: { url: img },
          });
        }
        return { role: 'user', content: userContent };
      }
      return { role: 'user', content: question };
    }

    const textOnly = formatUserMessage('宿舍空调怎么报修？', []);
    expect(textOnly).toEqual({ role: 'user', content: '宿舍空调怎么报修？' });

    const withImg = formatUserMessage('这台设备怎么了？', ['data:image/png;base64,test']);
    expect(withImg.role).toBe('user');
    expect(Array.isArray(withImg.content)).toBe(true);
    expect(withImg.content[0]).toEqual({ type: 'text', text: '这台设备怎么了？' });
    expect(withImg.content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,test' } });

    const imgOnlyNoQuestion = formatUserMessage('', ['data:image/jpeg;base64,photo']);
    expect(imgOnlyNoQuestion.content[0].text).toBe('请分析这幅图片中的内容');
  });
});
