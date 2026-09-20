<template>
  <PortalShell active="mail">
    <!-- 未开通对外收发 -->
    <section v-if="!hasMailbox" class="ml-locked">
      <el-empty description="校园邮箱对外收发尚未开通">
        <template #image><LockKeyhole :size="56" :stroke-width="1.4" color="#94a3b8" /></template>
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
          <el-button plain :loading="loading" @click="load(true)">
            <RefreshCw v-if="!loading" :size="14" class="ml-btn-ic" />刷新
          </el-button>
          <el-button type="primary" @click="composeDlg = true">
            <SquarePen :size="14" class="ml-btn-ic" />写邮件
          </el-button>
        </div>
      </section>

      <div class="ml-body">
        <!-- 左：邮件列表 -->
        <section class="ml-list">
          <div class="ml-tabs">
            <button :class="{ on: box === 'inbox' }" @click="switchBox('inbox')">
              <Inbox :size="15" /> 收件箱
            </button>
            <button :class="{ on: box === 'sent' }" @click="switchBox('sent')">
              <Send :size="15" /> 已发送
            </button>
          </div>
          <div v-if="loading && !items.length" class="ml-loading" v-loading="true" element-loading-text="加载中…" />
          <template v-else>
            <p v-if="!items.length" class="ml-empty">
              {{ box === 'inbox' ? '收件箱是空的，快给别人写封信吧' : '还没有发过邮件' }}
            </p>
            <div
              v-for="m in items"
              :key="m.id"
              class="ml-item"
              :class="{ active: m.id === current?.id }"
              @click="openMail(m)"
            >
              <div class="ml-item-top">
                <span class="ml-item-from">{{ box === 'inbox' ? senderName(m.from) : m.to }}</span>
                <span class="ml-item-time">{{ shortTime(m.receivedAt || m.sentAt) }}</span>
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
              <span v-if="box === 'sent'"><b>收件人：</b>{{ detail.to }}</span>
              <span v-else><b>发件人：</b>{{ senderName(detail.from) }}</span>
              <span v-if="box === 'sent'"><b>状态：</b><span class="ml-st" :class="statusClass(detail.status)">{{ statusLabel(detail.status) }}</span></span>
              <span><b>时间：</b>{{ fmtTime(detail.receivedAt || detail.sentAt) }}</span>
            </div>
            <div v-if="box !== 'sent' && detail.attachments?.length" class="ml-d-atts">
              <el-tag v-for="(a, i) in detail.attachments" :key="i" size="small" type="info">
                <Paperclip :size="11" class="ml-tag-ic" />{{ a.filename || a.name || '附件' }}
              </el-tag>
            </div>
            <el-divider style="margin: 12px 0" />
            <div class="ml-d-body" v-html="mailBody"></div>
          </template>
          <el-empty v-else-if="!detailLoading" :image-size="80">
            <template #image><MailOpen :size="56" :stroke-width="1.3" color="#cbd5e1" /></template>
            <p class="ml-empty" style="padding: 0">选择左侧邮件查看详情</p>
          </el-empty>
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
import { Inbox, Send, RefreshCw, SquarePen, Paperclip, MailOpen, LockKeyhole } from 'lucide-vue-next';
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
const box = ref('inbox'); // inbox | sent
const sentStore = new Map(); // 已发邮件详情缓存（本地数据，无需再请求）

const composeDlg = ref(false);
const form = ref({ to: '', subject: '', text: '' });
const sending = ref(false);

function statusLabel(s) {
  return {
    queued: '排队中', sending: '投递中', relayed: '已送达', delivered: '已送达',
    failed: '投递失败', bounced: '被对方拒收', rejected: '被对方拒收',
  }[s] || s || '';
}
function statusClass(s) {
  return ['relayed', 'delivered'].includes(s) ? 'ok' : ['failed', 'bounced', 'rejected'].includes(s) ? 'bad' : 'pending';
}

async function switchBox(b) {
  if (box.value === b) return;
  box.value = b;
  current.value = null;
  detail.value = null;
  nextCursor.value = '';
  await load(true);
}

async function load(reset = false) {
  loading.value = true;
  try {
    const url = box.value === 'sent' ? '/api/mail?action=sent&limit=20' : '/api/mail?limit=20';
    const res = await api(url);
    if (res.code === 0) {
      items.value = res.data.items || [];
      nextCursor.value = res.data.nextCursor || '';
      if (box.value === 'sent') items.value.forEach((m) => sentStore.set(m.id, m));
      if (reset && items.value.length) openMail(items.value[0]);
    } else {
      ElMessage.error(res.message || '邮件列表加载失败');
    }
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  loadingMore.value = true;
  try {
    const url = box.value === 'sent'
      ? `/api/mail?action=sent&limit=20&before=${encodeURIComponent(nextCursor.value)}`
      : `/api/mail?limit=20&cursor=${encodeURIComponent(nextCursor.value)}`;
    const res = await api(url);
    if (res.code === 0) {
      items.value.push(...(res.data.items || []));
      nextCursor.value = res.data.nextCursor || '';
      if (box.value === 'sent') res.data.items.forEach((m) => sentStore.set(m.id, m));
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
  // 已发邮件：详情就是列表数据本身
  if (box.value === 'sent') {
    detail.value = sentStore.get(m.id) || m;
    return;
  }
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
.ml-tabs {
  display: flex;
  gap: 4px;
  padding: 4px 6px 8px;
  border-bottom: 1px solid rgba(23, 50, 92, 0.08);
  margin-bottom: 4px;
}
.ml-tabs button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  background: transparent;
  padding: 7px 0;
  border-radius: 8px;
  font-size: 13px;
  color: var(--zc-text-sub, #64748b);
  cursor: pointer;
  transition: background 0.15s ease;
}
.ml-tabs button:hover { background: rgba(23, 50, 92, 0.06); }
.ml-tabs button.on {
  background: rgba(37, 99, 235, 0.1);
  color: var(--zc-navy, #17325c);
  font-weight: 600;
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
.ml-btn-ic { margin-right: 5px; }
.ml-tag-ic { margin-right: 4px; vertical-align: -1px; }

.ml-st { display: inline-flex; align-items: center; gap: 5px; }
.ml-st::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.75;
}
.ml-st.pending { color: #b45309; }
.ml-st.ok { color: #15803d; }
.ml-st.bad { color: #b91c1c; }

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
