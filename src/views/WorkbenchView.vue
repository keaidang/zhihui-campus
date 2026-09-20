<template>
  <PortalShell active="workbench">
    <div class="wb-zoom">
    <!-- 欢迎条 -->
    <section class="wb-hero">
      <div>
        <h2>{{ greeting }}，{{ auth.user?.realName || auth.user?.username }}</h2>
        <p>欢迎来到智汇校园工作台，今天也要元气满满</p>
      </div>
      <div class="wb-hero-badge"><span>{{ roleLabel }}</span></div>
    </section>

    <div class="wb-cols">
      <!-- 左列：账号信息卡 + 校园资源 -->
      <div class="wb-left">
        <!-- 账号信息卡 -->
        <section class="wb-profile wb-panel">
          <div class="wp-top">
            <el-avatar :size="56" class="wp-avatar">{{ initial }}</el-avatar>
            <div class="wp-id">
              <h3>{{ auth.user?.realName || auth.user?.username }}</h3>
              <span class="wp-role-tag">{{ roleLabel }}</span>
            </div>
          </div>
          <ul class="wp-meta">
            <li><em>账号</em><span>{{ auth.user?.username }}</span></li>
            <li v-if="auth.user?.userNo"><em>学号/工号</em><span>{{ auth.user.userNo }}</span></li>
            <li v-if="auth.user?.deptName"><em>院系</em><span>{{ auth.user.deptName }}</span></li>
            <li v-if="auth.user?.className"><em>班级</em><span>{{ auth.user.className }}</span></li>
            <li v-if="auth.user?.phone"><em>电话</em><span>{{ auth.user.phone }}</span></li>
            <li><em>角色</em><span>{{ roleNames.join(' / ') }}</span></li>
            <li v-if="auth.user?.lastLoginAt"><em>上次登录</em><span>{{ fmtTime(auth.user.lastLoginAt) }}</span></li>
          </ul>
        </section>

        <!-- 校园资源（外部链接） -->
        <section class="wb-res wb-panel">
          <h4><el-icon><Link /></el-icon> 常用资源</h4>
          <a v-for="r in RESOURCES" :key="r.name" :href="r.url" target="_blank" rel="noopener noreferrer" class="res-item">
            <span class="res-dot" :style="{ background: r.color }"></span>
            <span class="res-name">{{ r.name }}</span>
            <span class="res-desc">{{ r.desc }}</span>
            <el-icon class="res-go"><TopRight /></el-icon>
          </a>
        </section>

        <!-- 校园邮箱 -->
        <section class="wb-res wb-panel mail-card">
          <h4><el-icon><Promotion /></el-icon> 校园邮箱</h4>
          <template v-if="auth.user?.campusEmail">
            <div class="mail-addr">
              <span class="mail-addr-text">{{ auth.user.campusEmail }}</span>
              <el-tag :type="auth.user.mailEnabled ? 'success' : 'info'" size="small">
                {{ auth.user.mailEnabled ? '对外收发已开通' : '仅系统内' }}
              </el-tag>
            </div>
            <p class="mail-note" v-if="!auth.user.mailEnabled">开通对外收发后即可收发外部邮件，请联系管理员开通</p>
            <el-button
              v-if="auth.user.mailEnabled"
              size="small"
              plain
              @click="mailPwdDlg = true"
            >修改邮箱密码</el-button>
          </template>
          <p v-else class="mail-note">校园邮箱尚未分配，请联系管理员</p>
        </section>
      </div>

      <!-- 右列：我的功能（按角色） -->
      <div class="wb-right">
        <h3 class="wb-title">我的功能</h3>
        <div class="wb-grid">
          <div
            v-for="m in modules"
            :key="m.title"
            class="wb-card"
            :class="m.path ? 'ready' : 'pending-card'"
            @click="onOpen(m)"
          >
            <span class="wb-card-badge">{{ m.path ? '可用' : '即将上线' }}</span>
            <div class="wb-icon"><el-icon :size="22"><component :is="m.icon" /></el-icon></div>
            <h4>{{ m.title }}</h4>
            <p>{{ m.desc }}</p>
          </div>
        </div>
      </div>
    </div>
    <!-- 修改校园邮箱密码 -->
    <el-dialog v-model="mailPwdDlg" title="修改校园邮箱密码" width="420px">
      <p class="mail-dlg-tip">邮箱：{{ auth.user?.campusEmail }}</p>
      <el-input
        v-model="mailPwd"
        type="password"
        placeholder="新密码（至少 8 位）"
        show-password
      />
      <template #footer>
        <el-button @click="mailPwdDlg = false">取消</el-button>
        <el-button type="primary" :loading="mailPwdSaving" @click="changeMailPwd">确认修改</el-button>
      </template>
    </el-dialog>
    </div>
  </PortalShell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import PortalShell from '../components/PortalShell.vue';
import { useAuthStore } from '../stores/auth';
import { api } from '../api/request';

const router = useRouter();
const auth = useAuthStore();

// 校园邮箱改密
const mailPwdDlg = ref(false);
const mailPwd = ref('');
const mailPwdSaving = ref(false);
async function changeMailPwd() {
  if (mailPwd.value.length < 8) return ElMessage.warning('密码至少 8 位');
  mailPwdSaving.value = true;
  try {
    const res = await api('/api/me/mail-password', { method: 'POST', body: { newPassword: mailPwd.value } });
    if (res.code === 0) {
      ElMessage.success(res.message || '密码已修改');
      mailPwdDlg.value = false;
      mailPwd.value = '';
    } else {
      ElMessage.error(res.message || '修改失败');
    }
  } finally {
    mailPwdSaving.value = false;
  }
}

const ROLE_LABEL = {
  admin: '超级管理员',
  leader: '校领导',
  counselor: '辅导员',
  teacher: '教师',
  student: '学生',
};

const RESOURCES = [
  { name: '中国知网', desc: '学术文献检索', url: 'https://www.cnki.net/', color: '#2563eb' },
  { name: '学信网', desc: '学籍学历查询', url: 'https://www.chsi.com.cn/', color: '#0d7a6c' },
  { name: '南通市图书馆', desc: '数字资源与馆藏', url: 'https://www.ntlib.org.cn/', color: '#dc2626' },
  { name: '中国国家图书馆', desc: '国家图书馆·数字资源', url: 'https://www.nlc.cn/', color: '#d97706' },
  { name: '中国共青团', desc: '共青团中央官网', url: 'https://www.gqt.org.cn/', color: '#6b46c1' },
];

const roleLabel = computed(() => ROLE_LABEL[auth.primaryRole] || '用户');
const roleNames = computed(() => auth.user?.roleNames?.length ? auth.user.roleNames : ['学生']);
const initial = computed(() => (auth.user?.realName || auth.user?.username || 'U').charAt(0));
const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});

function fmtTime(t) {
  if (!t) return '';
  return String(t).replace('T', ' ').slice(0, 16);
}

/** 各角色功能矩阵（M3/M4 卡片保留占位） */
const BY_ROLE = {
  admin: [
    { title: '用户管理', desc: '账号、角色、状态、归属院系', icon: 'UserFilled', path: '/admin/users' },
    { title: '请假审批', desc: '全校请假单审批', icon: 'Checked', path: '/af/approve' },
    { title: '报修处理', desc: '全校报修工单受理', icon: 'SetUp', path: '/af/repair-manage' },
    { title: '公告管理', desc: '发布全校公告、置顶撤回', icon: 'Bell', path: '/af/notice' },
    { title: '全部课程', desc: '查看全部教学班', icon: 'Notebook', path: '/edu/teach' },
  ],
  counselor: [
    { title: '请假审批', desc: '本院学生请销假审批', icon: 'Checked', path: '/af/approve' },
    { title: '报修处理', desc: '报修工单受理与派办', icon: 'SetUp', path: '/af/repair-manage' },
    { title: '学生名册', desc: '本班学生名单与管理', icon: 'UserFilled', path: '/admin/students' },
    { title: '公告管理', desc: '发布本院公告', icon: 'Bell', path: '/af/notice' },
  ],
  teacher: [
    { title: '我的课程', desc: '教学班与选课名单', icon: 'Notebook', path: '/edu/teach' },
    { title: '成绩录入', desc: '选课学生成绩批量录入', icon: 'EditPen', path: '/edu/score-entry' },
    { title: '公告发布', desc: '面向本院发布通知', icon: 'Bell', path: '/af/notice' },
  ],
  leader: [
    { title: '数据驾驶舱', desc: '全校运行态势只读大屏（M4）', icon: 'DataAnalysis' },
    { title: '统计报表', desc: '学院/年级多维报表（M4）', icon: 'Histogram' },
    { title: '公告中心', desc: '全校通知公告浏览', icon: 'Bell', path: '/af/notice' },
  ],
  student: [
    { title: '课程选课', desc: '在线选课退课，名额实时', icon: 'Notebook', path: '/edu/elect' },
    { title: '成绩课表', desc: '成绩单与周课表', icon: 'Collection', path: '/edu/scores' },
    { title: '请销假', desc: '请假申请与销假闭环', icon: 'Clock', path: '/af/leave' },
    { title: '宿舍报修', desc: '报修提交与进度跟踪', icon: 'Tools', path: '/af/repair' },
    { title: '图书借阅', desc: '馆藏检索与续借（M3）', icon: 'Reading' },
    { title: '社团活动', desc: '社团与活动报名（M3）', icon: 'Flag' },
  ],
};

const modules = computed(() => BY_ROLE[auth.primaryRole] || BY_ROLE.student);

function onOpen(m) {
  if (m.path) {
    router.push(m.path);
    return;
  }
  ElMessage.info(`「${m.title}」${m.desc} — 即将上线，敬请期待`);
}
</script>

<style scoped>
/* 欢迎条：深蓝实景玻璃面板 + 素金细节，替代角色配色 */
.wb-hero {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
  padding: 26px 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  color: #fff;
  background: url('/web-pc.png') center / cover no-repeat;
  box-shadow: 0 14px 38px rgba(10, 24, 46, 0.32);
}
.wb-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, rgba(13, 28, 52, 0.88) 0%, rgba(23, 50, 92, 0.72) 60%, rgba(23, 50, 92, 0.55) 100%);
}
.wb-hero > div { position: relative; z-index: 1; }
.wb-hero h2 {
  margin: 0 0 8px;
  font-size: 22px;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  gap: 12px;
}
/* 标题前的素金竖条 */
.wb-hero h2::before {
  content: '';
  width: 4px;
  height: 22px;
  border-radius: 3px;
  background: var(--zc-gold);
}
.wb-hero p { margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.82); }
.wb-hero-badge span {
  display: inline-block;
  font-size: 12px;
  letter-spacing: 1px;
  padding: 6px 14px;
  border-radius: 999px;
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.32);
  backdrop-filter: blur(6px);
  white-space: nowrap;
}

/* 工作台整体放大 110%（用户浏览器 110% 缩放的默认观感） */
.wb-zoom { zoom: 1.1; }
.mail-card .mail-addr { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.mail-card .mail-addr-text { font-weight: 600; color: var(--zc-navy, #17325c); word-break: break-all; }
.mail-card .mail-note { margin: 0 0 8px; font-size: 12px; color: var(--zc-text-sub, #64748b); line-height: 1.6; }
.mail-dlg-tip { margin: 0 0 10px; font-size: 13px; color: var(--zc-navy, #17325c); font-weight: 600; }

.wb-cols {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 18px;
  margin-top: 18px;
  align-items: start;
}
.wb-left { display: flex; flex-direction: column; gap: 18px; }

/* 通用玻璃卡 */
.wb-panel {
  background: var(--zc-glass);
  backdrop-filter: blur(14px);
  border: 1px solid var(--zc-glass-border);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(15, 35, 66, 0.09);
}

/* 账号信息卡 */
.wb-profile { overflow: hidden; }
.wp-top {
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(135deg, rgba(23, 50, 92, 0.94), rgba(35, 74, 133, 0.88));
}
.wp-avatar {
  background: rgba(255, 255, 255, 0.16) !important;
  color: #fff;
  font-size: 22px;
  border: 2px solid rgba(255, 255, 255, 0.38);
}
.wp-id h3 { margin: 0 0 6px; font-size: 17px; color: #fff; letter-spacing: 1px; }
.wp-role-tag {
  display: inline-block;
  font-size: 11px;
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  padding: 2px 10px;
  letter-spacing: 1px;
}
.wp-meta { list-style: none; margin: 0; padding: 8px 20px 14px; }
.wp-meta li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--zc-border);
  font-size: 13px;
}
.wp-meta li:last-child { border-bottom: none; }
.wp-meta em { font-style: normal; color: var(--zc-text-sub); flex: none; }
.wp-meta span { text-align: right; word-break: break-all; }

/* 资源链接卡 */
.wb-res { padding: 16px 18px; }
.wb-res h4 {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--zc-navy);
  display: flex;
  align-items: center;
  gap: 6px;
  letter-spacing: 1px;
}
.res-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--zc-text);
  font-size: 13.5px;
  transition: background 0.15s;
}
.res-item:hover { background: rgba(23, 50, 92, 0.06); }
.res-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.res-name { font-weight: 600; flex: none; }
.res-desc { color: var(--zc-text-sub); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.res-go { margin-left: auto; color: var(--zc-text-sub); flex: none; }

.wb-right { min-width: 0; }
.wb-title { margin: 2px 0 14px; font-size: 17px; color: var(--zc-navy); letter-spacing: 1px; }
.wb-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.wb-card {
  position: relative;
  overflow: hidden;
  background: var(--zc-glass);
  backdrop-filter: blur(14px);
  border: 1px solid var(--zc-glass-border);
  border-radius: 13px;
  padding: 20px 18px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
  box-shadow: 0 6px 20px rgba(15, 35, 66, 0.07);
}
/* 悬停顶部素金线 */
.wb-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  width: 100%;
  background: linear-gradient(90deg, var(--zc-gold), rgba(200, 163, 95, 0.15));
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.3s ease;
}
.wb-card:hover {
  transform: translateY(-4px);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 12px 30px rgba(15, 35, 66, 0.13);
}
.wb-card:hover::before { transform: scaleX(1); }
.wb-card-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  font-size: 11px;
  color: var(--zc-text-sub);
  border: 1px solid var(--zc-border);
  border-radius: 999px;
  padding: 1px 8px;
  background: rgba(255, 255, 255, 0.6);
}
.wb-card.ready .wb-card-badge {
  color: var(--zc-navy);
  border-color: rgba(23, 50, 92, 0.28);
}
.wb-card.pending-card { filter: saturate(0.35); opacity: 0.82; }
.wb-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #2d5a9e, var(--zc-navy));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
  box-shadow: 0 6px 14px rgba(23, 50, 92, 0.2);
}
.wb-card h4 { margin: 0 0 6px; font-size: 15px; }
.wb-card p { margin: 0; font-size: 12.5px; color: var(--zc-text-sub); line-height: 1.6; }

@media (max-width: 1024px) {
  .wb-cols { grid-template-columns: 1fr; }
  .wb-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 560px) {
  .wb-grid { grid-template-columns: 1fr; }
  .wb-hero { flex-direction: column; align-items: flex-start; }
}
</style>
