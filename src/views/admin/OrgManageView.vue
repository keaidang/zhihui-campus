<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh, Plus, OfficeBuilding, School } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const isAdmin = auth.primaryRole === 'admin';

const tab = ref('depts');
const loading = ref(false);
const depts = ref([]); // 系部列表（含 user_count / class_count）
const classes = ref([]); // 班级列表
const counselors = ref([]); // 辅导员名单（下拉）

// ---- 系部编辑 ----
const deptDlg = ref(false);
const deptForm = ref({ id: null, code: '', name: '', sort: 0, type: 'college' });
const deptTypeLabel = (t) => (t === 'admin' ? '行政部门' : '教学院系');

// ---- 班级编辑 ----
const classDlg = ref(false);
const classForm = ref({ id: null, name: '', deptId: null, grade: 2026, counselorId: null });

async function load() {
  loading.value = true;
  try {
    const [d, c] = await Promise.all([api('/api/admin/departments'), api('/api/admin/classes')]);
    if (d.code === 0) depts.value = d.data.list || [];
    if (c.code === 0) {
      classes.value = c.data.list || [];
      counselors.value = c.data.counselors || [];
    }
  } finally {
    loading.value = false;
  }
}

const deptName = (id) => depts.value.find((d) => d.id === id)?.name || '—';

/* ---------- 系部管理 ---------- */
function openDeptCreate() {
  deptForm.value = { id: null, code: '', name: '', sort: depts.value.length + 1, type: 'college' };
  deptDlg.value = true;
}
function openDeptEdit(row) {
  deptForm.value = { id: row.id, code: row.code, name: row.name, sort: row.sort, type: row.dept_type || 'college' };
  deptDlg.value = true;
}
async function saveDept() {
  const f = deptForm.value;
  if (!f.id && !f.code) return ElMessage.warning('院系编码必填');
  if (!f.name) return ElMessage.warning('院系名称必填');
  const res = await api('/api/admin/departments', {
    method: 'POST',
    body: f.id
      ? { action: 'update', id: f.id, name: f.name, sort: f.sort }
      : { action: 'create', code: f.code, name: f.name, sort: f.sort, type: f.type },
  });
  if (res.code !== 0) return ElMessage.error(res.message || '保存失败');
  ElMessage.success(f.id ? '院系已更新' : '院系已创建');
  deptDlg.value = false;
  load();
}
async function toggleDept(row) {
  const res = await api('/api/admin/departments', {
    method: 'POST',
    body: { action: 'setStatus', id: row.id, value: row.status === 1 ? 0 : 1 },
  });
  if (res.code !== 0) return ElMessage.error(res.message || '操作失败');
  ElMessage.success(res.message);
  load();
}
async function delDept(row) {
  await ElMessageBox.confirm(
    `确认删除院系「${row.name}」？仅当院系下无人员且无班级时可删除。`,
    '删除院系',
    { type: 'warning' },
  );
  const res = await api('/api/admin/departments', { method: 'POST', body: { action: 'delete', id: row.id } });
  if (res.code !== 0) return ElMessage.error(res.message || '删除失败');
  ElMessage.success(res.message);
  load();
}

/* ---------- 班级管理 ---------- */
function openClassCreate() {
  classForm.value = { id: null, name: '', deptId: depts.value[0]?.id ?? null, grade: 2026, counselorId: null };
  classDlg.value = true;
}
function openClassEdit(row) {
  classForm.value = { id: row.id, name: row.name, deptId: row.dept_id, grade: row.grade || 2026, counselorId: row.counselor_id || null };
  classDlg.value = true;
}
async function saveClass() {
  const f = classForm.value;
  if (!f.name) return ElMessage.warning('班级名称必填');
  if (!f.deptId) return ElMessage.warning('所属院系必选');
  const res = await api('/api/admin/classes', {
    method: 'POST',
    body: f.id
      ? { action: 'update', id: f.id, name: f.name, deptId: f.deptId, grade: f.grade, counselorId: f.counselorId }
      : { action: 'create', name: f.name, deptId: f.deptId, grade: f.grade, counselorId: f.counselorId },
  });
  if (res.code !== 0) return ElMessage.error(res.message || '保存失败');
  ElMessage.success(f.id ? '班级已更新' : '班级已创建');
  classDlg.value = false;
  load();
}
async function delClass(row) {
  await ElMessageBox.confirm(
    `确认删除班级「${row.name}」？班级下有在读学生时不能删除，请先调班。`,
    '删除班级',
    { type: 'warning' },
  );
  const res = await api('/api/admin/classes', { method: 'POST', body: { action: 'delete', id: row.id } });
  if (res.code !== 0) return ElMessage.error(res.message || '删除失败');
  ElMessage.success(res.message);
  load();
}

onMounted(load);
</script>

<template>
  <PortalShell active="admin-org">
    <div class="page-head">
      <div>
        <h2>系部与班级</h2>
        <p>学校组织架构管理：院系设置、班级建立与辅导员指派{{ isAdmin ? '' : '（辅导员只读）' }}</p>
      </div>
      <el-button :icon="Refresh" circle @click="load" />
    </div>

    <el-tabs v-model="tab" class="org-tabs">
      <!-- ============ 系部管理 ============ -->
      <el-tab-pane name="depts">
        <template #label><span class="tab-label"><el-icon><OfficeBuilding /></el-icon> 系部管理</span></template>
        <div class="toolbar">
          <el-button v-if="isAdmin" type="primary" :icon="Plus" @click="openDeptCreate">新增院系</el-button>
        </div>
        <el-table :data="depts" v-loading="loading" stripe>
          <el-table-column prop="code" label="编码" width="110" />
          <el-table-column prop="name" label="名称" min-width="200" />
          <el-table-column label="类型" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.dept_type === 'admin' ? 'warning' : 'success'" size="small">{{ deptTypeLabel(row.dept_type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="sort" label="排序" width="70" align="center" />
          <el-table-column prop="user_count" label="人员数" width="90" align="center" />
          <el-table-column prop="class_count" label="班级数" width="90" align="center" />
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="isAdmin" label="操作" width="190" align="center">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDeptEdit(row)">编辑</el-button>
              <el-button link :type="row.status === 1 ? 'warning' : 'success'" @click="toggleDept(row)">{{ row.status === 1 ? '停用' : '启用' }}</el-button>
              <el-button link type="danger" @click="delDept(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ============ 班级管理 ============ -->
      <el-tab-pane name="classes">
        <template #label><span class="tab-label"><el-icon><School /></el-icon> 班级管理</span></template>
        <div class="toolbar">
          <el-button v-if="isAdmin" type="primary" :icon="Plus" @click="openClassCreate">新建班级</el-button>
        </div>
        <el-table :data="classes" v-loading="loading" stripe>
          <el-table-column prop="name" label="班级名称" min-width="150" />
          <el-table-column prop="grade" label="年级" width="90" align="center" />
          <el-table-column label="所属院系" min-width="180">
            <template #default="{ row }">{{ row.dept_name || deptName(row.dept_id) }}</template>
          </el-table-column>
          <el-table-column label="辅导员" width="120">
            <template #default="{ row }">{{ row.counselor_name || '未指派' }}</template>
          </el-table-column>
          <el-table-column prop="student_count" label="在读人数" width="100" align="center" />
          <el-table-column v-if="isAdmin" label="操作" width="140" align="center">
            <template #default="{ row }">
              <el-button link type="primary" @click="openClassEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="delClass(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 院系编辑 -->
    <el-dialog v-model="deptDlg" :title="deptForm.id ? '编辑院系' : '新增部门'" width="420px">
      <el-form label-width="80px">
        <el-form-item label="类型" v-if="!deptForm.id">
          <el-radio-group v-model="deptForm.type">
            <el-radio value="college">教学院系</el-radio>
            <el-radio value="admin">行政部门</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="编码">
          <el-input v-model="deptForm.code" :disabled="!!deptForm.id" placeholder="如 CS 或 JWC（大写字母/数字）" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="deptForm.name" placeholder="如 计算机学院 / 教务处" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="deptForm.sort" :min="0" :max="99" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deptDlg = false">取消</el-button>
        <el-button type="primary" @click="saveDept">保存</el-button>
      </template>
    </el-dialog>

    <!-- 班级编辑 -->
    <el-dialog v-model="classDlg" :title="classForm.id ? '编辑班级' : '新建班级'" width="440px">
      <el-form label-width="90px">
        <el-form-item label="班级名称"><el-input v-model="classForm.name" placeholder="如 计算机 2601" /></el-form-item>
        <el-form-item label="所属院系">
          <el-select v-model="classForm.deptId" style="width: 100%">
            <el-option v-for="d in depts" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="年级">
          <el-input-number v-model="classForm.grade" :min="2000" :max="2100" />
        </el-form-item>
        <el-form-item label="辅导员">
          <el-select v-model="classForm.counselorId" clearable placeholder="选择辅导员" style="width: 100%">
            <el-option v-for="u in counselors" :key="u.id" :label="`${u.real_name}（${u.user_no}）`" :value="u.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="classDlg = false">取消</el-button>
        <el-button type="primary" @click="saveClass">保存</el-button>
      </template>
    </el-dialog>
  </PortalShell>
</template>

<style scoped>
.page-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
.page-head h2 { margin: 0; font-size: 22px; color: var(--zc-navy, #17325c); }
.page-head p { margin: 4px 0 0; font-size: 13px; color: var(--zc-text-sub, #64748b); }
.toolbar { display: flex; gap: 10px; margin-bottom: 14px; }
.org-tabs { background: var(--zc-glass, #fff); border-radius: 14px; padding: 6px 18px 18px; }
.tab-label { display: inline-flex; align-items: center; gap: 4px; }
</style>
