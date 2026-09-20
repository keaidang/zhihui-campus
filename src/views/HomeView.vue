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

    <!-- Hero：校园实景 + 深蓝渐变压暗 + 白字（高校门户通行做法） -->
    <section class="zc-hero">
      <div class="zc-container hero-inner">
        <img class="school-name-img hero-school-name" src="/name.webp" alt="清北大学" />
        <h1>一站式智慧校园服务平台</h1>
        <p>
          学习、生活、社交，一个入口全部搞定。
          智汇校园把选课、成绩、课表、请假、报修、图书、
          二手、失物招领、社团与运动装进同一个平台，
          让校园生活更简单、更高效、更有温度。
        </p>
        <div class="actions">
          <el-button v-if="!auth.isLoggedIn" type="primary" size="large" round @click="$router.push('/login')">
            立即开始
          </el-button>
          <el-button v-else type="primary" size="large" round @click="$router.push('/workbench')">
            进入工作台
          </el-button>
          <el-button size="large" round class="ghost-btn" @click="scrollToModules">浏览全部服务</el-button>
        </div>
      </div>
    </section>

    <!-- 模块矩阵 -->
    <section ref="modulesRef" class="zc-container">
      <h2 class="zc-section-title">校园服务 · 全都在这里</h2>
      <p class="zc-section-sub">统一账号登录，模块持续上新</p>
      <div class="zc-grid">
        <div v-for="m in modules" :key="m.title" class="zc-card" :class="{ pending: !m.ready }" @click="onModule(m)">
          <span v-if="!m.ready" class="badge">即将上线</span>
          <div class="icon-wrap">
            <el-icon :size="26"><component :is="m.icon" /></el-icon>
          </div>
          <h3>{{ m.title }}<el-icon class="go"><ArrowRight /></el-icon></h3>
          <p>{{ m.desc }}</p>
        </div>
      </div>
    </section>

    <footer class="site-footer">
      清北大学 · 智汇校园一站式服务平台 © 2026 ·
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2026056678号</a>
      ·
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">鲁ICP备2025186072号</a>
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowRight } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const modulesRef = ref(null);

const modules = [
  { title: '课程选课', desc: '在线选课、退改选，名额实时可见', icon: 'Notebook', ready: true, path: '/edu/elect', roles: ['student'] },
  { title: '成绩课表', desc: '成绩查询、周课表，学业一目了然', icon: 'Reading', ready: true, path: '/edu/scores', roles: ['student'] },
  { title: '请销假', desc: '在线请假、辅导员审批、销假闭环', icon: 'Clock', ready: true, path: '/af/leave', roles: ['student'] },
  { title: '校园邮箱', desc: '专属 @keaidang.com 邮箱，收发外部邮件', icon: 'Promotion', ready: true, path: '/mail' },
  { title: '宿舍生活', desc: '宿舍报修、进度跟踪，后勤快响应', icon: 'House', ready: true, path: '/af/repair', roles: ['student'] },
  { title: '图书借阅', desc: '馆藏检索、借阅续借、到期提醒', icon: 'Collection', ready: false },
  { title: '二手集市', desc: '闲置好物流通，校园内放心交易', icon: 'ShoppingCart', ready: false },
  { title: '失物招领', desc: '拾金不昧有去处，失物快速找回', icon: 'Search', ready: false },
  { title: '社团活动', desc: '社团风采、活动报名、精彩回顾', icon: 'Flag', ready: false },
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
