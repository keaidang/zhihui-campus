<template>
  <PortalShell active="af-repair-m">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>报修处理</h2>
          <p>全校报修工单 · 受理后跟进完成</p>
        </div>
        <el-radio-group v-model="filter" @change="load">
          <el-radio-button value="0">待受理</el-radio-button>
          <el-radio-button value="1">处理中</el-radio-button>
          <el-radio-button value="2">已完成</el-radio-button>
          <el-radio-button value="3">无法处理</el-radio-button>
          <el-radio-button value="">全部</el-radio-button>
        </el-radio-group>
      </header>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column prop="id" label="#" width="60" />
        <el-table-column prop="real_name" label="报修人" width="90" />
        <el-table-column prop="location" label="位置" min-width="130" show-overflow-tooltip />
        <el-table-column prop="category" label="类型" width="80" align="center" />
        <el-table-column prop="description" label="描述" min-width="170" show-overflow-tooltip />
        <!-- C8 AI 分诊：紧急度 + 责任部门 + 给学生的一句话（未开启时显示 —，不占视觉重量） -->
        <el-table-column label="AI 分诊" min-width="190">
          <template #default="{ row }">
            <template v-if="row.triage && row.triage.dept">
              <el-tag :type="urgencyTag(row.triage.urgencyLabel)" size="small" effect="plain" round>
                {{ row.triage.urgencyLabel }}
              </el-tag>
              <span class="tri-dept">{{ row.triage.dept }}</span>
              <p v-if="row.triage.suggestion" class="tri-sug">{{ row.triage.suggestion }}</p>
            </template>
            <span v-else class="small muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="contact" label="电话" width="120" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="tagType(row.status)" size="small" effect="light" round>{{ row.status_text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }"><span class="small">{{ fmt(row.created_at) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="230" align="center">
          <template #default="{ row }">
            <template v-if="row.status === 0 || row.status === 1">
              <el-button v-if="row.status === 0" type="primary" size="small" round @click="open(row, 'accept')">受理</el-button>
              <el-button v-else type="success" size="small" round @click="open(row, 'finish')">完成</el-button>
              <el-button type="danger" size="small" round plain @click="open(row, 'reject')">无法处理</el-button>
            </template>
            <span v-else class="small muted">{{ row.handler_name || '—' }}</span>
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 工单详情：当前状态 + 状态机进度 + 历次变更原因（数据源 sys_op_log） -->
    <!-- 宽度 520 → 880：详情要放工单信息 + 四态链 + 处理时间线，520 太挤 -->
    <el-dialog v-model="detailVisible" title="报修工单详情" width="880px">
      <template v-if="detail">
        <div class="dt-head">
          <b>{{ detail.location }}</b>
          <el-tag :type="tagType(detail.status)" size="small" effect="dark" round>{{ detail.statusText }}</el-tag>
        </div>
        <p class="dt-desc">{{ detail.description }}</p>

        <div class="dt-grid">
          <span>报修人</span><em>{{ detail.user_name }}（{{ detail.username }}）</em>
          <span>联系电话</span><em>{{ detail.contact || '—' }}</em>
          <span>类型</span><em>{{ detail.category }}</em>
          <span>提交时间</span><em>{{ fmt(detail.created_at) }}</em>
          <span>处理人</span><em>{{ detail.handler_name || '待派单' }}</em>
          <template v-if="detail.remark"><span>当前处理说明</span><em>{{ detail.remark }}</em></template>
        </div>

        <!-- 状态机：四态单向推进（不是审批流，无"驳回"语义）
             只高亮当前态、不推断历史路径 —— 历史走哪条分支看下面的处理记录，避免视觉上臆造 -->
        <div class="dt-flow">
          <span
            v-for="(s, i) in STATUS_CHAIN"
            :key="s.v"
            class="dt-step"
            :class="{ on: s.v === detail.status, end: s.v >= 2 }"
          >
            {{ s.t }}<i v-if="i < STATUS_CHAIN.length - 1" class="dt-arrow">→</i>
          </span>
        </div>

        <h4 class="dt-h4">处理记录</h4>
        <el-timeline v-if="detail.logs.length" class="dt-tl">
          <el-timeline-item
            v-for="(lg, i) in detail.logs"
            :key="i"
            :timestamp="fmt(lg.at)"
            placement="top"
            :type="lg.action === 'repair.reject' ? 'danger' : lg.action === 'repair.finish' ? 'success' : 'primary'"
          >
            <b>{{ lg.label }}</b>
            <span v-if="lg.operatorName" class="dt-op">· {{ lg.operatorName }}</span>
            <p v-if="lg.detail" class="dt-reason">{{ lg.detail }}</p>
          </el-timeline-item>
        </el-timeline>
        <p v-else class="small muted">
          该工单尚无处理记录（历史导入数据不产生操作日志）。每次状态变更都会通过站内信通知报修人。
        </p>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dialogVisible" :title="DLG_TITLE[action]" width="440px">
      <p class="dlg-sub">{{ current?.location }} · {{ current?.category }} · {{ current?.description }}</p>
      <el-input
        v-model="remark"
        type="textarea"
        :rows="3"
        maxlength="256"
        :placeholder="action === 'reject' ? '无法处理的原因（必填，会通知报修人）' : '处理备注（选填）'"
      />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button :type="action === 'finish' ? 'success' : action === 'reject' ? 'danger' : 'primary'" :loading="saving" @click="confirm">
          确认
        </el-button>
      </template>
    </el-dialog>
  </PortalShell>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';

const list = ref([]);
const loading = ref(false);
const filter = ref('0');
const dialogVisible = ref(false);
const current = ref(null);
const action = ref('accept');
const remark = ref('');
const saving = ref(false);

// 工单详情（当前状态 + 处理记录），数据源 GET /api/af/repair?id=
const detailVisible = ref(false);
const detail = ref(null);
// 四态链：0 待受理 → 1 处理中 → 2 已完成；0/1 也可直接 → 3 无法处理（终态）
const STATUS_CHAIN = [
  { v: 0, t: '待受理' },
  { v: 1, t: '处理中' },
  { v: 2, t: '已完成' },
  { v: 3, t: '无法处理' },
];

async function openDetail(row) {
  detail.value = null;
  detailVisible.value = true;
  try {
    const res = await api(`/api/af/repair?id=${row.id}`);
    if (res.code === 0) detail.value = res.data;
    else {
      ElMessage.error(res.message || '加载工单详情失败');
      detailVisible.value = false;
    }
  } catch {
    ElMessage.error('加载工单详情失败');
    detailVisible.value = false;
  }
}

// 工单状态机文案（与后端 af/repair.js 的 FLOW 对齐：「无法处理」为终态，需填原因）
const DLG_TITLE = { accept: '受理工单', finish: '完成工单', reject: '标记无法处理' };
const tagType = (s) => ({ 0: 'warning', 1: 'primary', 2: 'success', 3: 'danger' }[s] || 'info');
// C8 分诊紧急度的标签配色（后端给的是中文标签，这里做展示映射）
const urgencyTag = (label) => ({ 紧急: 'danger', 较急: 'warning', 一般: 'info', 不急: 'success' }[label] || 'info');
// 时间统一走 utils/time.js：库内存 UTC，这里转北京时间展示（勿再手写字符串截断）
import { fmtTime as fmt } from '../../utils/time';

async function load() {
  loading.value = true;
  try {
    const q = filter.value !== '' ? `?status=${filter.value}` : '';
    const res = await api(`/api/af/repair${q}`);
    if (res.code === 0) list.value = res.data.list;
    else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function open(row, act) {
  current.value = row;
  action.value = act;
  remark.value = '';
  dialogVisible.value = true;
}

async function confirm() {
  // 「无法处理」必须填原因：报修人看到的就是这个 remark 字段，留空则工单被关闭却无从解释
  if (action.value === 'reject' && !remark.value.trim()) {
    ElMessage.warning('请填写无法处理的原因');
    return;
  }
  saving.value = true;
  try {
    const res = await api('/api/af/repair', {
      method: 'POST',
      body: { action: action.value, id: current.value.id, remark: remark.value.trim() },
    });
    if (res.code === 0) {
      ElMessage.success(res.message || '已处理');
      dialogVisible.value = false;
      await load();
    } else {
      ElMessage.error(res.message || '操作失败');
    }
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.pg-card {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 14px;
  padding: 22px 24px;
  box-shadow: 0 6px 24px rgba(23, 50, 92, 0.07);
}
.pg-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 14px; flex-wrap: wrap; }
.pg-head h2 { margin: 0 0 6px; font-size: 19px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.small { font-size: 12.5px; }
/* C8 分诊展示 */
.tri-dept { margin-left: 6px; font-size: 12.5px; color: var(--zc-navy); }
.tri-sug { margin: 3px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--zc-text-sub); }
.muted { color: var(--zc-text-sub); }
.dlg-sub { margin: 0 0 12px; font-size: 13px; color: var(--zc-text-sub); }

/* 工单详情弹窗 */
.dt-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--zc-navy);
}
.dt-desc {
  margin: 6px 0 12px;
  font-size: 13px;
  line-height: 1.7;
  color: #475569;
  background: #f7f9fc;
  border-radius: 8px;
  padding: 10px 12px;
}
.dt-grid {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 6px 10px;
  font-size: 12.5px;
  margin-bottom: 14px;
}
.dt-grid span { color: #94a3b8; }
.dt-grid em { font-style: normal; color: #334155; word-break: break-all; }
.dt-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 10px 12px;
  background: #f7f9fc;
  border: 1px solid var(--zc-border);
  border-radius: 8px;
  margin-bottom: 16px;
}
.dt-step {
  font-size: 12px;
  color: #94a3b8;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2f7;
}
.dt-step.end { color: #b45309; background: #fef3c7; }
.dt-step.on {
  color: #fff;
  background: #2563eb;
  font-weight: 600;
}
.dt-step.on.end { background: #b45309; }
.dt-arrow { font-style: normal; margin-left: 8px; color: #cbd5e1; }
.dt-step.on .dt-arrow { color: rgba(255, 255, 255, 0.7); }
.dt-h4 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--zc-navy);
}
.dt-tl { padding-left: 2px; }
.dt-op { color: #94a3b8; font-size: 12px; margin-left: 4px; }
.dt-reason {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: #475569;
  background: #f7f9fc;
  border-radius: 6px;
  padding: 6px 10px;
}
</style>
