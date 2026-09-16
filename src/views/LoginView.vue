<template>
  <div>
    <header class="zc-navbar">
      <div class="zc-container inner">
        <div class="zc-logo" @click="$router.push('/')">
          <el-icon :size="26"><Sunny /></el-icon>
          <span>智汇校园</span>
          <span class="sub">SMART CAMPUS</span>
        </div>
        <el-button text @click="$router.push('/')">返回首页</el-button>
      </div>
    </header>

    <div class="auth-wrap">
      <div class="auth-card">
        <h2>{{ mode === 'login' ? '欢迎回来' : '加入智汇校园' }}</h2>
        <p class="sub">{{ mode === 'login' ? '登录你的统一校园账号' : '注册即开通全部校园服务' }}</p>

        <el-tabs v-model="mode" stretch>
          <!-- 登录 -->
          <el-tab-pane label="登录" name="login">
            <el-form :model="loginForm" size="large" @submit.prevent>
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
                登 录
              </el-button>
            </el-form>
          </el-tab-pane>

          <!-- 注册 -->
          <el-tab-pane label="注册" name="register">
            <el-form :model="regForm" size="large" @submit.prevent>
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
          </el-tab-pane>
        </el-tabs>

        <p class="sub" style="margin: 18px 0 0">
          注册即代表同意《校园平台服务协议》· 默认开通学生角色
        </p>
      </div>
    </div>
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
</script>

<style scoped>
.w-full { width: 100%; }
:deep(.el-tabs__nav-wrap::after) { display: none; }
:deep(.el-tabs__active-bar) { height: 3px; border-radius: 2px; }
:deep(.el-form-item) { margin-bottom: 20px; }
</style>
