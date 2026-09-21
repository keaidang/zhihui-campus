<template>
  <PortalShell active="af-repair-m">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>报修处理</h2>
          <p>全校报修工单 · 受理后跟进完成</p>
        </div>
        <el-radio-group v-model="filter" @change="load">
          <el-radio-button value="0">待受理</el-radio-button>
          <el-radio-button value="1">处理中</el-radio-button>
          <el-radio-button value="2">已完成</el-radio-button>
          <el-radio-button value="3">无法处理</el-radio-button>
          <el-radio-button value="">全部</el-radio-button>
        </el-radio-group>
      </header>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column prop="id" label="#" width="60" />
        <el-table-column prop="real_name" label="报修人" width="90" />
        <el-table-column prop="location" label="位置" min-width="130" show-overflow-tooltip />
        <el-table-column prop="category" label="类型" width="80" align="center" />
        <el-table-column prop="description" label="描述" min-width="170" show-overflow-tooltip />
        <el-table-column prop="contact" label="电话" width="120" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="tagType(row.status)" size="small" effect="light" round>{{ row.status_text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }"><span class="small">{{ fmt(row.created_at) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center">
          <template #default="{ row }">
            <template v-if="row.status === 0 || row.status === 1">
              <el-button v-if="row.status === 0" type="primary" size="small" round @click="open(row, 'accept')">受理</el-button>
              <el-button v-else type="success" size="small" round @click="open(row, 'finish')">完成</el-button>
              <el-button type="danger" size="small" round plain @click="open(row, 'reject')">无法处理</el-button>
            </template>
            <span v-else class="small muted">{{ row.handler_name || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="dialogVisible" :title="DLG_TITLE[action]" width="440px">
      <p class="dlg-sub">{{ current?.location }} · {{ current?.category }} · {{ current?.description }}</p>
      <el-input
        v-model="remark"
        type="textarea"
        :rows="3"
        maxlength="256"
        :placeholder="action === 'reject' ? '无法处理的原因（必填，会通知报修人）' : '处理备注（选填）'"
      />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button :type="action === 'finish' ? 'success' : action === 'reject' ? 'danger' : 'primary'" :loading="saving" @click="confirm">
          确认
        </el-button>
      </template>
    </el-dialog>
  </PortalShell>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';

const list = ref([]);
const loading = ref(false);
const filter = ref('0');
const dialogVisible = ref(false);
const current = ref(null);
const action = ref('accept');
const remark = ref('');
const saving = ref(false);

// 工单状态机文案（与后端 af/repair.js 的 FLOW 对齐：「无法处理」为终态，需填原因）
const DLG_TITLE = { accept: '受理工单', finish: '完成工单', reject: '标记无法处理' };
const tagType = (s) => ({ 0: 'warning', 1: 'primary', 2: 'success', 3: 'danger' }[s] || 'info');
// 时间统一走 utils/time.js：库内存 UTC，这里转北京时间展示（勿再手写字符串截断）
import { fmtTime as fmt } from '../../utils/time';

async function load() {
  loading.value = true;
  try {
    const q = filter.value !== '' ? `?status=${filter.value}` : '';
    const res = await api(`/api/af/repair${q}`);
    if (res.code === 0) list.value = res.data.list;
    else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function open(row, act) {
  current.value = row;
  action.value = act;
  remark.value = '';
  dialogVisible.value = true;
}

async function confirm() {
  // 「无法处理」必须填原因：报修人看到的就是这个 remark 字段，留空则工单被关闭却无从解释
  if (action.value === 'reject' && !remark.value.trim()) {
    ElMessage.warning('请填写无法处理的原因');
    return;
  }
  saving.value = true;
  try {
    const res = await api('/api/af/repair', {
      method: 'POST',
      body: { action: action.value, id: current.value.id, remark: remark.value.trim() },
    });
    if (res.code === 0) {
      ElMessage.success(res.message || '已处理');
      dialogVisible.value = false;
      await load();
    } else {
      ElMessage.error(res.message || '操作失败');
    }
  } finally {
    saving.value = false;
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
.pg-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 14px; flex-wrap: wrap; }
.pg-head h2 { margin: 0 0 6px; font-size: 19px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.small { font-size: 12.5px; }
.muted { color: var(--zc-text-sub); }
.dlg-sub { margin: 0 0 12px; font-size: 13px; color: var(--zc-text-sub); }
</style>
