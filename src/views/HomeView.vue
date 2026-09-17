<template>
  <div>
    <!-- 顶栏 -->
    <header class="zc-navbar">
      <div class="zc-container inner">
        <div class="zc-logo" @click="$router.push('/')">
          <img class="brand-logo" src="/logo.png" alt="清北大学校徽" />
          <img class="brand-name" src="/name.png" alt="清北大学" />
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
                  <el-dropdown-item command="logout">退出登录</el-dropdown-item>
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

    <!-- Hero -->
    <section class="zc-hero zc-container">
      <img class="school-name-img" src="/name.png" alt="清北大学" />
      <h1>一站式智慧校园服务平台</h1>
      <p>
        学习、生活、社交，一个入口全部搞定。
        智汇校园把选课、图书、宿舍、点餐、二手、失物招领、社团与运动装进同一个平台，
        让校园生活更简单、更高效、更有温度。
      </p>
      <div class="actions">
        <el-button v-if="!auth.isLoggedIn" type="primary" size="large" round @click="$router.push('/login')">
          立即开始
        </el-button>
        <el-button size="large" round @click="scrollToModules">浏览全部服务</el-button>
      </div>
    </section>

    <!-- 模块矩阵 -->
    <section ref="modulesRef" class="zc-container">
      <h2 class="zc-section-title">校园服务 · 全都在这里</h2>
      <p class="zc-section-sub">统一账号登录，模块持续上新</p>
      <div class="zc-grid">
        <div v-for="m in modules" :key="m.title" class="zc-card" @click="onModule(m)">
          <span v-if="!m.ready" class="badge">即将上线</span>
          <div class="icon-wrap" :class="m.iconClass">
            <el-icon :size="26"><component :is="m.icon" /></el-icon>
          </div>
          <h3>{{ m.title }}</h3>
          <p>{{ m.desc }}</p>
        </div>
      </div>
    </section>

    <footer class="site-footer">
      清北大学 · 智汇校园一站式服务平台 © 2026 ·
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2026056678号</a>
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const modulesRef = ref(null);

const modules = [
  { title: '课程选课', desc: '在线选课、退改选，名额实时可见', icon: 'Notebook', iconClass: 'icon-1', ready: false },
  { title: '图书借阅', desc: '馆藏检索、借阅续借、到期提醒', icon: 'Reading', iconClass: 'icon-2', ready: false },
  { title: '宿舍生活', desc: '宿舍报修、水电查询、调宿申请', icon: 'House', iconClass: 'icon-3', ready: false },
  { title: '校园点餐', desc: '食堂菜单、在线下单、取餐叫号', icon: 'Food', iconClass: 'icon-4', ready: false },
  { title: '二手集市', desc: '闲置好物流通，校园内放心交易', icon: 'ShoppingCart', iconClass: 'icon-5', ready: false },
  { title: '失物招领', desc: '拾金不昧有去处，失物快速找回', icon: 'Search', iconClass: 'icon-6', ready: false },
  { title: '社团活动', desc: '社团风采、活动报名、精彩回顾', icon: 'Flag', iconClass: 'icon-7', ready: false },
  { title: '运动打卡', desc: '跑步打卡、连续天数、活力排行', icon: 'TrophyBase', iconClass: 'icon-8', ready: false },
];

function onModule(m) {
  if (m.ready) return;
  ElMessage.info(`「${m.title}」模块即将上线，敬请期待`);
}

function scrollToModules() {
  modulesRef.value?.scrollIntoView({ behavior: 'smooth' });
}

async function onCommand(cmd) {
  if (cmd === 'logout') {
    await auth.logout();
    ElMessage.success('已退出登录');
  }
}
</script>
