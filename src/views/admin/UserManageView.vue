<template>
  <PortalShell active="admin-users">
    <section class="um-head">
      <div>
        <h2>用户管理</h2>
        <p>
          数据范围：{{ scopeLabel }}
          <template v-if="meta.scope?.type === 'dept'">（仅本院用户）</template>
        </p>
      </div>
      <div class="um-count">共 {{ total }} 个账号</div>
    </section>

    <!-- 过滤条 -->
    <section class="um-filter">
      <el-input
        v-model="query.keyword"
        placeholder="搜索用户名 / 姓名 / 学号工号"
        clearable
        style="width: 260px"
        @keyup.enter="load(1)"
      />
      <el-select v-model="query.role" placeholder="全部角色" clearable style="width: 150px">
        <el-option v-for="r in meta.roles" :key="r.code" :label="r.name" :value="r.code" />
      </el-select>
      <el-select v-if="meta.scope?.type === 'all'" v-model="query.deptId" placeholder="全部院系" clearable style="width: 180px">
        <el-option v-for="d in meta.departments" :key="d.id" :label="d.name" :value="String(d.id)" />
      </el-select>
      <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 130px">
        <el-option label="正常" value="1" />
        <el-option label="已禁用" value="0" />
      </el-select>
      <el-button type="primary" @click="load(1)">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </section>

    <!-- 列表 -->
    <section class="um-table">
      <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="real_name" label="姓名" width="100" />
        <el-table-column prop="user_no" label="学号/工号" width="120" />
        <el-table-column label="角色" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="c in row.roles" :key="c" size="small" class="um-tag" :type="tagType(c)">
              {{ meta.roleNames[c] || c }}
            </el-tag>
            <span v-if="!row.roles.length" class="um-muted">未分配</span>
          </template>
        </el-table-column>
        <el-table-column label="院系 / 班级" min-width="190">
          <template #default="{ row }">
            <span>{{ row.dept_name || '—' }}</span>
            <span v-if="row.class_name" class="um-muted"> / {{ row.class_name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="注册时间" width="170">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openProfile(row)">归属</el-button>
            <el-button v-if="auth.isAdmin" size="small" type="primary" @click="openRoles(row)">角色</el-button>
            <el-button
              size="small"
              :type="row.status === 1 ? 'danger' : 'success'"
              :disabled="row.id === auth.user?.id"
              @click="toggleStatus(row)"
            >
              {{ row.status === 1 ? '禁用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="um-pager">
        <el-pagination
          layout="total, prev, pager, next, sizes"
          :total="total"
          :page-size="query.pageSize"
          :current-page="query.page"
          :page-sizes="[10, 20, 50]"
          @current-change="load"
          @size-change="(s) => { query.pageSize = s; load(1); }"
        />
      </div>
    </section>

    <!-- 角色分配 -->
    <el-dialog v-model="roleDlg" title="分配角色" width="420px">
      <p class="um-dlg-tip">
        用户：<strong>{{ current?.username }}</strong>（{{ current?.real_name || '未填姓名' }}）
      </p>
      <el-checkbox-group v-model="rolePick">
        <el-checkbox v-for="r in meta.roles" :key="r.code" :value="r.code" :label="r.code">
          {{ r.name }} <span class="um-muted">— {{ r.description }}</span>
        </el-checkbox>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="roleDlg = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRoles">保存</el-button>
      </template>
    </el-dialog>

    <!-- 归属设置 -->
    <el-dialog v-model="profileDlg" title="设置归属信息" width="440px">
      <el-form label-width="90px">
        <el-form-item label="学号/工号">
          <el-input v-model="profileForm.userNo" placeholder="如 2026001 / T0001" />
        </el-form-item>
        <el-form-item label="院系">
          <el-select v-model="profileForm.deptId" placeholder="选择院系" clearable style="width: 100%" @change="profileForm.classId = ''">
            <el-option v-for="d in meta.departments" :key="d.id" :label="d.name" :value="String(d.id)" />
          </el-select>
        </el-form-item>
        <el-form-item label="班级">
          <el-select v-model="profileForm.classId" placeholder="选择班级" clearable style="width: 100%">
            <el-option v-for="c in classOptions" :key="c.id" :label="c.name" :value="String(c.id)" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="profileDlg = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveProfile">保存</el-button>
      </template>
    </el-dialog>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();

const loading = ref(false);
const saving = ref(false);
const rows = ref([]);
const total = ref(0);
const meta = reactive({ roles: [], departments: [], classes: [], roleNames: {}, scope: {} });

const query = reactive({ keyword: '', role: '', deptId: '', status: '', page: 1, pageSize: 20 });

const scopeLabel = computed(() => {
  const t = meta.scope?.type;
  if (t === 'all') return '全校';
  if (t === 'dept') return '本院';
  return '本人';
});

function fmt(v) {
  return v ? String(v).slice(0, 19).replace('T', ' ') : '—';
}

function tagType(code) {
  return { admin: 'danger', leader: 'warning', counselor: 'success', teacher: 'primary' }[code] || 'info';
}

async function loadMeta() {
  const res = await api('/api/admin/meta');
  if (res.code === 0) {
    meta.roles = res.data.roles;
    meta.departments = res.data.departments;
    meta.classes = res.data.classes;
    meta.roleNames = res.data.roleNames;
    meta.scope = res.data.scope;
  }
}

async function load(page = query.page) {
  loading.value = true;
  try {
    query.page = page;
    const qs = new URLSearchParams();
    if (query.keyword) qs.set('keyword', query.keyword);
    if (query.role) qs.set('role', query.role);
    if (query.status) qs.set('status', query.status);
    if (query.deptId && meta.scope?.type === 'all') qs.set('deptId', query.deptId);
    qs.set('page', query.page);
    qs.set('pageSize', query.pageSize);
    const res = await api(`/api/admin/users?${qs.toString()}`);
    if (res.code === 0) {
      rows.value = res.data.list;
      total.value = res.data.total;
    } else {
      ElMessage.error(res.message || '加载失败');
    }
  } finally {
    loading.value = false;
  }
}

function reset() {
  query.keyword = '';
  query.role = '';
  query.deptId = '';
  query.status = '';
  load(1);
}

async function toggleStatus(row) {
  const next = row.status === 1 ? 0 : 1;
  const res = await api('/api/admin/users', {
    method: 'POST',
    body: { userId: row.id, action: 'setStatus', value: next },
  });
  if (res.code === 0) {
    row.status = next;
    ElMessage.success(res.message);
  } else {
    ElMessage.error(res.message || '操作失败');
  }
}

const roleDlg = ref(false);
const rolePick = ref([]);
const current = ref(null);

function openRoles(row) {
  current.value = row;
  rolePick.value = [...row.roles];
  roleDlg.value = true;
}

async function saveRoles() {
  saving.value = true;
  try {
    const res = await api('/api/admin/users', {
      method: 'POST',
      body: { userId: current.value.id, action: 'setRoles', value: rolePick.value },
    });
    if (res.code === 0) {
      ElMessage.success(res.message);
      roleDlg.value = false;
      load();
    } else {
      ElMessage.error(res.message || '保存失败');
    }
  } finally {
    saving.value = false;
  }
}

const profileDlg = ref(false);
const profileForm = reactive({ userNo: '', deptId: '', classId: '' });
const classOptions = computed(() =>
  profileForm.deptId ? meta.classes.filter((c) => String(c.dept_id) === String(profileForm.deptId)) : meta.classes,
);

function openProfile(row) {
  current.value = row;
  profileForm.userNo = row.user_no || '';
  profileForm.deptId = row.dept_id ? String(row.dept_id) : '';
  profileForm.classId = row.class_id ? String(row.class_id) : '';
  profileDlg.value = true;
}

async function saveProfile() {
  saving.value = true;
  try {
    const res = await api('/api/admin/users', {
      method: 'POST',
      body: {
        userId: current.value.id,
        action: 'setProfile',
        value: {
          userNo: profileForm.userNo,
          deptId: profileForm.deptId || null,
          classId: profileForm.classId || null,
        },
      },
    });
    if (res.code === 0) {
      ElMessage.success(res.message);
      profileDlg.value = false;
      load();
    } else {
      ElMessage.error(res.message || '保存失败');
    }
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadMeta();
  await load(1);
});
</script>

<style scoped>
.um-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.um-head h2 { margin: 0 0 6px; font-size: 20px; color: var(--zc-navy); letter-spacing: 1px; }
.um-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.um-count { font-size: 13px; color: var(--zc-text-sub); }
.um-filter {
  margin: 18px 0 14px;
  background: #fff;
  border: 1px solid var(--zc-border);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.um-table { background: #fff; border: 1px solid var(--zc-border); border-radius: 12px; padding: 6px 6px 14px; }
.um-pager { display: flex; justify-content: flex-end; padding: 12px 10px 0; }
.um-tag { margin-right: 6px; }
.um-muted { color: var(--zc-text-sub); font-size: 12.5px; }
.um-dlg-tip { margin: 0 0 14px; font-size: 13px; color: var(--zc-text-sub); }
</style>
