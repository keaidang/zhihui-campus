<template>
  <PortalShell active="edu-scores">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>成绩课表</h2>
          <p>2026-2027 学年第一学期</p>
        </div>
        <el-radio-group v-model="tab">
          <el-radio-button value="score">成绩单</el-radio-button>
          <el-radio-button value="table">周课表</el-radio-button>
        </el-radio-group>
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
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';

const tab = ref('score');
const loading = ref(false);
const list = ref([]);
const tableList = ref([]);
const summary = ref({});

const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const COLORS = ['#2563eb', '#0d9488', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];
const colorOf = (code) => COLORS[(String(code).charCodeAt(0) + String(code).length) % COLORS.length];
const byDay = (d) => tableList.value.filter((c) => c.week_day === d);
const scoreType = (s) => (Number(s) >= 80 ? 'success' : Number(s) >= 60 ? 'warning' : 'danger');

async function load() {
  loading.value = true;
  try {
    const [sc, tt] = await Promise.all([api('/api/edu/score'), api('/api/edu/timetable')]);
    if (sc.code === 0) {
      list.value = sc.data.list;
      summary.value = sc.data.summary || {};
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
