<template>
  <PortalShell active="lostfound">
    <div class="lf-page">
      <header class="pg-head">
        <div>
          <h2>失物招领</h2>
          <p>拾金不昧 · 失物信息由学工处统一发布</p>
        </div>
        <el-button v-if="canPublish" type="primary" size="large" @click="openPublish">发布失物信息</el-button>
      </header>

      <div class="lf-toolbar">
        <el-input v-model="keyword" placeholder="搜索物品名称 / 描述" clearable style="width: 260px" @keyup.enter="load" />
        <el-button type="primary" @click="load">搜索</el-button>
        <el-checkbox v-if="canPublish" v-model="mineOnly" label="只看我发布的" @change="load" />
      </div>

      <p v-if="!loading && items.length === 0" class="lf-empty">暂无失物招领信息</p>
      <div class="lf-grid">
        <div v-for="it in items" :key="it.id" class="lf-card" @click="openDetail(it)">
          <div class="lf-thumb">
            <img v-if="it.images[0]" :src="it.images[0]" alt="" loading="lazy" />
            <span v-else class="lf-thumb-fallback">📦</span>
          </div>
          <div class="lf-body">
            <h4>{{ it.title }}</h4>
            <p class="lf-desc">{{ it.description }}</p>
            <div class="lf-foot">
              <span class="lf-date">{{ day(it.createdAt) }}</span>
              <el-tag v-if="it.status === 1" type="success" size="small">招领中</el-tag>
              <el-tag v-else type="info" size="small">已认领</el-tag>
            </div>
          </div>
        </div>
      </div>

      <!-- 详情 -->
      <el-dialog v-model="detailDlg" :title="current?.title" width="460px">
        <template v-if="current">
          <div class="lf-imgs" v-if="current.images.length">
            <el-image v-for="u in current.images" :key="u" :src="u" fit="cover" :preview-src-list="current.images" class="lf-img" />
          </div>
          <p class="lf-detail-desc">{{ current.description }}</p>
          <ul class="lf-meta">
            <li><em>发布人</em><span>{{ current.publisherName }}（学工处）</span></li>
            <li><em>发布时间</em><span>{{ day(current.createdAt) }}</span></li>
            <li><em>联系电话</em><span class="lf-phone">{{ current.contact }}</span></li>
          </ul>
        </template>
        <template #footer>
          <el-button v-if="current && current.status === 1 && (current.publisherId === auth.user?.id || canPublish)" @click="doClose">标记已认领</el-button>
          <el-button type="primary" @click="detailDlg = false">关闭</el-button>
        </template>
      </el-dialog>

      <!-- 发布 -->
      <el-dialog v-model="publishDlg" title="发布失物招领" width="500px">
        <el-form label-width="82px">
          <el-form-item label="物品名称"><el-input v-model="form.title" placeholder="如 黑色钱包 / 蓝色水杯" /></el-form-item>
          <el-form-item label="描述">
            <el-input v-model="form.description" type="textarea" :rows="3" placeholder="拾获地点、物品特征、当前保管处…" />
          </el-form-item>
          <el-form-item label="联系电话"><el-input v-model="form.contact" placeholder="用于失主联系" /></el-form-item>
          <el-form-item label="图片"><ImgUploader v-model="form.images" /></el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="publishDlg = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="doPublish">发布</el-button>
        </template>
      </el-dialog>
    </div>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PortalShell from '../../components/PortalShell.vue';
import ImgUploader from '../../components/ImgUploader.vue';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/request';

const auth = useAuthStore();
const items = ref([]);
const loading = ref(false);
const keyword = ref('');
const mineOnly = ref(false);
const canPublish = computed(() => auth.hasRole(['counselor', 'admin']));

const detailDlg = ref(false);
const current = ref(null);
const publishDlg = ref(false);
const saving = ref(false);
const form = reactive({ title: '', description: '', contact: '', images: [] });

const day = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '');

async function load() {
  loading.value = true;
  try {
    const scope = mineOnly.value ? '&scope=mine' : '';
    const res = await api(`/api/lf/items?keyword=${encodeURIComponent(keyword.value)}${scope}`);
    if (res.code === 0) items.value = res.data.list;
    else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function openDetail(it) {
  current.value = it;
  detailDlg.value = true;
}

function openPublish() {
  Object.assign(form, { title: '', description: '', contact: '', images: [] });
  publishDlg.value = true;
}

async function doPublish() {
  if (!form.title.trim()) return ElMessage.warning('请填写物品名称');
  if (form.description.trim().length < 5) return ElMessage.warning('描述至少 5 个字（地点、特征等）');
  if (!form.contact.trim()) return ElMessage.warning('请填写联系电话');
  saving.value = true;
  try {
    const res = await api('/api/lf/items', { method: 'POST', body: { action: 'create', ...form } });
    if (res.code === 0) {
      ElMessage.success(res.message || '已发布');
      publishDlg.value = false;
      load();
    } else {
      ElMessage.error(res.message || '发布失败');
    }
  } finally {
    saving.value = false;
  }
}

async function doClose() {
  const confirmed = await ElMessageBox.confirm('确认该物品已被失主认领？', '标记已认领', { type: 'warning' });
  if (!confirmed) return;
  const res = await api('/api/lf/items', { method: 'POST', body: { action: 'close', id: current.value.id } });
  if (res.code === 0) {
    ElMessage.success(res.message || '已下架');
    detailDlg.value = false;
    load();
  } else {
    ElMessage.error(res.message || '操作失败');
  }
}

onMounted(load);
</script>

<style scoped>
.pg-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pg-head h2 { margin: 0 0 6px; font-size: 21px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.lf-toolbar { display: flex; gap: 12px; align-items: center; margin-top: 16px; }
.lf-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 14px; }
.lf-card {
  display: flex; gap: 12px; background: var(--zc-glass); border: 1px solid var(--zc-glass-border);
  border-radius: 12px; padding: 12px; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
}
.lf-card:hover { transform: translateY(-3px); box-shadow: 0 10px 24px rgba(23, 50, 92, 0.12); }
.lf-thumb { width: 92px; height: 92px; border-radius: 10px; overflow: hidden; flex: none; background: rgba(23, 50, 92, 0.08); display: flex; align-items: center; justify-content: center; }
.lf-thumb img { width: 100%; height: 100%; object-fit: cover; }
.lf-thumb-fallback { font-size: 30px; }
.lf-body { min-width: 0; display: flex; flex-direction: column; }
.lf-body h4 { margin: 0 0 6px; font-size: 14.5px; color: var(--zc-navy); }
.lf-desc { margin: 0; font-size: 12.5px; color: var(--zc-text-sub); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.lf-foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; }
.lf-date { font-size: 11.5px; color: #94a3b8; }
.lf-empty { text-align: center; color: var(--zc-text-sub); padding: 48px 0; }
.lf-imgs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.lf-img { width: 100px; height: 100px; border-radius: 8px; }
.lf-detail-desc { font-size: 13.5px; color: var(--zc-text); line-height: 1.7; margin: 0 0 12px; white-space: pre-wrap; }
.lf-meta { list-style: none; margin: 0; padding: 0; }
.lf-meta li { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px dashed var(--zc-border); font-size: 13px; }
.lf-meta em { font-style: normal; color: var(--zc-text-sub); }
.lf-phone { font-weight: 700; color: var(--zc-navy); }
@media (max-width: 1024px) { .lf-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px) { .lf-grid { grid-template-columns: 1fr; } }
</style>
