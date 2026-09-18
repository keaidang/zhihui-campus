<template>
  <PortalShell active="admin-students">
    <section class="um-head">
      <div>
        <h2>学生管理</h2>
        <p>
          班级名册 · 名单导入导出 · 调班
          · 数据范围：{{ isAll ? '全校' : '本人带班' }}
        </p>
      </div>
      <div class="um-count">共 {{ total }} 名学生</div>
    </section>

    <section class="um-filter">
      <el-select v-model="query.classId" placeholder="全部班级" clearable filterable style="width: 220px">
        <el-option
          v-for="c in classes"
          :key="c.id"
          :label="`${c.name}${c.counselor_name ? '（' + c.counselor_name + '）' : ''}`"
          :value="String(c.id)"
        />
      </el-select>
      <el-input
        v-model="query.keyword"
        placeholder="搜索姓名 / 账号 / 学号"
        clearable
        style="width: 240px"
        @keyup.enter="load(1)"
      />
      <el-button type="primary" @click="load(1)">查询</el-button>
      <el-button @click="reset">重置</el-button>
      <div class="um-spacer"></div>
      <el-button :icon="Upload" type="primary" plain @click="openImport">导入名单</el-button>
      <el-button :icon="Download" plain @click="onExport">导出名册</el-button>
    </section>

    <section class="um-table">
      <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="user_no" label="学号" width="130">
          <template #default="{ row }">{{ row.user_no || '—' }}</template>
        </el-table-column>
        <el-table-column prop="real_name" label="姓名" width="110">
          <template #default="{ row }">{{ row.real_name || '—' }}</template>
        </el-table-column>
        <el-table-column prop="username" label="账号" min-width="120" />
        <el-table-column label="班级" min-width="170">
          <template #default="{ row }">
            <span>{{ row.class_name || '未分班' }}</span>
            <span v-if="row.dept_name" class="um-muted"> / {{ row.dept_name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="有效期" width="110">
          <template #default="{ row }">{{ row.valid_until ? fmtDate(row.valid_until) : '长期' }}</template>
        </el-table-column>
        <el-table-column label="最近登录" width="170">
          <template #default="{ row }">{{ fmt(row.last_login_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openProfile(row)">调班</el-button>
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

    <!-- 导入名单 -->
    <el-dialog v-model="importDlg" title="导入学生名单" width="620px">
      <el-form label-width="90px">
        <el-form-item label="导入班级" required>
          <el-select v-model="importForm.classId" filterable placeholder="选择班级" style="width: 100%">
            <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="String(c.id)" />
          </el-select>
        </el-form-item>
      </el-form>
      <el-alert
        type="info"
        :closable="false"
        style="margin-bottom: 12px"
        title="每行一个学生：账号,姓名,学号（学号可省略；账号已存在则跳过）"
        description="示例：stu260101,张三,20260101"
      />
      <el-input v-model="importText" type="textarea" :rows="8" placeholder="账号,姓名,学号&#10;stu260101,张三,20260101" />
      <div class="um-dlg-tip" style="margin-top: 8px">
        已识别 <b>{{ importRows.length }}</b> 行；也可
        <input type="file" accept=".csv,.txt" style="display: none" ref="importFile" @change="onImportFile" />
        <el-link type="primary" @click="$refs.importFile.click()">从 CSV 文件导入</el-link>
        <span class="um-muted">（未指定密码的学生，初始密码为 Zhihui@2026）</span>
      </div>
      <template #footer>
        <el-button @click="importDlg = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!importRows.length || !importForm.classId" @click="submitImport">
          导入 {{ importRows.length }} 名学生
        </el-button>
      </template>
    </el-dialog>

    <!-- 调班 -->
    <el-dialog v-model="profileDlg" title="调整学生归属" width="440px">
      <el-form label-width="90px">
        <el-form-item label="学生">
          <span>{{ current?.real_name || '—' }}（{{ current?.username }}）</span>
        </el-form-item>
        <el-form-item label="学号">
          <el-input v-model="profileForm.userNo" placeholder="学号" />
        </el-form-item>
        <el-form-item label="班级">
          <el-select v-model="profileForm.classId" filterable clearable placeholder="选择班级" style="width: 100%">
            <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="String(c.id)" />
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
import { ElMessage, ElMessageBox } from 'element-plus';
import { Upload, Download } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { api, download } from '../../api/request';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const isAll = computed(() => auth.isAdmin);

const loading = ref(false);
const saving = ref(false);
const rows = ref([]);
const total = ref(0);
const classes = ref([]);
const query = reactive({ classId: '', keyword: '', page: 1, pageSize: 20 });

const fmt = (v) => (v ? String(v).slice(0, 19).replace('T', ' ') : '—');
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '');

async function loadClasses() {
  const res = await api('/api/admin/classes');
  if (res.code === 0) classes.value = res.data.list;
}

async function load(page = query.page) {
  loading.value = true;
  try {
    query.page = page;
    const qs = new URLSearchParams();
    if (query.classId) qs.set('classId', query.classId);
    if (query.keyword) qs.set('keyword', query.keyword);
    qs.set('page', query.page);
    qs.set('pageSize', query.pageSize);
    const res = await api(`/api/admin/students?${qs.toString()}`);
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
  query.classId = '';
  query.keyword = '';
  load(1);
}

async function onExport() {
  try {
    const qs = new URLSearchParams({ export: 'csv' });
    if (query.classId) qs.set('classId', query.classId);
    if (query.keyword) qs.set('keyword', query.keyword);
    await download(`/api/admin/students?${qs.toString()}`, `学生名册-${new Date().toISOString().slice(0, 10)}.csv`);
    ElMessage.success('已导出');
  } catch (e) {
    ElMessage.error(e.message || '导出失败');
  }
}

/* ---- 导入 ---- */
const importDlg = ref(false);
const importText = ref('');
const importFile = ref(null);
const importForm = reactive({ classId: '' });
const importRows = computed(() =>
  importText.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [username = '', realName = '', userNo = ''] = line.split(',').map((s) => s.trim());
      return { username, realName, userNo };
    }),
);
function onImportFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => (importText.value = String(reader.result || ''));
  reader.readAsText(file, 'utf-8');
  ev.target.value = '';
}
function openImport() {
  if (!classes.value.length) {
    ElMessage.warning('当前账号暂无可管理的班级');
    return;
  }
  importText.value = '';
  importDlg.value = true;
}
async function submitImport() {
  saving.value = true;
  try {
    const res = await api('/api/admin/students', {
      method: 'POST',
      body: { action: 'import', classId: Number(importForm.classId), rows: importRows.value },
    });
    if (res.code === 0) {
      ElMessageBox.alert(
        `导入 ${res.data.created.length} 名：${res.data.created.join('、') || '无'}${
          res.data.skipped.length
            ? `<br/>跳过 ${res.data.skipped.length} 条：${res.data.skipped.map((s) => `${s.username}(${s.reason})`).join('、')}`
            : ''
        }`,
        '导入结果',
        { dangerouslyUseHTMLString: true },
      );
      importDlg.value = false;
      load(1);
    } else ElMessage.error(res.message || '导入失败');
  } finally {
    saving.value = false;
  }
}

/* ---- 调班 ---- */
const profileDlg = ref(false);
const profileForm = reactive({ userNo: '', classId: '' });
const current = ref(null);
function openProfile(row) {
  current.value = row;
  profileForm.userNo = row.user_no || '';
  profileForm.classId = row.class_id ? String(row.class_id) : '';
  profileDlg.value = true;
}
async function saveProfile() {
  saving.value = true;
  try {
    const res = await api('/api/admin/students', {
      method: 'POST',
      body: {
        userId: current.value.id,
        action: 'setProfile',
        userNo: profileForm.userNo,
        classId: profileForm.classId || null,
      },
    });
    if (res.code === 0) {
      ElMessage.success(res.message);
      profileDlg.value = false;
      load();
    } else ElMessage.error(res.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadClasses();
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
  background: var(--zc-glass);
  backdrop-filter: blur(14px);
  border: 1px solid var(--zc-glass-border);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.um-table {
  background: var(--zc-glass);
  backdrop-filter: blur(14px);
  border: 1px solid var(--zc-glass-border);
  border-radius: 12px;
  padding: 6px 6px 14px;
}
.um-pager { display: flex; justify-content: flex-end; padding: 12px 10px 0; }
.um-muted { color: var(--zc-text-sub); font-size: 12.5px; }
.um-dlg-tip { margin: 0 0 14px; font-size: 13px; color: var(--zc-text-sub); }
.um-spacer { flex: 1; }
</style>
