<template>
  <PortalShell active="edu-entry">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>成绩录入</h2>
          <p>选择教学班后逐条填写成绩，保存时批量提交</p>
        </div>
        <el-select v-model="classId" placeholder="选择教学班" style="width: 280px" @change="loadRoster">
          <el-option v-for="c in classes" :key="c.class_id" :value="c.class_id" :label="`${c.course_name}（${c.enrolled} 人）`" />
        </el-select>
      </header>

      <el-table v-loading="loading" :data="roster" stripe>
        <el-table-column prop="user_no" label="学号" width="110" />
        <el-table-column prop="real_name" label="姓名" width="110" />
        <el-table-column prop="class_name" label="班级" min-width="140" show-overflow-tooltip />
        <el-table-column label="现有成绩" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.status === 2" size="small" round>{{ row.score }}</el-tag>
            <el-tag v-else type="info" size="small" effect="plain" round>未录</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="录入成绩" width="180" align="center">
          <template #default="{ row }">
            <el-input-number
              v-model="scores[row.student_id]"
              :min="0"
              :max="100"
              :step="1"
              size="small"
              controls-position="right"
            />
          </template>
        </el-table-column>
        <el-table-column label="预览等级" width="100" align="center">
          <template #default="{ row }">
            <span class="grade-preview">{{ gradeOf(scores[row.student_id]) }}</span>
          </template>
        </el-table-column>
      </el-table>

      <footer v-if="classId && roster.length" class="entry-foot">
        <span class="hint">成绩 0-100 分；90+ 优秀 / 80+ 良好 / 70+ 中等 / 60+ 及格 / 不及格</span>
        <el-button type="primary" :loading="saving" @click="save">保存全部成绩</el-button>
      </footer>
      <el-empty v-if="classId && roster.length === 0 && !loading" description="该班暂无选课学生" />
      <el-empty v-if="!classId" description="请先选择教学班" />
    </section>
  </PortalShell>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';

const classes = ref([]);
const classId = ref(null);
const roster = ref([]);
const loading = ref(false);
const saving = ref(false);
const scores = ref({});

function gradeOf(s) {
  const n = Number(s);
  if (Number.isNaN(n)) return '—';
  if (n >= 90) return '优秀';
  if (n >= 80) return '良好';
  if (n >= 70) return '中等';
  if (n >= 60) return '及格';
  return '不及格';
}

async function loadClasses() {
  const res = await api('/api/edu/teach');
  if (res.code === 0) classes.value = res.data.list;
  else ElMessage.error(res.message || '教学班加载失败');
}

async function loadRoster() {
  if (!classId.value) return;
  loading.value = true;
  scores.value = {};
  try {
    const res = await api(`/api/edu/score?classId=${classId.value}`);
    if (res.code === 0) {
      roster.value = res.data.list;
      // 已出分的回填
      for (const r of roster.value) {
        if (r.status === 2 && r.score !== null) scores.value[r.student_id] = Number(r.score);
      }
    } else {
      ElMessage.error(res.message || '名单加载失败');
    }
  } finally {
    loading.value = false;
  }
}

async function save() {
  const items = Object.entries(scores.value)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => ({ studentId: Number(k), score: Number(v) }));
  if (items.length === 0) {
    ElMessage.warning('请先填写成绩');
    return;
  }
  const okGo = await ElMessageBox.confirm(`将保存 ${items.length} 条成绩，确认提交？`, '提交确认', {
    confirmButtonText: '提交',
    cancelButtonText: '取消',
  }).catch(() => false);
  if (!okGo) return;
  saving.value = true;
  try {
    const res = await api('/api/edu/score', { method: 'POST', body: { classId: classId.value, items } });
    if (res.code === 0) {
      ElMessage.success(res.message || '保存成功');
      await loadRoster();
      await loadClasses();
    } else {
      ElMessage.error(res.message || '保存失败');
    }
  } finally {
    saving.value = false;
  }
}

onMounted(loadClasses);
</script>

<style scoped>
.pg-card {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 14px;
  padding: 22px 24px;
  box-shadow: 0 6px 24px rgba(23, 50, 92, 0.07);
}
.pg-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
.pg-head h2 { margin: 0 0 6px; font-size: 19px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.grade-preview { font-size: 13px; color: #0d9488; font-weight: 600; }
.entry-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed var(--zc-border);
}
.hint { font-size: 12px; color: var(--zc-text-sub); }
</style>
