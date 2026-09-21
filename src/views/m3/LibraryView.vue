<template>
  <PortalShell active="library">
    <div class="lib-page">
      <header class="pg-head">
        <div>
          <h2>图书借阅</h2>
          <p>馆藏检索 · 在线借阅 · 到期提醒</p>
        </div>
        <div class="pg-head-actions">
          <el-radio-group v-model="tab" size="large">
            <el-radio-button value="search">馆藏检索</el-radio-button>
            <el-radio-button value="loans">我的借阅</el-radio-button>
            <el-radio-button v-if="auth.hasRole(['admin'])" value="manage">管理后台</el-radio-button>
          </el-radio-group>
        </div>
      </header>

      <!-- 检索 -->
      <section v-show="tab === 'search'" class="lib-panel">
        <div class="lib-toolbar">
          <el-input v-model="query.keyword" placeholder="书名 / 作者 / ISBN" clearable style="width: 260px" @keyup.enter="load(1)" />
          <el-select v-model="query.category" clearable placeholder="全部分类" style="width: 130px">
            <el-option v-for="c in CATEGORIES" :key="c" :label="c" :value="c" />
          </el-select>
          <el-button type="primary" @click="load(1)">搜索</el-button>
        </div>
        <div v-if="loading" class="lib-loading" v-loading="true" element-loading-text="检索中…" style="min-height: 220px"></div>
        <template v-else>
          <p v-if="books.length === 0" class="lib-empty">没有找到相关藏书</p>
          <div class="lib-grid">
            <div v-for="b in books" :key="b.id" class="lib-card" @click="openBook(b)">
              <div class="lib-cover">
                <img v-if="b.coverUrl" :src="b.coverUrl" alt="" loading="lazy" />
                <span v-else class="lib-cover-fallback">{{ b.title.slice(0, 2) }}</span>
              </div>
              <h4 :title="b.title">{{ b.title }}</h4>
              <p class="lib-meta">{{ b.author || '佚名' }} · {{ b.category }}</p>
              <p class="lib-loc" :title="b.location">{{ b.location || '馆藏位置待定' }}</p>
              <span class="lib-badge" :class="b.availableCopies > 0 ? 'ok' : 'out'">
                {{ b.availableCopies > 0 ? `可借 ${b.availableCopies}/${b.totalCopies}` : '已借空' }}
              </span>
            </div>
          </div>
          <el-pagination
            v-if="total > query.pageSize"
            layout="prev, pager, next, total"
            :total="total"
            :page-size="query.pageSize"
            :current-page="query.page"
            @current-change="(p) => load(p)"
            style="margin-top: 16px; justify-content: flex-end"
          />
        </template>
      </section>

      <!-- 我的借阅 -->
      <section v-show="tab === 'loans'" class="lib-panel">
        <el-alert v-if="overdueCount > 0" type="error" :closable="false" show-icon style="margin-bottom: 12px"
          :title="`你有 ${overdueCount} 本图书已逾期，请尽快归还`" />
        <el-table :data="loans" stripe>
          <el-table-column prop="title" label="书名" min-width="180" show-overflow-tooltip />
          <el-table-column prop="author" label="作者" width="110" show-overflow-tooltip />
          <el-table-column label="借出日期" width="110">
            <template #default="{ row }">{{ day(row.borrowedAt) }}</template>
          </el-table-column>
          <el-table-column label="应还日期" width="110">
            <template #default="{ row }">
              <span :class="{ 'overdue-text': isOverdue(row) }">{{ day(row.dueAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.status === 1" type="success" size="small">已归还</el-tag>
              <el-tag v-else-if="row.status === 2 || isOverdue(row)" type="danger" size="small">逾期</el-tag>
              <el-tag v-else type="primary" size="small">借出中</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button v-if="row.status === 0" size="small" type="primary" plain @click="doReturn(row)">归还</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <!-- 管理后台（admin） -->
      <section v-show="tab === 'manage'" class="lib-panel">
        <div class="lib-toolbar">
          <el-button type="primary" @click="openAdd">添加书籍</el-button>
          <el-button @click="importDlg = true">批量导入</el-button>
          <el-button @click="exportTemplate">下载导入模板</el-button>
          <el-input v-model="loansKeyword" placeholder="按书名/借阅人搜索借阅" clearable style="width: 240px; margin-left: auto" @keyup.enter="loadLoans" />
          <el-button @click="loadLoans">查询</el-button>
        </div>
        <p class="lib-hint">提示：批量导入支持 CSV（书名,作者,ISBN,出版社,分类,馆藏位置,副本数），首行为表头；也可粘贴 JSON 数组。</p>

        <el-table :data="allLoans" stripe style="margin-top: 12px">
          <el-table-column prop="title" label="书名" min-width="160" show-overflow-tooltip />
          <el-table-column prop="borrowerName" label="借阅人" width="100" />
          <el-table-column prop="username" label="账号" width="120" show-overflow-tooltip />
          <el-table-column label="借出" width="100"><template #default="{ row }">{{ day(row.borrowedAt) }}</template></el-table-column>
          <el-table-column label="应还" width="100">
            <template #default="{ row }"><span :class="{ 'overdue-text': isOverdue(row) }">{{ day(row.dueAt) }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.status === 1" type="success" size="small">已归还</el-tag>
              <el-tag v-else-if="row.status === 2 || isOverdue(row)" type="danger" size="small">逾期</el-tag>
              <el-tag v-else type="primary" size="small">借出中</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button v-if="row.status === 0" size="small" type="primary" plain @click="doReturn(row)">代还</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <!-- 书籍详情 -->
      <el-dialog v-model="detailDlg" :title="current?.title" width="440px">
        <div class="lib-detail" v-if="current">
          <div class="lib-cover big">
            <img v-if="current.coverUrl" :src="current.coverUrl" alt="" />
            <span v-else class="lib-cover-fallback">{{ current.title.slice(0, 2) }}</span>
          </div>
          <ul>
            <li><em>作者</em><span>{{ current.author || '佚名' }}</span></li>
            <li><em>ISBN</em><span>{{ current.isbn || '—' }}</span></li>
            <li><em>出版社</em><span>{{ current.publisher || '—' }}</span></li>
            <li><em>分类</em><span>{{ current.category }}</span></li>
            <li><em>馆藏位置</em><span>{{ current.location || '待定' }}</span></li>
            <li><em>馆藏</em><span>共 {{ current.totalCopies }} 册，可借 {{ current.availableCopies }} 册</span></li>
            <li v-if="current.extSource"><em>数据来源</em><span>{{ current.extSource }}（外部系统对接）</span></li>
          </ul>
        </div>
        <template #footer>
          <el-button @click="detailDlg = false">关闭</el-button>
          <el-button type="primary" :disabled="!current || current.availableCopies <= 0" :loading="borrowing" @click="doBorrow">
            {{ current?.availableCopies > 0 ? '借阅（30 天）' : '暂无可借副本' }}
          </el-button>
        </template>
      </el-dialog>

      <!-- 添加/编辑书籍 -->
      <el-dialog v-model="addDlg" :title="editId ? '编辑书籍' : '添加书籍'" width="480px">
        <el-form label-width="76px">
          <el-form-item label="书名"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="作者"><el-input v-model="form.author" /></el-form-item>
          <el-form-item label="ISBN"><el-input v-model="form.isbn" /></el-form-item>
          <el-form-item label="出版社"><el-input v-model="form.publisher" /></el-form-item>
          <el-form-item label="分类">
            <el-select v-model="form.category" style="width: 100%">
              <el-option v-for="c in CATEGORIES" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item>
          <el-form-item label="馆藏位置"><el-input v-model="form.location" placeholder="如 图书馆3楼A区01架" /></el-form-item>
          <el-form-item label="副本数"><el-input-number v-model="form.copies" :min="1" :max="99" /></el-form-item>
          <el-form-item label="封面图">
            <ImgUploader v-model="form.coverUrl" :max="1" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="addDlg = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="saveBook">保存</el-button>
        </template>
      </el-dialog>

      <!-- 批量导入 -->
      <el-dialog v-model="importDlg" title="批量导入藏书" width="560px">
        <p class="lib-hint">粘贴 CSV（每行：书名,作者,ISBN,出版社,分类,馆藏位置,副本数）或 JSON 数组。已存在的 ISBN 自动跳过。</p>
        <el-input v-model="importText" type="textarea" :rows="12" placeholder="书名,作者,ISBN,出版社,计算机,图书馆3楼A区01架,3&#10;算法导论,Thomas H. Cormen,9787111407010,机械工业出版社,计算机,图书馆3楼B区12架,5" />
        <template #footer>
          <el-button @click="importDlg = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="doImport">导入</el-button>
        </template>
      </el-dialog>
    </div>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PortalShell from '../../components/PortalShell.vue';
import ImgUploader from '../../components/ImgUploader.vue';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/request';

const auth = useAuthStore();
const CATEGORIES = ['计算机', 'AI', '金融', '文学', '历史', '科学', '艺术', '教育', '综合'];

const tab = ref('search');
const loading = ref(false);
const query = reactive({ keyword: '', category: '', page: 1, pageSize: 12 });
const books = ref([]);
const total = ref(0);

const loans = ref([]);
const allLoans = ref([]);
const loansKeyword = ref('');

const detailDlg = ref(false);
const current = ref(null);
const borrowing = ref(false);

const addDlg = ref(false);
const editId = ref(0);
const saving = ref(false);
const importDlg = ref(false);
const importText = ref('');
const form = reactive({ title: '', author: '', isbn: '', publisher: '', category: '综合', location: '', copies: 1, coverUrl: [] });

const overdueCount = computed(() => loans.value.filter((l) => l.status === 0 && isOverdue(l)).length);

const day = (t) => (t ? String(t).slice(0, 10) : '');
const isOverdue = (row) => row.status === 0 && new Date(row.dueAt) < new Date();

async function load(page = 1) {
  loading.value = true;
  query.page = page;
  try {
    const res = await api(`/api/lib/books?keyword=${encodeURIComponent(query.keyword)}&category=${encodeURIComponent(query.category)}&page=${page}&pageSize=${query.pageSize}`);
    if (res.code === 0) {
      books.value = res.data.list;
      total.value = res.data.total;
    } else {
      ElMessage.error(res.message || '检索失败');
    }
  } finally {
    loading.value = false;
  }
}

async function loadLoans() {
  const scope = tab.value === 'manage' ? 'all' : 'mine';
  const res = await api(`/api/lib/loans?scope=${scope}${scope === 'all' && loansKeyword.value ? `&keyword=${encodeURIComponent(loansKeyword.value)}` : ''}`);
  if (res.code === 0) {
    if (scope === 'all') allLoans.value = res.data.list;
    else loans.value = res.data.list;
  }
}

function openBook(b) {
  current.value = b;
  detailDlg.value = true;
}

async function doBorrow() {
  borrowing.value = true;
  try {
    const res = await api('/api/lib/loans', { method: 'POST', body: { action: 'borrow', bookId: current.value.id } });
    if (res.code === 0) {
      ElMessage.success(res.message || '借阅成功');
      detailDlg.value = false;
      load(query.page);
      loadLoans();
    } else {
      ElMessage.error(res.message || '借阅失败');
    }
  } finally {
    borrowing.value = false;
  }
}

async function doReturn(row) {
  const res = await api('/api/lib/loans', { method: 'POST', body: { action: 'return', loanId: row.id } });
  if (res.code === 0) {
    ElMessage.success(res.message || '归还成功');
    loadLoans();
  } else {
    ElMessage.error(res.message || '归还失败');
  }
}

function openAdd() {
  editId.value = 0;
  Object.assign(form, { title: '', author: '', isbn: '', publisher: '', category: '综合', location: '', copies: 1, coverUrl: [] });
  addDlg.value = true;
}

async function saveBook() {
  if (!form.title.trim()) return ElMessage.warning('请填写书名');
  saving.value = true;
  try {
    const payload = {
      action: editId.value ? 'update' : 'add',
      book: {
        title: form.title, author: form.author, isbn: form.isbn, publisher: form.publisher,
        category: form.category, location: form.location, copies: form.copies,
        coverUrl: form.coverUrl[0] || '',
      },
      ...(editId.value ? { id: editId.value } : {}),
    };
    const res = await api('/api/lib/books', { method: 'POST', body: payload });
    if (res.code === 0) {
      ElMessage.success(res.message || '已保存');
      addDlg.value = false;
      load(1);
    } else {
      ElMessage.error(res.message || '保存失败');
    }
  } finally {
    saving.value = false;
  }
}

function csvLine(line) {
  // 简易 CSV 分列（支持引号包裹的逗号）
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function doImport() {
  const text = importText.value.trim();
  if (!text) return ElMessage.warning('请粘贴导入内容');
  let rows = [];
  if (text.startsWith('[')) {
    try {
      rows = JSON.parse(text);
    } catch {
      return ElMessage.error('JSON 解析失败');
    }
  } else {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    for (const line of lines) {
      const c = csvLine(line);
      if (c[0] === '书名') continue; // 表头
      rows.push({ title: c[0], author: c[1], isbn: c[2], publisher: c[3], category: c[4], location: c[5], copies: Number(c[6]) || 1 });
    }
  }
  saving.value = true;
  try {
    const res = await api('/api/lib/books', { method: 'POST', body: { action: 'import', rows } });
    if (res.code === 0) {
      ElMessage.success(res.message || '导入完成');
      importDlg.value = false;
      importText.value = '';
      load(1);
    } else {
      ElMessage.error(res.message || '导入失败');
    }
  } finally {
    saving.value = false;
  }
}

function exportTemplate() {
  const csv = '书名,作者,ISBN,出版社,分类,馆藏位置,副本数\n算法导论,Thomas H. Cormen,9787111407010,机械工业出版社,计算机,图书馆3楼B区12架,5\n红楼梦,曹雪芹,9787020002207,人民文学出版社,文学,图书馆2楼A区03架,4';
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '图书导入模板.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

onMounted(() => {
  load(1);
  loadLoans();
});
</script>

<style scoped>
.pg-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pg-head h2 { margin: 0 0 6px; font-size: 21px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.lib-panel {
  margin-top: 16px;
  background: var(--zc-glass);
  backdrop-filter: blur(14px);
  border: 1px solid var(--zc-glass-border);
  border-radius: 14px;
  padding: 18px;
}
.lib-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.lib-hint { font-size: 12px; color: var(--zc-text-sub); margin: 10px 0 0; line-height: 1.6; }
.lib-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 16px; }
.lib-card {
  position: relative; background: rgba(255, 255, 255, 0.75); border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 12px; padding: 12px; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
}
.lib-card:hover { transform: translateY(-3px); box-shadow: 0 10px 24px rgba(23, 50, 92, 0.12); }
.lib-cover { width: 100%; height: 120px; border-radius: 8px; overflow: hidden; background: linear-gradient(135deg, #2d5a9e, var(--zc-navy)); display: flex; align-items: center; justify-content: center; margin-bottom: 10px; }
.lib-cover img { width: 100%; height: 100%; object-fit: cover; }
.lib-cover-fallback { color: rgba(255, 255, 255, 0.9); font-size: 26px; letter-spacing: 4px; font-weight: 600; }
.lib-cover.big { width: 120px; height: 160px; flex: none; }
.lib-card h4 { margin: 0 0 4px; font-size: 14px; color: var(--zc-navy); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-meta { margin: 0 0 3px; font-size: 12px; color: var(--zc-text-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-loc { margin: 0; font-size: 11.5px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-badge { position: absolute; top: 18px; right: 18px; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.9); }
.lib-badge.ok { color: #0d7a6c; }
.lib-badge.out { color: #b83232; }
.lib-empty { text-align: center; color: var(--zc-text-sub); padding: 40px 0; }
.lib-detail { display: flex; gap: 16px; }
.lib-detail ul { list-style: none; margin: 0; padding: 0; flex: 1; }
.lib-detail li { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px dashed var(--zc-border); font-size: 13px; }
.lib-detail li:last-child { border-bottom: none; }
.lib-detail em { font-style: normal; color: var(--zc-text-sub); flex: none; }
.overdue-text { color: #b83232; font-weight: 600; }
@media (max-width: 1024px) { .lib-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 640px) { .lib-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
