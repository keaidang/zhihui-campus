<template>
  <div class="gate-page">
    <!-- 抬头：校徽 + 书法校名 + 竖分隔线 + 认证标题（整体居中，参考统一身份认证截图） -->
    <header class="gate-header">
      <div class="gate-brand">
        <img class="gate-logo" src="/logo.webp" alt="清北大学校徽" />
        <img class="gate-name" src="/name.webp" alt="清北大学" />
      </div>
      <span class="gate-vline" aria-hidden="true"></span>
      <h1 class="gate-title">智汇校园 · 统一身份认证</h1>
    </header>

    <!-- 认证卡片 -->
    <main class="gate-main">
      <div class="gate-card">
        <img class="card-school-name" src="/name.webp" alt="清北大学" />
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
            />
          </el-form-item>
          <el-form-item>
            <el-input v-model="regForm.email" placeholder="邮箱（用于接收验证码）" :prefix-icon="Message" clearable>
              <template #append>
                <el-button :disabled="codeCooldown > 0 || sending" @click="sendCode">
                  {{ sending ? '发送中…' : codeCooldown > 0 ? `${codeCooldown}s 后重发` : '获取验证码' }}
                </el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item>
            <el-input v-model="regForm.code" placeholder="6 位邮箱验证码" :prefix-icon="Key" maxlength="6" @keyup.enter="doRegister" />
          </el-form-item>
          <el-form-item>
            <div class="prefix-row">
              <el-input v-model="regForm.prefix" placeholder="校园邮箱前缀（选填，如 20261004）" :prefix-icon="Promotion" clearable>
                <template #append>
                  <el-button :disabled="!regForm.prefix" @click="checkPrefix">{{ prefixAvailable === true ? '✓ 可用' : '检查可用' }}</el-button>
                </template>
              </el-input>
              <el-select v-model="regForm.domain" class="domain-select" size="large" @change="prefixAvailable = null; prefixHint = ''">
                <el-option v-for="d in domains" :key="d" :label="`@${d}`" :value="d" />
              </el-select>
            </div>
          </el-form-item>
          <p v-if="prefixHint" class="prefix-hint" :class="{ ok: prefixAvailable === true }">{{ prefixHint }}</p>
          <p class="mail-tip">验证码发送至上方邮箱，<b>若未收到请检查垃圾邮件 / 广告邮件</b>文件夹</p>
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
      清北大学 · 智汇校园一站式服务平台 © 2026 ·
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2026056678号</a>
      ·
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">鲁ICP备2025186072号</a>
    </footer>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock, Postcard, Message, Key, Promotion } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { api } from '../api/request';

const router = useRouter();
const auth = useAuthStore();

const mode = ref('login');
const loading = ref(false);
const loginForm = reactive({ username: '', password: '' });
const regForm = reactive({ realName: '', username: '', password: '', confirm: '', email: '', code: '', prefix: '', domain: 'keaidang.com' });
const sending = ref(false);
const codeCooldown = ref(0);
const prefixAvailable = ref(null);
const prefixHint = ref('');
let cooldownTimer = null;

// 校园邮箱可选后缀（邮件服务器实时返回，失败时回退默认）
const domains = ref(['keaidang.com']);
(async () => {
  try {
    const res = await api('/api/auth/register/domains', { auth: false });
    if (res.code === 0 && res.data.items?.length) {
      domains.value = res.data.items;
      if (!domains.value.includes(regForm.domain)) regForm.domain = domains.value[0];
    }
  } catch { /* 保持默认 */ }
})();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function sendCode() {
  if (!EMAIL_RE.test(regForm.email)) {
    ElMessage.warning('请先填写正确的邮箱地址');
    return;
  }
  sending.value = true;
  try {
    const res = await api('/api/auth/register/send-code', { method: 'POST', body: { email: regForm.email }, auth: false });
    if (res.code === 0) {
      ElMessage.success(res.message || '验证码已发送');
      codeCooldown.value = 60;
      cooldownTimer = setInterval(() => {
        codeCooldown.value--;
        if (codeCooldown.value <= 0) clearInterval(cooldownTimer);
      }, 1000);
    } else {
      ElMessage.error(res.message || '发送失败');
    }
  } finally {
    sending.value = false;
  }
}

async function checkPrefix() {
  const prefix = regForm.prefix.trim().toLowerCase();
  prefixHint.value = '';
  const res = await api(`/api/auth/register/prefix-check?prefix=${encodeURIComponent(prefix)}&domain=${encodeURIComponent(regForm.domain)}`, { auth: false });
  if (res.code === 0) {
    prefixAvailable.value = res.data.available;
    prefixHint.value = res.data.available ? `✓ ${prefix}@${regForm.domain} 可用` : res.data.reason || '该前缀不可用';
  } else {
    prefixAvailable.value = null;
    prefixHint.value = '检查失败，可稍后再试';
  }
}

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
      const redirect = router.currentRoute.value.query.redirect;
      router.push(typeof redirect === 'string' && redirect ? redirect : '/workbench');
    } else {
      ElMessage.error(res.message || '登录失败');
    }
  } finally {
    loading.value = false;
  }
}

async function doRegister() {
  const { realName, username, password, confirm, email, code, prefix, domain } = regForm;
  if (!realName || !username || !password) {
    ElMessage.warning('请完整填写注册信息');
    return;
  }
  if (password !== confirm) {
    ElMessage.warning('两次输入的密码不一致');
    return;
  }
  if (!EMAIL_RE.test(email)) {
    ElMessage.warning('请填写正确的邮箱地址');
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    ElMessage.warning('请输入 6 位邮箱验证码');
    return;
  }
  loading.value = true;
  try {
    const res = await auth.register({
      realName, username, password,
      email, code,
      prefix: prefix.trim().toLowerCase() || undefined,
      domain,
    });
    if (res.code === 0) {
      ElMessage.success(res.message || '注册成功，请登录');
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
.prefix-row { display: flex; gap: 8px; width: 100%; }
.prefix-row .el-input { flex: 1; min-width: 0; }
.domain-select { width: 158px; flex-shrink: 0; }
.domain-select :deep(.el-select__wrapper) { height: var(--el-component-size-large); }
.prefix-hint { margin: -8px 0 4px; font-size: 12px; color: #b45309; }
.prefix-hint.ok { color: #0d7a6c; }
.mail-tip { margin: -4px 0 10px; font-size: 12px; color: #64748b; line-height: 1.6; }
.mail-tip b { color: #b45309; }
</style>
