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
            <div class="field-row mail-row">
              <el-input v-model="regForm.email" placeholder="邮箱（接收验证码）" :prefix-icon="Message" clearable />
              <el-button class="side-btn" :disabled="codeCooldown > 0 || sending" @click="sendCode">
                {{ sending ? '发送中…' : codeCooldown > 0 ? `${codeCooldown}s 重发` : '获取验证码' }}
              </el-button>
            </div>
          </el-form-item>
          <el-form-item>
            <el-input v-model="regForm.code" placeholder="6 位邮箱验证码" :prefix-icon="Key" maxlength="6" @keyup.enter="doRegister" />
          </el-form-item>
          <p class="mail-tip">验证码发送至上方邮箱，<b>若未收到请检查垃圾邮件 / 广告邮件</b>文件夹</p>
          <el-form-item>
            <div class="field-row">
              <el-input v-model="regForm.prefix" placeholder="校园邮箱前缀" :prefix-icon="Promotion" clearable @keyup.enter="checkPrefix" />
              <el-select v-model="regForm.domain" class="domain-select" @change="resetPrefixHint">
                <el-option v-for="d in domains" :key="d" :label="`@${d}`" :value="d" />
              </el-select>
            </div>
          </el-form-item>
          <div class="prefix-meta">
            <span class="prefix-hint" :class="prefixState">{{ prefixHint }}</span>
            <a v-if="prefixState !== 'checking'" class="prefix-check" :class="{ dim: !regForm.prefix.trim() }" @click="checkPrefix">
              {{ prefixAvailable === null ? '检查可用性' : '重新检查' }}
            </a>
          </div>
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

    <!-- 忘记密码对话框 -->
    <el-dialog v-model="forgotDlg" title="找回密码" width="420px">
      <template v-if="forgotStep === 1">
        <p class="forgot-tip">输入账号与注册时绑定的邮箱，验证码将发送至该邮箱</p>
        <el-input v-model="forgotForm.username" placeholder="账号（用户名）" style="margin-bottom: 12px" />
        <el-input v-model="forgotForm.email" placeholder="绑定邮箱（注册时验证的邮箱）" />
      </template>
      <template v-else>
        <p class="forgot-tip">验证码已发送至 {{ forgotForm.email }}（10 分钟内有效，未收到请查垃圾邮件）</p>
        <el-input v-model="forgotForm.code" placeholder="6 位邮箱验证码" maxlength="6" style="margin-bottom: 12px">
          <template #append>
            <el-button :disabled="forgotCooldown > 0 || forgotSending" @click="sendForgotCode">
              {{ forgotCooldown > 0 ? `${forgotCooldown}s 后重发` : '重新发送' }}
            </el-button>
          </template>
        </el-input>
        <el-input v-model="forgotForm.newPassword" type="password" show-password placeholder="新密码（至少 8 位）" style="margin-bottom: 12px" />
        <el-input v-model="forgotForm.confirm" type="password" show-password placeholder="确认新密码" @keyup.enter="doForgotReset" />
      </template>
      <template #footer>
        <el-button @click="forgotDlg = false">取消</el-button>
        <el-button v-if="forgotStep === 1" type="primary" :loading="forgotSending" @click="sendForgotCode">发送验证码</el-button>
        <el-button v-else type="primary" :loading="forgotResetting" @click="doForgotReset">重置密码</el-button>
      </template>
    </el-dialog>

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
const prefixState = ref('idle'); // idle | checking | ok | bad
const PREFIX_RULE = '校园邮箱前缀选填 · 3~30 位小写字母 / 数字 / . _ -，须以字母或数字开头';
const PREFIX_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const prefixHint = ref(PREFIX_RULE);
let cooldownTimer = null;
let prefixSeq = 0;

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

function resetPrefixHint() {
  prefixAvailable.value = null;
  prefixState.value = 'idle';
  prefixHint.value = PREFIX_RULE;
}

// 前缀可用性：显式点"检查可用性"触发（后端需查邮件服务器，约 4~10s，故不做逐字自动校验）
async function checkPrefix() {
  const prefix = regForm.prefix.trim().toLowerCase();
  if (!prefix) {
    resetPrefixHint();
    return;
  }
  if (!PREFIX_RE.test(prefix)) {
    prefixAvailable.value = false;
    prefixState.value = 'bad';
    prefixHint.value = '前缀格式不正确：需 3~30 位小写字母 / 数字 / . _ -，且以字母或数字开头';
    return;
  }
  const seq = ++prefixSeq;
  prefixState.value = 'checking';
  prefixHint.value = '正在检查前缀可用性，请稍候…（不检查也可直接注册）';
  // 后端最慢可能等邮件服务器约 20s，前端 14s 兜底，避免一直停在"检查中"
  const guard = setTimeout(() => {
    if (seq === prefixSeq && prefixState.value === 'checking') {
      prefixState.value = 'bad';
      prefixHint.value = '检查超时，可稍后重试（不影响注册，注册时仍会校验一次）';
    }
  }, 14000);
  try {
    const res = await api(`/api/auth/register/prefix-check?prefix=${encodeURIComponent(prefix)}&domain=${encodeURIComponent(regForm.domain)}`, { auth: false });
    if (seq !== prefixSeq) return; // 已有更新的请求，丢弃旧结果
    if (res.code === 0 && res.data.available) {
      prefixAvailable.value = true;
      prefixState.value = 'ok';
      prefixHint.value = `✓ ${prefix}@${regForm.domain} 可用，将作为你的校园邮箱`;
    } else if (res.code === 0) {
      prefixAvailable.value = false;
      prefixState.value = 'bad';
      prefixHint.value = res.data.reason || '该前缀不可用，可换一个';
    } else {
      prefixAvailable.value = null;
      prefixState.value = 'bad';
      prefixHint.value = '检查失败，可稍后再试（不影响注册）';
    }
  } catch {
    if (seq !== prefixSeq) return;
    prefixAvailable.value = null;
    prefixState.value = 'bad';
    prefixHint.value = '检查失败，可稍后再试（不影响注册）';
  } finally {
    clearTimeout(guard);
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
  forgotDlg.value = true;
  forgotStep.value = 1;
}

// ---- 忘记密码（邮箱验证码自助找回） ----
const forgotDlg = ref(false);
const forgotStep = ref(1); // 1 发码 2 重置
const forgotSending = ref(false);
const forgotResetting = ref(false);
const forgotCooldown = ref(0);
const forgotForm = reactive({ username: '', email: '', code: '', newPassword: '', confirm: '' });

async function sendForgotCode() {
  if (!forgotForm.username.trim()) return ElMessage.warning('请输入账号');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(forgotForm.email.trim())) return ElMessage.warning('请输入正确的绑定邮箱');
  forgotSending.value = true;
  try {
    const res = await api('/api/auth/password/forgot-send-code', {
      method: 'POST',
      auth: false,
      body: { username: forgotForm.username, email: forgotForm.email },
    });
    if (res.code === 0) {
      ElMessage.success(res.message || '验证码已发送');
      forgotStep.value = 2;
      forgotCooldown.value = 60;
      const timer = setInterval(() => {
        forgotCooldown.value--;
        if (forgotCooldown.value <= 0) clearInterval(timer);
      }, 1000);
    } else {
      ElMessage.error(res.message || '发送失败');
    }
  } finally {
    forgotSending.value = false;
  }
}

async function doForgotReset() {
  if (!/^\d{6}$/.test(forgotForm.code.trim())) return ElMessage.warning('请输入 6 位验证码');
  if (forgotForm.newPassword.length < 8) return ElMessage.warning('新密码至少 8 位');
  if (forgotForm.newPassword !== forgotForm.confirm) return ElMessage.warning('两次输入的新密码不一致');
  forgotResetting.value = true;
  try {
    const res = await api('/api/auth/password/forgot-reset', {
      method: 'POST',
      auth: false,
      body: {
        username: forgotForm.username,
        email: forgotForm.email,
        code: forgotForm.code,
        newPassword: forgotForm.newPassword,
      },
    });
    if (res.code === 0) {
      ElMessage.success(res.message || '密码已重置，请使用新密码登录');
      forgotDlg.value = false;
      loginForm.username = forgotForm.username;
      loginForm.password = '';
    } else {
      ElMessage.error(res.message || '重置失败');
    }
  } finally {
    forgotResetting.value = false;
  }
}
</script>

<style scoped>
.w-full { width: 100%; }
.forgot-tip { margin: 0 0 12px; font-size: 12.5px; color: #64748b; line-height: 1.6; }

/* 输入框 + 操作按钮同行：按钮做成兄弟节点。
   不要用 el-input 的 #append（Element Plus 会渲染成 display:table 的
   .el-input-group），在 430px 卡片里追加按钮会把真正的输入区挤到只剩几十像素。 */
.field-row { display: flex; align-items: center; gap: 8px; width: 100%; }
.field-row .el-input { flex: 1; min-width: 0; }
.field-row .el-select { flex: 0 0 auto; }
/* 覆盖 .gate-card .el-button 的 6px 字距，否则右侧窄按钮过宽 */
.gate-card .field-row .el-button { letter-spacing: 0.5px; padding: 0 12px; height: 40px; }
/* 后缀下拉：@keaidang.com 需约 101px（14px 字号），收到 12.5px 后 164px 宽刚好不截断 */
.domain-select { width: 164px; }
.domain-select :deep(.el-select__wrapper) { font-size: 12.5px; }

/* 前缀提示行：左侧说明占满，右侧"检查可用性"文字链（不挤占输入框宽度） */
.prefix-meta { display: flex; align-items: flex-start; gap: 10px; margin: -10px 0 16px; }
.prefix-hint { flex: 1; min-width: 0; font-size: 12px; line-height: 1.6; color: rgba(255, 255, 255, 0.5); }
.prefix-hint.idle { color: rgba(255, 255, 255, 0.5); }
.prefix-hint.checking { color: rgba(255, 255, 255, 0.62); }
.prefix-hint.ok { color: #5eead4; }
.prefix-hint.bad { color: #fcd34d; }
.prefix-check {
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 1.6;
  color: #7dd3fc;
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 1px dashed rgba(125, 211, 252, 0.5);
}
.prefix-check:hover { color: #bae6fd; }
.prefix-check.dim { color: rgba(255, 255, 255, 0.35); border-bottom-color: rgba(255, 255, 255, 0.18); }
.mail-tip { margin: -8px 0 14px; font-size: 12px; color: rgba(255, 255, 255, 0.5); line-height: 1.6; }
.mail-tip b { color: #fcd34d; }

/* 窄屏：把后缀下拉收紧，保证输入框仍有可读宽度 */
@media (max-width: 640px) {
  .domain-select { width: 152px; }
  .domain-select :deep(.el-select__wrapper) { font-size: 12px; }
  .gate-card .field-row .el-button { padding: 0 10px; }
}
</style>
