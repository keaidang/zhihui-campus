<template>
  <PortalShell active="edu-teach">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>我的课程</h2>
          <p>2026-2027 学年第一学期 · 任教班级</p>
        </div>
        <el-button :icon="Refresh" circle @click="load" />
      </header>

      <div v-loading="loading" class="tc-grid">
        <div v-for="c in list" :key="c.class_id" class="tc-card" @click="openRoster(c)">
          <div class="tc-band"></div>
          <h4>{{ c.course_name }}</h4>
          <p class="tc-code">{{ c.course_code }} · {{ c.credit }} 学分 / {{ c.hours }} 学时</p>
          <p>{{ weekText(c.week_day) }} {{ c.section }} · {{ c.classroom }}</p>
          <div class="tc-foot">
            <span>选课 <b>{{ c.enrolled }}</b>/{{ c.capacity }}</span>
            <el-tag size="small" :type="c.graded_count > 0 ? 'success' : 'info'" round>
              已录成绩 {{ c.graded_count }}
            </el-tag>
          </div>
        </div>
        <el-empty v-if="!loading && list.length === 0" description="本学期暂无任教班级" style="grid-column: 1 / -1" />
      </div>
    </section>

    <!-- 选课名单 -->
    <el-dialog v-model="rosterVisible" :title="rosterTitle" width="680px">
      <el-table v-loading="rosterLoading" :data="roster" stripe max-height="420">
        <el-table-column prop="user_no" label="学号" width="110" />
        <el-table-column prop="real_name" label="姓名" width="100" />
        <el-table-column prop="class_name" label="班级" min-width="130" show-overflow-tooltip />
        <el-table-column label="成绩" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.status === 2" :type="Number(row.score) >= 60 ? 'success' : 'danger'" size="small" round>
              {{ row.score }}
            </el-tag>
            <el-tag v-else type="info" size="small" effect="plain" round>未出分</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </PortalShell>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';

const list = ref([]);
const loading = ref(false);
const rosterVisible = ref(false);
const rosterLoading = ref(false);
const roster = ref([]);
const rosterTitle = ref('');

const WEEK = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const weekText = (d) => WEEK[d] || `周${d}`;

async function load() {
  loading.value = true;
  try {
    const res = await api('/api/edu/teach');
    if (res.code === 0) list.value = res.data.list;
    else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function openRoster(c) {
  rosterVisible.value = true;
  rosterLoading.value = true;
  rosterTitle.value = `${c.course_name} · 选课名单`;
  try {
    const res = await api(`/api/edu/teach?classId=${c.class_id}`);
    if (res.code === 0) roster.value = res.data.list;
    else ElMessage.error(res.message || '名单加载失败');
  } finally {
    rosterLoading.value = false;
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

.tc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.tc-card {
  position: relative;
  background: #fff;
  border: 1px solid var(--zc-border);
  border-radius: 12px;
  padding: 18px 18px 14px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  overflow: hidden;
}
.tc-card:hover { transform: translateY(-4px); box-shadow: 0 10px 28px rgba(13, 148, 136, 0.15); }
.tc-band {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #0d9488, #14b8a6);
}
.tc-card h4 { margin: 4px 0 8px; font-size: 16px; }
.tc-card p { margin: 0 0 6px; font-size: 12.5px; color: var(--zc-text-sub); }
.tc-code { letter-spacing: 0.5px; }
.tc-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--zc-border);
  font-size: 13px;
  color: var(--zc-text-sub);
}
.tc-foot b { color: #0d9488; }
</style>
