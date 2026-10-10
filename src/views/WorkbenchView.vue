<template>
  <PortalShell active="workbench">
    <div class="wb-container">
      <!-- 宽幅全景身份与信息面板 -->
      <section class="wb-hero">
        <div class="wb-hero-main">
          <!-- 用户身份与元信息 -->
          <div class="wb-hero-profile">
            <el-avatar :size="58" class="wp-avatar">{{ initial }}</el-avatar>
            <div class="wp-user-meta">
              <div class="wp-title-row">
                <h2>{{ greeting }}，{{ auth.user?.realName || auth.user?.username }}</h2>
                <span class="wp-role-badge">{{ roleLabel }}</span>
              </div>
              <div class="wp-chips">
                <span v-if="auth.user?.userNo" class="wp-chip" title="学号/工号">
                  <el-icon><User /></el-icon> {{ auth.user.userNo }}
                </span>
                <span v-if="auth.user?.deptName" class="wp-chip" title="所属院系">
                  <el-icon><OfficeBuilding /></el-icon> {{ auth.user.deptName }}
                </span>
                <span v-if="auth.user?.className" class="wp-chip" title="班级">
                  <el-icon><School /></el-icon> {{ auth.user.className }}
                </span>
                <span v-if="auth.user?.phone" class="wp-chip" title="联系电话">
                  <el-icon><Iphone /></el-icon> {{ auth.user.phone }}
                </span>
                <span v-if="auth.user?.lastLoginAt" class="wp-chip wp-time-chip" title="上次登录时间">
                  <el-icon><Clock /></el-icon> 上次登录 {{ fmtTime(auth.user.lastLoginAt) }}
                </span>
              </div>
            </div>
          </div>

          <!-- 校园邮箱横向快捷卡 -->
          <div class="wb-hero-mail">
            <div class="mail-head">
              <span class="mail-title"><el-icon><Promotion /></el-icon> 校园邮箱</span>
              <el-tag
                v-if="auth.user?.campusEmail"
                :type="auth.user.mailEnabled ? 'success' : 'info'"
                size="small"
                effect="plain"
                class="mail-tag"
              >
                {{ auth.user.mailEnabled ? '对外收发已开通' : '仅系统内' }}
              </el-tag>
            </div>
            <template v-if="auth.user?.campusEmail">
              <div class="mail-addr-row" :title="auth.user.campusEmail">
                <span class="mail-addr-text">{{ auth.user.campusEmail }}</span>
              </div>
              <div class="mail-actions">
                <el-button v-if="auth.user.mailEnabled" type="primary" size="small" round @click="router.push('/mail')">
                  进入邮箱
                </el-button>
                <el-button v-if="auth.user.mailEnabled" size="small" round class="mail-btn-ghost" @click="mailPwdDlg = true">
                  改密
                </el-button>
                <span v-if="!auth.user.mailEnabled" class="mail-note-unauth">联系管理员开通对外收发</span>
              </div>
            </template>
            <p v-else class="mail-note-empty">校园邮箱尚未分配，请联系管理员</p>
          </div>
        </div>
      </section>

      <!-- 主功能矩阵（全宽展示） -->
      <section class="wb-section">
        <div class="wb-section-head">
          <h3 class="wb-section-title"><el-icon><Grid /></el-icon> 我的功能</h3>
          <span class="wb-section-badge">共 {{ modules.length }} 项服务</span>
        </div>
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
      </section>

      <!-- 常用资源（横向全宽铺底） -->
      <section class="wb-section wb-resrow">
        <div class="wb-section-head">
          <h4 class="wb-section-title"><el-icon><Link /></el-icon> 常用资源</h4>
        </div>
        <div class="wb-resrow-grid">
          <a
            v-for="r in RESOURCES"
            :key="r.name"
            :href="r.url"
            target="_blank"
            rel="noopener noreferrer"
            class="resx-card"
          >
            <span class="res-dot" :style="{ background: r.color }"></span>
            <span class="resx-name">{{ r.name }}</span>
            <span class="resx-desc">{{ r.desc }}</span>
            <el-icon class="res-go"><TopRight /></el-icon>
          </a>
        </div>
      </section>

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
import {
  Promotion,
  Link,
  TopRight,
  User,
  OfficeBuilding,
  School,
  Clock,
  Grid,
  Iphone,
} from '@element-plus/icons-vue';
import PortalShell from '../components/PortalShell.vue';
import { useAuthStore } from '../stores/auth';
import { useAiStore } from '../stores/ai';
import { api } from '../api/request';
import { fmtTime } from '../utils/time';

const router = useRouter();
const auth = useAuthStore();
const ai = useAiStore();

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
const initial = computed(() => (auth.user?.realName || auth.user?.username || 'U').charAt(0));
const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});

/** 各角色功能矩阵（M3/M4 卡片保留占位） */
const AI_CARD = { title: 'AI 助手', desc: '校园问答 · 办事流程即问即答，可直接下指令或查统计数据', icon: 'MagicStick', path: '/ai' };
const AI_CONSOLE_CARD = { title: 'AI 管理控制台', desc: '开关 · 审核队列 · 知识库 · 告警 · 用量', icon: 'Setting', path: '/admin/ai' };

const BY_ROLE = {
  admin: [
    { title: '数据驾驶舱', desc: '全校运行态势只读大屏', icon: 'DataAnalysis', path: '/dashboard' },
    { title: '用户管理', desc: '账号、角色、状态、归属院系', icon: 'UserFilled', path: '/admin/users' },
    { title: '宿舍管理', desc: '楼栋房间、住宿分配、报修处理', icon: 'House', path: '/dorm' },
    { title: '请假审批', desc: '全校请假单审批', icon: 'Checked', path: '/af/approve' },
    { title: '报修处理', desc: '全校报修工单受理', icon: 'SetUp', path: '/af/repair-manage' },
    { title: '公告管理', desc: '发布全校公告、置顶撤回', icon: 'Bell', path: '/af/notice' },
    { title: '全部课程', desc: '查看全部教学班', icon: 'Notebook', path: '/edu/teach' },
    { title: '图书管理', desc: '藏书入库、批量导入、借还管理', icon: 'Reading', path: '/library' },
    { title: '校园论坛', desc: '板块管理、置顶锁定、禁言', icon: 'ChatDotRound', path: '/forum' },
    { title: '失物招领', desc: '发布与下架失物信息', icon: 'Search', path: '/lost-found' },
  ],
  counselor: [
    { title: '请假审批', desc: '本院学生请销假审批', icon: 'Checked', path: '/af/approve' },
    { title: '宿舍管理', desc: '住宿分配与报修处理', icon: 'House', path: '/dorm' },
    { title: '报修处理', desc: '报修工单受理与派办', icon: 'SetUp', path: '/af/repair-manage' },
    { title: '学生名册', desc: '本班学生名单与管理', icon: 'UserFilled', path: '/admin/students' },
    { title: '公告管理', desc: '发布本院公告', icon: 'Bell', path: '/af/notice' },
    { title: '失物招领', desc: '学工处发布失物信息', icon: 'Search', path: '/lost-found' },
    { title: '校园论坛', desc: '校园社区讨论', icon: 'ChatDotRound', path: '/forum' },
  ],
  teacher: [
    { title: '我的课程', desc: '教学班与选课名单', icon: 'Notebook', path: '/edu/teach' },
    { title: '成绩录入', desc: '选课学生成绩批量录入', icon: 'EditPen', path: '/edu/score-entry' },
    { title: '公告发布', desc: '面向本院发布通知', icon: 'Bell', path: '/af/notice' },
    { title: '社团审批', desc: '教务处审批社团申请', icon: 'Flag', path: '/club' },
    { title: '校园论坛', desc: '校园社区讨论', icon: 'ChatDotRound', path: '/forum' },
  ],
  leader: [
    { title: '数据驾驶舱', desc: '全校运行态势只读大屏', icon: 'DataAnalysis', path: '/dashboard' },
    { title: '公告中心', desc: '全校通知公告浏览', icon: 'Bell', path: '/af/notice' },
    { title: '校园论坛', desc: '校园社区讨论', icon: 'ChatDotRound', path: '/forum' },
  ],
  student: [
    { title: '课程选课', desc: '在线选课退课，名额实时', icon: 'Notebook', path: '/edu/elect' },
    { title: '成绩课表', desc: '成绩单与周课表', icon: 'Collection', path: '/edu/scores' },
    { title: '请销假', desc: '请假申请与销假闭环', icon: 'Clock', path: '/af/leave' },
    { title: '宿舍管理', desc: '我的宿舍、室友与报修', icon: 'House', path: '/dorm' },
    { title: '图书借阅', desc: '馆藏检索、借阅与到期提醒', icon: 'Reading', path: '/library' },
    { title: '社团活动', desc: '社团申请与活动报名', icon: 'Flag', path: '/club' },
    { title: '校园论坛', desc: '板块交流 · 二手交易集市', icon: 'ChatDotRound', path: '/forum' },
    { title: '失物招领', desc: '浏览失物信息与联系电话', icon: 'Search', path: '/lost-found' },
  ],
};

const modules = computed(() => {
  const base = BY_ROLE[auth.primaryRole] || BY_ROLE.student;
  const head = [];
  if (ai.chatOn) head.push(AI_CARD);
  if (ai.features.adminConsole && auth.hasRole(['admin'])) head.push(AI_CONSOLE_CARD);
  return [...head, ...base];
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
.wb-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}

/* 宽幅全景身份与信息面板 */
.wb-hero {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
  padding: 24px 28px;
  color: #fff;
  background: url('/web-pc.webp') center / cover no-repeat;
  box-shadow: 0 12px 32px rgba(10, 24, 46, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.wb-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, rgba(13, 28, 52, 0.92) 0%, rgba(23, 50, 92, 0.82) 55%, rgba(35, 74, 133, 0.72) 100%);
}
.wb-hero-main {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.wb-hero-profile {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
}
.wp-avatar {
  background: rgba(255, 255, 255, 0.18) !important;
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  border: 2px solid rgba(255, 255, 255, 0.45);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  flex: none;
}
.wp-user-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.wp-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.wp-title-row h2 {
  margin: 0;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #fff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.wp-role-badge {
  display: inline-block;
  font-size: 11.5px;
  letter-spacing: 0.5px;
  padding: 2px 10px;
  border-radius: 999px;
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(4px);
  white-space: nowrap;
}
.wp-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  padding: 3px 9px;
  backdrop-filter: blur(4px);
  white-space: nowrap;
}
.wp-chip .el-icon {
  font-size: 13px;
  opacity: 0.85;
}
.wp-time-chip {
  color: rgba(255, 255, 255, 0.75);
}

/* 顶栏右侧：校园邮箱微卡 */
.wb-hero-mail {
  flex: none;
  width: 290px;
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12);
}
.mail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mail-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.5px;
}
.mail-tag {
  background: rgba(255, 255, 255, 0.18) !important;
  color: #fff !important;
  border-color: rgba(255, 255, 255, 0.4) !important;
  font-size: 11px;
}
.mail-addr-row {
  min-width: 0;
}
.mail-addr-text {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}
.mail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.mail-btn-ghost {
  background: rgba(255, 255, 255, 0.14) !important;
  border-color: rgba(255, 255, 255, 0.35) !important;
  color: #fff !important;
}
.mail-btn-ghost:hover {
  background: rgba(255, 255, 255, 0.24) !important;
  border-color: #fff !important;
}
.mail-note-unauth {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.75);
}
.mail-note-empty {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
}
.mail-dlg-tip {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--zc-navy, #17325c);
  font-weight: 600;
}

/* 主功能矩阵 */
.wb-section {
  margin-top: 22px;
}
.wb-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.wb-section-title {
  margin: 0;
  font-size: 16.5px;
  font-weight: 700;
  color: var(--zc-navy);
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wb-section-badge {
  font-size: 12px;
  color: var(--zc-text-sub);
  background: rgba(23, 50, 92, 0.05);
  border: 1px solid rgba(23, 50, 92, 0.1);
  padding: 2px 10px;
  border-radius: 999px;
}
.wb-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.wb-card {
  position: relative;
  overflow: hidden;
  background: var(--zc-glass);
  backdrop-filter: blur(14px);
  border: 1px solid var(--zc-glass-border);
  border-radius: 14px;
  padding: 18px 16px;
  cursor: pointer;
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.22s ease, border-color 0.22s ease;
  box-shadow: 0 6px 20px rgba(15, 35, 66, 0.06);
}
.wb-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  height: 2.5px;
  width: 100%;
  background: linear-gradient(90deg, var(--zc-gold), rgba(200, 163, 95, 0.2));
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.3s ease;
}
.wb-card:hover {
  transform: translateY(-4px);
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(37, 99, 235, 0.25);
  box-shadow: 0 12px 30px rgba(15, 35, 66, 0.12);
}
.wb-card:hover::before {
  transform: scaleX(1);
}
.wb-card-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  font-size: 11px;
  color: var(--zc-text-sub);
  border: 1px solid var(--zc-border);
  border-radius: 999px;
  padding: 1px 7px;
  background: rgba(255, 255, 255, 0.65);
}
.wb-card.ready .wb-card-badge {
  color: var(--zc-navy);
  border-color: rgba(23, 50, 92, 0.22);
}
.wb-card.pending-card {
  filter: saturate(0.35);
  opacity: 0.82;
}
.wb-icon {
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: linear-gradient(135deg, #2d5a9e, var(--zc-navy));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  box-shadow: 0 5px 12px rgba(23, 50, 92, 0.18);
  transition: transform 0.2s ease;
}
.wb-card:hover .wb-icon {
  transform: scale(1.06);
}
.wb-card h4 {
  margin: 0 0 5px;
  font-size: 15px;
  font-weight: 600;
  color: var(--zc-navy);
}
.wb-card p {
  margin: 0;
  font-size: 12.5px;
  color: var(--zc-text-sub);
  line-height: 1.55;
}

/* 常用资源横向网格 */
.wb-resrow {
  margin-top: 24px;
}
.wb-resrow-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
}
.resx-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 15px;
  background: var(--zc-glass);
  backdrop-filter: blur(12px);
  border: 1px solid var(--zc-glass-border);
  border-radius: 12px;
  text-decoration: none;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  box-shadow: 0 4px 14px rgba(15, 35, 66, 0.05);
}
.resx-card:hover {
  transform: translateY(-2px);
  border-color: rgba(37, 99, 235, 0.3);
  box-shadow: 0 8px 22px rgba(23, 50, 92, 0.1);
  background: rgba(255, 255, 255, 0.95);
}
.resx-card .res-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-bottom: 4px;
}
.resx-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--zc-navy);
}
.resx-desc {
  font-size: 12px;
  color: var(--zc-text-sub);
  line-height: 1.5;
  padding-right: 18px;
}
.resx-card .res-go {
  position: absolute;
  right: 12px;
  top: 14px;
  color: var(--zc-text-sub);
  font-size: 13px;
  transition: transform 0.15s ease, color 0.15s ease;
}
.resx-card:hover .res-go {
  transform: translate(2px, -2px);
  color: var(--zc-navy);
}

/* 响应式调整 */
@media (max-width: 1120px) {
  .wb-grid { grid-template-columns: repeat(3, 1fr); }
  .wb-resrow-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 900px) {
  .wb-hero-main { flex-direction: column; align-items: stretch; }
  .wb-hero-mail { width: 100%; }
}
@media (max-width: 680px) {
  .wb-grid { grid-template-columns: repeat(2, 1fr); }
  .wb-resrow-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 480px) {
  .wb-grid { grid-template-columns: 1fr; }
  .wb-resrow-grid { grid-template-columns: 1fr; }
}
</style>
