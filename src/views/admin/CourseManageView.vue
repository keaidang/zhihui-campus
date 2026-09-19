<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh, Plus, Upload, Download } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';

const tab = ref('courses');
const loading = ref(false);
const courses = ref([]);
const classes = ref([]);
const teachers = ref([]);
const depts = ref([]);

const WEEK = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const PERIODS = ['1-2节', '3-4节', '5-6节', '7-8节', '9-10节', '11-12节'];

// ---- 课程编辑弹窗 ----
const courseDlg = ref(false);
const courseForm = ref({ id: null, code: '', name: '', credit: 2, hours: 32, deptId: null, status: 1 });

// ---- 排课编辑弹窗 ----
const classDlg = ref(false);
const classForm = ref({ id: null, courseId: null, teacherId: null, term: '2026-2027-1', weekDay: 1, section: '1-2节', classroom: '', capacity: 60, status: 1 });

// ---- 导入弹窗 ----
const importDlg = ref(false);
const importType = ref('courses'); // courses | schedule
const importCsv = ref('');
const importResult = ref(null);

const deptName = (id) => depts.value.find((d) => d.id === id)?.name || '—';

async function load() {
  loading.value = true;
  try {
    const res = await api('/api/admin/courses');
    courses.value = res.data.courses || [];
    classes.value = res.data.classes || [];
    teachers.value = res.data.teachers || [];
    depts.value = res.data.depts || [];
  } finally {
    loading.value = false;
  }
}

const teacherById = computed(() => Object.fromEntries(teachers.value.map((t) => [t.id, t])));

/* ---------- 课程库 ---------- */
function openCourseCreate() {
  courseForm.value = { id: null, code: '', name: '', credit: 2, hours: 32, deptId: depts.value[0]?.id ?? null, status: 1 };
  courseDlg.value = true;
}
function openCourseEdit(row) {
  courseForm.value = { id: row.id, code: row.code, name: row.name, credit: Number(row.credit), hours: row.hours, deptId: row.dept_id, status: row.status };
  courseDlg.value = true;
}
async function saveCourse() {
  const f = courseForm.value;
  if (!f.code || !f.name) return ElMessage.warning('课程编码与名称必填');
  const res = await api('/api/admin/courses', {
    method: 'POST',
    body: {
      action: f.id ? 'course.update' : 'course.create',
      courseId: f.id, code: f.code, name: f.name, credit: f.credit, hours: f.hours, deptId: f.deptId, status: f.status,
    },
  });
  if (res.code !== 0) return ElMessage.error(res.message || '保存失败');
  ElMessage.success(f.id ? '课程已更新' : '课程已创建');
  courseDlg.value = false;
  load();
}
async function delCourse(row) {
  await ElMessageBox.confirm(`确认删除课程「${row.name}（${row.code}）」？已开设教学班的课程需先删排课。`, '删除课程', { type: 'warning' });
  const res = await api('/api/admin/courses', { method: 'POST', body: { action: 'course.delete', courseId: row.id } });
  if (res.code === 0) { ElMessage.success('已删除'); load(); }
}

function exportCourses() {
  const lines = ['课程编码,课程名称,学分,学时,院系ID,状态'];
  for (const c of courses.value) lines.push([c.code, c.name, c.credit, c.hours, c.dept_id ?? '', c.status].join(','));
  downloadCsv(`课程库导出_${new Date().toISOString().slice(0, 10)}.csv`, lines);
}

/* ---------- 排课管理 ---------- */
function openClassCreate() {
  classForm.value = { id: null, courseId: courses.value[0]?.id ?? null, teacherId: teachers.value[0]?.id ?? null, term: '2026-2027-1', weekDay: 1, section: '1-2节', classroom: '', capacity: 60, status: 1 };
  classDlg.value = true;
}
function openClassEdit(row) {
  classForm.value = { id: row.id, courseId: row.course_id, teacherId: row.teacher_id, term: row.term, weekDay: row.week_day, section: row.section, classroom: row.classroom, capacity: row.capacity, status: row.status };
  classDlg.value = true;
}
async function saveClass() {
  const f = classForm.value;
  if (!f.courseId || !f.teacherId) return ElMessage.warning('课程与教师必选');
  const res2 = await api('/api/admin/courses', {
    method: 'POST',
    body: {
      action: f.id ? 'class.update' : 'class.create',
      classId: f.id, courseId: f.courseId, teacherId: f.teacherId, term: f.term,
      weekDay: f.weekDay, section: f.section, classroom: f.classroom, capacity: f.capacity, status: f.status,
    },
  });
  if (res2.code !== 0) return ElMessage.error(res2.message || '保存失败');
  ElMessage.success(f.id ? '排课已更新' : '排课已创建');
  classDlg.value = false;
  load();
}
async function delClass(row) {
  await ElMessageBox.confirm(`确认删除排课「${row.course_name} · ${row.teacher_name} · ${WEEK[row.week_day]}${row.section}」？`, '删除排课', { type: 'warning' });
  const res = await api('/api/admin/courses', { method: 'POST', body: { action: 'class.delete', classId: row.id } });
  if (res.code === 0) { ElMessage.success('已删除'); load(); }
}

/* ---------- 导入 ---------- */
function openImport(type) {
  importType.value = type;
  importCsv.value = '';
  importResult.value = null;
  importDlg.value = true;
}
const importTpl = computed(() =>
  importType.value === 'courses'
    ? '课程编码,课程名称,学分,学时,院系ID\nCS999,人工智能导论,2.0,32,1'
    : '课程编码,教师工号,学期,周几,节次,教室,容量\nCS999,T2025001,2026-2027-1,4,1-2节,教学楼 D201,50',
);
async function doImport() {
  if (!importCsv.value.trim()) return ElMessage.warning('请粘贴 CSV 数据或选择文件');
  const res = await api('/api/admin/courses', {
    method: 'POST',
    body: {
      action: importType.value === 'courses' ? 'import.courses' : 'import.schedule',
      csv: importCsv.value,
    },
  });
  if (res.code !== 0) return ElMessage.error(res.message || '导入失败');
  importResult.value = res.data;
  ElMessage.success(`导入完成：新增 ${res.data.created ?? res.data.updated}，问题 ${res.data.errors?.length || 0}`);
  load();
}
function onCsvFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { importCsv.value = String(reader.result || ''); };
  reader.readAsText(file, 'utf-8');
  ev.target.value = '';
}

function downloadCsv(filename, lines) {
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

onMounted(load);
</script>

<template>
  <PortalShell active="admin-courses">
    <div class="page-head">
      <div>
        <h2>课程与排课</h2>
        <p>维护全校课程库，为教师安排授课时间与教室</p>
      </div>
      <el-button :icon="Refresh" circle @click="load" />
    </div>

    <el-tabs v-model="tab" class="course-tabs">
      <!-- ============ 课程库 ============ -->
      <el-tab-pane label="课程库" name="courses">
        <div class="toolbar">
          <el-button type="primary" :icon="Plus" @click="openCourseCreate">新增课程</el-button>
          <el-button :icon="Upload" @click="openImport('courses')">导入课程</el-button>
          <el-button :icon="Download" @click="exportCourses">导出</el-button>
        </div>
        <el-table :data="courses" v-loading="loading" stripe>
          <el-table-column prop="code" label="编码" width="110" />
          <el-table-column prop="name" label="课程名称" min-width="180" />
          <el-table-column prop="credit" label="学分" width="70" align="center" />
          <el-table-column prop="hours" label="学时" width="70" align="center" />
          <el-table-column label="开课院系" width="140">
            <template #default="{ row }">{{ deptName(row.dept_id) }}</template>
          </el-table-column>
          <el-table-column prop="class_count" label="排课数" width="80" align="center" />
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '开设' : '停开' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" align="center">
            <template #default="{ row }">
              <el-button link type="primary" @click="openCourseEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="delCourse(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ============ 排课管理 ============ -->
      <el-tab-pane label="排课管理" name="classes">
        <div class="toolbar">
          <el-button type="primary" :icon="Plus" @click="openClassCreate">新增排课</el-button>
          <el-button :icon="Upload" @click="openImport('schedule')">导入排课</el-button>
        </div>
        <el-table :data="classes" v-loading="loading" stripe>
          <el-table-column prop="course_code" label="课程编码" width="110" />
          <el-table-column prop="course_name" label="课程" min-width="160" />
          <el-table-column prop="teacher_name" label="任课教师" width="100" />
          <el-table-column prop="term" label="学期" width="120" />
          <el-table-column label="时间" width="130">
            <template #default="{ row }">{{ WEEK[row.week_day] }} · {{ row.section }}</template>
          </el-table-column>
          <el-table-column prop="classroom" label="教室" width="130" />
          <el-table-column label="已选/容量" width="100" align="center">
            <template #default="{ row }">{{ row.enrolled }}/{{ row.capacity }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '开放' : '停选' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" align="center">
            <template #default="{ row }">
              <el-button link type="primary" @click="openClassEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="delClass(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 课程编辑 -->
    <el-dialog v-model="courseDlg" :title="courseForm.id ? '编辑课程' : '新增课程'" width="440px">
      <el-form label-width="80px">
        <el-form-item label="编码"><el-input v-model="courseForm.code" :disabled="!!courseForm.id" placeholder="如 CS101" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="courseForm.name" /></el-form-item>
        <el-form-item label="学分"><el-input-number v-model="courseForm.credit" :min="0.5" :max="20" :step="0.5" /></el-form-item>
        <el-form-item label="学时"><el-input-number v-model="courseForm.hours" :min="8" :max="200" :step="8" /></el-form-item>
        <el-form-item label="院系">
          <el-select v-model="courseForm.deptId" clearable placeholder="选择院系" style="width: 100%">
            <el-option v-for="d in depts" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="courseForm.status" :active-value="1" :inactive-value="0" active-text="开设" inactive-text="停开" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="courseDlg = false">取消</el-button>
        <el-button type="primary" @click="saveCourse">保存</el-button>
      </template>
    </el-dialog>

    <!-- 排课编辑 -->
    <el-dialog v-model="classDlg" :title="classForm.id ? '编辑排课' : '新增排课'" width="480px">
      <el-form label-width="80px">
        <el-form-item label="课程">
          <el-select v-model="classForm.courseId" filterable style="width: 100%">
            <el-option v-for="c in courses" :key="c.id" :label="`${c.code} ${c.name}`" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="任课教师">
          <el-select v-model="classForm.teacherId" filterable style="width: 100%">
            <el-option v-for="t in teachers" :key="t.id" :label="`${t.real_name}（${t.user_no}）`" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="学期"><el-input v-model="classForm.term" placeholder="2026-2027-1" /></el-form-item>
        <el-form-item label="时间">
          <div class="time-row">
            <el-select v-model="classForm.weekDay" style="width: 110px">
              <el-option v-for="(w, i) in WEEK.slice(1)" :key="i" :label="w" :value="i + 1" />
            </el-select>
            <el-select v-model="classForm.section" filterable allow-create style="width: 130px">
              <el-option v-for="p in PERIODS" :key="p" :label="p" :value="p" />
            </el-select>
          </div>
        </el-form-item>
        <el-form-item label="教室"><el-input v-model="classForm.classroom" placeholder="如 教学楼 A101" /></el-form-item>
        <el-form-item label="容量"><el-input-number v-model="classForm.capacity" :min="1" :max="500" /></el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="classForm.status" :active-value="1" :inactive-value="0" active-text="开放选课" inactive-text="停选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="classDlg = false">取消</el-button>
        <el-button type="primary" @click="saveClass">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入 -->
    <el-dialog v-model="importDlg" :title="importType === 'courses' ? '导入课程（CSV）' : '导入排课（CSV）'" width="560px">
      <el-alert :title="'CSV 列格式（可从 Excel 复制粘贴）：'" type="info" :closable="false" style="margin-bottom: 10px" />
      <pre class="tpl">{{ importTpl }}</pre>
      <el-input v-model="importCsv" type="textarea" :rows="7" placeholder="粘贴 CSV 数据，或点击下方选择文件" />
      <div style="margin-top: 10px">
        <input type="file" accept=".csv,.txt" @change="onCsvFile" />
      </div>
      <el-alert
        v-if="importResult"
        :title="`新增 ${importResult.created ?? 0}，更新 ${importResult.updated ?? 0}，问题 ${importResult.errors?.length || 0} 条`"
        :type="(importResult.errors?.length || 0) ? 'warning' : 'success'"
        style="margin-top: 10px"
        :closable="false"
      />
      <ul v-if="importResult?.errors?.length" class="err-list">
        <li v-for="(e, i) in importResult.errors" :key="i">{{ e }}</li>
      </ul>
      <template #footer>
        <el-button @click="importDlg = false">关闭</el-button>
        <el-button type="primary" @click="doImport">开始导入</el-button>
      </template>
    </el-dialog>
  </PortalShell>
</template>

<style scoped>
.page-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
.page-head h2 { margin: 0; font-size: 22px; color: var(--zc-navy, #17325c); }
.page-head p { margin: 4px 0 0; font-size: 13px; color: var(--zc-text-sub, #64748b); }
.toolbar { display: flex; gap: 10px; margin-bottom: 14px; }
.course-tabs { background: var(--zc-glass, #fff); border-radius: 14px; padding: 6px 18px 18px; }
.time-row { display: flex; gap: 8px; }
.tpl { background: #f1f5f9; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #334155; margin-bottom: 10px; white-space: pre-wrap; }
.err-list { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: #b45309; max-height: 120px; overflow: auto; }
</style>
