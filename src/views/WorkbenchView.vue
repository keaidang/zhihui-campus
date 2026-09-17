<template>
  <PortalShell active="workbench">
    <!-- 欢迎区 -->
    <section class="wb-hero">
      <div>
        <h2>{{ greeting }}，{{ auth.user?.realName || auth.user?.username }}</h2>
        <p>
          {{ roleLabel }}<template v-if="auth.user?.deptName"> · {{ auth.user.deptName }}</template>
          <template v-if="auth.user?.className"> · {{ auth.user.className }}</template>
          <template v-if="auth.user?.userNo"> · 学号/工号 {{ auth.user.userNo }}</template>
        </p>
      </div>
      <div class="wb-hero-badge">
        <span>{{ roles.join(' / ') }}</span>
      </div>
    </section>

    <!-- 我的功能模块（按角色） -->
    <section>
      <h3 class="wb-title">我的功能</h3>
      <div class="wb-grid">
        <div
          v-for="m in modules"
          :key="m.title"
          class="wb-card"
          :class="{ ready: m.path }"
          @click="onOpen(m)"
        >
          <span class="wb-card-badge">{{ m.path ? '可用' : '即将上线' }}</span>
          <div class="wb-icon"><el-icon :size="22"><component :is="m.icon" /></el-icon></div>
          <h4>{{ m.title }}</h4>
          <p>{{ m.desc }}</p>
        </div>
      </div>
    </section>
  </PortalShell>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import PortalShell from '../components/PortalShell.vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const ROLE_LABEL = {
  admin: '超级管理员',
  leader: '校领导',
  counselor: '辅导员',
  teacher: '教师',
  student: '学生',
};

const roles = computed(() => auth.user?.roleNames?.length ? auth.user.roleNames : auth.roles);
const roleLabel = computed(() => ROLE_LABEL[auth.primaryRole] || '用户');
const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});

// 各角色功能矩阵（一期教务/学工线落地后逐张点亮 ready）
const BY_ROLE = {
  admin: [
    { title: '用户管理', desc: '账号、角色、状态、归属院系', icon: 'UserFilled', path: '/admin/users' },
    { title: '院系班级', desc: '组织架构维护（M1 一并交付）', icon: 'OfficeBuilding' },
    { title: '公告管理', desc: '发布、置顶、撤回（M2）', icon: 'Bell' },
    { title: '数据看板', desc: '全校运行数据（M4）', icon: 'DataAnalysis' },
  ],
  counselor: [
    { title: '学生信息', desc: '本院学生名册与档案', icon: 'UserFilled', path: '/admin/users' },
    { title: '请假审批', desc: '待办审批、销假确认（M2）', icon: 'Clock' },
    { title: '奖助初审', desc: '奖助学金申请初审（M2）', icon: 'Medal' },
    { title: '报修派单', desc: '宿舍报修工单派发（M2）', icon: 'Tools' },
  ],
  teacher: [
    { title: '我的课程', desc: '开课信息与教学班（M1）', icon: 'Notebook' },
    { title: '成绩录入', desc: '期末成绩批量录入（M1）', icon: 'EditPen' },
    { title: '公告发布', desc: '面向任教班级发布通知（M2）', icon: 'Bell' },
    { title: '我的课表', desc: '周课表查看（M1）', icon: 'Calendar' },
  ],
  leader: [
    { title: '数据驾驶舱', desc: '全校运行态势只读大屏（M4）', icon: 'DataAnalysis' },
    { title: '统计报表', desc: '学院/年级多维报表（M4）', icon: 'Histogram' },
  ],
  student: [
    { title: '课程选课', desc: '在线选课退课，名额实时（M1）', icon: 'Notebook' },
    { title: '成绩课表', desc: '成绩查询与周课表（M1）', icon: 'Collection' },
    { title: '请销假', desc: '请假申请与销假闭环（M2）', icon: 'Clock' },
    { title: '宿舍报修', desc: '报修提交与进度跟踪（M2）', icon: 'Tools' },
    { title: '图书借阅', desc: '馆藏检索与续借（M3）', icon: 'Reading' },
    { title: '社团活动', desc: '社团与活动报名（M3）', icon: 'Flag' },
  ],
};

const modules = computed(() => {
  // 超管叠加辅导员视角的入口（有 admin 就先展示 admin 的）
  const list = BY_ROLE[auth.primaryRole] || BY_ROLE.student;
  return list;
});

function onOpen(m) {
  if (m.path) {
    router.push(m.path);
    return;
  }
  ElMessage.info(`「${m.title}」${m.desc} — 即将上线，敬请期待`);
}
</script>

<style scoped>
.wb-hero {
  background: linear-gradient(120deg, #17325c, #24548f);
  color: #fff;
  border-radius: 14px;
  padding: 26px 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.wb-hero h2 { margin: 0 0 8px; font-size: 22px; letter-spacing: 1px; }
.wb-hero p { margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.85); }
.wb-hero-badge span {
  display: inline-block;
  font-size: 12px;
  letter-spacing: 1px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.3);
  white-space: nowrap;
}
.wb-title { margin: 26px 0 14px; font-size: 17px; color: var(--zc-navy); letter-spacing: 1px; }
.wb-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.wb-card {
  position: relative;
  background: #fff;
  border: 1px solid var(--zc-border);
  border-radius: 12px;
  padding: 20px 18px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}
.wb-card:hover { transform: translateY(-4px); box-shadow: 0 10px 28px rgba(23, 50, 92, 0.1); }
.wb-card.ready { border-color: rgba(37, 99, 235, 0.4); }
.wb-card-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  font-size: 11px;
  color: var(--zc-text-sub);
  border: 1px solid var(--zc-border);
  border-radius: 999px;
  padding: 1px 8px;
}
.wb-card.ready .wb-card-badge { color: #1d4ed8; border-color: rgba(37, 99, 235, 0.4); background: #eef4ff; }
.wb-icon {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  background: linear-gradient(135deg, #2d6cb5, #17325c);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}
.wb-card h4 { margin: 0 0 6px; font-size: 15px; }
.wb-card p { margin: 0; font-size: 12.5px; color: var(--zc-text-sub); line-height: 1.6; }

@media (max-width: 1024px) { .wb-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) {
  .wb-grid { grid-template-columns: 1fr; }
  .wb-hero { flex-direction: column; align-items: flex-start; }
}
</style>
