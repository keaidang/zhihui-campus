<template>
  <PortalShell active="af-notice">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>公告中心</h2>
          <p>{{ canPublish ? '全校与本院通知公告' : '学校通知与公告' }}</p>
        </div>
        <div class="head-btns">
          <el-button :icon="Refresh" circle @click="load" />
          <el-button v-if="canPublish" type="primary" round :icon="EditPen" @click="openPublish">发布公告</el-button>
        </div>
      </header>

      <div v-loading="loading" class="nt-list">
        <div v-for="n in list" :key="n.id" class="nt-item">
          <div class="nt-top">
            <el-tag v-if="n.pinned" type="danger" effect="plain" size="small" round>置顶</el-tag>
            <el-tag :type="n.dept_id ? 'warning' : 'primary'" effect="plain" size="small" round>
              {{ n.dept_name || '全校' }}
            </el-tag>
            <h3>{{ n.title }}</h3>
          </div>
          <p class="nt-content">{{ n.content }}</p>
          <div class="nt-foot">
            <span>{{ n.publisher_name }} · {{ fmt(n.created_at) }}</span>
            <span v-if="canManage(n)" class="nt-ops">
              <el-button v-if="isAdmin" link type="primary" size="small" @click="pin(n)">
                {{ n.pinned ? '取消置顶' : '置顶' }}
              </el-button>
              <el-button link type="danger" size="small" @click="revoke(n)">撤回</el-button>
            </span>
          </div>
        </div>
        <el-empty v-if="!loading && list.length === 0" description="暂无公告" />
      </div>
      <div v-if="total > query.pageSize" class="nt-page">
        <el-pagination background layout="prev, pager, next" :total="total" :page-size="query.pageSize" v-model:current-page="query.page" @current-change="load" />
      </div>
    </section>

    <!-- 发布公告 -->
    <el-dialog v-model="pubVisible" title="发布公告" width="560px">
      <el-form label-position="top">
        <el-form-item label="标题">
          <el-input v-model="pub.title" maxlength="128" show-word-limit placeholder="公告标题" />
        </el-form-item>
        <el-form-item label="正文">
          <el-input v-model="pub.content" type="textarea" :rows="6" maxlength="8000" show-word-limit placeholder="公告正文" />
        </el-form-item>
        <el-form-item v-if="isAdmin">
          <el-checkbox v-model="pub.pinned">置顶显示</el-checkbox>
          <el-checkbox v-model="pub.global">全校公告（否则需指定院系）</el-checkbox>
          <el-select v-if="!pub.global" v-model="pub.deptId" placeholder="选择院系" style="width: 220px; margin-left: 12px">
            <el-option v-for="d in depts" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <p v-else class="pub-scope-tip">发布公告将定向到<span class="hl">{{ auth.user?.deptName || '本院' }}</span>（超管可发全校）</p>
      </el-form>
      <template #footer>
        <el-button @click="pubVisible = false">取消</el-button>
        <el-button type="primary" :loading="pubLoading" @click="publish">发布</el-button>
      </template>
    </el-dialog>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh, EditPen } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/request';

const auth = useAuthStore();
const canPublish = computed(() => auth.hasRole(['teacher', 'counselor', 'admin']));
const isAdmin = computed(() => auth.hasRole(['admin']));
const depts = ref([]);

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const query = reactive({ page: 1, pageSize: 10 });
const pubVisible = ref(false);
const pubLoading = ref(false);
const pub = reactive({ title: '', content: '', pinned: false, global: true, deptId: null });

const fmt = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '—');
const canManage = (n) => isAdmin.value || n.publisher_name === auth.user?.realName;

async function load() {
  loading.value = true;
  try {
    const res = await api(`/api/af/notice?page=${query.page}&pageSize=${query.pageSize}`);
    if (res.code === 0) {
      list.value = res.data.list;
      total.value = res.data.total;
    } else {
      ElMessage.error(res.message || '加载失败');
    }
  } finally {
    loading.value = false;
  }
}

async function loadDepts() {
  if (!isAdmin.value) return;
  const res = await api('/api/admin/meta');
  if (res.code === 0) depts.value = res.data.departments || [];
}

function openPublish() {
  pub.title = '';
  pub.content = '';
  pub.pinned = false;
  pub.global = true;
  pub.deptId = null;
  pubVisible.value = true;
}

async function publish() {
  if (!pub.title.trim() || !pub.content.trim()) {
    ElMessage.warning('标题和内容不能为空');
    return;
  }
  pubLoading.value = true;
  try {
    const body = { action: 'publish', title: pub.title.trim(), content: pub.content.trim() };
    if (isAdmin.value) {
      body.pinned = pub.pinned ? 1 : 0;
      if (!pub.global) body.deptId = pub.deptId;
    }
    const res = await api('/api/af/notice', { method: 'POST', body });
    if (res.code === 0) {
      ElMessage.success(res.message || '发布成功');
      pubVisible.value = false;
      query.page = 1;
      await load();
    } else {
      ElMessage.error(res.message || '发布失败');
    }
  } finally {
    pubLoading.value = false;
  }
}

async function pin(n) {
  const res = await api('/api/af/notice', { method: 'POST', body: { action: 'pin', id: n.id } });
  if (res.code === 0) {
    ElMessage.success(res.message || '已更新');
    await load();
  } else {
    ElMessage.error(res.message || '操作失败');
  }
}

async function revoke(n) {
  const okGo = await ElMessageBox.confirm(`确定撤回「${n.title}」吗？`, '撤回确认', {
    confirmButtonText: '撤回',
    cancelButtonText: '取消',
    type: 'warning',
  }).catch(() => false);
  if (!okGo) return;
  const res = await api('/api/af/notice', { method: 'POST', body: { action: 'revoke', id: n.id } });
  if (res.code === 0) {
    ElMessage.success(res.message || '已撤回');
    await load();
  } else {
    ElMessage.error(res.message || '操作失败');
  }
}

onMounted(() => {
  load();
  loadDepts();
});
</script>

<style scoped>
.pg-card {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 14px;
  padding: 22px 24px;
  box-shadow: 0 6px 24px rgba(23, 50, 92, 0.07);
}
.pg-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 14px; flex-wrap: wrap; }
.pg-head h2 { margin: 0 0 6px; font-size: 19px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.head-btns { display: flex; gap: 10px; align-items: center; }
.nt-list { display: flex; flex-direction: column; gap: 12px; }
.nt-item {
  border: 1px solid var(--zc-border);
  border-radius: 10px;
  padding: 16px 18px;
  background: #fff;
  transition: box-shadow 0.2s;
}
.nt-item:hover { box-shadow: 0 6px 18px rgba(23, 50, 92, 0.08); }
.nt-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nt-top h3 { margin: 0; font-size: 15.5px; color: var(--zc-text); }
.nt-content { margin: 10px 0; font-size: 13.5px; line-height: 1.8; color: var(--zc-text-sub); }
.nt-foot { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--zc-text-sub); }
.nt-ops { display: flex; gap: 4px; }
.nt-page { display: flex; justify-content: center; margin-top: 16px; }
.pub-scope-tip { font-size: 12.5px; color: var(--zc-text-sub); margin: 0; }
.hl { color: #d97706; font-weight: 600; margin: 0 4px; }
</style>
