<template>
  <PortalShell active="forum">
    <div class="fm-page">
      <header class="pg-head">
        <div>
          <h2>校园论坛</h2>
          <p>仅限校内登录用户访问 · 文明发言 · 违规将被禁言</p>
        </div>
        <el-button type="primary" size="large" @click="openEditor()">发帖</el-button>
      </header>

      <!-- 板块 -->
      <div class="fm-boards">
        <button
          class="fm-board"
          :class="{ active: boardId === 0 }"
          @click="boardId = 0; load(1)"
        >全部</button>
        <button
          v-for="b in boards"
          :key="b.id"
          class="fm-board"
          :class="{ active: boardId === b.id, trade: b.isTrade }"
          @click="boardId = b.id; load(1)"
        >
          {{ b.name }}
          <em>{{ b.threads }}</em>
        </button>
      </div>

      <div class="fm-toolbar">
        <el-input v-model="keyword" placeholder="搜索帖子标题 / 正文" clearable style="width: 260px" @keyup.enter="load(1)" />
        <el-button type="primary" @click="load(1)">搜索</el-button>
        <el-checkbox v-model="mineOnly" label="只看我的" @change="load(1)" />
        <el-button v-if="isAdmin" link type="warning" style="margin-left: auto" @click="banDlg = true">禁言管理</el-button>
      </div>

      <!-- 帖子列表 -->
      <section class="fm-panel">
        <p v-if="!loading && threads.length === 0" class="fm-empty">暂无帖子，来发第一帖吧</p>
        <div v-for="t in threads" :key="t.id" class="fm-thread" @click="router.push(`/forum/${t.id}`)">
          <div class="fm-thread-main">
            <div class="fm-thread-title">
              <el-tag v-if="t.pinned" type="warning" size="small" effect="dark">置顶</el-tag>
              <el-tag v-if="t.locked" type="info" size="small">锁定</el-tag>
              <el-tag v-if="t.isTrade" type="danger" size="small">交易</el-tag>
              <span class="fm-t">{{ t.title }}</span>
            </div>
            <p class="fm-snippet" v-if="t.lastReply">最新回复：{{ t.lastReply.slice(0, 60) }}</p>
            <div class="fm-thread-meta">
              <span>{{ t.authorName }}</span>
              <span>{{ t.boardName }}</span>
              <span>{{ day(t.createdAt) }}</span>
              <span>回复 {{ t.replyCount }}</span>
              <el-tag v-if="t.isTrade && t.price !== null" type="danger" size="small" effect="plain">¥{{ t.price }} · {{ t.itemName }}</el-tag>
            </div>
          </div>
          <div v-if="isAdmin" class="fm-thread-admin" @click.stop>
            <el-button link size="small" @click="moderate(t, 'pin', !t.pinned)">{{ t.pinned ? '取消置顶' : '置顶' }}</el-button>
            <el-button link size="small" @click="moderate(t, 'lock', !t.locked)">{{ t.locked ? '解锁' : '锁定' }}</el-button>
            <el-button link size="small" type="danger" @click="delThread(t)">删除</el-button>
            <el-button link size="small" type="warning" @click="banUser(t)">禁言作者</el-button>
          </div>
        </div>
        <el-pagination
          v-if="total > pageSize"
          layout="prev, pager, next, total"
          :total="total"
          :page-size="pageSize"
          :current-page="page"
          @current-change="(p) => load(p)"
          style="margin-top: 16px; justify-content: flex-end"
        />
      </section>

      <!-- 发帖/编辑 -->
      <el-dialog v-model="editorDlg" :title="editId ? '编辑帖子' : '发布新帖'" width="620px" top="6vh">
        <el-form label-width="70px">
          <el-form-item label="板块">
            <el-select v-model="editorBoard" style="width: 240px" :disabled="!!editId">
              <el-option v-for="b in boards" :key="b.id" :label="b.name" :value="b.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="标题"><el-input v-model="editor.title" maxlength="128" show-word-limit /></el-form-item>
          <el-form-item label="正文">
            <div class="fm-editor">
              <div class="fm-editor-bar">
                <span class="fm-editor-hint">支持纯文本排版：空行分段</span>
              </div>
              <el-input v-model="editor.content" type="textarea" :rows="8" maxlength="20000" show-word-limit />
            </div>
          </el-form-item>
          <el-form-item label="图片"><ImgUploader v-model="editor.images" :max="9" /></el-form-item>
          <template v-if="currentBoard?.isTrade">
            <el-divider content-position="left">交易信息（必填）</el-divider>
            <el-form-item label="物品信息"><el-input v-model="editor.itemName" placeholder="如 95 新机械键盘" /></el-form-item>
            <el-form-item label="价格（元）"><el-input-number v-model="editor.price" :min="0" :precision="2" /></el-form-item>
            <el-form-item label="联系方式"><el-input v-model="editor.contact" placeholder="微信 / QQ / 手机号" /></el-form-item>
          </template>
        </el-form>
        <template #footer>
          <el-button @click="editorDlg = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitThread">发布</el-button>
        </template>
      </el-dialog>

      <!-- 禁言管理 -->
      <el-dialog v-model="banDlg" title="论坛禁言管理" width="520px">
        <div class="fm-ban-add">
          <el-input v-model="banForm.userId" placeholder="用户 ID（可在帖子详情查看作者 ID）" style="width: 200px" />
          <el-input v-model="banForm.reason" placeholder="禁言原因" style="width: 200px" />
          <el-button type="warning" @click="doBan">禁言</el-button>
        </div>
        <el-table :data="banned" size="small" style="margin-top: 12px">
          <el-table-column prop="userId" label="ID" width="70" />
          <el-table-column prop="userName" label="姓名" width="100" />
          <el-table-column prop="username" label="账号" width="130" show-overflow-tooltip />
          <el-table-column prop="reason" label="原因" min-width="110" show-overflow-tooltip />
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button link type="success" size="small" @click="doUnban(row)">解除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-dialog>
    </div>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import PortalShell from '../../components/PortalShell.vue';
import ImgUploader from '../../components/ImgUploader.vue';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/request';

const router = useRouter();
const auth = useAuthStore();
const isAdmin = computed(() => auth.hasRole(['admin']));

const boards = ref([]);
const boardId = ref(0);
const threads = ref([]);
const keyword = ref('');
const mineOnly = ref(false);
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const loading = ref(false);

const editorDlg = ref(false);
const editorBoard = ref(0);
const editId = ref(0);
const saving = ref(false);
const editor = reactive({ title: '', content: '', images: [], itemName: '', price: 0, contact: '' });

const banDlg = ref(false);
const banned = ref([]);
const banForm = reactive({ userId: '', reason: '' });

const currentBoard = computed(() => boards.value.find((b) => b.id === editorBoard.value));
const day = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '');

async function loadBoards() {
  const res = await api('/api/forum/boards');
  if (res.code === 0) boards.value = res.data.list;
}

async function load(p = 1) {
  loading.value = true;
  page.value = p;
  try {
    const qs = new URLSearchParams({ page: String(p), keyword: keyword.value });
    if (boardId.value) qs.set('boardId', String(boardId.value));
    if (mineOnly.value) qs.set('scope', 'mine');
    const res = await api(`/api/forum/threads?${qs.toString()}`);
    if (res.code === 0) {
      threads.value = res.data.list;
      total.value = res.data.total;
    } else {
      ElMessage.error(res.message || '加载失败');
    }
  } finally {
    loading.value = false;
  }
}

watch(boardId, () => load(1));

function openEditor(t) {
  if (t) {
    editId.value = t.id;
    Object.assign(editor, { title: t.title, content: '', images: [], itemName: t.itemName || '', price: t.price || 0, contact: t.contact || '' });
  } else {
    editId.value = 0;
    Object.assign(editor, { title: '', content: '', images: [], itemName: '', price: 0, contact: '' });
    editorBoard.value = boardId.value || boards.value[0]?.id || 0;
  }
  editorDlg.value = true;
}

async function submitThread() {
  if (!editor.title.trim()) return ElMessage.warning('请填写标题');
  if (editor.content.trim().length < 2) return ElMessage.warning('正文太短');
  const board = boards.value.find((b) => b.id === editorBoard.value);
  if (board?.isTrade && (!editor.itemName.trim() || !editor.contact.trim())) {
    return ElMessage.warning('交易帖的物品信息与联系方式必填');
  }
  saving.value = true;
  try {
    const res = await api('/api/forum/threads', {
      method: 'POST',
      body: editId.value
        ? { action: 'edit', id: editId.value, ...editor }
        : { action: 'create', boardId: editorBoard.value, ...editor },
    });
    if (res.code === 0) {
      ElMessage.success(res.message || '发布成功');
      editorDlg.value = false;
      load(1);
      loadBoards();
    } else {
      ElMessage.error(res.message || '发布失败');
    }
  } finally {
    saving.value = false;
  }
}

async function moderate(t, act, on) {
  const res = await api('/api/forum/threads', { method: 'POST', body: { action: act, id: t.id, on } });
  if (res.code === 0) {
    ElMessage.success(res.message || '操作成功');
    load(page.value);
  } else {
    ElMessage.error(res.message || '操作失败');
  }
}

async function delThread(t) {
  const confirmed = await ElMessageBox.confirm(`确认删除帖子「${t.title}」？`, '删除', { type: 'warning' });
  if (!confirmed) return;
  const res = await api('/api/forum/threads', { method: 'POST', body: { action: 'delete', id: t.id } });
  if (res.code === 0) {
    ElMessage.success('已删除');
    load(page.value);
    loadBoards();
  } else {
    ElMessage.error(res.message || '删除失败');
  }
}

async function banUser(t) {
  const { value } = await ElMessageBox.prompt(`禁言 ${t.authorName}（${t.username}），请输入原因`, '禁言用户', { inputPlaceholder: '违规发言' });
  const res = await api('/api/forum/moderate', { method: 'POST', body: { action: 'ban', userId: t.authorId, reason: value || '违规发言' } });
  if (res.code === 0) ElMessage.success(res.message || '已禁言');
  else ElMessage.error(res.message || '操作失败');
}

async function doBan() {
  const uid = Number(banForm.userId);
  if (!uid) return ElMessage.warning('请输入用户 ID');
  const res = await api('/api/forum/moderate', { method: 'POST', body: { action: 'ban', userId: uid, reason: banForm.reason } });
  if (res.code === 0) {
    ElMessage.success(res.message || '已禁言');
    loadBanned();
  } else {
    ElMessage.error(res.message || '操作失败');
  }
}

async function doUnban(row) {
  const res = await api('/api/forum/moderate', { method: 'POST', body: { action: 'unban', userId: row.userId } });
  if (res.code === 0) {
    ElMessage.success(res.message || '已解除');
    loadBanned();
  } else {
    ElMessage.error(res.message || '操作失败');
  }
}

async function loadBanned() {
  const res = await api('/api/forum/moderate');
  if (res.code === 0) banned.value = res.data.list;
}

watch(banDlg, (v) => v && loadBanned());

onMounted(() => {
  loadBoards();
  load(1);
});
</script>

<style scoped>
.pg-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pg-head h2 { margin: 0 0 6px; font-size: 21px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.fm-boards { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.fm-board {
  border: 1px solid rgba(23, 50, 92, 0.14); background: var(--zc-glass, rgba(255,255,255,0.7));
  border-radius: 999px; padding: 7px 16px; font-size: 13.5px; color: var(--zc-navy); cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s;
}
.fm-board em { font-style: normal; font-size: 11px; color: var(--zc-text-sub); }
.fm-board:hover { border-color: var(--zc-navy); }
.fm-board.active { background: var(--zc-navy); color: #fff; border-color: var(--zc-navy); }
.fm-board.active em { color: rgba(255, 255, 255, 0.75); }
.fm-board.trade.active { background: #b83232; border-color: #b83232; }
.fm-toolbar { display: flex; gap: 12px; align-items: center; margin-top: 14px; }
.fm-panel {
  margin-top: 14px; background: var(--zc-glass); backdrop-filter: blur(14px);
  border: 1px solid var(--zc-glass-border); border-radius: 14px; padding: 10px 18px;
}
.fm-thread { display: flex; align-items: center; gap: 12px; padding: 14px 4px; border-bottom: 1px solid rgba(23, 50, 92, 0.07); cursor: pointer; }
.fm-thread:last-of-type { border-bottom: none; }
.fm-thread:hover .fm-t { color: #2d5a9e; }
.fm-thread-main { flex: 1; min-width: 0; }
.fm-thread-title { display: flex; align-items: center; gap: 8px; }
.fm-t { font-size: 14.5px; font-weight: 600; color: var(--zc-navy); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fm-snippet { margin: 5px 0 0; font-size: 12px; color: var(--zc-text-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fm-thread-meta { display: flex; gap: 14px; margin-top: 6px; font-size: 11.5px; color: #94a3b8; flex-wrap: wrap; }
.fm-thread-admin { display: flex; gap: 2px; flex: none; }
.fm-empty { text-align: center; color: var(--zc-text-sub); padding: 44px 0; }
.fm-editor-bar { display: flex; justify-content: space-between; margin-bottom: 6px; }
.fm-editor-hint { font-size: 11.5px; color: #94a3b8; }
.fm-ban-add { display: flex; gap: 8px; }
@media (max-width: 640px) { .fm-thread-admin { display: none; } }
</style>
