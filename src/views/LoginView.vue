<template>
  <div class="gate-page">
    <!-- 抬头：校名品牌 + 认证标题 -->
    <header class="gate-header zc-container">
      <div class="gate-brand">
        <img class="gate-logo" src="/logo.png" alt="清北大学校徽" />
        <img class="gate-name" src="/name.png" alt="清北大学" />
      </div>
      <h1 class="gate-title">智汇校园 · 统一身份认证</h1>
    </header>

    <!-- 认证卡片 -->
    <main class="gate-main">
      <div class="gate-card">
        <img class="card-school-name" src="/name.png" alt="清北大学" />
        <h2>{{ mode === 'login' ? '账号密码登录' : '注册统一账号' }}</h2>
        <div class="divider"></div>

        <!-- 登录 -->
        <el-form v-if="mode === 'login'" :model="loginForm" size="large" @submit.prevent>
          <el-form-item>
            <el-input v-model="loginForm.username" placeholder="用户名" :prefix-icon="User" clearable />
          </el-form-item>
          <el-form-item>
            <el-input
              v-model="loginForm.password"
              type="password"
              placeholder="密码"
              :prefix-icon="Lock"
              show-password
              @keyup.enter="doLogin"
            />
          </el-form-item>
          <el-button type="primary" class="w-full" size="large" :loading="loading" @click="doLogin">
            登录
          </el-button>
        </el-form>

        <!-- 注册 -->
        <el-form v-else :model="regForm" size="large" @submit.prevent>
          <el-form-item>
            <el-input v-model="regForm.realName" placeholder="姓名" :prefix-icon="Postcard" clearable />
          </el-form-item>
          <el-form-item>
            <el-input v-model="regForm.username" placeholder="用户名（字母开头，4~32 位）" :prefix-icon="User" clearable />
          </el-form-item>
          <el-form-item>
            <el-input
              v-model="regForm.password"
              type="password"
              placeholder="密码（至少 8 位）"
              :prefix-icon="Lock"
              show-password
            />
          </el-form-item>
          <el-form-item>
            <el-input
              v-model="regForm.confirm"
              type="password"
              placeholder="确认密码"
              :prefix-icon="Lock"
              show-password
              @keyup.enter="doRegister"
            />
          </el-form-item>
          <el-button type="primary" class="w-full" size="large" :loading="loading" @click="doRegister">
            注 册
          </el-button>
        </el-form>

        <div class="gate-links">
          <a v-if="mode === 'login'" @click="mode = 'register'">免费注册</a>
          <a v-else @click="mode = 'login'">返回登录</a>
          <span>|</span>
          <a @click="onForgot">忘记密码</a>
        </div>

        <p class="gate-tip">一个账号通行全部校园服务 · 默认开通学生角色</p>
      </div>
    </main>

    <footer class="gate-footer">
      智汇校园 · 一站式智慧校园服务平台 © 2026
    </footer>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock, Postcard } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const mode = ref('login');
const loading = ref(false);
const loginForm = reactive({ username: '', password: '' });
const regForm = reactive({ realName: '', username: '', password: '', confirm: '' });

async function doLogin() {
  if (!loginForm.username || !loginForm.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    const res = await auth.login(loginForm.username, loginForm.password);
    if (res.code === 0) {
      ElMessage.success(`欢迎回来，${res.data.user.realName || res.data.user.username}！`);
      router.push('/');
    } else {
      ElMessage.error(res.message || '登录失败');
    }
  } finally {
    loading.value = false;
  }
}

async function doRegister() {
  const { realName, username, password, confirm } = regForm;
  if (!realName || !username || !password) {
    ElMessage.warning('请完整填写注册信息');
    return;
  }
  if (password !== confirm) {
    ElMessage.warning('两次输入的密码不一致');
    return;
  }
  loading.value = true;
  try {
    const res = await auth.register({ realName, username, password });
    if (res.code === 0) {
      ElMessage.success('注册成功，请登录');
      mode.value = 'login';
      loginForm.username = username;
      loginForm.password = '';
    } else {
      ElMessage.error(res.message || '注册失败');
    }
  } finally {
    loading.value = false;
  }
}

function onForgot() {
  ElMessage.info('请联系管理员重置密码');
}
</script>

<style scoped>
.w-full { width: 100%; }
</style>
