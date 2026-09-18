<template>
  <PortalShell active="af-approve">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>请假审批</h2>
          <p>{{ isDept ? '本院学生的请假申请' : '全校请假申请' }} · 实时待办</p>
        </div>
        <el-radio-group v-model="filter" @change="load">
          <el-radio-button value="1">待审批</el-radio-button>
          <el-radio-button value="2">已批准</el-radio-button>
          <el-radio-button value="3">已驳回</el-radio-button>
          <el-radio-button value="">全部</el-radio-button>
        </el-radio-group>
      </header>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column prop="real_name" label="学生" width="90" />
        <el-table-column prop="user_no" label="学号" width="100" />
        <el-table-column prop="class_name" label="班级" min-width="120" show-overflow-tooltip />
        <el-table-column prop="type" label="类型" width="70" align="center" />
        <el-table-column label="时段" width="230">
          <template #default="{ row }">
            <span class="small">{{ fmt(row.start_at) }} ~ {{ fmt(row.end_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="事由" min-width="150" show-overflow-tooltip />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="tagType(row.status)" size="small" effect="light" round>{{ row.status_text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center">
          <template #default="{ row }">
            <template v-if="row.status === 1">
              <el-button type="primary" size="small" round @click="open(row, true)">通过</el-button>
              <el-button type="danger" plain size="small" round @click="open(row, false)">驳回</el-button>
            </template>
            <span v-else class="small muted">{{ row.opinion || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 审批意见 -->
    <el-dialog v-model="dialogVisible" :title="approving ? '通过申请' : '驳回申请'" width="440px">
      <p class="dlg-sub">
        {{ current?.real_name }} · {{ current?.type }} · {{ fmt(current?.start_at) }} ~ {{ fmt(current?.end_at) }}
      </p>
      <el-input v-model="opinion" type="textarea" :rows="3" maxlength="256" :placeholder="approving ? '审批意见（选填）' : '请填写驳回原因'" />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button :type="approving ? 'primary' : 'danger'" :loading="saving" @click="confirm">
          {{ approving ? '确认通过' : '确认驳回' }}
        </el-button>
      </template>
    </el-dialog>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PortalShell from '../../components/PortalShell.vue';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/request';

const auth = useAuthStore();
const isDept = computed(() => !auth.hasRole(['admin']));
const list = ref([]);
const loading = ref(false);
const filter = ref('1');
const dialogVisible = ref(false);
const approving = ref(true);
const saving = ref(false);
const current = ref(null);
const opinion = ref('');

const tagType = (s) => ({ 1: 'warning', 2: 'primary', 3: 'danger', 4: 'success' }[s] || 'info');
const fmt = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '—');

async function load() {
  loading.value = true;
  try {
    const q = filter.value ? `?status=${filter.value}` : '';
    const res = await api(`/api/af/leave${q}`);
    if (res.code === 0) list.value = res.data.list;
    else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function open(row, yes) {
  current.value = row;
  approving.value = yes;
  opinion.value = '';
  dialogVisible.value = true;
}

async function confirm() {
  if (!approving.value && !opinion.value.trim()) {
    ElMessage.warning('请填写驳回原因');
    return;
  }
  saving.value = true;
  try {
    const res = await api('/api/af/leave', {
      method: 'POST',
      body: {
        action: approving.value ? 'approve' : 'reject',
        leaveId: current.value.id,
        opinion: opinion.value.trim(),
      },
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
