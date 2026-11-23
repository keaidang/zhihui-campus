<template>
  <PortalShell active="af-approve">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>请假审批</h2>
          <p>{{ isDept ? '本院学生的请假申请' : '全校请假申请' }} · 实时待办</p>
        </div>
        <el-radio-group v-model="filter" @change="load">
          <el-radio-button value="1">待审批</el-radio-button>
          <el-radio-button value="2">已批准</el-radio-button>
          <el-radio-button value="3">已驳回</el-radio-button>
          <el-radio-button value="">全部</el-radio-button>
        </el-radio-group>
      </header>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column prop="real_name" label="学生" width="90" />
        <el-table-column prop="user_no" label="学号" width="100" />
        <el-table-column prop="class_name" label="班级" min-width="120" show-overflow-tooltip />
        <el-table-column prop="type" label="类型" width="70" align="center" />
        <el-table-column label="时段" width="230">
          <template #default="{ row }">
            <span class="small">{{ fmt(row.start_at) }} ~ {{ fmt(row.end_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="事由" min-width="150" show-overflow-tooltip />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="tagType(row.status)" size="small" effect="light" round>{{ row.status_text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center">
          <template #default="{ row }">
            <template v-if="row.status === 1">
              <el-button type="primary" size="small" round @click="open(row, true)">通过</el-button>
              <el-button type="danger" plain size="small" round @click="open(row, false)">驳回</el-button>
            </template>
            <span v-else class="small muted">{{ row.opinion || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 审批意见 -->
    <!-- 宽度 440 → 860：这个弹窗现在要放「提交→辅导员→院系复核」时间线，440 装不下（挤成两行看不清） -->
    <el-dialog v-model="dialogVisible" :title="approving ? '通过申请' : '驳回申请'" width="860px">
      <p class="dlg-sub">
        {{ current?.real_name }} · {{ current?.type }} · {{ fmt(current?.start_at) }} ~ {{ fmt(current?.end_at) }}
      </p>

      <!-- 审批流程时间线：申请人 → 辅导员审批 → 院系复核
           数据来自 GET /api/af/leave?id=（flow_node 逐节点），
           当前停留节点高亮；已处理节点显示处理人 / 时间 / 意见 -->
      <div v-if="nodes.length" class="flow-tl">
        <div class="flow-item start done">
          <span class="flow-dot"></span>
          <div class="flow-body">
            <div class="flow-head">
              <b>提交申请</b>
              <span class="flow-st">已提交</span>
            </div>
            <div class="flow-meta">
              <span v-if="current?.real_name">{{ current.real_name }}</span>
              <span v-if="current?.created_at">{{ fmt(current.created_at) }}</span>
              <em v-if="current?.type">{{ current.type }}</em>
            </div>
          </div>
        </div>
        <div
          v-for="n in nodes"
          :key="n.order"
          class="flow-item"
          :class="{ cur: n.current, done: n.status === 1, rej: n.status === 2 }"
        >
          <span class="flow-dot"></span>
          <div class="flow-body">
            <div class="flow-head">
              <b>{{ n.name }}</b>
              <span class="flow-st">{{
                n.status === 1 ? '已通过' : n.status === 2 ? '已驳回' : n.current ? '当前环节' : '待流转'
              }}</span>
            </div>
            <div class="flow-meta">
              <span v-if="n.handlerName">{{ n.handlerName }}</span>
              <span v-if="n.handledAt">{{ fmt(n.handledAt) }}</span>
              <em v-if="n.opinion">{{ n.opinion }}</em>
            </div>
          </div>
        </div>
      </div>
      <!-- C4 AI 审批助手：只给建议，绝不代替人工决定（开关未开时不显示） -->
      <div v-if="adviceOn" class="ai-advice">
        <div v-if="adviceLoading" class="ai-advice-loading">AI 正在分析该申请…</div>
        <template v-else-if="advice">
          <div class="ai-advice-head">
            <span class="ai-advice-title">AI 建议</span>
            <el-tag :type="adviceTag(advice.suggestion)" size="small" effect="dark" round>
              {{ adviceLabel(advice.suggestion) }}
            </el-tag>
            <span class="ai-advice-conf">置信度 {{ Math.round((advice.confidence || 0) * 100) }}%</span>
            <span v-if="advice.degraded" class="ai-advice-deg">（AI 降级结果，仅供参考）</span>
          </div>
          <p class="ai-advice-reason">{{ advice.reason }}</p>
          <ul v-if="advice.risk && advice.risk.length" class="ai-advice-risk">
            <li v-for="(r, i) in advice.risk" :key="i">{{ r }}</li>
          </ul>
          <div class="ai-advice-ops">
            <el-button link size="small" type="primary" @click="adoptAdvice">采纳建议理由到意见框</el-button>
            <span class="ai-advice-tip">最终决定权在你 —— AI 不参与审批</span>
          </div>
        </template>
      </div>

      <el-input v-model="opinion" type="textarea" :rows="3" maxlength="256" :placeholder="approving ? '审批意见（选填）' : '请填写驳回原因'" />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button :type="approving ? 'primary' : 'danger'" :loading="saving" @click="confirm">
          {{ approving ? '确认通过' : '确认驳回' }}
        </el-button>
      </template>
    </el-dialog>
  </PortalShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PortalShell from '../../components/PortalShell.vue';
import { useAuthStore } from '../../stores/auth';
import { useAiStore } from '../../stores/ai';
import { api } from '../../api/request';

const auth = useAuthStore();
const ai = useAiStore();
const isDept = computed(() => !auth.hasRole(['admin']));
const list = ref([]);
const loading = ref(false);
const filter = ref('1');
const dialogVisible = ref(false);
const approving = ref(true);
const saving = ref(false);
const current = ref(null);
const opinion = ref('');
const nodes = ref([]);

// ---- C4 AI 审批助手（只建议，不自动审批）----
const adviceOn = computed(() => Boolean(ai.features.approvalAdvice));
const advice = ref(null);
const adviceLoading = ref(false);

const adviceLabel = (s2) => ({ approve: '建议通过', reject: '建议驳回', manual: '建议人工核实' }[s2] || '建议人工核实');
const adviceTag = (s2) => ({ approve: 'success', reject: 'danger', manual: 'warning' }[s2] || 'info');

async function loadAdvice(leaveId) {
  advice.value = null;
  if (!adviceOn.value) return;
  adviceLoading.value = true;
  try {
    const res = await api(`/api/ai/approval-advice?leaveId=${leaveId}`);
    if (res.code === 0 && res.data?.enabled) advice.value = res.data;
  } catch {
    /* 建议拿不到不影响审批本身 */
  } finally {
    adviceLoading.value = false;
  }
}

/** 把 AI 理由填进意见框（仍是人工点确认才生效） */
function adoptAdvice() {
  if (!advice.value) return;
  const prefix = advice.value.suggestion === 'approve' ? '同意' : advice.value.suggestion === 'reject' ? '不同意：' : '';
  opinion.value = `${prefix}${advice.value.reason}`.slice(0, 256);
}

const tagType = (s) => ({ 1: 'warning', 2: 'primary', 3: 'danger', 4: 'success' }[s] || 'info');
// 时间统一走 utils/time.js：库内存 UTC，这里转北京时间展示（勿再手写字符串截断）
import { fmtTime as fmt } from '../../utils/time';

async function load() {
  loading.value = true;
  try {
    const q = filter.value ? `?status=${filter.value}` : '';
    const res = await api(`/api/af/leave${q}`);
    if (res.code === 0) list.value = res.data.list;
    else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function open(row, yes) {
  current.value = row;
  approving.value = yes;
  opinion.value = '';
  nodes.value = [];
  dialogVisible.value = true;
  // 打开对话框时才去请求建议（不给列表页增加 N 次调用）
  loadAdvice(row.id);
  loadNodes(row.id);
}

/** 拉取该单据的流程节点（用于时间线）。失败不影响审批本身。 */
async function loadNodes(leaveId) {
  try {
    const res = await api(`/api/af/leave?id=${leaveId}`);
    if (res.code === 0) nodes.value = res.data?.nodes || [];
  } catch {
    /* 拿不到时间线不阻塞审批 */
  }
}

async function confirm() {
  if (!approving.value && !opinion.value.trim()) {
    ElMessage.warning('请填写驳回原因');
    return;
  }
  saving.value = true;
  try {
    const res = await api('/api/af/leave', {
      method: 'POST',
      body: {
        action: approving.value ? 'approve' : 'reject',
        leaveId: current.value.id,
        opinion: opinion.value.trim(),
      },
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

onMounted(async () => {
  await load();
  // 只拉一次能力清单（store 内按用户去重，悬浮球/菜单已拉过就不会重复请求）
  await ai.load(auth.user?.id ?? null);
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
.pg-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 14px; flex-wrap: wrap; }
.pg-head h2 { margin: 0 0 6px; font-size: 19px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.small { font-size: 12.5px; }
.muted { color: var(--zc-text-sub); }
.dlg-sub { margin: 0 0 12px; font-size: 13px; color: var(--zc-text-sub); }

/* 审批流程时间线（申请人 → 辅导员审批 → 院系复核） */
.flow-tl {
  position: relative;
  margin: 0 0 14px;
  padding: 10px 12px 4px;
  background: #f7f9fc;
  border: 1px solid var(--zc-border);
  border-radius: 10px;
}
.flow-item {
  position: relative;
  display: flex;
  gap: 10px;
  padding-bottom: 12px;
}
.flow-item:last-child { padding-bottom: 4px; }
/* 竖线：从圆点往下连，最后一项不画 */
.flow-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 12px;
  bottom: 0;
  width: 1px;
  background: #d6dfea;
}
.flow-dot {
  flex: none;
  width: 9px;
  height: 9px;
  margin-top: 4px;
  border-radius: 50%;
  background: #cbd5e1;
  box-shadow: 0 0 0 3px #f7f9fc;
}
.flow-item.done .flow-dot { background: #16a34a; }
.flow-item.rej .flow-dot { background: #dc2626; }
.flow-item.cur .flow-dot {
  background: #2563eb;
  box-shadow: 0 0 0 3px #dbeafe;
}
.flow-body { flex: 1; min-width: 0; }
.flow-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: #1e293b;
}
.flow-head b { font-weight: 600; }
.flow-st {
  font-size: 11px;
  color: #64748b;
  padding: 1px 6px;
  border-radius: 999px;
  background: #eef2f7;
}
.flow-item.cur .flow-st { color: #1d4ed8; background: #dbeafe; }
.flow-item.done .flow-st { color: #15803d; background: #dcfce7; }
.flow-item.rej .flow-st { color: #b91c1c; background: #fee2e2; }
.flow-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
  font-size: 11.5px;
  color: #94a3b8;
}
.flow-meta em {
  font-style: normal;
  color: #475569;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* C4 AI 建议卡片 */
.ai-advice {
  margin: 0 0 12px;
  padding: 11px 13px;
  border: 1px solid #e2e8f0;
  border-left: 3px solid #1d9e75;
  border-radius: 8px;
  background: #f8fbf9;
}
.ai-advice-loading { font-size: 12.5px; color: var(--zc-text-sub); }
.ai-advice-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ai-advice-title { font-size: 13px; font-weight: 600; color: var(--zc-navy); }
.ai-advice-conf { font-size: 12px; color: var(--zc-text-sub); }
.ai-advice-deg { font-size: 12px; color: #b45309; }
.ai-advice-reason { margin: 8px 0 0; font-size: 13px; line-height: 1.7; color: var(--zc-text); }
.ai-advice-risk { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; line-height: 1.8; color: #9a3412; }
.ai-advice-ops { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.ai-advice-tip { font-size: 11.5px; color: var(--zc-text-sub); }
</style>
