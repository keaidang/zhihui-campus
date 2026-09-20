<template>
  <PortalShell active="dashboard">
    <div v-loading="loading" class="dash">
      <!-- 顶部核心指标 -->
      <div class="kpi-row">
        <div v-for="k in kpis" :key="k.label" class="kpi pg-card">
          <span class="kpi-label">{{ k.label }}</span>
          <span class="kpi-value">{{ k.value }}</span>
          <span class="kpi-sub">{{ k.sub }}</span>
        </div>
      </div>

      <div class="dash-cols">
        <!-- 各学院学生分布 -->
        <section class="pg-card">
          <h2>各学院学生分布</h2>
          <div class="bar-list">
            <div v-for="d in data.depts" :key="d.name" class="bar-row">
              <span class="bar-name">{{ d.name }}</span>
              <div class="bar-track"><div class="bar-in" :style="{ width: pct(d.n, data.depts) }"></div></div>
              <span class="bar-num">{{ d.n }}</span>
            </div>
            <el-empty v-if="data.depts.length === 0" :image-size="60" description="暂无数据" />
          </div>
        </section>

        <!-- 近 7 日登录趋势 -->
        <section class="pg-card">
          <h2>近 7 日登录趋势</h2>
          <div class="trend">
            <div v-for="t in trend" :key="t.date" class="trend-col">
              <div class="trend-bar-wrap">
                <div class="trend-bar" :style="{ height: Math.max(t.n / trendMax * 100, 4) + '%' }"></div>
              </div>
              <span class="trend-num">{{ t.n }}</span>
              <span class="trend-date">{{ t.date.slice(5) }}</span>
            </div>
          </div>
          <p class="trend-sub">数据来源：sys_login_log 成功登录流水（边缘就近接入 → Node 侧落库）</p>
        </section>
      </div>

      <div class="dash-cols">
        <!-- 学工线 -->
        <section class="pg-card">
          <h2>学工运行</h2>
          <div class="stat-grid">
            <div class="stat"><b class="warn">{{ data.affairs.leave.pending }}</b><span>请假待审批</span></div>
            <div class="stat"><b class="ok">{{ data.affairs.leave.approved }}</b><span>已批准</span></div>
            <div class="stat"><b>{{ data.affairs.leave.done }}</b><span>已销假</span></div>
            <div class="stat"><b class="warn">{{ data.affairs.repair.pending }}</b><span>报修待受理</span></div>
            <div class="stat"><b>{{ data.affairs.repair.processing }}</b><span>处理中</span></div>
            <div class="stat"><b class="ok">{{ data.affairs.repair.done }}</b><span>已完成</span></div>
          </div>
        </section>

        <!-- 宿舍 -->
        <section class="pg-card">
          <h2>宿舍运行</h2>
          <div class="dorm-dash">
            <div class="dorm-ring">
              <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(23,50,92,0.1)" stroke-width="12" />
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--zc-navy)" stroke-width="12"
                        stroke-linecap="round" :stroke-dasharray="`${dormPct * 3.14} 314`" transform="rotate(-90 60 60)" />
              </svg>
              <div class="dorm-ring-label"><b>{{ dormPct }}%</b><span>入住率</span></div>
            </div>
            <div class="dorm-facts">
              <div class="stat"><b>{{ data.dorm.buildings }}</b><span>楼栋</span></div>
              <div class="stat"><b>{{ data.dorm.bedsUsed }}</b><span>已入住</span></div>
              <div class="stat"><b>{{ data.dorm.bedsTotal - data.dorm.bedsUsed }}</b><span>空床位</span></div>
            </div>
          </div>
        </section>

        <!-- 生活服务 -->
        <section class="pg-card">
          <h2>生活服务</h2>
          <div class="stat-grid">
            <div class="stat"><b>{{ data.life.books }}</b><span>馆藏种数</span></div>
            <div class="stat"><b>{{ data.life.loansActive }}</b><span>在借</span></div>
            <div class="stat"><b :class="data.life.loansOverdue > 0 ? 'warn' : ''">{{ data.life.loansOverdue }}</b><span>逾期</span></div>
            <div class="stat"><b>{{ data.life.clubRecruiting }}</b><span>社团招募中</span></div>
            <div class="stat"><b :class="data.life.clubPending > 0 ? 'warn' : ''">{{ data.life.clubPending }}</b><span>社团待审</span></div>
            <div class="stat"><b>{{ data.life.forumNew24h }}</b><span>论坛 24h 新帖</span></div>
          </div>
        </section>
      </div>

      <!-- 最近管理动态 -->
      <section class="pg-card" style="margin-top: 18px">
        <h2>最近管理动态</h2>
        <el-table :data="data.recentOps" size="small" stripe>
          <el-table-column prop="createdAt" label="时间" width="150">
            <template #default="{ row }">{{ String(row.createdAt).replace('T', ' ').slice(0, 16) }}</template>
          </el-table-column>
          <el-table-column prop="operator" label="操作人" width="110" />
          <el-table-column prop="action" label="动作" width="180" />
          <el-table-column prop="target" label="对象" width="160" show-overflow-tooltip />
          <el-table-column prop="detail" label="明细" show-overflow-tooltip />
        </el-table>
      </section>
    </div>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';

const loading = ref(false);
const data = ref({
  users: { students: 0, teachers: 0, counselors: 0, gender: [] },
  depts: [],
  edu: {},
  affairs: { leave: {}, repair: {}, pendingApprovals: 0 },
  dorm: { buildings: 0, bedsTotal: 0, bedsUsed: 0 },
  life: {},
  loginTrend: [],
  recentOps: [],
});

const kpis = computed(() => [
  { label: '在校学生', value: data.value.users.students, sub: `${genderText} · ${data.value.edu.classes} 个班级` },
  { label: '教职工', value: data.value.users.teachers + data.value.users.counselors + data.value.users.leaders + data.value.users.admins, sub: `教师 ${data.value.users.teachers} · 辅导员 ${data.value.users.counselors}` },
  { label: '开设课程', value: data.value.edu.courses, sub: `累计选课 ${data.value.edu.electives} 人次` },
  { label: '平均成绩', value: data.value.edu.scoreAvg ?? '—', sub: `已录入 ${data.value.edu.scored} 门次` },
]);
const genderText = computed(() => {
  const g = data.value.users.gender;
  const m = g.find((x) => x.gender === 1)?.n || 0;
  const f = g.find((x) => x.gender === 2)?.n || 0;
  return `男 ${m} / 女 ${f}`;
});
const dormPct = computed(() =>
  data.value.dorm.bedsTotal > 0 ? Math.round((data.value.dorm.bedsUsed / data.value.dorm.bedsTotal) * 100) : 0,
);
const trend = computed(() => {
  // 补齐 7 天（无登录的天也显示 0）
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hit = data.value.loginTrend.find((t) => String(t.date).slice(0, 10) === key);
    days.push({ date: key, n: hit ? hit.n : 0 });
  }
  return days;
});
const trendMax = computed(() => Math.max(...trend.value.map((t) => t.n), 1));
const pct = (n, list) => `${Math.round((n / Math.max(...list.map((x) => x.n), 1)) * 100)}%`;

async function load() {
  loading.value = true;
  try {
    const res = await api('/api/admin/dashboard');
    if (res.code === 0) data.value = res.data;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.dash { display: flex; flex-direction: column; }
.pg-card {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 14px;
  padding: 20px 22px;
  box-shadow: 0 6px 24px rgba(23, 50, 92, 0.07);
}
.pg-card h2 { margin: 0 0 14px; font-size: 16px; color: var(--zc-navy); letter-spacing: 1px; }

.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 18px; }
.kpi { display: flex; flex-direction: column; gap: 4px; padding: 18px 22px; }
.kpi-label { font-size: 13px; color: var(--zc-text-sub); }
.kpi-value { font-size: 30px; font-weight: 700; color: var(--zc-navy); line-height: 1.1; }
.kpi-sub { font-size: 12px; color: var(--zc-text-sub); }

.dash-cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px; align-items: stretch; }
.dash-cols:first-of-type { grid-template-columns: 1.4fr 1.6fr; }

.bar-list { display: flex; flex-direction: column; gap: 10px; }
.bar-row { display: flex; align-items: center; gap: 10px; }
.bar-name { width: 150px; font-size: 12.5px; color: var(--zc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-track { flex: 1; height: 10px; background: rgba(23, 50, 92, 0.08); border-radius: 5px; overflow: hidden; }
.bar-in { height: 100%; background: linear-gradient(90deg, var(--zc-navy), #3b82f6); border-radius: 5px; }
.bar-num { width: 40px; text-align: right; font-size: 12.5px; font-weight: 600; color: var(--zc-navy); }

.trend { display: flex; justify-content: space-between; align-items: flex-end; height: 130px; padding: 0 6px; }
.trend-col { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 44px; }
.trend-bar-wrap { height: 90px; display: flex; align-items: flex-end; }
.trend-bar { width: 22px; background: linear-gradient(180deg, #3b82f6, var(--zc-navy)); border-radius: 5px 5px 2px 2px; transition: height 0.4s; }
.trend-num { font-size: 12px; font-weight: 600; color: var(--zc-navy); }
.trend-date { font-size: 11px; color: var(--zc-text-sub); }
.trend-sub { margin: 10px 0 0; font-size: 11.5px; color: var(--zc-text-sub); }

.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.stat { display: flex; flex-direction: column; align-items: center; gap: 2px; background: rgba(23, 50, 92, 0.03); border-radius: 10px; padding: 12px 6px; }
.stat b { font-size: 22px; color: var(--zc-navy); }
.stat b.warn { color: #d97706; }
.stat b.ok { color: #0d9488; }
.stat span { font-size: 12px; color: var(--zc-text-sub); }

.dorm-dash { display: flex; align-items: center; gap: 18px; }
.dorm-ring { position: relative; width: 110px; height: 110px; flex: none; }
.dorm-ring-label { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.dorm-ring-label b { font-size: 20px; color: var(--zc-navy); }
.dorm-ring-label span { font-size: 11px; color: var(--zc-text-sub); }
.dorm-facts { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }

@media (max-width: 1000px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .dash-cols { grid-template-columns: 1fr; }
  .bld-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
