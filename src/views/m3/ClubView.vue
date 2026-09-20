<template>
  <PortalShell active="club">
    <div class="club-page">
      <header class="pg-head">
        <div>
          <h2>社团活动</h2>
          <p>社团申请 · 教务处审批 · 招聘报名 · 名额实时</p>
        </div>
        <div class="pg-head-actions">
          <el-radio-group v-model="tab" size="large">
            <el-radio-button value="recruit">招募中</el-radio-button>
            <el-radio-button value="mine">我的预约</el-radio-button>
            <el-radio-button value="apply">社团申请</el-radio-button>
            <el-radio-button v-if="canReview" value="review">审批管理</el-radio-button>
          </el-radio-group>
        </div>
      </header>

      <!-- 招募列表 -->
      <section v-show="tab === 'recruit'" class="club-panel">
        <p v-if="recruits.length === 0" class="club-empty">暂无招募中的社团，可先提交社团申请</p>
        <div class="club-grid">
          <div v-for="r in recruits" :key="r.id" class="club-card">
            <div class="club-imgs" v-if="r.images.length">
              <el-image v-for="u in r.images" :key="u" :src="u" fit="cover" class="club-img" :preview-src-list="r.images" />
            </div>
            <h4>{{ r.title }}</h4>
            <p class="club-sub"><b>{{ r.clubName }}</b> · 开课人 {{ r.proposerName }}</p>
            <p class="club-line">📍 {{ r.location || '待定' }}</p>
            <p class="club-line">🕐 {{ r.activityTime || '时间待定' }}</p>
            <p class="club-desc">{{ r.content || r.clubContent }}</p>
            <div class="club-foot">
              <span class="club-quota" :class="{ full: r.quota > 0 && r.taken >= r.quota }">
                {{ r.quota > 0 ? `名额 ${r.taken}/${r.quota}` : '名额不限' }}
                <template v-if="r.quota > 0">（剩 {{ Math.max(0, r.quota - r.taken) }}）</template>
              </span>
              <el-button
                size="small"
                :type="r.booked ? 'warning' : 'primary'"
                :disabled="r.status !== 1"
                @click="toggleBook(r)"
              >
                {{ r.booked ? '取消预约' : '立即预约' }}
              </el-button>
            </div>
            <el-tag v-if="r.status !== 1" type="info" size="small" class="club-stopped">已停止招募</el-tag>
          </div>
        </div>
      </section>

      <!-- 我的预约 -->
      <section v-show="tab === 'mine'" class="club-panel">
        <el-table :data="myBookings" stripe>
          <el-table-column prop="title" label="社团/活动" min-width="180" show-overflow-tooltip />
          <el-table-column prop="location" label="地点" width="150" show-overflow-tooltip />
          <el-table-column prop="activityTime" label="时间" width="150" show-overflow-tooltip />
          <el-table-column label="预约时间" width="110"><template #default="{ row }">{{ day(row.bookedAt) }}</template></el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.active" type="success" size="small">已预约</el-tag>
              <el-tag v-else type="info" size="small">已取消</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button v-if="row.active" size="small" plain @click="cancelBook(row)">取消</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <!-- 社团申请（学生） -->
      <section v-show="tab === 'apply'" class="club-panel">
        <div class="club-apply-head">
          <p class="club-hint">填写社团信息提交申请，教务处审批通过后即可发布招募</p>
          <el-button type="primary" @click="openApply">新建申请</el-button>
        </div>
        <el-table :data="myApplies" stripe style="margin-top: 12px">
          <el-table-column prop="name" label="社团名称" min-width="140" />
          <el-table-column prop="location" label="开课位置" min-width="140" show-overflow-tooltip />
          <el-table-column prop="activityTime" label="时间" min-width="120" show-overflow-tooltip />
          <el-table-column label="审批状态" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.status === 0" type="warning" size="small">待审批</el-tag>
              <el-tag v-else-if="row.status === 1" type="success" size="small">已通过</el-tag>
              <el-tooltip v-else :content="row.reviewOpinion" placement="top">
                <el-tag type="danger" size="small">已驳回</el-tag>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110">
            <template #default="{ row }">
              <el-button v-if="row.status === 1" size="small" type="primary" plain @click="openPublish(row)">发布招募</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <!-- 审批管理（teacher/admin） -->
      <section v-show="tab === 'review'" class="club-panel">
        <el-tabs v-model="reviewTab">
          <el-tab-pane label="待审批" name="0" />
          <el-tab-pane label="已审批" name="done" />
        </el-tabs>
        <el-table :data="reviewList" stripe>
          <el-table-column prop="name" label="社团名称" min-width="130" />
          <el-table-column prop="proposerName" label="开课人" width="90" />
          <el-table-column prop="userNo" label="学号" width="110" />
          <el-table-column prop="location" label="开课位置" min-width="120" show-overflow-tooltip />
          <el-table-column prop="activityTime" label="时间" min-width="110" show-overflow-tooltip />
          <el-table-column label="内容/大纲" min-width="180">
            <template #default="{ row }">
              <el-popover placement="top" :width="380" trigger="click">
                <template #reference><el-button link type="primary">查看详情</el-button></template>
                <p><b>简介：</b>{{ row.content }}</p>
                <p style="white-space: pre-wrap"><b>大纲：</b>{{ row.outline }}</p>
              </el-popover>
            </template>
          </el-table-column>
          <el-table-column v-if="reviewTab === '0'" label="操作" width="170">
            <template #default="{ row }">
              <el-button size="small" type="success" @click="doReview(row, true)">通过</el-button>
              <el-button size="small" type="danger" plain @click="doReview(row, false)">驳回</el-button>
            </template>
          </el-table-column>
          <el-table-column v-else label="结果" width="120">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">{{ row.status === 1 ? '通过' : '驳回' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <!-- 新建申请 -->
      <el-dialog v-model="applyDlg" title="社团申请" width="560px">
        <el-form label-width="82px">
          <el-form-item label="社团名称"><el-input v-model="applyForm.name" placeholder="如 AI 兴趣社" /></el-form-item>
          <el-form-item label="开课位置"><el-input v-model="applyForm.location" placeholder="如 教学楼 A305" /></el-form-item>
          <el-form-item label="活动时间"><el-input v-model="applyForm.activityTime" placeholder="如 每周三 19:00-20:30" /></el-form-item>
          <el-form-item label="内容简介"><el-input v-model="applyForm.content" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="活动大纲"><el-input v-model="applyForm.outline" type="textarea" :rows="4" placeholder="分期/分主题的大纲安排" /></el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="applyDlg = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitApply">提交申请</el-button>
        </template>
      </el-dialog>

      <!-- 发布招募 -->
      <el-dialog v-model="publishDlg" title="发布社团招募" width="560px">
        <p class="club-hint" v-if="publishTarget">社团：{{ publishTarget.name }}（已审批通过）</p>
        <el-form label-width="82px">
          <el-form-item label="招聘标题"><el-input v-model="publishForm.title" :placeholder="publishTarget?.name" /></el-form-item>
          <el-form-item label="名额">
            <el-input-number v-model="publishForm.quota" :min="0" :max="999" />
            <span class="club-hint" style="margin-left: 8px">0 = 不限名额</span>
          </el-form-item>
          <el-form-item label="招聘说明"><el-input v-model="publishForm.content" type="textarea" :rows="3" /></el-form-item>
          <el-form-item label="图片"><ImgUploader v-model="publishForm.images" /></el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="publishDlg = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitPublish">发布（全员可见）</el-button>
        </template>
      </el-dialog>
    </div>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PortalShell from '../../components/PortalShell.vue';
import ImgUploader from '../../components/ImgUploader.vue';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/request';

const auth = useAuthStore();
const canReview = computed(() => auth.hasRole(['teacher', 'admin']));

const tab = ref('recruit');
const reviewTab = ref('0');
const saving = ref(false);

const recruits = ref([]);
const myBookings = ref([]);
const myApplies = ref([]);
const reviewList = ref([]);

const applyDlg = ref(false);
const applyForm = reactive({ name: '', location: '', activityTime: '', content: '', outline: '' });
const publishDlg = ref(false);
const publishTarget = ref(null);
const publishForm = reactive({ title: '', content: '', quota: 20, images: [] });

const day = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '');

async function loadRecruits() {
  const res = await api('/api/club/recruit');
  if (res.code === 0) recruits.value = res.data.list;
}
async function loadMine() {
  const res = await api('/api/club/recruit?scope=mine');
  if (res.code === 0) myBookings.value = res.data.list;
}
async function loadApplies() {
  const res = await api('/api/club/apply');
  if (res.code === 0) myApplies.value = res.data.list;
}
async function loadReview() {
  const status = reviewTab.value === '0' ? '?status=0' : '';
  const res = await api(`/api/club/apply${status}`);
  if (res.code === 0) reviewList.value = res.data.list;
}

watch(reviewTab, loadReview);
watch(tab, (t) => {
  if (t === 'review') loadReview();
  if (t === 'apply') loadApplies();
});

function openApply() {
  Object.assign(applyForm, { name: '', location: '', activityTime: '', content: '', outline: '' });
  applyDlg.value = true;
}

async function submitApply() {
  if (!applyForm.name.trim()) return ElMessage.warning('请填写社团名称');
  if (!applyForm.location.trim()) return ElMessage.warning('请填写开课位置');
  if (!applyForm.activityTime.trim()) return ElMessage.warning('请填写活动时间');
  if (applyForm.outline.trim().length < 10) return ElMessage.warning('大纲至少 10 个字');
  saving.value = true;
  try {
    const res = await api('/api/club/apply', { method: 'POST', body: { action: 'create', ...applyForm } });
    if (res.code === 0) {
      ElMessage.success(res.message || '申请已提交');
      applyDlg.value = false;
      loadApplies();
    } else {
      ElMessage.error(res.message || '提交失败');
    }
  } finally {
    saving.value = false;
  }
}

async function doReview(row, pass) {
  let opinion = '';
  if (!pass) {
    const { value } = await ElMessageBox.prompt('请填写驳回原因', '驳回申请', { inputPlaceholder: '如 大纲不够完整' });
    opinion = value || '';
  }
  const res = await api('/api/club/apply', { method: 'POST', body: { action: 'review', id: row.id, pass, opinion } });
  if (res.code === 0) {
    ElMessage.success(res.message || '已审批');
    loadReview();
  } else {
    ElMessage.error(res.message || '操作失败');
  }
}

function openPublish(row) {
  publishTarget.value = row;
  Object.assign(publishForm, { title: row.name, content: row.content, quota: 20, images: [] });
  publishDlg.value = true;
}

async function submitPublish() {
  saving.value = true;
  try {
    const res = await api('/api/club/recruit', {
      method: 'POST',
      body: { action: 'publish', applicationId: publishTarget.value.id, ...publishForm },
    });
    if (res.code === 0) {
      ElMessage.success(res.message || '招聘已发布');
      publishDlg.value = false;
      tab.value = 'recruit';
      loadRecruits();
    } else {
      ElMessage.error(res.message || '发布失败');
    }
  } finally {
    saving.value = false;
  }
}

async function toggleBook(r) {
  if (r.booked) return cancelBook({ recruitId: r.id, title: r.title });
  const res = await api('/api/club/recruit', { method: 'POST', body: { action: 'book', id: r.id } });
  if (res.code === 0) {
    ElMessage.success(res.message || '预约成功');
    loadRecruits();
  } else {
    ElMessage.error(res.message || '预约失败');
  }
}

async function cancelBook(row) {
  const confirmed = await ElMessageBox.confirm(`确认取消预约「${row.title || ''}」？取消后名额将释放`, '取消预约', { type: 'warning' });
  if (!confirmed) return;
  const res = await api('/api/club/recruit', { method: 'POST', body: { action: 'cancel', id: row.recruitId } });
  if (res.code === 0) {
    ElMessage.success(res.message || '已取消');
    loadRecruits();
    loadMine();
  } else {
    ElMessage.error(res.message || '操作失败');
  }
}

onMounted(() => {
  loadRecruits();
  loadMine();
  loadApplies();
});
</script>

<style scoped>
.pg-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pg-head h2 { margin: 0 0 6px; font-size: 21px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.club-panel {
  margin-top: 16px;
  background: var(--zc-glass);
  backdrop-filter: blur(14px);
  border: 1px solid var(--zc-glass-border);
  border-radius: 14px;
  padding: 18px;
}
.club-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.club-card { position: relative; background: rgba(255, 255, 255, 0.75); border: 1px solid rgba(23, 50, 92, 0.08); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; }
.club-imgs { display: flex; gap: 6px; margin-bottom: 10px; }
.club-img { width: 84px; height: 64px; border-radius: 8px; }
.club-card h4 { margin: 0 0 4px; font-size: 15px; color: var(--zc-navy); }
.club-sub { margin: 0 0 8px; font-size: 12px; color: var(--zc-text-sub); }
.club-line { margin: 0 0 4px; font-size: 12.5px; color: var(--zc-text); }
.club-desc { margin: 6px 0 10px; font-size: 12.5px; color: var(--zc-text-sub); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.club-foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; }
.club-quota { font-size: 12.5px; color: #0d7a6c; font-weight: 600; }
.club-quota.full { color: #b83232; }
.club-stopped { position: absolute; top: 12px; right: 12px; }
.club-empty { text-align: center; color: var(--zc-text-sub); padding: 40px 0; }
.club-hint { font-size: 12.5px; color: var(--zc-text-sub); margin: 0; line-height: 1.6; }
.club-apply-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
@media (max-width: 1024px) { .club-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px) { .club-grid { grid-template-columns: 1fr; } }
</style>
