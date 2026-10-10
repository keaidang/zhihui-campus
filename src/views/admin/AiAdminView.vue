<template>
  <PortalShell active="admin-ai">
    <section class="pg-card">
      <header class="pg-head">
        <div>
          <h2>AI 管理控制台</h2>
          <p>
            模型 {{ meta.model || '-' }} · {{ meta.configured ? '已配置' : '未配置密钥' }}
            <span v-if="!meta.configured" class="warn">（未配置密钥时所有 AI 能力自动隐藏入口）</span>
          </p>
        </div>
        <el-button :icon="Refresh" round @click="reload">刷新</el-button>
      </header>

      <el-tabs v-model="tab">
        <!-- ========== 开关 ========== -->
        <el-tab-pane label="功能开关" name="switches">
          <p class="tab-tip">
            开关存在库里（<code>sys_config</code>），<b>改完约 30 秒内在全部实例生效，无需重新部署</b>。
            新 AI 能力默认关闭，由你显式开启。
          </p>
          <el-table v-loading="loading.config" :data="configItems" size="small">
            <el-table-column prop="label" label="功能" min-width="230" />
            <el-table-column prop="key" label="配置键" width="250">
              <template #default="{ row }"><code class="k">{{ row.key }}</code></template>
            </el-table-column>
            <el-table-column label="当前值" width="150">
              <template #default="{ row }">
                <el-tag v-if="row.type === 'bool'" :type="row.value === '1' ? 'success' : 'info'" size="small" effect="dark" round>
                  {{ row.value === '1' ? '已开启' : '已关闭' }}
                </el-tag>
                <span v-else class="mono">{{ row.value || '（空）' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" align="center">
              <template #default="{ row }">
                <el-switch
                  v-if="row.type === 'bool'"
                  :model-value="row.value === '1'"
                  :loading="savingKey === row.key"
                  @change="(v) => setSwitch(row, v ? '1' : '0')"
                />
                <el-button v-else link type="primary" size="small" @click="editValue(row)">修改</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- ========== 审核队列 ========== -->
        <el-tab-pane label="审核队列" name="review">
          <p class="tab-tip">
            论坛 AI 审核员的判定留痕。待复核 = AI 判为可疑或降级放行的内容；
            管理员确认违规会下架内容，标记误判则放行。
          </p>
          <div class="row-btns">
            <el-radio-group v-model="reviewHandled" size="small" @change="loadReview">
              <el-radio-button value="0">待复核</el-radio-button>
              <el-radio-button value="1">已确认违规</el-radio-button>
              <el-radio-button value="2">误判放行</el-radio-button>
              <el-radio-button value="all">全部</el-radio-button>
            </el-radio-group>
          </div>
          <el-table v-loading="loading.review" :data="reviews" size="small">
            <el-table-column prop="id" label="#" width="60" />
            <el-table-column label="对象" width="70">
              <template #default="{ row }">{{ row.biz === 'thread' ? '帖子' : '回复' }}</template>
            </el-table-column>
            <el-table-column prop="author_name" label="作者" width="90" />
            <el-table-column label="判定" width="110">
              <template #default="{ row }">
                <el-tag :type="verdictTag(row.verdict)" size="small" effect="dark" round>{{ row.verdict }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="categories" label="分类" width="110" />
            <el-table-column prop="excerpt" label="内容摘要" min-width="200" show-overflow-tooltip />
            <el-table-column prop="reason" label="AI 理由" min-width="180" show-overflow-tooltip />
            <el-table-column label="操作" width="200" align="center">
              <template #default="{ row }">
                <template v-if="row.handled === 0">
                  <el-button type="danger" link size="small" @click="handleReview(row, true)">确认违规</el-button>
                  <el-button link size="small" @click="handleReview(row, false, false)">误判放行</el-button>
                </template>
                <span v-else class="muted">{{ row.handled === 1 ? '已处置' : '已放行' }}</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination
              background
              layout="prev, pager, next"
              :total="reviewTotal"
              :page-size="20"
              v-model:current-page="reviewPage"
              @current-change="loadReview"
            />
          </div>
        </el-tab-pane>

        <!-- ========== 知识库 ========== -->
        <el-tab-pane label="知识库" name="kb">
          <el-alert type="warning" :closable="false" show-icon class="kb-note" :title="kbNote" />
          <div class="row-btns">
            <el-input v-model="kbKeyword" placeholder="搜索标题/关键词/正文" clearable style="width: 260px" @keyup.enter="loadKb" />
            <el-select v-model="kbCategory" placeholder="全部分类" clearable style="width: 160px" @change="loadKb">
              <el-option v-for="c in kbCats" :key="c.category" :label="`${c.category}（${c.n}）`" :value="c.category" />
            </el-select>
            <el-button type="primary" round @click="loadKb">查询</el-button>
            <span class="muted">
              共 {{ kbTotal }} 条 · 启用条目合计 {{ kbChars }} 字（阈值 {{ inlineMax }} 字，
              {{ kbChars > Number(inlineMax) ? '走关键词召回' : '走全量注入' }}）
            </span>
          </div>
          <el-table v-loading="loading.kb" :data="kbList" size="small">
            <el-table-column prop="id" label="#" width="60" />
            <el-table-column prop="category" label="分类" width="100" />
            <el-table-column prop="title" label="标题" min-width="200" />
            <el-table-column prop="keywords" label="关键词" min-width="200" show-overflow-tooltip />
            <el-table-column label="正文字数" width="90" align="center">
              <template #default="{ row }">{{ row.content_len }}</template>
            </el-table-column>
            <el-table-column label="状态" width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small" round>{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" align="center">
              <template #default="{ row }">
                <el-button link size="small" type="primary" @click="toggleKb(row)">{{ row.status === 1 ? '停用' : '启用' }}</el-button>
                <el-button link size="small" type="danger" @click="removeKb(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination background layout="prev, pager, next" :total="kbTotal" :page-size="20" v-model:current-page="kbPage" @current-change="loadKb" />
          </div>
        </el-tab-pane>

        <!-- ========== 告警记录 ========== -->
        <el-tab-pane label="告警记录" name="alerts">
          <p class="tab-tip">
            异常告警邮件的发送留痕（去重依据也在这张表）。收件人留空时自动取 admin 角色的校园邮箱。
          </p>

          <!-- C11 数据异常监测：检测是纯 SQL 规则（零模型成本、结论可复现），AI 只把清单归纳成人话 -->
          <div class="anomaly-box">
            <div class="anomaly-head">
              <div>
                <b>数据异常监测</b>
                <p class="tab-tip">
                  用规则扫描业务数据：请假集中、成绩未录完、图书逾期、AI 审核待复核积压、报修超 48 小时未受理。
                  需先在「功能开关」里开启。
                </p>
              </div>
              <div class="anomaly-ops">
                <el-button size="small" :loading="anomalyLoading" @click="scanAnomaly(false)">仅扫描</el-button>
                <el-button size="small" type="primary" :loading="anomalyLoading" @click="scanAnomaly(true)">扫描并邮件通知</el-button>
              </div>
            </div>
            <ul v-if="anomalyFindings.length" class="anomaly-list">
              <li v-for="(f, i) in anomalyFindings" :key="i">
                <el-tag :type="f.level === 'high' ? 'danger' : 'warning'" size="small" round>{{ f.level === 'high' ? '高' : '中' }}</el-tag>
                <b>{{ f.title }}</b>
                <span>{{ f.detail }}</span>
              </li>
            </ul>
            <p v-else-if="anomalyDone" class="tab-tip">本轮扫描未发现异常。</p>
            <p v-if="anomalySummary" class="anomaly-sum">{{ anomalySummary }}</p>
          </div>

          <el-table v-loading="loading.usage" :data="alerts" size="small">
            <el-table-column prop="id" label="#" width="60" />
            <el-table-column prop="type" label="类型" width="150" />
            <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
            <el-table-column prop="sent_to" label="收件人" min-width="180" show-overflow-tooltip />
            <el-table-column label="结果" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="row.ok === 1 ? 'success' : 'danger'" size="small" round>{{ row.ok === 1 ? '已发送' : '失败' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="160">
              <template #default="{ row }">{{ fmt(row.created_at) }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!loading.usage && !alerts.length" description="暂无告警记录（开关默认关闭）" />
        </el-tab-pane>

        <!-- ========== 用量 ========== -->
        <el-tab-pane label="用量统计" name="usage">
          <div class="stat-row">
            <div class="stat"><span class="stat-n">{{ totals.calls ?? 0 }}</span><span class="stat-l">近 {{ usageDays }} 天调用</span></div>
            <div class="stat"><span class="stat-n">{{ totals.okRate ?? '-' }}%</span><span class="stat-l">成功率</span></div>
            <div class="stat"><span class="stat-n">{{ totals.promptTokens ?? 0 }}</span><span class="stat-l">输入 token</span></div>
            <div class="stat"><span class="stat-n">{{ totals.completionTokens ?? 0 }}</span><span class="stat-l">输出 token</span></div>
            <div class="stat"><span class="stat-n">{{ usage?.review?.pending ?? 0 }}</span><span class="stat-l">待复核</span></div>
          </div>
          <el-table :data="usage?.summary || []" size="small" class="mb">
            <el-table-column prop="kind" label="用途" width="120" />
            <el-table-column prop="calls" label="调用次数" width="110" />
            <el-table-column prop="okCalls" label="成功" width="90" />
            <el-table-column prop="promptTokens" label="输入 token" width="120" />
            <el-table-column prop="completionTokens" label="输出 token" width="120" />
            <el-table-column prop="avgMs" label="平均耗时(ms)" width="130" />
          </el-table>
          <el-table v-loading="loading.usage" :data="usage?.recentCalls || []" size="small">
            <el-table-column prop="id" label="#" width="70" />
            <el-table-column prop="user_name" label="用户" width="100" />
            <el-table-column prop="kind" label="用途" width="90" />
            <el-table-column prop="prompt_tokens" label="输入" width="80" />
            <el-table-column prop="completion_tokens" label="输出" width="80" />
            <el-table-column label="结果" width="80">
              <template #default="{ row }">
                <el-tag :type="row.ok === 1 ? 'success' : 'danger'" size="small" round>{{ row.ok === 1 ? 'OK' : '失败' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="cost_ms" label="耗时(ms)" width="100" />
            <el-table-column label="时间" min-width="150">
              <template #default="{ row }">{{ fmt(row.created_at) }}</template>
            </el-table-column>
          </el-table>

        </el-tab-pane>

        <!-- ========== 效果评估（AI 能力的量化指标） ========== -->
        <el-tab-pane label="效果评估" name="eval">
          <p class="tab-tip">
            AI 能力的<b>量化指标</b>（准确率 / 误报率 / 响应耗时），由 <code>scripts/ai-eval.mjs</code>
            在<b>同一条真实判定链路</b>上跑出并落库。本页<b>只读结果</b>：一轮完整评估约 30 次模型调用、
            耗时 1~2 分钟，超出边缘函数单次执行预算 —— 所以跑分放本地脚本、结果落库供展示与答辩引用。
          </p>

          <div class="eval-scale">
            <b>{{ evalData.cases?.total || 0 }}</b>
            <span>条人工标注用例</span>
            <span class="muted">
              <template v-for="(n, k) in evalData.cases?.byScene || {}" :key="k">{{ evalLabel(k) }} {{ n }} 条 · </template>
            </span>
          </div>

          <el-empty v-if="!evalData.runs.length" description="还没有评估记录，先在项目目录执行 npm run eval:ai" />

          <div v-else class="eval-grid">
            <div v-for="r in evalData.runs" :key="r.scene" class="eval-card">
              <div class="eval-head">
                <span class="eval-name">{{ evalLabel(r.scene) }}</span>
                <el-tag v-if="r.never" type="info" size="small" round>尚未运行</el-tag>
                <el-tag v-else :type="accTag(r.accuracy)" size="small" effect="dark" round>
                  准确率 {{ (r.accuracy * 100).toFixed(1) }}%
                </el-tag>
              </div>
              <template v-if="!r.never">
                <div class="eval-nums">
                  <span>通过 <b>{{ r.passed }}</b>/{{ r.total }}</span>
                  <span>平均 <b>{{ r.avgMs }}</b> ms</span>
                  <span v-if="r.falsePositive">误报率 <b>{{ (r.falsePositive.rate * 100).toFixed(1) }}%</b></span>
                  <span v-if="r.violationRecall">违规检出 <b>{{ (r.violationRecall.rate * 100).toFixed(0) }}%</b></span>
                </div>
                <p class="eval-time">运行于 {{ fmt(r.createdAt) }}</p>
                <el-collapse v-if="r.failed > 0">
                  <el-collapse-item :title="`查看 ${r.failed} 条未通过用例`">
                    <ul class="eval-fails">
                      <li v-for="(d, i) in r.detail.filter((x) => !x.ok)" :key="i">
                        <span class="eval-in">{{ d.input }}</span>
                        <span class="eval-exp">期望：{{ d.expect }}｜实际：{{ d.actual }}</span>
                      </li>
                    </ul>
                  </el-collapse-item>
                </el-collapse>
              </template>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>

    </section>

    <!-- 数值/文本配置修改 -->
    <el-dialog v-model="valDlg" :title="valForm.label || '修改配置'" width="420px">
      <el-input v-model="valForm.value" :placeholder="valForm.key" />
      <p class="muted mt8">{{ valForm.key }}</p>
      <template #footer>
        <el-button @click="valDlg = false">取消</el-button>
        <el-button type="primary" :loading="valSaving" @click="saveValue">保存</el-button>
      </template>
    </el-dialog>
  </PortalShell>
</template>

<script setup>
// views/admin/AiAdminView.vue — P9 AI 管理控制台（仅超管）
//
// 为什么这个页面是"必需品"而不是"锦上添花"：所有新 AI 能力（C2 审核 / C3 告警 / C4 审批助手）
// **默认关闭**（用户确认的决策），在控制台出现之前，管理员只能改数据库才能打开它们。
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import PortalShell from '../../components/PortalShell.vue';
import { api } from '../../api/request';
import { fetchAiEval, runAnomalyScan } from '../../api/ai';
import { fmtTime as fmt } from '../../utils/time';

const tab = ref('switches');
const meta = reactive({ model: '', configured: false });
const loading = reactive({ config: false, review: false, kb: false, usage: false });

// ---- AI 效果评估（只读展示；跑分见 scripts/ai-eval.mjs） ----
const evalData = reactive({ cases: null, runs: [] });
const EVAL_LABEL = {
  qa: '知识问答（检索层）',
  triage: '报修智能分诊',
  review: '论坛内容审核',
  insight: '信息问数',
};
const evalLabel = (k) => EVAL_LABEL[k] || k;
const accTag = (a) => (a >= 0.95 ? 'success' : a >= 0.8 ? 'warning' : 'danger');

async function loadEval() {
  const res = await fetchAiEval();
  if (res.code === 0) {
    evalData.cases = res.data.cases;
    evalData.runs = res.data.runs || [];
  }
}

// ---- C11 数据异常监测 ----
const anomalyLoading = ref(false);
const anomalyFindings = ref([]);
const anomalySummary = ref('');
const anomalyDone = ref(false);

async function scanAnomaly(notify) {
  anomalyLoading.value = true;
  try {
    const res = await runAnomalyScan(notify);
    if (res.code === 0) {
      anomalyFindings.value = res.data.findings || [];
      anomalySummary.value = res.data.summary || '';
      anomalyDone.value = true;
      ElMessage.success(res.message || '扫描完成');
      if (notify) loadUsage(); // 发过邮件 → 刷新告警留痕
    } else {
      ElMessage.warning(res.message || '扫描失败');
    }
  } finally {
    anomalyLoading.value = false;
  }
}

// ---- 开关 ----
const configItems = ref([]);
const savingKey = ref('');
const valDlg = ref(false);
const valSaving = ref(false);
const valForm = ref({ key: '', value: '', label: '' });

async function loadConfig() {
  loading.config = true;
  try {
    const res = await api('/api/ai/config');
    if (res.code === 0) {
      configItems.value = res.data.items || [];
      meta.model = res.data.model;
      meta.configured = res.data.configured;
    } else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.config = false;
  }
}

async function setSwitch(row, value) {
  savingKey.value = row.key;
  try {
    const res = await api('/api/ai/config', { method: 'POST', body: { key: row.key, value } });
    if (res.code === 0) {
      row.value = value;
      ElMessage.success(res.message || '已更新');
    } else ElMessage.error(res.message || '更新失败');
  } finally {
    savingKey.value = '';
  }
}

function editValue(row) {
  valForm.value = { key: row.key, value: row.value, label: row.label };
  valDlg.value = true;
}

async function saveValue() {
  valSaving.value = true;
  try {
    const res = await api('/api/ai/config', { method: 'POST', body: { key: valForm.value.key, value: valForm.value.value } });
    if (res.code === 0) {
      ElMessage.success(res.message || '已保存');
      valDlg.value = false;
      await loadConfig();
    } else ElMessage.error(res.message || '保存失败');
  } finally {
    valSaving.value = false;
  }
}

// ---- 审核队列 ----
const reviews = ref([]);
const reviewTotal = ref(0);
const reviewHandled = ref('0');
const reviewPage = ref(1);
const verdictTag = (v) => ({ ok: 'success', suspect: 'warning', violation: 'danger', degraded: 'info' }[v] || 'info');

async function loadReview() {
  loading.review = true;
  try {
    const res = await api(`/api/ai/review?handled=${reviewHandled.value}&page=${reviewPage.value}`);
    if (res.code === 0) {
      reviews.value = res.data.list;
      reviewTotal.value = res.data.total;
    } else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.review = false;
  }
}

async function handleReview(row, confirm) {
  const ask = confirm
    ? `确认「${String(row.excerpt || '').slice(0, 30)}」违规？内容将被下架。`
    : '标记为误判？内容将放行。';
  const go = await ElMessageBox.confirm(ask, '处置确认', { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }).catch(() => false);
  if (!go) return;
  const res = await api('/api/ai/review', { method: 'POST', body: { id: row.id, action: confirm ? 'confirm_violation' : 'false_positive' } });
  if (res.code === 0) {
    ElMessage.success(res.message || '已处置');
    await loadReview();
  } else ElMessage.error(res.message || '处置失败');
}

// ---- 知识库 ----
const kbList = ref([]);
const kbTotal = ref(0);
const kbCats = ref([]);
const kbChars = ref(0);
const kbKeyword = ref('');
const kbCategory = ref('');
const kbPage = ref(1);
const kbNote = ref('');
const inlineMax = computed(() => configItems.value.find((x) => x.key === 'ai.kb.inline_max_chars')?.value || '4000');

async function loadKb() {
  loading.kb = true;
  try {
    const qs = new URLSearchParams({ keyword: kbKeyword.value, category: kbCategory.value, page: kbPage.value });
    const res = await api(`/api/ai/kb?${qs}`);
    if (res.code === 0) {
      kbList.value = res.data.list;
      kbTotal.value = res.data.total;
      kbCats.value = res.data.categories || [];
      kbChars.value = res.data.totalChars;
      kbNote.value = res.data.note;
    } else ElMessage.error(res.message || '加载失败');
  } finally {
    loading.kb = false;
  }
}

async function toggleKb(row) {
  const res = await api('/api/ai/kb', { method: 'POST', body: { action: 'status', id: row.id, status: row.status === 1 ? 0 : 1 } });
  if (res.code === 0) {
    ElMessage.success('已更新');
    await loadKb();
    await loadConfig();
  } else ElMessage.error(res.message || '操作失败');
}

async function removeKb(row) {
  const go = await ElMessageBox.confirm(`删除知识条目「${row.title}」？`, '删除确认', { type: 'warning' }).catch(() => false);
  if (!go) return;
  const res = await api('/api/ai/kb', { method: 'POST', body: { action: 'delete', id: row.id } });
  if (res.code === 0) {
    ElMessage.success('已删除');
    await loadKb();
  } else ElMessage.error(res.message || '删除失败');
}

// ---- 用量 / 告警 ----
const usage = ref(null);
const totals = ref({});
const alerts = ref([]);
const usageDays = ref(7);

async function loadUsage() {
  loading.usage = true;
  try {
    const res = await api(`/api/ai/usage?days=${usageDays.value}`);
    if (res.code === 0) {
      usage.value = res.data;
      totals.value = res.data.totals || {};
      alerts.value = res.data.alerts || [];
    }
  } finally {
    loading.usage = false;
  }
}

async function reload() {
  await Promise.all([loadConfig(), loadReview(), loadKb(), loadUsage(), loadEval()]);
  ElMessage.success('已刷新');
}

onMounted(reload);
</script>

<style scoped>
.pg-card {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(23, 50, 92, 0.08);
  border-radius: 14px;
  padding: 22px 24px;
  box-shadow: 0 6px 24px rgba(23, 50, 92, 0.07);
}
.pg-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 14px; flex-wrap: wrap; }
.pg-head h2 { margin: 0 0 6px; font-size: 19px; color: var(--zc-navy); letter-spacing: 1px; }
.pg-head p { margin: 0; font-size: 13px; color: var(--zc-text-sub); }
.warn { color: #b45309; }
.tab-tip { margin: 0 0 12px; font-size: 12.5px; line-height: 1.8; color: var(--zc-text-sub); }
.tab-tip code, .k { background: rgba(23, 50, 92, 0.07); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
/* 效果评估卡片 */
.eval-scale { margin: 0 0 14px; font-size: 13px; color: var(--zc-text-sub); }
.eval-scale b { font-size: 19px; color: var(--zc-navy); margin-right: 4px; }
.eval-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 14px; }
.eval-card { padding: 14px; border: 1px solid var(--zc-border); border-radius: 10px; background: #fff; }
.eval-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.eval-name { font-size: 13.5px; font-weight: 600; color: var(--zc-navy); }
.eval-nums { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: 12.5px; color: var(--zc-text-sub); }
.eval-nums b { color: var(--zc-navy); font-size: 14px; }
.eval-time { margin: 8px 0 0; font-size: 11.5px; color: var(--zc-text-sub); }
.eval-fails { margin: 6px 0 0; padding-left: 16px; font-size: 12px; line-height: 1.8; }
.eval-in { display: block; color: var(--zc-text); }
.eval-exp { display: block; color: #9a3412; }

/* C11 异常监测区 */
.anomaly-box {
  margin: 0 0 16px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid var(--zc-border);
  border-radius: 10px;
}
.anomaly-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.anomaly-head b { font-size: 13.5px; color: var(--zc-navy); }
.anomaly-head .tab-tip { margin: 4px 0 0; max-width: 560px; }
.anomaly-ops { display: flex; gap: 8px; flex: none; }
.anomaly-list { margin: 10px 0 0; padding: 0; list-style: none; }
.anomaly-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 12.5px;
  line-height: 1.7;
  border-top: 1px dashed var(--zc-border);
}
.anomaly-list li b { flex: none; color: var(--zc-navy); }
.anomaly-list li span { color: var(--zc-text-sub); }
.anomaly-sum {
  margin: 10px 0 0;
  padding: 9px 11px;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--zc-text);
  background: #fff;
  border-left: 3px solid var(--zc-navy);
  border-radius: 0 8px 8px 0;
}
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
.muted { color: var(--zc-text-sub); font-size: 12.5px; }
.mt8 { margin: 8px 0 0; }
.mb { margin-bottom: 14px; }
.row-btns { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.pager { display: flex; justify-content: center; margin-top: 14px; }
.kb-note { margin-bottom: 12px; }
.stat-row { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.stat {
  flex: 1 1 140px;
  background: #f7f9fc;
  border: 1px solid var(--zc-border);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-n { font-size: 20px; font-weight: 700; color: var(--zc-navy); }
.stat-l { font-size: 12px; color: var(--zc-text-sub); }

@media (max-width: 820px) {
  .pg-card { padding: 16px 14px; }
  .stat { flex: 1 1 100%; }
  .anomaly-head { flex-direction: column; align-items: stretch; }
  .anomaly-ops { width: 100%; justify-content: flex-end; }
  .row-btns { gap: 8px; }
  .row-btns :deep(.el-input),
  .row-btns :deep(.el-select) {
    max-width: 100%;
  }
}

@media (max-width: 480px) {
  .anomaly-ops { flex-direction: column; }
  .anomaly-ops :deep(.el-button) { width: 100%; }
  .row-btns :deep(.el-input),
  .row-btns :deep(.el-select) {
    width: 100% !important;
  }
}
</style>
