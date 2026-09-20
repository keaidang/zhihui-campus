<template>
  <PortalShell active="forum">
    <div class="ft-page" v-if="thread">
      <header class="ft-head">
        <el-button link @click="router.push('/forum')">
          <el-icon><ArrowLeft /></el-icon> 返回论坛
        </el-button>
      </header>

      <section class="ft-panel">
        <div class="ft-title">
          <el-tag v-if="thread.pinned" type="warning" size="small" effect="dark">置顶</el-tag>
          <el-tag v-if="thread.locked" type="info" size="small">锁定</el-tag>
          <el-tag v-if="thread.isTrade" type="danger" size="small">交易</el-tag>
          <h2>{{ thread.title }}</h2>
        </div>
        <div class="ft-meta">
          <el-avatar :size="26">{{ thread.authorName?.charAt(0) }}</el-avatar>
          <span class="ft-author">{{ thread.authorName }}</span>
          <span>{{ thread.boardName }}</span>
          <span>{{ day(thread.createdAt) }}</span>
          <div class="ft-admin" v-if="thread.canModerate">
            <el-button link size="small" @click="moderate('pin', !thread.pinned)">{{ thread.pinned ? '取消置顶' : '置顶' }}</el-button>
            <el-button link size="small" @click="moderate('lock', !thread.locked)">{{ thread.locked ? '解锁' : '锁定' }}</el-button>
            <el-button link size="small" type="warning" @click="banAuthor">禁言作者</el-button>
            <el-button v-if="thread.canEdit" link size="small" @click="router.push('/forum')">（编辑请回列表）</el-button>
          </div>
          <el-button v-if="thread.canEdit" link size="small" type="danger" class="ft-del" @click="delThread">删除本帖</el-button>
        </div>

        <div class="ft-content">{{ thread.content }}</div>

        <div class="ft-images" v-if="thread.images.length">
          <el-image v-for="u in thread.images" :key="u" :src="u" fit="cover" class="ft-img" :preview-src-list="thread.images" />
        </div>

        <!-- 交易信息卡 -->
        <div class="ft-trade" v-if="thread.isTrade">
          <h4>交易信息</h4>
          <ul>
            <li><em>物品</em><span>{{ thread.itemName }}</span></li>
            <li><em>价格</em><span class="ft-price">¥{{ thread.price }}</span></li>
            <li><em>联系方式</em><span>{{ thread.contact }}</span></li>
          </ul>
        </div>
      </section>

      <!-- 回复 -->
      <section class="ft-panel">
        <h3 class="ft-reply-title">回复（{{ replies.length }}）</h3>
        <p v-if="replies.length === 0" class="ft-empty">还没有回复，抢个沙发</p>
        <div v-for="r in replies" :key="r.id" class="ft-reply">
          <el-avatar :size="30">{{ r.authorName?.charAt(0) }}</el-avatar>
          <div class="ft-reply-body">
            <div class="ft-reply-meta">
              <b>{{ r.authorName }}</b>
              <span>{{ day(r.createdAt) }}</span>
              <el-button v-if="thread.canModerate" link size="small" type="warning" @click="banReply(r)">禁言</el-button>
            </div>
            <p>{{ r.content }}</p>
          </div>
        </div>

        <div class="ft-reply-box" v-if="thread.locked && !thread.canModerate">
          <el-alert type="info" :closable="false" title="该帖已被锁定，禁止回复" />
        </div>
        <div class="ft-reply-box" v-else>
          <el-input v-model="replyText" type="textarea" :rows="3" maxlength="1024" show-word-limit placeholder="友善回复，理性讨论…" />
          <div class="ft-reply-actions">
            <el-button type="primary" :loading="replying" @click="doReply">回复</el-button>
          </div>
        </div>
      </section>
    </div>
  </PortalShell>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';

const route = useRoute();
const router = useRouter();
const thread = ref(null);
const replies = ref([]);
const replyText = ref('');
const replying = ref(false);

// 时间统一走 utils/time.js：库内存 UTC，这里转北京时间展示（勿再手写字符串截断）
import { fmtTime as day } from '../../utils/time';

async function load() {
  const res = await api(`/api/forum/threads?id=${route.params.id}`);
  if (res.code === 0) {
    thread.value = res.data.thread;
    replies.value = res.data.replies;
  } else {
    ElMessage.error(res.message || '帖子不存在');
    router.push('/forum');
  }
}

async function doReply() {
  if (!replyText.value.trim()) return ElMessage.warning('回复内容不能为空');
  replying.value = true;
  try {
    const res = await api('/api/forum/threads', { method: 'POST', body: { action: 'reply', threadId: thread.value.id, content: replyText.value } });
    if (res.code === 0) {
      ElMessage.success('回复成功');
      replyText.value = '';
      load();
    } else {
      ElMessage.error(res.message || '回复失败');
    }
  } finally {
    replying.value = false;
  }
}

async function moderate(act, on) {
  const res = await api('/api/forum/threads', { method: 'POST', body: { action: act, id: thread.value.id, on } });
  if (res.code === 0) {
    ElMessage.success(res.message || '操作成功');
    load();
  } else {
    ElMessage.error(res.message || '操作失败');
  }
}

async function banUser(userId, name) {
  const { value } = await ElMessageBox.prompt(`禁言 ${name}，请输入原因`, '禁言用户', { inputPlaceholder: '违规发言' });
  const res = await api('/api/forum/moderate', { method: 'POST', body: { action: 'ban', userId, reason: value || '违规发言' } });
  if (res.code === 0) ElMessage.success(res.message || '已禁言');
  else ElMessage.error(res.message || '操作失败');
}

const banAuthor = () => banUser(thread.value.authorId, thread.value.authorName);
const banReply = (r) => banUser(r.authorId, r.authorName);

async function delThread() {
  const confirmed = await ElMessageBox.confirm('确认删除本帖？', '删除', { type: 'warning' });
  if (!confirmed) return;
  const res = await api('/api/forum/threads', { method: 'POST', body: { action: 'delete', id: thread.value.id } });
  if (res.code === 0) {
    ElMessage.success('已删除');
    router.push('/forum');
  } else {
    ElMessage.error(res.message || '删除失败');
  }
}

onMounted(load);
</script>

<style scoped>
.ft-head { margin-bottom: 10px; }
.ft-panel {
  background: var(--zc-glass); backdrop-filter: blur(14px);
  border: 1px solid var(--zc-glass-border); border-radius: 14px; padding: 20px; margin-bottom: 14px;
}
.ft-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ft-title h2 { margin: 0; font-size: 19px; color: var(--zc-navy); }
.ft-meta { display: flex; align-items: center; gap: 10px; margin: 12px 0 16px; font-size: 12.5px; color: var(--zc-text-sub); flex-wrap: wrap; }
.ft-author { font-weight: 600; color: var(--zc-navy); }
.ft-admin { margin-left: auto; display: flex; gap: 2px; }
.ft-content { font-size: 14.5px; line-height: 1.9; color: var(--zc-text); white-space: pre-wrap; word-break: break-word; }
.ft-images { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
.ft-img { width: 150px; height: 112px; border-radius: 10px; }
.ft-trade { margin-top: 16px; background: rgba(184, 50, 50, 0.06); border: 1px solid rgba(184, 50, 50, 0.18); border-radius: 10px; padding: 12px 16px; }
.ft-trade h4 { margin: 0 0 8px; font-size: 13.5px; color: #b83232; }
.ft-trade ul { list-style: none; margin: 0; padding: 0; }
.ft-trade li { display: flex; gap: 12px; padding: 4px 0; font-size: 13px; }
.ft-trade em { font-style: normal; color: var(--zc-text-sub); flex: none; }
.ft-price { font-weight: 700; color: #b83232; }
.ft-reply-title { margin: 0 0 12px; font-size: 15px; color: var(--zc-navy); }
.ft-reply { display: flex; gap: 10px; padding: 12px 0; border-bottom: 1px dashed rgba(23, 50, 92, 0.1); }
.ft-reply-body { flex: 1; min-width: 0; }
.ft-reply-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #94a3b8; }
.ft-reply-meta b { color: var(--zc-navy); font-size: 13px; }
.ft-reply-body p { margin: 5px 0 0; font-size: 13.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.ft-empty { text-align: center; color: var(--zc-text-sub); padding: 20px 0; }
.ft-reply-box { margin-top: 16px; }
.ft-reply-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
</style>
