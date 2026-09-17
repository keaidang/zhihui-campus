<template>
  <PortalShell active="edu-elect">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>课程选课</h2>
          <p>本学期可选课程 · 名额实时变动，先到先得</p>
        </div>
        <el-button :icon="Refresh" circle @click="load" />
      </header>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column prop="course_code" label="课程代码" width="100" />
        <el-table-column prop="course_name" label="课程名称" min-width="160" show-overflow-tooltip />
        <el-table-column label="学分" width="70" align="center">
          <template #default="{ row }">{{ row.credit }}</template>
        </el-table-column>
        <el-table-column prop="teacher_name" label="任课教师" width="100" />
        <el-table-column label="时间" width="120">
          <template #default="{ row }">{{ weekText(row.week_day) }} {{ row.section }}</template>
        </el-table-column>
        <el-table-column prop="classroom" label="教室" min-width="110" show-overflow-tooltip />
        <el-table-column label="名额" width="170">
          <template #default="{ row }">
            <el-progress :percentage="pct(row)" :stroke-width="10" :color="row.mine ? '#2563eb' : pctColor(row)" />
            <span class="cap-text">{{ row.enrolled }}/{{ row.capacity }} · 余 {{ row.remaining }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button v-if="!row.mine" type="primary" size="small" round :loading="busyId === row.class_id" @click="enroll(row)">
              选课
            </el-button>
            <el-button v-else type="danger" plain size="small" round :loading="busyId === row.class_id" @click="drop(row)">
              退课
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </PortalShell>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';

const list = ref([]);
const loading = ref(false);
const busyId = ref(null);

const WEEK = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const weekText = (d) => WEEK[d] || `周${d}`;
const pct = (row) => (row.capacity ? Math.round((row.enrolled / row.capacity) * 100) : 0);
const pctColor = (row) => (row.remaining === 0 ? '#dc2626' : row.remaining <= 10 ? '#d97706' : '#0d9488');

async function load() {
  loading.value = true;
  try {
    const res = await api('/api/edu/course');
    if (res.code === 0) list.value = res.data.list;
    else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function enroll(row) {
  busyId.value = row.class_id;
  try {
    const res = await api('/api/edu/course', { method: 'POST', body: { action: 'enroll', classId: row.class_id } });
    if (res.code === 0) {
      ElMessage.success(`已选中「${row.course_name}」`);
      await load();
    } else {
      ElMessage.error(res.message || '选课失败');
    }
  } finally {
    busyId.value = null;
  }
}

async function drop(row) {
  const okGo = await ElMessageBox.confirm(`确定退掉「${row.course_name}」吗？`, '退课确认', {
    confirmButtonText: '退课',
    cancelButtonText: '再想想',
    type: 'warning',
  }).catch(() => false);
  if (!okGo) return;
  busyId.value = row.class_id;
  try {
    const res = await api('/api/edu/course', { method: 'POST', body: { action: 'drop', classId: row.class_id } });
    if (res.code === 0) {
      ElMessage.success('已退课');
      await load();
    } else {
      ElMessage.error(res.message || '退课失败');
    }
  } finally {
    busyId.value = null;
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
.pg-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.pg-head h2 { margin: 0 0 6px; font-size: 19px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.cap-text { font-size: 12px; color: var(--zc-text-sub); }
</style>
