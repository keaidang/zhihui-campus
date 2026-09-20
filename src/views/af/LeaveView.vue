<template>
  <PortalShell active="af-leave">
    <div class="lv-cols">
      <!-- 左：申请表单 -->
      <section class="pg-card lv-form">
        <h2>请假申请</h2>
        <p class="sub">提交后由本院辅导员审批，销假后流程闭环</p>
        <el-form label-position="top" :model="form">
          <el-form-item label="请假类型">
            <el-radio-group v-model="form.type">
              <el-radio-button v-for="t in TYPES" :key="t" :value="t">{{ t }}</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="请假时段">
            <el-date-picker
              v-model="range"
              type="datetimerange"
              start-placeholder="开始时间"
              end-placeholder="结束时间"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DD HH:mm:ss"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="请假事由">
            <el-input v-model="form.reason" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="请说明请假原因（如病假请附就诊情况说明）" />
          </el-form-item>
          <el-button type="primary" class="w-full" :loading="submitting" @click="submit">提交申请</el-button>
        </el-form>
      </section>

      <!-- 右：我的请假单 -->
      <section class="pg-card lv-list">
        <header class="list-head">
          <h2>我的请假单</h2>
          <el-button :icon="Refresh" circle @click="load" />
        </header>
        <div v-loading="loading" class="lv-items">
          <div v-for="r in list" :key="r.id" class="lv-item">
            <div class="lv-item-top">
              <el-tag :type="tagType(r.status)" effect="light" round size="small">{{ r.status_text }}</el-tag>
              <span class="lv-type">{{ r.type }}</span>
              <span class="lv-time">{{ fmt(r.start_at) }} ~ {{ fmt(r.end_at) }}</span>
            </div>
            <p class="lv-reason">{{ r.reason }}</p>
            <div v-if="r.opinion" class="lv-opinion">审批意见：{{ r.opinion }}</div>
            <div class="lv-item-foot">
              <span>提交于 {{ fmt(r.created_at) }}</span>
              <el-button v-if="r.status === 2" type="success" size="small" round plain @click="back(r)">销假</el-button>
            </div>
          </div>
          <el-empty v-if="!loading && list.length === 0" description="暂无请假记录" />
        </div>
      </section>
    </div>
  </PortalShell>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';

const TYPES = ['事假', '病假', '其他'];
const form = ref({ type: '事假', reason: '' });
const range = ref([]);
const list = ref([]);
const loading = ref(false);
const submitting = ref(false);

const tagType = (s) => ({ 1: 'warning', 2: 'primary', 3: 'danger', 4: 'success' }[s] || 'info');
// 时间统一走 utils/time.js：库内存 UTC，这里转北京时间展示（勿再手写字符串截断）
import { fmtTime as fmt } from '../../utils/time';

async function load() {
  loading.value = true;
  try {
    const res = await api('/api/af/leave');
    if (res.code === 0) list.value = res.data.list;
    else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!range.value || range.value.length !== 2) {
    ElMessage.warning('请选择请假时段');
    return;
  }
  if (!form.value.reason.trim()) {
    ElMessage.warning('请填写请假事由');
    return;
  }
  submitting.value = true;
  try {
    const res = await api('/api/af/leave', {
      method: 'POST',
      body: { action: 'apply', type: form.value.type, reason: form.value.reason.trim(), startAt: range.value[0], endAt: range.value[1] },
    });
    if (res.code === 0) {
      ElMessage.success(res.message || '已提交');
      form.value.reason = '';
      range.value = [];
      await load();
    } else {
      ElMessage.error(res.message || '提交失败');
    }
  } finally {
    submitting.value = false;
  }
}

async function back(row) {
  const res = await api('/api/af/leave', { method: 'POST', body: { action: 'back', leaveId: row.id } });
  if (res.code === 0) {
    ElMessage.success(res.message || '销假成功');
    await load();
  } else {
    ElMessage.error(res.message || '销假失败');
  }
}

onMounted(load);
</script>

<style scoped>
.lv-cols { display: grid; grid-template-columns: 400px 1fr; gap: 18px; align-items: start; }
.pg-card {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 14px;
  padding: 22px 24px;
  box-shadow: 0 6px 24px rgba(23, 50, 92, 0.07);
}
.pg-card h2 { margin: 0 0 6px; font-size: 19px; color: var(--zc-navy); letter-spacing: 1px; }
.sub { margin: 0 0 16px; font-size: 13px; color: var(--zc-text-sub); }
.w-full { width: 100%; }
.list-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.lv-items { display: flex; flex-direction: column; gap: 12px; max-height: 640px; overflow-y: auto; }
.lv-item {
  border: 1px solid var(--zc-border);
  border-radius: 10px;
  padding: 14px 16px;
  background: #fff;
}
.lv-item-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.lv-type { font-weight: 600; font-size: 14px; }
.lv-time { font-size: 12.5px; color: var(--zc-text-sub); }
.lv-reason { margin: 10px 0; font-size: 13.5px; line-height: 1.7; color: var(--zc-text); }
.lv-opinion {
  font-size: 12.5px;
  color: #0d9488;
  background: rgba(13, 148, 136, 0.07);
  border-radius: 6px;
  padding: 6px 10px;
  margin-bottom: 10px;
}
.lv-item-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--zc-text-sub);
}
@media (max-width: 900px) { .lv-cols { grid-template-columns: 1fr; } }
</style>
