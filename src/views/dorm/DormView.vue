<template>
  <PortalShell active="dorm">
    <!-- 学生视角：我的宿舍 + 宿舍报修 -->
    <template v-if="!isStaff">
      <div class="dm-cols">
        <section class="pg-card">
          <h2>我的宿舍</h2>
          <template v-if="dorm">
            <div class="dorm-hero">
              <div class="dorm-room">{{ dorm.buildingName }} · {{ dorm.roomNo }}</div>
              <el-tag :type="dorm.gender === 'male' ? 'primary' : 'danger'" effect="plain" round size="small">
                {{ dorm.gender === 'male' ? '男生宿舍' : '女生宿舍' }}
              </el-tag>
            </div>
            <div class="dorm-meta">
              <span>床位：{{ dorm.bedNo }} 号床</span>
              <span>入住时间：{{ fmt(dorm.checkInAt) }}</span>
            </div>
            <div class="mates">
              <h3>室友（{{ roommates.length }} 人）</h3>
              <div class="mate-list">
                <div v-for="m in roommates" :key="m.username" class="mate">
                  <el-avatar :size="30" :style="{ background: 'var(--zc-navy)' }">{{ m.realName?.charAt(0) }}</el-avatar>
                  <div class="mate-info">
                    <b>{{ m.realName }}</b>
                    <span>{{ m.userNo || m.username }} · {{ m.bedNo }} 号床</span>
                  </div>
                </div>
                <el-empty v-if="roommates.length === 0" :image-size="60" description="暂时是单人入住" />
              </div>
            </div>
          </template>
          <el-empty v-else-if="!loading" description="尚未分配宿舍，请联系辅导员" />
        </section>

        <section class="pg-card">
          <h2>宿舍报修</h2>
          <p class="sub">提交后自动带上你的宿舍位置，由辅导员/后勤受理</p>
          <el-form label-position="top" :model="form">
            <el-form-item label="故障类型">
              <el-select v-model="form.category" style="width: 100%">
                <el-option v-for="c in CATEGORIES" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
            <el-form-item label="报修位置">
              <el-input v-model="form.location" placeholder="默认带出宿舍位置，可修改" maxlength="128" clearable />
            </el-form-item>
            <el-form-item label="联系电话">
              <el-input v-model="form.contact" placeholder="方便师傅联系你" maxlength="32" clearable />
            </el-form-item>
            <el-form-item label="故障描述">
              <el-input v-model="form.description" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="描述故障现象，越具体处理越快" />
            </el-form-item>
            <el-button type="primary" class="w-full" :loading="submitting" @click="submitRepair">提交报修</el-button>
          </el-form>
        </section>
      </div>

      <section class="pg-card" style="margin-top: 18px">
        <header class="list-head">
          <h2>我的报修工单</h2>
          <el-button :icon="Refresh" circle @click="loadRepairs" />
        </header>
        <div v-loading="loadingRepairs" class="rp-items">
          <div v-for="r in repairs" :key="r.id" class="rp-item">
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
          <el-empty v-if="!loadingRepairs && repairs.length === 0" description="暂无报修记录" />
        </div>
      </section>
    </template>

    <!-- 管理视角：楼栋/房间/分配 -->
    <template v-else>
      <section class="pg-card">
        <header class="list-head">
          <h2>宿舍总览</h2>
          <div class="head-actions">
            <el-button type="primary" plain @click="dlgBuilding = true">新建楼栋</el-button>
            <el-button type="primary" plain @click="openAddRoom">新增房间</el-button>
          </div>
        </header>
        <div v-loading="loading" class="bld-grid">
          <div v-for="b in buildings" :key="b.id" class="bld-card" @click="focusBuilding = b.id">
            <div class="bld-top">
              <b>{{ b.name }}</b>
              <el-tag :type="b.gender === 'male' ? 'primary' : 'danger'" effect="plain" round size="small">
                {{ b.gender === 'male' ? '男' : '女' }}
              </el-tag>
            </div>
            <span class="bld-sub">{{ b.roomCount }} 间房 · {{ b.floors }} 层</span>
            <div class="bld-bar">
              <div class="bld-bar-in" :style="{ width: bedPct(b) + '%' }"></div>
            </div>
            <span class="bld-occ">{{ b.bedUsed }}/{{ b.bedTotal }} 床位</span>
          </div>
        </div>
      </section>

      <section class="pg-card" style="margin-top: 18px">
        <header class="list-head">
          <h2>{{ focusName }} · 房间分配</h2>
          <el-radio-group v-model="filterFull" size="small">
            <el-radio-button :value="false">全部</el-radio-button>
            <el-radio-button :value="true">有空位</el-radio-button>
          </el-radio-group>
        </header>
        <div class="room-grid">
          <div v-for="r in visibleRooms" :key="r.id" class="room-card" :class="{ full: r.occupied >= r.capacity, off: r.status !== 1 }">
            <div class="room-top">
              <b>{{ r.roomNo }}</b>
              <span class="room-cap">{{ r.occupied }}/{{ r.capacity }}</span>
            </div>
            <div class="room-beds">
              <span v-for="i in r.capacity" :key="i" class="bed" :class="{ used: i <= r.occupied }"></span>
            </div>
            <div class="room-residents">
              <span v-for="u in r.residents" :key="u.id" class="chip" :title="`${u.realName}（${u.userNo || u.username}）· ${u.bedNo}号床`">
                {{ u.realName }}
              </span>
            </div>
            <div class="room-actions">
              <el-button size="small" type="primary" plain :disabled="r.occupied >= r.capacity || r.status !== 1" @click="openAssign(r)">安排入住</el-button>
              <el-button size="small" plain :disabled="r.occupied === 0" @click="openRoomDetail(r)">管理</el-button>
              <el-button size="small" text type="danger" @click="toggleRoom(r)">{{ r.status === 1 ? '停用' : '启用' }}</el-button>
            </div>
          </div>
        </div>
      </section>

      <!-- 报修处理入口卡片 -->
      <section class="pg-card" style="margin-top: 18px">
        <div class="repair-entry">
          <div>
            <h2>宿舍报修处理</h2>
            <p class="sub">受理 / 完成学生提交的报修工单</p>
          </div>
          <el-button type="primary" @click="$router.push('/af/repair-manage')">进入报修处理</el-button>
        </div>
      </section>
    </template>

    <!-- 新建楼栋 -->
    <el-dialog v-model="dlgBuilding" title="新建宿舍楼" width="420px">
      <el-form label-width="80px">
        <el-form-item label="楼栋名"><el-input v-model="bForm.name" placeholder="如 9栋" maxlength="16" /></el-form-item>
        <el-form-item label="性别属性">
          <el-radio-group v-model="bForm.gender">
            <el-radio value="male">男生宿舍</el-radio>
            <el-radio value="female">女生宿舍</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="楼层数"><el-input-number v-model="bForm.floors" :min="1" :max="30" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgBuilding = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveBuilding">创建</el-button>
      </template>
    </el-dialog>

    <!-- 新增房间 -->
    <el-dialog v-model="dlgRoom" title="新增房间" width="420px">
      <el-form label-width="80px">
        <el-form-item label="楼栋">
          <el-select v-model="rForm.buildingId" style="width: 100%">
            <el-option v-for="b in buildings" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="房号"><el-input v-model="rForm.roomNo" placeholder="如 608" maxlength="8" /></el-form-item>
        <el-form-item label="楼层"><el-input-number v-model="rForm.floor" :min="1" :max="30" /></el-form-item>
        <el-form-item label="床位数"><el-input-number v-model="rForm.capacity" :min="1" :max="12" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgRoom = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRoom">创建</el-button>
      </template>
    </el-dialog>

    <!-- 安排入住 -->
    <el-dialog v-model="dlgAssign" :title="`安排入住 · ${assignRoom?.roomNo || ''}`" width="520px">
      <el-input v-model="assignKw" placeholder="搜索姓名 / 学号 / 用户名" clearable @input="searchStudents" />
      <div v-loading="assignLoading" class="stu-list">
        <div v-for="s in stuList" :key="s.id" class="stu-row">
          <div class="stu-info">
            <b>{{ s.realName }}</b>
            <span>{{ s.userNo || s.username }} · {{ s.deptName || s.className || '' }}</span>
          </div>
          <el-tag v-if="s.gender === 1" type="primary" effect="plain" size="small">男</el-tag>
          <el-tag v-else-if="s.gender === 2" type="danger" effect="plain" size="small">女</el-tag>
          <el-button size="small" type="primary" @click="doAssign(s)">分配</el-button>
        </div>
        <el-empty v-if="!assignLoading && stuList.length === 0" :image-size="60" description="没有未住宿的学生" />
      </div>
    </el-dialog>

    <!-- 房间管理（退宿） -->
    <el-dialog v-model="dlgRoomDetail" :title="`房间管理 · ${detailRoom?.roomNo || ''}`" width="480px">
      <div class="stu-list">
        <div v-for="u in detailRoom?.residents || []" :key="u.id" class="stu-row">
          <div class="stu-info">
            <b>{{ u.realName }}</b>
            <span>{{ u.userNo || u.username }} · {{ u.bedNo }} 号床</span>
          </div>
          <el-popconfirm title="确认办理该生退宿？" confirm-button-text="确认退宿" cancel-button-text="取消" @confirm="doUnassign(u)">
            <template #reference><el-button size="small" type="danger" plain>退宿</el-button></template>
          </el-popconfirm>
        </div>
        <el-empty v-if="(detailRoom?.residents || []).length === 0" :image-size="60" description="无住户" />
      </div>
    </el-dialog>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const isStaff = computed(() => auth.hasRole(['admin', 'counselor']));

const CATEGORIES = ['水电', '家具', '网络', '门锁', '其他'];
const loading = ref(false);
const saving = ref(false);

// ---- 学生侧 ----
const dorm = ref(null);
const roommates = ref([]);
const repairs = ref([]);
const loadingRepairs = ref(false);
const form = ref({ category: '水电', location: '', contact: '', description: '' });

// ---- 管理侧 ----
const buildings = ref([]);
const rooms = ref([]);
const focusBuilding = ref(null);
const filterFull = ref(false);
const dlgBuilding = ref(false);
const dlgRoom = ref(false);
const dlgAssign = ref(false);
const dlgRoomDetail = ref(false);
const bForm = ref({ name: '', gender: 'male', floors: 6 });
const rForm = ref({ buildingId: null, roomNo: '', floor: 1, capacity: 4 });
const assignRoom = ref(null);
const assignKw = ref('');
const assignLoading = ref(false);
const stuList = ref([]);
const detailRoom = ref(null);

const focusName = computed(() => buildings.value.find((b) => b.id === focusBuilding.value)?.name || '全部楼栋');
const visibleRooms = computed(() => {
  let list = rooms.value;
  if (focusBuilding.value) list = list.filter((r) => r.buildingId === focusBuilding.value);
  if (filterFull.value) list = list.filter((r) => r.occupied < r.capacity && r.status === 1);
  return list;
});
const bedPct = (b) => (b.bedTotal > 0 ? Math.round((b.bedUsed / b.bedTotal) * 100) : 0);
// 报修工单状态配色（3=无法处理，终态；原因在 r.remark 中展示）
const tagType = (s) => ({ 0: 'warning', 1: 'primary', 2: 'success', 3: 'danger' }[s] || 'info');
// 时间统一走 utils/time.js：库内存 UTC，这里转北京时间展示（勿再手写字符串截断）
import { fmtTime as fmt } from '../../utils/time';

async function loadDorm() {
  const res = await api('/api/dorm?view=my');
  if (res.code === 0) {
    dorm.value = res.data.dorm;
    roommates.value = res.data.roommates;
    if (dorm.value && !form.value.location) {
      form.value.location = `${dorm.value.buildingName} ${dorm.value.roomNo}`;
    }
  }
}

async function loadRepairs() {
  loadingRepairs.value = true;
  try {
    const res = await api('/api/af/repair');
    if (res.code === 0) repairs.value = res.data.list;
  } finally {
    loadingRepairs.value = false;
  }
}

async function submit() {
  if (!form.value.location.trim() || !form.value.description.trim()) {
    ElMessage.warning('请填写报修位置和故障描述');
    return;
  }
  submitting();
  async function submitting() {
    form.saving = true;
  }
}

// 学生提交报修（复用 /api/af/repair）
const submitting = ref(false);
async function submitRepair() {
  if (!form.value.location.trim() || !form.value.description.trim()) {
    ElMessage.warning('请填写报修位置和故障描述');
    return;
  }
  submitting.value = true;
  try {
    const res = await api('/api/af/repair', { method: 'POST', body: { action: 'create', ...form.value } });
    if (res.code === 0) {
      ElMessage.success(res.message || '已提交');
      form.value = { category: '水电', location: dorm.value ? `${dorm.value.buildingName} ${dorm.value.roomNo}` : '', contact: '', description: '' };
      await loadRepairs();
    } else {
      ElMessage.error(res.message || '提交失败');
    }
  } finally {
    submitting.value = false;
  }
}

async function loadOverview() {
  loading.value = true;
  try {
    const res = await api('/api/dorm?view=overview');
    if (res.code === 0) {
      buildings.value = res.data.buildings;
      rooms.value = res.data.rooms;
      if (!focusBuilding.value && buildings.value.length) focusBuilding.value = buildings.value[0].id;
    } else {
      ElMessage.error(res.message || '加载失败');
    }
  } finally {
    loading.value = false;
  }
}

async function saveBuilding() {
  saving.value = true;
  try {
    const res = await api('/api/dorm', { method: 'POST', body: { action: 'addBuilding', ...bForm.value } });
    if (res.code === 0) {
      ElMessage.success(res.message);
      dlgBuilding.value = false;
      bForm.value = { name: '', gender: 'male', floors: 6 };
      await loadOverview();
    } else ElMessage.error(res.message || '创建失败');
  } finally {
    saving.value = false;
  }
}

function openAddRoom() {
  rForm.value = { buildingId: focusBuilding.value || buildings.value[0]?.id, roomNo: '', floor: 1, capacity: 4 };
  dlgRoom.value = true;
}

async function saveRoom() {
  saving.value = true;
  try {
    const res = await api('/api/dorm', { method: 'POST', body: { action: 'addRoom', ...rForm.value } });
    if (res.code === 0) {
      ElMessage.success(res.message);
      dlgRoom.value = false;
      await loadOverview();
    } else ElMessage.error(res.message || '创建失败');
  } finally {
    saving.value = false;
  }
}

async function toggleRoom(r) {
  const res = await api('/api/dorm', { method: 'POST', body: { action: 'toggleRoom', id: r.id } });
  if (res.code === 0) {
    ElMessage.success(res.message);
    await loadOverview();
  } else ElMessage.error(res.message || '操作失败');
}

async function searchStudents() {
  assignLoading.value = true;
  try {
    const res = await api('/api/dorm?view=students');
    if (res.code === 0) {
      const kw = assignKw.value.trim().toLowerCase();
      stuList.value = kw
        ? res.data.list.filter((s) => [s.realName, s.username, s.userNo].some((v) => v && String(v).toLowerCase().includes(kw)))
        : res.data.list;
    }
  } finally {
    assignLoading.value = false;
  }
}

function openAssign(r) {
  assignRoom.value = r;
  assignKw.value = '';
  dlgAssign.value = true;
  searchStudents();
}

async function doAssign(s) {
  const res = await api('/api/dorm', { method: 'POST', body: { action: 'assign', roomId: assignRoom.value.id, userId: s.id } });
  if (res.code === 0) {
    ElMessage.success(`${s.realName} 已安排至 ${assignRoom.value.roomNo} ${res.data.bedNo} 号床`);
    dlgAssign.value = false;
    await loadOverview();
  } else ElMessage.error(res.message || '分配失败');
}

function openRoomDetail(r) {
  detailRoom.value = r;
  dlgRoomDetail.value = true;
}

async function doUnassign(u) {
  const res = await api('/api/dorm', { method: 'POST', body: { action: 'unassign', userId: u.id } });
  if (res.code === 0) {
    ElMessage.success(`${u.realName} 已办理退宿`);
    await loadOverview();
  } else ElMessage.error(res.message || '操作失败');
}

onMounted(() => {
  if (isStaff.value) loadOverview();
  else {
    loadDorm();
    loadRepairs();
  }
});
</script>

<style scoped>
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
.head-actions { display: flex; gap: 8px; }

.dm-cols { display: grid; grid-template-columns: 1fr 400px; gap: 18px; align-items: start; }
.dorm-hero { display: flex; align-items: center; gap: 12px; margin: 8px 0 10px; }
.dorm-room { font-size: 26px; font-weight: 700; color: var(--zc-navy); letter-spacing: 1px; }
.dorm-meta { display: flex; gap: 18px; font-size: 13px; color: var(--zc-text-sub); margin-bottom: 16px; }
.mates h3 { font-size: 14px; color: var(--zc-text); margin: 0 0 10px; }
.mate-list { display: flex; flex-direction: column; gap: 8px; }
.mate { display: flex; align-items: center; gap: 10px; border: 1px solid var(--zc-border); border-radius: 10px; padding: 8px 12px; background: #fff; }
.mate-info { display: flex; flex-direction: column; }
.mate-info span { font-size: 12px; color: var(--zc-text-sub); }

.rp-items { display: flex; flex-direction: column; gap: 12px; max-height: 480px; overflow-y: auto; }
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

.bld-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.bld-card { border: 1px solid var(--zc-border); border-radius: 12px; padding: 14px 16px; background: #fff; cursor: pointer; transition: box-shadow 0.2s, border-color 0.2s; }
.bld-card:hover { border-color: var(--zc-navy); box-shadow: 0 6px 18px rgba(23, 50, 92, 0.12); }
.bld-top { display: flex; justify-content: space-between; align-items: center; }
.bld-top b { font-size: 16px; color: var(--zc-navy); }
.bld-sub { font-size: 12px; color: var(--zc-text-sub); }
.bld-bar { height: 6px; border-radius: 4px; background: rgba(23, 50, 92, 0.1); margin: 10px 0 6px; overflow: hidden; }
.bld-bar-in { height: 100%; background: linear-gradient(90deg, var(--zc-navy), #3b82f6); border-radius: 4px; }
.bld-occ { font-size: 12px; color: var(--zc-text-sub); }

.room-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.room-card { border: 1px solid var(--zc-border); border-radius: 12px; padding: 12px 14px; background: #fff; }
.room-card.full { opacity: 0.75; }
.room-card.off { opacity: 0.45; }
.room-top { display: flex; justify-content: space-between; align-items: baseline; }
.room-top b { font-size: 15px; color: var(--zc-navy); }
.room-cap { font-size: 12px; color: var(--zc-text-sub); }
.room-beds { display: flex; gap: 4px; margin: 8px 0; }
.bed { width: 16px; height: 10px; border-radius: 3px; background: rgba(23, 50, 92, 0.12); }
.bed.used { background: var(--zc-navy); }
.room-residents { display: flex; flex-wrap: wrap; gap: 4px; min-height: 22px; margin-bottom: 8px; }
.chip { font-size: 11px; background: rgba(23, 50, 92, 0.06); border-radius: 999px; padding: 2px 8px; color: var(--zc-navy); }
.room-actions { display: flex; gap: 4px; }
.room-actions .el-button { margin-left: 0; }

.repair-entry { display: flex; justify-content: space-between; align-items: center; }

.stu-list { max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.stu-row { display: flex; align-items: center; gap: 8px; border: 1px solid var(--zc-border); border-radius: 10px; padding: 8px 12px; background: #fff; }
.stu-info { flex: 1; display: flex; flex-direction: column; }
.stu-info span { font-size: 12px; color: var(--zc-text-sub); }

@media (max-width: 1000px) {
  .dm-cols { grid-template-columns: 1fr; }
  .bld-grid, .room-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
