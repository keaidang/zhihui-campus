<template>
  <PortalShell active="mail">
    <!-- 未开通对外收发 -->
    <section v-if="!hasMailbox" class="ml-locked">
      <el-empty description="校园邮箱对外收发尚未开通">
        <template #image><el-icon :size="64" color="#94a3b8"><Promotion /></el-icon></template>
        <p class="ml-locked-tip">
          当前账号：<b>{{ auth.user?.campusEmail || '尚未分配校园邮箱' }}</b>
        </p>
        <p class="ml-locked-tip">请联系管理员在「账号管理」中为你开通对外收发</p>
      </el-empty>
    </section>

    <!-- 邮箱主界面 -->
    <template v-else>
      <section class="ml-head">
        <div>
          <h2>校园邮箱</h2>
          <p>{{ address }}</p>
        </div>
        <div class="ml-actions">
          <el-button :icon="Refresh" plain :loading="loading" @click="load(true)">刷新</el-button>
          <el-button type="primary" :icon="Promotion" @click="composeDlg = true">写邮件</el-button>
        </div>
      </section>

      <div class="ml-body">
        <!-- 左：邮件列表 -->
        <section class="ml-list">
          <div v-if="loading && !items.length" class="ml-loading" v-loading="true" element-loading-text="加载中…" />
          <template v-else>
            <p v-if="!items.length" class="ml-empty">收件箱是空的，快给别人写封信吧 ✉️</p>
            <div
              v-for="m in items"
              :key="m.id"
              class="ml-item"
              :class="{ active: m.id === current?.id }"
              @click="openMail(m)"
            >
              <div class="ml-item-top">
                <span class="ml-item-from">{{ senderName(m.from) }}</span>
                <span class="ml-item-time">{{ shortTime(m.receivedAt) }}</span>
              </div>
              <p class="ml-item-subj">{{ m.subject || '(无主题)' }}</p>
              <p class="ml-item-snip">{{ m.snippet || '' }}</p>
            </div>
            <div v-if="nextCursor" class="ml-more">
              <el-button size="small" text :loading="loadingMore" @click="loadMore">加载更多</el-button>
            </div>
          </template>
        </section>

        <!-- 右：详情 -->
        <section class="ml-detail">
          <template v-if="detail">
            <h3 class="ml-d-subj">{{ detail.subject || '(无主题)' }}</h3>
            <div class="ml-d-meta">
              <span><b>发件人：</b>{{ senderName(detail.from) }}</span>
              <span><b>时间：</b>{{ fmtTime(detail.receivedAt) }}</span>
            </div>
            <div v-if="detail.attachments?.length" class="ml-d-atts">
              <el-tag v-for="(a, i) in detail.attachments" :key="i" size="small" type="info">
                📎 {{ a.filename || a.name || '附件' }}
              </el-tag>
            </div>
            <el-divider style="margin: 12px 0" />
            <div class="ml-d-body" v-html="mailBody"></div>
          </template>
          <el-empty v-else-if="!detailLoading" description="选择左侧邮件查看详情" :image-size="90" />
          <div v-if="detailLoading" class="ml-loading" v-loading="true" />
        </section>
      </div>
    </template>

    <!-- 写邮件 -->
    <el-dialog v-model="composeDlg" title="写邮件" width="560px">
      <el-form label-width="64px">
        <el-form-item label="收件人">
          <el-input v-model="form.to" placeholder="对方邮箱地址，如 someone@example.com" clearable />
        </el-form-item>
        <el-form-item label="主题">
          <el-input v-model="form.subject" placeholder="邮件主题" maxlength="200" clearable />
        </el-form-item>
        <el-form-item label="正文">
          <el-input v-model="form.text" type="textarea" :rows="8" placeholder="邮件正文…" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="composeDlg = false">取消</el-button>
        <el-button type="primary" :loading="sending" @click="send">发送</el-button>
      </template>
    </el-dialog>
  </PortalShell>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import PortalShell from '../components/PortalShell.vue';
import { useAuthStore } from '../stores/auth';
import { api } from '../api/request';

const auth = useAuthStore();
const hasMailbox = computed(() => Boolean(auth.user?.mailEnabled && auth.user?.campusEmail));
const address = computed(() => auth.user?.campusEmail || '');

const items = ref([]);
const nextCursor = ref('');
const current = ref(null);
const detail = ref(null);
const loading = ref(false);
const loadingMore = ref(false);
const detailLoading = ref(false);

const composeDlg = ref(false);
const form = ref({ to: '', subject: '', text: '' });
const sending = ref(false);

async function load(reset = false) {
  loading.value = true;
  try {
    const res = await api('/api/mail?limit=20');
    if (res.code === 0) {
      items.value = res.data.items || [];
      nextCursor.value = res.data.nextCursor || '';
      if (reset && items.value.length) openMail(items.value[0]);
    } else {
      ElMessage.error(res.message || '收件箱加载失败');
    }
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  loadingMore.value = true;
  try {
    const res = await api(`/api/mail?limit=20&cursor=${encodeURIComponent(nextCursor.value)}`);
    if (res.code === 0) {
      items.value.push(...(res.data.items || []));
      nextCursor.value = res.data.nextCursor || '';
    } else {
      ElMessage.error(res.message || '加载失败');
    }
  } finally {
    loadingMore.value = false;
  }
}

async function openMail(m) {
  current.value = m;
  detail.value = null;
  detailLoading.value = true;
  try {
    const res = await api(`/api/mail/detail?id=${encodeURIComponent(m.id)}`);
    if (res.code === 0) {
      detail.value = res.data;
    } else {
      ElMessage.error(res.message || '邮件详情加载失败');
    }
  } finally {
    detailLoading.value = false;
  }
}

const mailBody = computed(() => {
  if (!detail.value) return '';
  if (detail.value.html) return detail.value.html;
  return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(detail.value.text || detail.value.snippet || '')}</pre>`;
});
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function senderName(from) {
  if (!from) return '未知发件人';
  const m = String(from).match(/^(.*)<(.+)>$/);
  return m ? (m[1].trim().replace(/^"|"$/g, '') || m[2]) : String(from);
}
function shortTime(t) {
  if (!t) return '';
  return String(t).replace('T', ' ').slice(5, 16);
}
function fmtTime(t) {
  if (!t) return '';
  return String(t).replace('T', ' ').slice(0, 19);
}

async function send() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.value.to.trim())) {
    return ElMessage.warning('收件人邮箱格式不正确');
  }
  if (!form.value.subject.trim()) return ElMessage.warning('请填写邮件主题');
  if (!form.value.text.trim()) return ElMessage.warning('请填写邮件正文');
  sending.value = true;
  try {
    const res = await api('/api/mail', { method: 'POST', body: { ...form.value } });
    if (res.code === 0) {
      ElMessage.success(res.message || '发送成功');
      composeDlg.value = false;
      form.value = { to: '', subject: '', text: '' };
    } else {
      ElMessage.error(res.message || '发送失败');
    }
  } finally {
    sending.value = false;
  }
}

onMounted(() => {
  if (hasMailbox.value) load(true);
});
</script>

<style scoped>
.ml-locked { padding: 60px 0; text-align: center; }
.ml-locked-tip { margin: 6px 0; font-size: 13.5px; color: var(--zc-text-sub, #64748b); }
.ml-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.ml-head h2 { margin: 0; font-size: 20px; color: var(--zc-navy, #17325c); }
.ml-head p { margin: 4px 0 0; font-size: 13px; color: var(--zc-text-sub, #64748b); }
.ml-actions { display: flex; gap: 0; }

.ml-body {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 16px;
  margin-top: 16px;
  min-height: 480px;
}
.ml-list {
  background: var(--zc-glass, rgba(255, 255, 255, 0.72));
  border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 14px;
  padding: 8px;
  max-height: 620px;
  overflow-y: auto;
}
.ml-loading { min-height: 200px; }
.ml-empty { text-align: center; color: var(--zc-text-sub, #94a3b8); font-size: 13px; padding: 40px 0; }
.ml-item {
  padding: 12px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.ml-item:hover { background: rgba(23, 50, 92, 0.05); }
.ml-item.active { background: rgba(37, 99, 235, 0.09); }
.ml-item-top { display: flex; justify-content: space-between; gap: 8px; }
.ml-item-from { font-size: 13px; font-weight: 600; color: var(--zc-navy, #17325c); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ml-item-time { font-size: 11.5px; color: var(--zc-text-sub, #94a3b8); flex-shrink: 0; }
.ml-item-subj {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--zc-navy, #334155);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ml-item-snip {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--zc-text-sub, #94a3b8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ml-more { text-align: center; padding: 6px 0; }

.ml-detail {
  background: var(--zc-glass, rgba(255, 255, 255, 0.72));
  border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 14px;
  padding: 20px 24px;
  overflow-y: auto;
  max-height: 620px;
}
.ml-d-subj { margin: 0 0 10px; font-size: 17px; color: var(--zc-navy, #17325c); }
.ml-d-meta { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: var(--zc-text-sub, #64748b); }
.ml-d-meta b { color: var(--zc-navy, #334155); font-weight: 600; }
.ml-d-atts { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
.ml-d-body { font-size: 14px; line-height: 1.7; color: #1e293b; word-break: break-word; }
.ml-d-body :deep(img) { max-width: 100%; }
.ml-d-body :deep(pre) { white-space: pre-wrap; font-family: inherit; }

@media (max-width: 860px) {
  .ml-body { grid-template-columns: 1fr; }
  .ml-list { max-height: 300px; }
}
</style>
