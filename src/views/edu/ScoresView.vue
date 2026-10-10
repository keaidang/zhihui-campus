<template>
  <PortalShell active="edu-scores">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>成绩课表</h2>
          <p>{{ tab === 'score' ? `${termLabelText}成绩` : '本学期周课表' }}</p>
        </div>
        <div class="head-ops">
          <el-select
            v-if="tab === 'score'"
            v-model="term"
            style="width: 200px"
            placeholder="选择学期"
            @change="load"
          >
            <el-option
              v-for="t in terms"
              :key="t.term"
              :label="t.term === currentTerm ? `${t.label}（当前学期）` : t.label"
              :value="t.term"
            />
          </el-select>
          <el-button :icon="Download" round @click="onExport">导出课表</el-button>
          <el-radio-group v-model="tab">
            <el-radio-button value="score">成绩单</el-radio-button>
            <el-radio-button value="table">周课表</el-radio-button>
          </el-radio-group>
        </div>
      </header>

      <!-- 成绩单 -->
      <template v-if="tab === 'score'">
        <div class="sum-row">
          <div class="sum-item"><b>{{ summary.gpa ?? '—' }}</b><span>平均绩点</span></div>
          <div class="sum-item"><b>{{ summary.creditsEarned ?? 0 }}</b><span>已获学分</span></div>
          <div class="sum-item"><b>{{ summary.courseCount ?? 0 }}</b><span>已出分课程</span></div>
        </div>
        <el-table v-loading="loading" :data="list" stripe>
          <el-table-column prop="course_code" label="课程代码" width="100" />
          <el-table-column prop="course_name" label="课程" min-width="170" show-overflow-tooltip />
          <el-table-column label="学分" width="70" align="center">
            <template #default="{ row }">{{ row.credit }}</template>
          </el-table-column>
          <el-table-column prop="teacher_name" label="教师" width="100" />
          <el-table-column label="成绩" width="100" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.status === 2" :type="scoreType(row.score)" effect="light" round>
                {{ row.score }}
              </el-tag>
              <el-tag v-else type="info" effect="plain" round>未出分</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="等级" width="90" align="center">
            <template #default="{ row }">{{ row.grade || '—' }}</template>
          </el-table-column>
        </el-table>
      </template>

      <!-- 周课表 -->
      <template v-else>
        <div v-loading="loading" class="tt-wrap">
          <table class="tt">
            <thead>
              <tr>
                <th v-for="d in DAYS" :key="d">{{ d }}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td v-for="d in 7" :key="d" class="tt-cell">
                  <div
                    v-for="c in byDay(d)"
                    :key="c.class_id"
                    class="tt-item"
                    :style="{ background: colorOf(c.course_code) }"
                  >
                    <b>{{ c.course_name }}</b>
                    <span>{{ c.section }}</span>
                    <span>{{ c.classroom }}</span>
                    <span>{{ c.teacher_name }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <el-empty v-if="!loading && tableList.length === 0" description="暂无课程，快去选课吧" />
        </div>
      </template>
    </section>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Download } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';
import { useAuthStore } from '../../stores/auth';
import { exportTimetable } from '../../utils/timetableExport';

const tab = ref('score');
const loading = ref(false);
const list = ref([]);
const tableList = ref([]);
const summary = ref({});
// 学期：成绩可按学期切换（成绩数据挂在历史学期，当前学期只该有"在选"）
const term = ref('');
const terms = ref([]);
const currentTerm = ref('');
const termLabelText = computed(() => {
  const hit = terms.value.find((t) => t.term === term.value);
  return hit?.label || term.value || '';
});

const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const COLORS = ['#2563eb', '#0d9488', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];
const colorOf = (code) => COLORS[(String(code).charCodeAt(0) + String(code).length) % COLORS.length];
const byDay = (d) => tableList.value.filter((c) => c.week_day === d);
const scoreType = (s) => (Number(s) >= 80 ? 'success' : Number(s) >= 60 ? 'warning' : 'danger');

function onExport() {
  const auth = useAuthStore();
  const ok = exportTimetable({
    title: '我的周课表',
    subtitle: auth.user ? `${auth.user.realName || auth.user.username} · ${auth.user.userNo || ''}` : '',
    term: '2026-2027 学年第一学期',
    list: tableList.value,
  });
  if (!ok) ElMessage.warning('暂无课表数据');
}

async function load() {
  loading.value = true;
  try {
    // 成绩按学期查；课表始终是当前学期（周课表没有"往年"概念，不跟着切）
    const q = term.value ? `?term=${encodeURIComponent(term.value)}` : '';
    const [sc, tt] = await Promise.all([api(`/api/edu/score${q}`), api('/api/edu/timetable')]);
    if (sc.code === 0) {
      list.value = sc.data.list;
      summary.value = sc.data.summary || {};
      terms.value = sc.data.terms || [];
      currentTerm.value = sc.data.currentTerm || '';
      // 首次进入时跟随后端返回的学期（默认当前学期），之后由用户选择
      if (!term.value && sc.data.term) term.value = sc.data.term;
    } else {
      ElMessage.error(sc.message || '成绩加载失败');
    }
    if (tt.code === 0) tableList.value = tt.data.list;
  } finally {
    loading.value = false;
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
.head-ops { display: flex; align-items: center; gap: 12px; }

.sum-row { display: flex; gap: 14px; margin-bottom: 18px; }
.sum-item {
  flex: 1;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(37, 99, 235, 0.03));
  border: 1px solid rgba(37, 99, 235, 0.15);
  border-radius: 10px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sum-item b { font-size: 22px; color: #1d4ed8; }
.sum-item span { font-size: 12px; color: var(--zc-text-sub); }

/* 周课表 */
.tt-wrap { overflow-x: auto; }
.tt { width: 100%; border-collapse: separate; border-spacing: 6px; min-width: 640px; }
.tt th { font-size: 13px; color: var(--zc-navy); padding: 8px 0; }
.tt-cell { vertical-align: top; background: #f4f8fc; border-radius: 10px; min-height: 180px; padding: 4px; }
.tt-item {
  border-radius: 8px;
  color: #fff;
  padding: 8px 10px;
  margin-bottom: 6px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tt-item b { font-size: 13px; }
</style>
