<template>
  <PortalShell active="af-repair">
    <div class="rp-cols">
      <!-- 左：报修表单 -->
      <section class="pg-card rp-form">
        <h2>宿舍报修</h2>
        <p class="sub">提交后由辅导员/后勤受理，可随时查看进度</p>
        <el-form label-position="top" :model="form">
          <el-form-item label="故障类型">
            <el-select v-model="form.category" style="width: 100%">
              <el-option v-for="c in CATEGORIES" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item>
          <el-form-item label="报修位置">
            <el-input v-model="form.location" placeholder="如：6栋 312 宿舍" maxlength="128" clearable />
          </el-form-item>
          <el-form-item label="联系电话">
            <el-input v-model="form.contact" placeholder="方便师傅联系你" maxlength="32" clearable />
          </el-form-item>
          <el-form-item label="故障描述">
            <el-input v-model="form.description" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="描述故障现象，越具体处理越快" />
          </el-form-item>
          <el-button type="primary" class="w-full" :loading="submitting" @click="submit">提交报修</el-button>
        </el-form>
      </section>

      <!-- 右：我的工单 -->
      <section class="pg-card">
        <header class="list-head">
          <h2>我的工单</h2>
          <el-button :icon="Refresh" circle @click="load" />
        </header>
        <div v-loading="loading" class="rp-items">
          <div v-for="r in list" :key="r.id" class="rp-item">
            <div class="rp-item-top">
              <el-tag :type="tagType(r.status)" effect="light" round size="small">{{ r.status_text }}</el-tag>
              <el-tag type="info" effect="plain" round size="small">{{ r.category }}</el-tag>
              <span class="rp-loc">{{ r.location }}</span>
            </div>
            <p class="rp-desc">{{ r.description }}</p>
            <p v-if="r.remark" class="rp-remark">处理备注：{{ r.remark }}</p>
            <div class="rp-foot">
              <span>提交于 {{ fmt(r.created_at) }}</span>
              <span v-if="r.handler_name">受理人：{{ r.handler_name }}</span>
            </div>
          </div>
          <el-empty v-if="!loading && list.length === 0" description="暂无报修记录" />
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

const CATEGORIES = ['水电', '家具', '网络', '门锁', '其他'];
const form = ref({ category: '水电', location: '', contact: '', description: '' });
const list = ref([]);
const loading = ref(false);
const submitting = ref(false);

const tagType = (s) => ({ 0: 'warning', 1: 'primary', 2: 'success' }[s] || 'info');
const fmt = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '—');

async function load() {
  loading.value = true;
  try {
    const res = await api('/api/af/repair');
    if (res.code === 0) list.value = res.data.list;
    else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!form.value.location.trim() || !form.value.description.trim()) {
    ElMessage.warning('请填写报修位置和故障描述');
    return;
  }
  submitting.value = true;
  try {
    const res = await api('/api/af/repair', { method: 'POST', body: { action: 'create', ...form.value } });
    if (res.code === 0) {
      ElMessage.success(res.message || '已提交');
      form.value = { category: '水电', location: '', contact: '', description: '' };
      await load();
    } else {
      ElMessage.error(res.message || '提交失败');
    }
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.rp-cols { display: grid; grid-template-columns: 400px 1fr; gap: 18px; align-items: start; }
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
.rp-items { display: flex; flex-direction: column; gap: 12px; max-height: 640px; overflow-y: auto; }
.rp-item { border: 1px solid var(--zc-border); border-radius: 10px; padding: 14px 16px; background: #fff; }
.rp-item-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rp-loc { font-weight: 600; font-size: 14px; }
.rp-desc { margin: 10px 0; font-size: 13.5px; line-height: 1.7; }
.rp-remark {
  margin: 0 0 10px;
  font-size: 12.5px;
  color: #0d9488;
  background: rgba(13, 148, 136, 0.07);
  border-radius: 6px;
  padding: 6px 10px;
}
.rp-foot { display: flex; justify-content: space-between; font-size: 12px; color: var(--zc-text-sub); }
@media (max-width: 900px) { .rp-cols { grid-template-columns: 1fr; } }
</style>
