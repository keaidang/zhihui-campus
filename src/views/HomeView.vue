<template>
  <div>
    <!-- 顶栏 -->
    <header class="zc-navbar">
      <div class="zc-container inner">
        <div class="zc-logo" @click="$router.push('/')">
          <img class="brand-logo" src="/logo.webp" alt="清北大学校徽" />
          <img class="brand-name" src="/name.webp" alt="清北大学" />
        </div>
        <div>
          <template v-if="auth.isLoggedIn">
            <el-dropdown @command="onCommand">
              <span style="cursor: pointer; display: flex; align-items: center; gap: 8px">
                <el-avatar :size="32" style="background: var(--zc-primary)">
                  {{ auth.user?.realName?.charAt(0) || 'U' }}
                </el-avatar>
                <span>{{ auth.user?.realName || auth.user?.username }}</span>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="workbench">进入工作台</el-dropdown-item>
                  <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <template v-else>
            <el-button type="primary" round @click="$router.push('/login')">登录 / 注册</el-button>
          </template>
        </div>
      </div>
    </header>

    <!-- Hero：左文案 + 右真实界面预览（双栏；首屏就能看到平台长什么样） -->
    <section class="zc-hero">
      <div class="zc-container hero-inner">
        <div class="hero-copy">
          <img class="school-name-img hero-school-name" src="/name.webp" alt="清北大学" />
          <h1>一站式智慧校园服务平台</h1>
          <p>
            一个账号打通选课、成绩、课表、请销假、宿舍、图书、失物招领、社团与论坛；
            并以<b>大模型能力</b>贯穿问答、审批、运维与决策 —— AI 不是外挂的聊天框，
            它长在每一个业务环节里。
          </p>
          <div class="actions">
            <el-button
              v-if="!auth.isLoggedIn"
              type="primary"
              size="large"
              round
              :icon="MagicStick"
              class="ai-cta"
              @click="goAi"
            >
              AI 校园助手
            </el-button>
            <el-button
              v-else
              type="primary"
              size="large"
              round
              :icon="MagicStick"
              class="ai-cta"
              @click="goAi"
            >
              AI 校园助手
            </el-button>
            <el-button v-if="auth.isLoggedIn" size="large" round class="ghost-btn" @click="$router.push('/workbench')">
              进入工作台
            </el-button>
            <el-button v-else size="large" round class="ghost-btn" @click="$router.push('/login')">
              登录 / 注册
            </el-button>
            <el-button link class="more-link" @click="scrollToModules">浏览全部服务 ↓</el-button>
          </div>
        </div>
        <div class="hero-preview">
          <img src="/home-app.jpg" alt="智汇校园工作台界面" />
        </div>
      </div>
    </section>

    <!-- 数据带：用真实规模数字替代空泛形容词 -->
    <section class="zc-container">
      <div class="zc-stats">
        <div class="stat highlight"><b>{{ aiTotal }}<i>项</i></b><span>AI 能力</span></div>
        <div class="stat"><b>{{ modules.length }}</b><span>服务模块</span></div>
        <div class="stat"><b>400<i>+</i></b><span>在校学生</span></div>
        <div class="stat"><b>5</b><span>角色权限</span></div>
      </div>
    </section>

    <!-- AI 能力板块：本年度毕业设计主题是"AI 技术融合"，因此在服务列表之前先讲 AI -->
    <section class="zc-container zc-ai-section">
      <h2 class="zc-section-title">AI 能力 · 长在每个业务环节里</h2>
      <p class="zc-section-sub">模型只做"理解与判断"，权限校验与数据操作仍由服务端按白名单执行</p>
      <div class="zc-ai-grid">
        <div v-for="a in aiFeatures" :key="a.title" class="zc-ai-card">
          <div class="ai-icon"><el-icon :size="20"><component :is="a.icon" /></el-icon></div>
          <h3>{{ a.title }}</h3>
          <p>{{ a.desc }}</p>
        </div>
      </div>
      <div class="zc-ai-cta">
        <el-button type="primary" size="large" round :icon="MagicStick" class="ai-cta" @click="goAi">
          立即体验 AI 助手
        </el-button>
        <span class="zc-ai-note">
          问答 / 分诊 / 审核 / 问数四类能力已完成效果评估（{{ evalCases }} 条人工标注用例）
        </span>
      </div>
    </section>

    <!-- 模块矩阵：改 3 列后 9 个模块正好 3×3 排满（原 4 列会剩最后一行孤零零 1 个） -->
    <section ref="modulesRef" class="zc-container">
      <h2 class="zc-section-title">校园服务 · 全都在这里</h2>
      <p class="zc-section-sub">统一账号登录，模块持续上新</p>
      <div class="zc-grid">
        <div v-for="m in modules" :key="m.title" class="zc-card" :class="{ pending: !m.ready }" @click="onModule(m)">
          <span v-if="!m.ready" class="badge">即将上线</span>
          <div class="icon-wrap">
            <el-icon :size="24"><component :is="m.icon" /></el-icon>
          </div>
          <div class="card-body">
            <h3>{{ m.title }}</h3>
            <p>{{ m.desc }}</p>
          </div>
          <el-icon class="go"><ArrowRight /></el-icon>
        </div>
      </div>
    </section>

    <footer class="site-footer"><span class="ft-main">清北大学 · 智汇校园一站式服务平台 © 2026</span><span class="ft-sep"> · </span><a class="ft-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2026056678号</a><span class="ft-sep"> · </span><a class="ft-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">鲁ICP备2025186072号</a></footer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowRight, MagicStick } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const modulesRef = ref(null);

// 边缘访问统计：KV 计数在边缘节点毫秒级完成，不回源、不碰数据库（云边协同样板，fire-and-forget）
onMounted(() => { fetch('/api/edge/stats').catch(() => {}); });

/**
 * AI 能力展示（首页用）。
 * 只列**真实存在**的能力，措辞与 docs/AI-FEATURES.md 的能力清单一一对应 ——
 * 首页是对外承诺，写了却没实现是最糟糕的情况。
 */
const aiFeatures = [
  {
    title: '校园智能问答',
    desc: '基于校园知识库回答选课、请假、报修等流程问题，答不出来会如实说明而不是编造',
    icon: 'ChatDotRound',
  },
  {
    title: '对话式系统管理',
    desc: '管理员说一句"禁用账号 xxx"，系统先列出影响清单，确认之后才真正执行',
    icon: 'MagicStick',
  },
  {
    title: '信息问数',
    desc: '「这周哪个班请假最多」直接出统计表；模型只负责选模板，全程不接触 SQL',
    icon: 'DataAnalysis',
  },
  {
    title: '学业助手',
    desc: '只读本人成绩与课表，回答还差多少学分、哪些课不及格、绩点是多少',
    icon: 'Reading',
  },
  {
    title: '审核与分诊',
    desc: '论坛帖子自动判定违规内容；报修提交后自动判定责任部门与紧急程度',
    icon: 'SetUp',
  },
  {
    title: '数据异常监测',
    desc: '规则扫描请假集中、成绩未录等问题，再由 AI 归纳成一段人话邮件提醒管理员',
    icon: 'Bell',
  },
];

/** AI 能力总数（C1~C12）；首页只列 6 项代表，故用常量而不是卡片数推算 */
const aiTotal = 12;
/** 评估用例数（与 scripts/seed-ai-eval.mjs 的 42 条一致；写在页面上的数字必须真实可查） */
const evalCases = 42;

const modules = [
  { title: '课程选课', desc: '在线选课、退改选，名额实时可见', icon: 'Notebook', ready: true, path: '/edu/elect', roles: ['student'] },
  { title: '成绩课表', desc: '成绩查询、周课表，学业一目了然', icon: 'Reading', ready: true, path: '/edu/scores', roles: ['student'] },
  { title: '请销假', desc: '在线请假、辅导员审批、销假闭环', icon: 'Clock', ready: true, path: '/af/leave', roles: ['student'] },
  { title: '校园邮箱', desc: '专属校园邮箱，可收发外部邮件', icon: 'Promotion', ready: true, path: '/mail' },
  { title: '宿舍管理', desc: '我的宿舍、室友一览、在线报修', icon: 'House', ready: true, path: '/dorm' },
  { title: '图书借阅', desc: '馆藏检索、借阅续借、到期提醒', icon: 'Collection', ready: true, path: '/library' },
  { title: '失物招领', desc: '拾金不昧有去处，失物快速找回', icon: 'Search', ready: true, path: '/lost-found' },
  { title: '社团活动', desc: '社团申请、招募预约，精彩校园', icon: 'Flag', ready: true, path: '/club' },
  { title: '校园论坛', desc: '六大板块交流分享，交易有保障', icon: 'ChatDotRound', ready: true, path: '/forum' },
];

/**
 * SSO 联动：已登录 → 直接进入对应服务；未登录 → 去登录页并记住目标，
 * 登录成功后原路跳回（LoginView 读取 redirect 参数）。
 * 面向学生的服务入口对教师/辅导员等角色自动改为进入工作台。
 */
async function onModule(m) {
  if (!m.ready || !m.path) {
    ElMessage.info(`「${m.title}」模块即将上线，敬请期待`);
    return;
  }
  if (!auth.isLoggedIn) {
    router.push({ name: 'login', query: { redirect: m.path } });
    return;
  }
  if (!auth.user) {
    await auth.fetchMe().catch(() => {});
  }
  if (m.roles && !auth.hasRole(m.roles)) {
    // 教职工点学生服务入口：带去与自己权限匹配的工作台
    ElMessage.info(`「${m.title}」面向学生开放，已为你进入工作台`);
    router.push('/workbench');
    return;
  }
  router.push(m.path);
}

/** 去 AI 助手：未登录先登录，登录后原路跳回（复用 onModule 的 SSO 联动口径） */
function goAi() {
  if (!auth.isLoggedIn) {
    router.push({ name: 'login', query: { redirect: '/ai' } });
    return;
  }
  router.push('/ai');
}

function scrollToModules() {
  modulesRef.value?.scrollIntoView({ behavior: 'smooth' });
}

async function onCommand(cmd) {
  if (cmd === 'logout') {
    await auth.logout();
    ElMessage.success('已退出登录');
  } else if (cmd === 'workbench') {
    router.push('/workbench');
  }
}
</script>
