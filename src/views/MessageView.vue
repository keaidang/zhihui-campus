<template>
  <PortalShell active="messages">
    <div class="msg-cols">
      <!-- 左：消息列表 -->
      <section class="pg-card">
        <header class="list-head">
          <h2>消息中心</h2>
          <div class="head-actions">
            <el-badge :value="unread" :hidden="unread === 0" class="unread-badge">
              <el-radio-group v-model="scope" size="small" @change="load">
                <el-radio-button value="all">全部</el-radio-button>
                <el-radio-button value="unread">未读</el-radio-button>
              </el-radio-group>
            </el-badge>
            <el-button size="small" plain @click="readAll">全部已读</el-button>
          </div>
        </header>
        <div v-loading="loading" class="msg-list">
          <div
            v-for="m in list"
            :key="m.id"
            class="msg-item"
            :class="{ unread: !m.readAt, active: current?.id === m.id }"
            @click="open(m)"
          >
            <div class="msg-top">
              <el-tag :type="m.type === 'system' ? 'info' : 'primary'" effect="plain" size="small" round>
                {{ m.type === 'system' ? '系统通知' : '站内信' }}
              </el-tag>
              <span class="msg-title">{{ m.title }}</span>
              <span v-if="!m.readAt" class="dot"></span>
              <span class="msg-time">{{ fmt(m.createdAt) }}</span>
            </div>
            <p class="msg-brief">{{ m.content }}</p>
          </div>
          <el-empty v-if="!loading && list.length === 0" description="暂无消息" />
          <el-pagination
            v-if="total > pageSize"
            layout="prev, pager, next"
            :total="total"
            :page-size="pageSize"
            :current-page="page"
            class="pager"
            @current-change="changePage"
          />
        </div>
      </section>

      <!-- 右：详情 / 撰写 -->
      <section class="pg-card side">
        <template v-if="current">
          <div class="detail-head">
            <h2>{{ current.title }}</h2>
            <p class="meta">
              {{ current.type === 'system' ? '系统通知' : `来自：${current.senderName || '用户'}` }}
              · {{ fmt(current.createdAt) }}
            </p>
          </div>
          <p class="detail-body">{{ current.content }}</p>
          <div class="detail-actions">
            <el-popconfirm title="删除该消息？" @confirm="del(current)">
              <template #reference><el-button size="small" type="danger" plain>删除</el-button></template>
            </el-popconfirm>
          </div>
        </template>

        <!-- 撰写（staff） -->
        <template v-if="canSend">
          <h2>发送站内信</h2>
          <el-form label-position="top">
            <el-form-item label="接收范围">
              <el-radio-group v-model="sendForm.target">
                <el-radio value="user">指定用户</el-radio>
                <el-radio value="role">按角色</el-radio>
                <el-radio v-if="isAdmin" value="all">全校广播</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="sendForm.target === 'user'" label="接收人">
              <el-select v-model="sendForm.userId" filterable remote :remote-method="searchStu" :loading="stuLoading" placeholder="搜索姓名/学号" style="width: 100%">
                <el-option v-for="s in stuOptions" :key="s.id" :label="`${s.realName}（${s.userNo || s.username}）`" :value="s.id" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="sendForm.target === 'role'" label="目标角色">
              <el-select v-model="sendForm.role" style="width: 100%">
                <el-option label="学生" value="student" />
                <el-option label="教师" value="teacher" />
                <el-option label="辅导员" value="counselor" />
                <el-option label="校领导" value="leader" />
              </el-select>
            </el-form-item>
            <el-form-item label="标题">
              <el-input v-model="sendForm.title" maxlength="128" show-word-limit placeholder="消息标题" />
            </el-form-item>
            <el-form-item label="正文">
              <el-input v-model="sendForm.content" type="textarea" :rows="5" maxlength="1024" show-word-limit placeholder="消息正文" />
            </el-form-item>
            <el-button type="primary" class="w-full" :loading="sending" @click="send">发送</el-button>
          </el-form>
        </template>
        <el-empty v-else-if="!current" :image-size="80" description="点击左侧消息查看详情" />
      </section>
    </div>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PortalShell from '../components/PortalShell.vue';
import { api } from '../api/request';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const canSend = computed(() => auth.hasRole(['admin', 'counselor', 'teacher']));
const isAdmin = computed(() => auth.hasRole(['admin']));

const list = ref([]);
const unread = ref(0);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const scope = ref('all');
const loading = ref(false);
const current = ref(null);

const sendForm = ref({ target: 'user', userId: null, role: 'student', title: '', content: '' });
const sending = ref(false);
const stuOptions = ref([]);
const stuLoading = ref(false);

// 时间统一走 utils/time.js：库内存 UTC，这里转北京时间展示（勿再手写字符串截断）
import { fmtTime as fmt } from '../utils/time';

async function load() {
  loading.value = true;
  try {
    const res = await api(`/api/notice/messages?scope=${scope.value}&page=${page.value}`);
    if (res.code === 0) {
      list.value = res.data.list;
      unread.value = res.data.unread;
      total.value = res.data.total;
    }
  } finally {
    loading.value = false;
  }
}

function changePage(p) {
  page.value = p;
  load();
}

async function open(m) {
  current.value = m;
  if (!m.readAt) {
    await api('/api/notice/messages', { method: 'POST', body: { action: 'read', id: m.id } });
    m.readAt = new Date().toISOString();
    unread.value = Math.max(unread.value - 1, 0);
  }
}

async function readAll() {
  const res = await api('/api/notice/messages', { method: 'POST', body: { action: 'readAll' } });
  if (res.code === 0) {
    ElMessage.success('已全部标记已读');
    await load();
  }
}

async function del(m) {
  const res = await api('/api/notice/messages', { method: 'POST', body: { action: 'delete', id: m.id } });
  if (res.code === 0) {
    current.value = null;
    await load();
  }
}

async function searchStu(kw) {
  stuLoading.value = true;
  try {
    const res = await api('/api/notice/messages?view=recipients');
    if (res.code === 0) {
      const k = (kw || '').toLowerCase();
      stuOptions.value = (k
        ? res.data.students.filter((s) => [s.realName, s.username, s.userNo].some((v) => v && String(v).toLowerCase().includes(k)))
        : res.data.students
      ).slice(0, 20);
    }
  } finally {
    stuLoading.value = false;
  }
}

async function send() {
  if (!sendForm.value.title.trim() || !sendForm.value.content.trim()) {
    ElMessage.warning('请填写标题和正文');
    return;
  }
  if (sendForm.value.target === 'user' && !sendForm.value.userId) {
    ElMessage.warning('请选择接收人');
    return;
  }
  sending.value = true;
  try {
    const res = await api('/api/notice/messages', { method: 'POST', body: { action: 'send', ...sendForm.value } });
    if (res.code === 0) {
      ElMessage.success(res.message || '已发送');
      sendForm.value = { target: sendForm.value.target, userId: null, role: 'student', title: '', content: '' };
    } else ElMessage.error(res.message || '发送失败');
  } finally {
    sending.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.pg-card {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 14px;
  padding: 22px 24px;
  box-shadow: 0 6px 24px rgba(23, 50, 92, 0.07);
}
.pg-card h2 { margin: 0 0 6px; font-size: 19px; color: var(--zc-navy); letter-spacing: 1px; }
.w-full { width: 100%; }
.list-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.head-actions { display: flex; align-items: center; gap: 10px; }

.msg-cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; align-items: start; }
.msg-list { display: flex; flex-direction: column; gap: 10px; max-height: 640px; overflow-y: auto; }
.msg-item { border: 1px solid var(--zc-border); border-radius: 10px; padding: 12px 16px; background: #fff; cursor: pointer; transition: border-color 0.2s; }
.msg-item:hover { border-color: var(--zc-navy); }
.msg-item.active { border-color: var(--zc-navy); box-shadow: 0 4px 14px rgba(23, 50, 92, 0.12); }
.msg-item.unread { background: rgba(23, 50, 92, 0.03); }
.msg-top { display: flex; align-items: center; gap: 8px; }
.msg-title { font-weight: 600; font-size: 14px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; flex: none; }
.msg-time { font-size: 12px; color: var(--zc-text-sub); flex: none; }
.msg-brief {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--zc-text-sub);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pager { margin-top: 12px; justify-content: center; }

.side .meta { margin: 0 0 14px; font-size: 12.5px; color: var(--zc-text-sub); }
.detail-body { font-size: 14px; line-height: 1.9; white-space: pre-wrap; color: var(--zc-text); }
.detail-actions { margin-top: 16px; display: flex; justify-content: flex-end; }

@media (max-width: 900px) { .msg-cols { grid-template-columns: 1fr; } }
</style>
