<template>
  <div>
    <!-- 顶栏 -->
    <header class="zc-navbar">
      <div class="zc-container inner">
        <div class="zc-logo" @click="$router.push('/')">
          <img class="brand-logo" src="/logo.webp" alt="清北大学校徽" />
          <img class="brand-name" src="/name.webp" alt="清北大学" />
        </div>

        <div class="navbar-center">
          <div class="sem-pill">
            <span class="sem-dot"></span>
            <span>2025-2026学年 · 第二学期</span>
          </div>
          <nav class="nav-links">
            <a class="nav-link" href="#ai-section" @click.prevent="scrollToAi">AI 融合中枢</a>
            <a class="nav-link" href="#modules-section" @click.prevent="scrollToModules">服务大厅</a>
          </nav>
        </div>

        <div>
          <template v-if="auth.isLoggedIn">
            <el-dropdown @command="onCommand">
              <div class="user-capsule">
                <el-avatar :size="28" style="background: var(--zc-primary)">
                  {{ auth.user?.realName?.charAt(0) || 'U' }}
                </el-avatar>
                <span class="user-name">{{ auth.user?.realName || auth.user?.username }}</span>
                <span class="user-role-badge">{{ roleLabel }}</span>
              </div>
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

    <!-- Hero：左文案 + 右 macOS 旗舰视窗悬浮预览 -->
    <section class="zc-hero">
      <div class="zc-container hero-inner">
        <div class="hero-copy">
          <div class="hero-badge">
            <span class="badge-pulse"></span>
            <span class="badge-text">2026 数智融合 · 清北大学一站式数字底座</span>
          </div>
          <img class="school-name-img hero-school-name" src="/name.webp" alt="清北大学" />
          <h1>一站式智慧校园服务平台</h1>
          <p>
            一个账号打通选课、课表、成绩、审批、宿舍、图书、失物与论坛；
            并以<b>多模态大模型能力</b>贯穿问答、分诊、审核与自由问数 —— AI 深度植入每个业务环节。
          </p>
          <div class="actions">
            <el-button
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

          <div class="hero-quick-bar">
            <span class="quick-label">热门直达：</span>
            <button type="button" class="quick-pill" @click="onModule(modules[0])">
              <el-icon :size="12"><Notebook /></el-icon> 选课
            </button>
            <button type="button" class="quick-pill" @click="onModule(modules[1])">
              <el-icon :size="12"><Reading /></el-icon> 课表成绩
            </button>
            <button type="button" class="quick-pill" @click="onModule(modules[3])">
              <el-icon :size="12"><Promotion /></el-icon> 邮箱
            </button>
            <button type="button" class="quick-pill" @click="onModule(modules[5])">
              <el-icon :size="12"><Collection /></el-icon> 图书
            </button>
            <button type="button" class="quick-pill" @click="onModule(modules[8])">
              <el-icon :size="12"><ChatDotRound /></el-icon> 论坛
            </button>
          </div>
        </div>

        <div class="hero-window">
          <div class="window-chrome">
            <div class="window-dots">
              <span class="w-dot dot-red"></span>
              <span class="w-dot dot-yellow"></span>
              <span class="w-dot dot-green"></span>
            </div>
            <div class="window-url">
              <el-icon :size="11"><Lock /></el-icon>
              <span>campus.pku.edu.cn/workbench</span>
            </div>
            <div class="window-live-badge">
              <span class="live-dot"></span>
              <span>系统在线</span>
            </div>
          </div>
          <div class="window-screen">
            <img src="/home-app.jpg" alt="智汇校园工作台界面" />
            <div class="window-floating-card">
              <div class="fl-icon">
                <el-icon :size="16"><MagicStick /></el-icon>
              </div>
              <div class="fl-info">
                <div class="fl-title">AI 中枢全域协同就绪</div>
                <div class="fl-sub">知识库流式输出 · 白名单严格受控</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 数据带：悬浮流光毛玻璃卡片 -->
    <section class="zc-container">
      <div class="zc-stats">
        <div class="zc-stat-card highlight">
          <div class="stat-head">
            <span class="stat-val">{{ aiTotal }}</span>
            <span class="stat-unit">项</span>
          </div>
          <div class="stat-label">AI 深度融合</div>
          <p class="stat-desc">涵盖问答、分诊、审核与问数</p>
        </div>
        <div class="zc-stat-card">
          <div class="stat-head">
            <span class="stat-val">{{ modules.length }}</span>
            <span class="stat-unit">大</span>
          </div>
          <div class="stat-label">一站服务模块</div>
          <p class="stat-desc">打通教务学工与校园生活全闭环</p>
        </div>
        <div class="zc-stat-card">
          <div class="stat-head">
            <span class="stat-val">400</span>
            <span class="stat-unit">+</span>
          </div>
          <div class="stat-label">活跃师生覆盖</div>
          <p class="stat-desc">多角色全流程在线协同与承载</p>
        </div>
        <div class="zc-stat-card">
          <div class="stat-head">
            <span class="stat-val">5</span>
            <span class="stat-unit">级</span>
          </div>
          <div class="stat-label">细粒度角色权限</div>
          <p class="stat-desc">基于 RBAC 的安全分级访问控制</p>
        </div>
      </div>
    </section>

    <!-- AI 能力板块：本年度毕业设计主题是"AI 技术融合"，因此在服务列表之前先讲 AI -->
    <section ref="aiRef" class="zc-container zc-ai-section">
      <div class="zc-section-header">
        <div class="zc-section-pill">
          <el-icon><MagicStick /></el-icon>
          <span>数智融合 · 核心场景</span>
        </div>
        <h2 class="zc-section-title">AI 能力 · 长在每个业务环节里</h2>
        <p class="zc-section-sub">模型只做"理解与判断"，权限校验与数据操作仍由服务端严格按白名单执行</p>
      </div>

      <div class="zc-ai-grid">
        <div v-for="a in aiFeatures" :key="a.title" class="zc-ai-card" @click="onAiCard(a)">
          <div class="ai-card-top">
            <div class="ai-icon"><el-icon :size="20"><component :is="a.icon" /></el-icon></div>
            <span class="ai-card-tag">{{ a.tag }}</span>
          </div>
          <h3>{{ a.title }}</h3>
          <p>{{ a.desc }}</p>
          <div class="ai-card-footer">
            <span>在 AI 助手体验</span>
            <el-icon :size="12"><ArrowRight /></el-icon>
          </div>
        </div>
      </div>

      <div class="zc-ai-cta">
        <el-button type="primary" size="large" round :icon="MagicStick" class="ai-cta" @click="goAi">
          立即体验 AI 校园助手
        </el-button>
        <span class="zc-ai-note">
          共 {{ aiTotal }} 项能力（上方为 {{ aiFeatures.length }} 项代表） · 问答 / 分诊 / 审核 / 问数四类已完成效果评估（{{ evalCases }} 条人工标注用例）
        </span>
      </div>
    </section>

    <!-- 模块矩阵：3 列 9 个模块正好 3×3 排满 -->
    <section ref="modulesRef" class="zc-container">
      <div class="zc-section-header">
        <div class="zc-section-pill">
          <span>🏛️ 协同中台 · 服务大厅</span>
        </div>
        <h2 class="zc-section-title">校园全景服务 · 全都在这里</h2>
        <p class="zc-section-sub">统一账号登录，模块持续上新</p>
      </div>

      <div class="zc-grid">
        <div v-for="m in modules" :key="m.title" class="zc-card" :class="{ pending: !m.ready }" @click="onModule(m)">
          <span v-if="!m.ready" class="badge">即将上线</span>
          <div class="icon-wrap" :class="m.colorClass">
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
import { computed, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  ArrowRight,
  ChatDotRound,
  Collection,
  Lock,
  MagicStick,
  Notebook,
  Promotion,
  Reading,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const modulesRef = ref(null);
const aiRef = ref(null);

// 边缘访问统计：KV 计数在边缘节点毫秒级完成，不回源、不碰数据库（云边协同样板，fire-and-forget）
onMounted(() => { fetch('/api/edge/stats').catch(() => {}); });

const roleLabel = computed(() => {
  const r = auth.user?.role;
  const map = {
    student: '学生',
    teacher: '教师',
    counselor: '辅导员',
    admin: '系统管理员',
    leader: '校领导',
  };
  return map[r] || '校内成员';
});

/**
 * AI 能力展示（首页用）。
 * 只列**真实存在**的能力，措辞与 docs/AI-FEATURES.md 的能力清单一一对应。
 */
const aiFeatures = [
  {
    title: '校园智能问答',
    tag: '知识库流式检索',
    desc: '基于校园知识库回答选课、请假、报修等流程问题，逐字流式输出并标注出处；答不出来会如实说明而不是编造',
    icon: 'ChatDotRound',
  },
  {
    title: '对话式系统管理',
    tag: '二阶段安全确认',
    desc: '管理员说一句"禁用账号 xxx"，系统先列出影响清单，确认之后才真正执行',
    icon: 'MagicStick',
  },
  {
    title: '信息问数与自由统计',
    tag: '结构化 Text-to-Query',
    desc: '「这周哪个班请假最多」出统计表；「账号总数」「各院系人数排名」「绩点最差的学生」也能直接问 —— 模型只产出结构化查询条件，全程不接触 SQL',
    icon: 'DataAnalysis',
  },
  {
    title: '学业助手',
    tag: '只读隐私保护',
    desc: '只读本人成绩与课表，回答还差多少学分、哪些课不及格、绩点是多少',
    icon: 'Reading',
  },
  {
    title: '审核与分诊',
    tag: '智能风控与定级',
    desc: '论坛帖子自动判定违规内容；报修提交后自动判定责任部门与紧急程度',
    icon: 'SetUp',
  },
  {
    title: '数据异常监测',
    tag: '规则扫描+智能归纳',
    desc: '规则扫描请假集中、成绩未录等问题，再由 AI 归纳成一段人话邮件提醒管理员',
    icon: 'Bell',
  },
];

/** AI 能力总数（C1~C13）；首页只列 6 项代表，故用常量而不是卡片数推算 */
const aiTotal = 13;
/** 评估用例数（与 scripts/seed-ai-eval.mjs 的 42 条一致；写在页面上的数字必须真实可查） */
const evalCases = 42;

const modules = [
  { title: '课程选课', desc: '在线选课、退改选，名额实时可见', icon: 'Notebook', colorClass: 'icon-edu', ready: true, path: '/edu/elect', roles: ['student'] },
  { title: '成绩课表', desc: '成绩查询、周课表，学业一目了然', icon: 'Reading', colorClass: 'icon-scores', ready: true, path: '/edu/scores', roles: ['student'] },
  { title: '请销假', desc: '在线请假、辅导员审批、销假闭环', icon: 'Clock', colorClass: 'icon-leave', ready: true, path: '/af/leave', roles: ['student'] },
  { title: '校园邮箱', desc: '专属校园邮箱，可收发外部邮件', icon: 'Promotion', colorClass: 'icon-mail', ready: true, path: '/mail' },
  { title: '宿舍管理', desc: '我的宿舍、室友一览、在线报修', icon: 'House', colorClass: 'icon-dorm', ready: true, path: '/dorm' },
  { title: '图书借阅', desc: '馆藏检索、借阅续借、到期提醒', icon: 'Collection', colorClass: 'icon-lib', ready: true, path: '/library' },
  { title: '失物招领', desc: '拾金不昧有去处，失物快速找回', icon: 'Search', colorClass: 'icon-lost', ready: true, path: '/lost-found' },
  { title: '社团活动', desc: '社团申请、招募预约，精彩校园', icon: 'Flag', colorClass: 'icon-club', ready: true, path: '/club' },
  { title: '校园论坛', desc: '六大板块交流分享，交易有保障', icon: 'ChatDotRound', colorClass: 'icon-forum', ready: true, path: '/forum' },
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

function onAiCard() {
  goAi();
}

function scrollToModules() {
  modulesRef.value?.scrollIntoView({ behavior: 'smooth' });
}

function scrollToAi() {
  aiRef.value?.scrollIntoView({ behavior: 'smooth' });
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
