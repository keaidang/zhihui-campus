# AI 能力融合 · 详细设计方案（v1 · 待确认）

> **状态**：设计稿，**未开工**。请确认第 8 节的待决项后再实施。
> **上位文档**：本方案是 `ARCHITECTURE.md` **ADR-9** 的落地展开，**冲突时以 ADR-9 为准**。
> **创建日期**：2026-10-09　**适用模型**：qwen3.8-omni-flash（阿里云 DashScope 兼容网关）

---

## 0. 前置约束（不可协商，来自 ADR-9 与 HANDOVER 铁律）

| # | 约束 | 来源 |
|---|---|---|
| 1 | **只用文本输入→文本输出，禁止任何多模态调用**（不传 image/audio/video、不做 OCR/图片理解/语音/图像生成） | 铁律 #36 |
| 2 | **思考模式默认关闭** `enable_thinking: false`（意图 JSON 快 6.2 倍、输出 token 降 94%） | ADR-9 硬约束二 |
| 3 | **密钥只在 `.env` 与 EdgeOne env**，严禁入库、严禁写进 docs | 铁律 #13 |
| 4 | **模型永不生成/拼接 SQL，永不直接执行操作**——只做意图分类与参数抽取 | ADR-9 |
| 5 | **破坏性操作必须二次确认**，且解析出的 action 必须再过 `guard.js` 实时查库鉴权 | ADR-9 |
| 6 | **频控走 DB 流水计数**，禁用内存计数（多实例内存不共享） | 铁律 #23 |
| 7 | **AI 挂了业务照常**——所有调用 try/catch + 超时 + 降级兜底 | ADR-9 |
| 8 | **不引入新 npm 依赖**（用原生 `fetch` + `AbortSignal.timeout`） | 项目惯例 |
| 9 | 写操作与 AI 判定结果全部落 `sys_op_log`，AI 触发的标 `via:ai` | 铁律 #4 |
| 10 | 每次调用设 `max_tokens` 上限 | ADR-9 成本控制 |

---

## 1. 能力总览与分期

### 1.1 你提出的 5 项

| 编号 | 能力 | 面向 | 一句话说明 |
|---|---|---|---|
| **C1** | **校园智能问答** | 全部账号 | 自然语言问学校各类情况（介绍/部门/制度/办事流程），基于内置知识库回答 |
| **C2** | **论坛 AI 审核员** | 管理员（可开关） | 发帖/回复自动判定违规，异常内容**发邮件提醒管理员** |
| **C3** | **异常告警邮件** | 管理员（可开关） | 内容异常 + 系统异常（500/AI 故障/登录爆破）邮件推送 |
| **C4** | **AI 审批助手** | 辅导员/管理员（可开关） | 审批时给"建议通过/驳回 + 理由 + 风险提示"，**人工最终决定** |
| **C5** | **管理员智能管理** | 管理员 | 对话式执行系统管理（禁用账号 / 查审批 / 批准审批 …） |
| **C6** | **校领导信息汇总** | 校领导/管理员 | 对话式问数（"这周哪个班请假最多"）+ 定期汇总 |

> 注：原文把"论坛 AI 审核员"与"异常内容邮件"合并表述，本方案拆为 **C2（审核判定）** 与 **C3（告警通道）**——因为 C3 还要覆盖系统异常，是独立通道。

### 1.2 我补充建议的项（供你挑选，非必须）

| 编号 | 能力 | 面向 | 价值 | 成本 | 建议 |
|---|---|---|---|---|---|
| **C7** | **学生学业助手** | 学生 | 基于**本人**成绩/选课数据答"我还差多少学分""哪些课挂了""下学期该选什么" | 低（只读本人数据，权限天然隔离） | ⭐ 强烈建议（答辩亮点，且零越权风险） |
| **C8** | **报修智能分诊** | 学生/后勤 | 描述问题 → 判紧急度 + 责任部门 + 是否需学生自理（配合 `status=3 无法处理`） | 低 | ⭐ 建议 |
| **C9** | **公告/通知 AI 摘要** | 全员 | 长公告自动生成 3 句摘要，列表页显示 | 极低 | ⭐ 建议 |
| **C10** | **失物招领智能匹配** | 全员 | 发布时自动比对"失物"与"招领"描述，命中则双向推送 | 中 | 可选 |
| **C11** | **数据异常监测** | 管理员 | 定期扫描异常（某班请假率畸高、成绩录入缺失、图书大量逾期）邮件推送 | 中 | 可选（可与 C3 合并） |
| **C12** | **图书自然语言检索** | 全员 | "我想找本讲数据结构的入门书" → 映射到 `lib_book` 检索 | 低 | 可选 |

### 1.3 建议实施分期（每期都可独立验收）

| 期 | 内容 | 验收标准 |
|---|---|---|
| **P1** | 技术底座（`lib/ai.js` 等 6 个模块）+ 数据库 `schema-012` + **C1 校园问答** | 登录后可对话问校史/部门/制度，答案正确且带出处 |
| **P2** | **C2 论坛审核** + **C3 异常告警邮件** | 发违规帖被拦 + 管理员收到邮件；模拟 500 收到邮件 |
| **P3** | **C5 管理员智能管理**（含服务层重构） | 对话"禁用账号 student01"→ 预览 → 确认 → 生效且有审计 |
| **P4** | **C4 审批助手** + **C6 校领导问数** | 审批页出 AI 建议卡片；"本周哪个班请假最多"返回正确表格 |
| **P5** | C7~C12 全部（学业助手 / 报修分诊 / 公告摘要 / 失物匹配 / 异常监测 / 图书检索） | — |

> **★ 2026-10-09 用户已确认实施范围：C1~C12 全量一次做完。** 上表分期仅表示交付顺序，不再中途停下等验收。各项决定见第 8 节「已确认」。

### 1.4 能力分级（累加式）与配色（2026-10-09 用户确认）

**累加式权限**：高角色版本 = 低角色全部能力 + 新增能力。同一套 `/ai` 页面与悬浮球，**按登录角色动态渲染能力与主色**。

| 版本 | 角色 | 能力 |
|---|---|---|
| **标准版** | 所有登录用户 | C1 校园问答、C12 图书自然语言检索、C9 公告摘要展示、C8 报修分诊（提交报修时） |
| **审批版** | counselor（累加） | 标准版 + C4 审批助手 |
| **校领导版** | leader（累加） | 标准版 + **C6 信息问数**（请假数据 / 成绩分布 / 宿舍入住 / 报修时效 / 论坛活跃…全部只读） |
| **管理员版** | admin（累加） | 标准版 + C6 问数 + **C5 智能管理（写操作）** + C4 审批助手 + **AI 管理控制台**（C2 开关 / 知识库 / 审核队列 / 告警 / 用量） |

> 领导版**只读**：可看全校数据但不给任何写操作（与驾驶舱权限口径一致）。`/api/ai/status` 按角色返回能力清单，前端据此渲染。

**界面与配色（全部浅色调，仅主标识色随角色变化）**

| 版本 | 主标识色 `--ai-accent` | 用途 |
|---|---|---|
| 标准版 | 蓝 `#4a72c4` | 悬浮球、发送按钮、用户气泡、链接 |
| 审批版（辅导员） | 青绿 `#1d9e75` | 同上 |
| 校领导版 | 紫 `#7f77dd` | 同上 |
| 管理员版 | 素金 `#c8a35f`（与全站素金一致） | 同上 + 管理控制台入口 |

- 页面底色浅灰 `#f5f7fa`、卡片纯白、圆角 12px；AI 气泡 `#f1f3f7`、用户气泡取主标识色 10% 透明底；文字 `#1e293b`
- 悬浮球 44px 圆形，主标识色实底 + 白色对话图标；悬浮球与独立页共用同一 CSS 变量
- 配色只在 `AIView.vue` 的 CSS 变量层切换（`--ai-accent` 由角色 computed 决定），**布局结构完全复用，不按角色复制页面**

---

## 2. 技术底座（所有能力共用，新增 6 个 lib 模块）

### 2.1 `lib/ai.js` — 统一调用出口（照 `lib/notify.js` 模式）

```js
/** 是否已配置（缺 key 时全站 AI 能力自动静默降级） */
export const aiConfigured = () => Boolean(process.env.AI_QWEN_API_KEY);

/** 原始对话。失败返回 null（调用方降级），不抛异常 */
export async function aiChat({
  messages,              // [{role, content}]
  json = false,          // true → response_format: json_object
  thinking = false,      // ★ 默认 false（硬约束二）
  maxTokens = 512,       // ★ 成本上限
  temperature = 0.1,
  timeoutMs = 12000,     // ★ 超时降级
}) -> { content, usage } | null

/** 强制 JSON + 自动剥 ```json 围栏 + 解析失败重试 1 次；仍失败返回 null */
export async function aiJson({ system, user, maxTokens = 512, timeoutMs = 12000 })
  -> object | null

/** 供上层做频控与降级判断的分级错误（'timeout'|'http'|'parse'|'off'） */
export async function aiStatus() -> { configured, model, provider }
```

**实现要点**
- `POST {AI_QWEN_BASE_URL}/chat/completions`，`Authorization: Bearer ${AI_QWEN_API_KEY}`
- 请求体固定带 `enable_thinking: false`（除非显式传 `thinking: true`）
- `AbortSignal.timeout(timeoutMs)`；非 2xx / 超时 / JSON 解析失败 → 记 `sys_op_log(action='ai.error')` 并返回 `null`
- 模块级常量 `AI_SAMPLE = '...'`（few-shot 示例），避免每次拼装

### 2.2 `lib/ai-config.js` — 运行时开关与阈值（**管理员可改，不需要重新部署**）

现有机制只有环境变量，改一次要重新部署（铁律 #5），不满足"管理员开关"需求 → **新增 `sys_config` 表**（k-v）。

```js
export async function getConfig(key, fallback = null)   // 读单个（带 30s 模块级缓存）
export async function setConfig(key, value, operatorId)  // 写 + opLog
export async function getAiFlags()  // 一次性取全部 AI 开关（供管理页与各调用点）
```

**配置项清单（首版）**

| key | 默认 | 说明 |
|---|---|---|
| `ai.enabled` | `1` | AI 总开关（关掉 = 全站 AI 静默降级） |
| `ai.chat.enabled` | `1` | C1 校园问答 |
| `ai.chat.rate_per_min` | `10` | 每用户每分钟问答次数上限 |
| `ai.forum_review.enabled` | `0` | C2 论坛 AI 审核员（**默认关**，需管理员显式开启） |
| `ai.forum_review.block_on_violation` | `1` | 判定违规时是否直接拦截发帖 |
| `ai.alert.enabled` | `0` | C3 邮件告警总开关 |
| `ai.alert.emails` | `''` | 收件人（逗号分隔；留空则取 admin 角色的校园邮箱） |
| `ai.alert.dedupe_min` | `30` | 同类告警去重窗口（分钟） |
| `ai.approval_advice.enabled` | `0` | C4 审批助手 |
| `ai.admin_console.enabled` | `1` | C5 管理员智能管理 |
| `ai.insight.enabled` | `1` | C6 校领导问数 |
| `ai.kb.inline_max_chars` | `8000` | 知识库内联注入阈值（见 §5.1） |

### 2.3 `lib/ai-kb.js` — 知识库与知识注入

**两级知识注入策略**（兼顾准确率与成本）

| 层 | 内容 | 注入方式 | 规模 |
|---|---|---|---|
| **L0 固定档案** | 校名/沿革/五角色/12 功能域/部门树/术语表 | **常驻 system prompt**（精简，约 600~900 字） | 常量，写在 `lib/ai-kb.js` |
| **L1 知识库** | `ai_kb` 表条目（分类+标题+关键词+正文） | 总长 ≤ `ai.kb.inline_max_chars` → **全量注入**；超出 → **关键词召回 TopK 4** | 5000~8000 字 |

**检索实现（零依赖）**：对用户问题做**规则型关键词抽取**（去停用词 + 2-4 字滑窗切词 + 命中 `ai_kb.keywords`/`title`/`content` 加权计分），取 TopK。不引分词库，中文靠滑窗 + 关键词字段人工标注兜底。

> ⚠ 需同步微调 ADR-9「运行约束 · 成本控制」条：原文"RAG 必须走检索 TopK、禁止整篇塞上下文"针对的是**用户上传的长文档/大语料**；对本项目**规模可控的固定校园知识库（≤8000 字）**，全量注入 + DashScope 上下文缓存（实测 usage 返回 `cached_tokens`）成本更低、准确率更高。两条并存，以字数阈值为界。

### 2.4 `lib/ai-guard.js` — AI 频控（DB 流水计数）

照登录限流范式（铁律 #23）：新增 `ai_usage_log(user_id, kind, created_at)`，**SQL 侧**统计近 1 分钟行数，超阈值返回 `49429`。另按用户+日期做日配额（防单账号刷爆额度）。

### 2.5 `lib/ai-actions.js` — 白名单操作注册表（C5 的核心）

```js
// 每个 action 一条登记；不在表里的 action 一律拒绝执行
export const ACTIONS = {
  query_users:    { roles:['admin','counselor'], scope:true,  destructive:false, run },
  disable_users:  { roles:['admin'],             destructive:true,  confirm:'count', run },
  approve_leave:  { roles:['counselor','admin'], destructive:true,  confirm:'single', run },
  // ...
};
```

- `run` **不重新实现业务逻辑**，而是调用 §4.3 抽出的**服务层**函数（与人工操作共用同一套权限与审计）
- `destructive:true` 的操作 → 服务端返回 `preview`（将被影响的实体清单）+ 一次性 `confirmToken`（存 `sys_config` 或以签名 token 形式，5 分钟失效）→ 前端二次确认 → 第二次请求才执行

### 2.6 `lib/alert.js` — 告警通道（C3）

**需先补一个通用发信函数**：`lib/lanqin.js` 目前只有 `sendVerificationCode()`，新增

```js
export async function sendMail({ to, subject, html, text })  // 复用内部 call()
```

`lib/alert.js` 提供 `alertAdmins({ type, title, detail, dedupeKey })`：
- 读 `ai.alert.enabled` 与 `ai.alert.emails`（留空则查 admin 角色用户的 `campus_email`）
- **去重**：`sys_config` 记 `ai.alert.last:{dedupeKey}`，窗口内不重复发送
- 发送失败不阻断业务（照 notify.js）

---

## 3. 数据库变更（`database/schema-012-ai.sql`，幂等可重复跑）

| 对象 | 类型 | 说明 |
|---|---|---|
| `sys_config` | 新表 | `cfg_key`(PK) / `cfg_value` / `remark` / `updated_by` / `updated_at` |
| `ai_kb` | 新表 | `id` / `category` / `title` / `keywords` / `content` / `sort` / `status` / `updated_at`——校园知识库条目 |
| `ai_usage_log` | 新表 | `id` / `user_id` / `kind`(chat/action/insight/review) / `tokens` / `created_at`——频控 + 论文用 token 统计 |
| `ai_review_log` | 新表 | `id` / `biz`(thread/reply) / `biz_id` / `author_id` / `verdict` / `categories` / `confidence` / `reason` / `handled` / `handled_by` / `created_at`——C2 审核留痕与人工复核队列 |
| `ai_alert_log` | 新表 | `id` / `type` / `title` / `detail` / `sent_to` / `ok` / `created_at`——C3 告警留痕 |
| `forum_thread` | **ALTER** | 加 `review_status TINYINT DEFAULT 0`（0 正常 1 待人工复核 2 已确认违规） | 
| `forum_reply` | **ALTER** | 同上 |

> 不改动任何现有字段语义，全部为新增，向后兼容。

---

## 4. 接口设计

### 4.1 面向全员

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/api/ai/status` | 登录 | 返回可用能力（按角色过滤）+ 是否已配置；前端据此决定是否显示入口 |
| `POST` | `/api/ai/chat` | 登录 | **C1 校园问答**。入参 `{ question, history? }`；出参 `{ answer, sources:[{title,category}], degraded }` |
| `POST` | `/api/ai/study` | student | **C7 学业助手**（可选期）。仅注入本人成绩/选课数据 |

### 4.2 面向管理端

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `POST` | `/api/ai/action` | admin/counselor | **C5 管理员智能管理**。`{ text }` → `{ intent, preview, confirmToken }`；`{ confirmToken }` → 执行 |
| `POST` | `/api/ai/insight` | admin/leader | **C6 问数**。`{ text }` → `{ templateId, params, rows, summary, sql? }` |
| `GET` | `/api/ai/config` | admin | AI 开关与阈值（`ai.*` 全量） |
| `POST` | `/api/ai/config` | admin | `{ key, value }` 更新开关（落 opLog） |
| `GET` | `/api/ai/kb` | admin | 知识库列表（分页/分类/关键词） |
| `POST` | `/api/ai/kb` | admin | 知识库增删改（`action: upsert/delete/batchImport`，支持 CSV 导入，照 `lib/books.js` 范例） |
| `GET` | `/api/ai/review` | admin | **C2** 待人工复核队列 / 审核日志 |
| `POST` | `/api/ai/review` | admin | `{ id, action: 'confirm_violation'\|'false_positive', penalty? }` 处置 |
| `GET` | `/api/ai/approval-advice` | counselor/admin | **C4** 对指定 `leaveId` 生成建议（也可并入 `af/leave` GET 响应） |

### 4.3 服务层重构（C5 的前置，建议做）

现状：`api/admin/users.js`（380 行）等把权限校验、SQL、审计全写在 handler 里，AI 无法复用。
方案：抽出 `node-functions/lib/services/{users,leave,notice,forum}.js`，**现有 handler 改为薄壳**（`requireRoles` → 调 service → 返回），AI 也调同一 service。

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A · 抽服务层**（推荐） | AI 与人工**共用同一套权限与审计**，无重复实现；论文可写"AI 与人工同源"，是亮点 | 需重构 4~5 个文件（约 1 天） |
| B · AI 只解析、前端调现有 API | 零重构 | 二次确认与审计分散在前端；AI 写操作绕过了服务端统一入口，安全边界变弱 |

### 4.4 错误码（`49400~49499`，AI 模块专用）

| code | 含义 |
|---|---|
| 49400 | AI 服务未配置 |
| 49401 | 问题为空或过长 |
| 49402 | 意图无法识别（返回引导文案） |
| 49403 | 无权限执行该 AI 操作 |
| 49404 | 确认令牌无效或已过期 |
| 49405 | 待确认操作不存在 |
| 49429 | AI 调用过于频繁（限流） |
| 49430 | AI 服务暂时不可用（已降级） |
| 49431 | 知识库条目不存在 |

---

## 5. 六大能力详设

### 5.1 C1 校园智能问答（面向所有账号）

**知识库内容（由我生成，约 6000~8000 字）—— ★ 真实性分级（2026-10-09 用户要求）**

| 层 | 内容 | 要求 |
|---|---|---|
| **可虚构层** | 校史沿革、办学定位、校训校徽、校园地图、院系介绍等**概况类** | 自由编写（虚拟学校"清北大学"） |
| **必须真实层** | **系统功能与流程**：选课/退课规则、请假审批流与 30 天上限、报修状态机四态、图书借阅规则、宿舍分配与性别约束、校园邮箱开通与限额、论坛版规与封禁、忘记密码流程、五角色权限边界 | **以代码为准**——写库前逐条核对 `DATABASE.md` / `HANDOVER.md` 与对应 API 实现，**禁止编造** |

> 落地方式：先产出《知识库条目核对清单》（每条标注依据的代码/文档），再写正文——避免"AI 说的和系统做的不一样"。

| 分类 | 条目数（估） | 内容举例 |
|---|---|---|
| 学校概况 | 6 | 校史沿革、办学定位、校训校徽、校园地图（文字描述）、联系方式、虚拟校历 |
| 组织架构 | 12 | 6 个教学院系 + 10 个行政部门的职责与联系方式 |
| 教务 | 6 | 选课规则、学分与绩点、考试与补考、学籍异动、毕业要求 |
| 学工 | 5 | 请销假流程、评奖评优、困难资助、心理咨询、违纪处理 |
| 生活服务 | 8 | 图书馆借阅规则、宿舍管理规定、食堂/浴室、校园卡、失物招领流程、社团注册、论坛版规、校园邮箱使用 |
| 常见问题 | 20~30 | "怎么选课""忘记密码怎么办""邮箱怎么开通""请假要谁批"等一问一答 |

**回答链路**

```
用户问题
 → 频控（ai-guard，1 分钟 N 次）
 → 组装 prompt：L0 固定档案 + 检索/全量注入的 L1 条目 + 强约束（只依据资料回答，不确定就说不知道，给出处）
 → aiChat（enable_thinking:false, temperature 0.1, max_tokens 700）
 → 返回 answer + sources（命中的 kb 条目 title/category）
 → 写 ai_usage_log
```

**降级**：AI 未配置 / 超时 / 失败 → `degraded:true` + 返回"智能问答暂时不可用，可前往【公告中心】或联系辅导员"。**绝不让业务报错。**

**前端**：独立页 `/ai`（对话流 + 问题建议 chips + 出处标签）；门户壳加「AI 助手」菜单项；移动端复用 `mobile.css` 媒体查询层。

---

### 5.2 C2 论坛 AI 审核员（管理员可开关）＋ 邮件提醒

**开关**：`ai.forum_review.enabled`（**默认关**，管理员在 `/admin/ai` 打开）

**接入点**：`api/forum/threads.js` 的**发帖 / 回复**写入前

**判定输出（强制 JSON）**

```json
{ "verdict": "ok|suspect|violation",
  "categories": ["广告","辱骂","涉政","色情","隐私泄露","无意义灌水"],
  "confidence": 0.0-1.0,
  "reason": "一句话说明" }
```

**处置矩阵**

| verdict | 行为 |
|---|---|
| `ok` | 正常入库 |
| `suspect` | 入库但 `review_status=1`（列表显示"待复核"角标）→ 进人工队列 |
| `violation` | `block_on_violation=1` → **拒绝发帖**并提示；同时**发邮件告警管理员**（C3）+ 写 `ai_review_log` |

**性能与降级（关键设计）**

- 同步判定，**超时 3s**。实测关思考后单次判定约 600~900ms，多数能过
- **超时/失败 → 放行入库 + `review_status=1`**（宁可事后复核，不能卡住发帖）
- 判定耗时计入发帖响应，故 `ai.forum_review.enabled=0` 时**零额外开销**

**管理页** `/admin/ai` → 「审核队列」Tab：待复核列表（帖子摘要 / 作者 / AI 判定 / 置信度 / 理由）→ 一键「确认违规（删除+可禁言）」或「误判，放行」。全部落 `ai_review_log`。

> 纯文本，不读图片（铁律 #36）。原 ADR-9「图片走视觉能力」已作废。

---

### 5.3 C3 异常告警邮件（管理员可开关）

**开关**：`ai.alert.enabled`（默认关）+ `ai.alert.emails`

**告警源**

| type | 触发条件 | 去重键 |
|---|---|---|
| `content_violation` | C2 判定 `violation` | `violation:{biz}:{bizId}` |
| `system_500` | `sys_op_log` 出现 `error.500`（按分钟聚合） | `500:{errCode}:{分钟}` |
| `ai_failure` | AI 连续 N 次失败 / 触发降级 | `ai_fail:{小时}` |
| `login_bruteforce` | `sys_login_log` 某账号失败 ≥ 10 次/10 分钟 | `brute:{username}:{小时}` |

**邮件内容**：类型 / 时间（北京时间）/ 概述 / 明细 / 建议动作，纯文本 + 简单 HTML（照 `sendVerificationCode` 的样式）。

**去重**：`ai.alert.dedupe_min`（默认 30 分钟），窗口内同类合并计数只发一封。留痕 `ai_alert_log`。

**与系统异常联动**：`http.js` 的 `jsonError` 已把 500 落库 `sys_op_log`，只需在落库后**异步触发** `alertAdmins`（fire-and-forget，绝不阻断响应）。

---

### 5.4 C4 AI 审批助手（辅导员/管理员可开关）

**开关**：`ai.approval_advice.enabled`（默认关）

**输入**（服务端组装，非用户输入）：本单请假类型/时长/事由 + 该生**近 30 天请假次数与天数** + 该假期内**已选课程冲突**（`edu_elect` + 课表）+ 是否临近考试周（校历）。

**输出**

```json
{ "suggestion": "approve|reject|manual",
  "risk": ["该生本月已请假 3 次，累计 7 天","请假时段与《数据结构》3 门课冲突"],
  "reason": "…",
  "confidence": 0.0-1.0 }
```

**定位铁律**：**只做建议，绝不自动审批**。审批权始终在人（符合 ADR-9「所有 AI 结果均为辅助判定」）。前端在 `/af/approve` 每行展开处显示「AI 建议」卡片 + 「一键采纳意见」（把 AI 理由填入审批意见框，仍需人工点批准）。

---

### 5.5 C5 管理员智能管理（对话式操作）

**开关**：`ai.admin_console.enabled`

**两阶段流程（安全核心）**

```
① POST /api/ai/action { text:"禁用 student01 和 student02" }
   → aiJson 解析意图（few-shot + 强制 JSON）
   → 命中白名单 ACTIONS.disable_users → guard.js 实时校验 admin 角色
   → 执行 dry-run 查询，产出 preview：{ affected:[{id,username,realName}], count:2 }
   → 生成 confirmToken（5 分钟有效）→ 返回 { intent, preview, confirmToken }
② 前端弹确认框（"即将禁用 2 个账号：student01 陈晓东、student02 林小雨，确认？"）
③ POST /api/ai/action { confirmToken } → 校验令牌 → 调 services/users.js → opLog(via:ai)
```

**批量与"全部"类指令的处理（实测结论）**

> 实测发现模型对"全部批准""禁用所有学生账号"这类**集合操作只会返回单条 id 或自行枚举**，不可靠。故规定：**集合语义一律做成独立 action，由服务端执行，模型只负责识别"这是集合操作"**。
> 例：`disable_users { all:true, role:"student" }`、`approve_all { template:"pending_leave" }`。

**白名单操作清单（首版）**

| action | 说明 | 角色 | 破坏性 | 确认方式 |
|---|---|---|---|---|
| `query_users` | 查账号（关键词/角色/状态） | admin,counselor | 否 | — |
| `query_stats` | 查统计概览 | admin,leader | 否 | — |
| `list_approvals` | 查待审批/已审批 | counselor,admin | 否 | — |
| `disable_users` | 禁用账号（名单 / 按角色 / 全部） | admin | **是** | 列清单确认 |
| `enable_users` | 启用账号 | admin | 是 | 列清单确认 |
| `reset_password` | 重置登录密码 | admin | **是** | 确认 + 回显新密码 |
| `assign_roles` | 改角色 | admin | **是** | 列差异确认 |
| `approve_leave` / `reject_leave` | 审批请假 | counselor,admin | 是 | 单条确认 |
| `approve_all_pending` | 批量批准待审请假 | counselor,admin | **是** | 列清单确认 |
| `publish_notice` | 发布公告 | admin | 是 | 预览正文确认 |
| `forum_ban` / `forum_unban` | 禁言/解禁 | admin | 是 | 确认 |

**越权防线（三重）**：① 模型解析出的 action 不在白名单 → 直接拒绝；② `requireRoles` 实时查库（不信 JWT 角色）；③ service 层内部原有校验（如"不能删自己""不能改其他 admin 主账号"）**原样生效**。

---

### 5.6 C6 校领导信息汇总（对话式问数）

**开关**：`ai.insight.enabled`；权限 `admin` / `leader`（与驾驶舱一致）

**链路**：自然语言 → `aiJson` 选 **模板 id** + 填参数 → 服务端**校验参数类型** → 执行**预写参数化 SQL** → 返回表格 + 模型摘要。

**模板清单（首版，全部只读）**

| templateId | 参数 | 回答的问题 |
|---|---|---|
| `leave_rank_by_class` | `days`(7/30), `order` | "这周哪个班级请假人数最多" |
| `leave_rate_by_dept` | `days` | "各院系请假情况对比" |
| `score_by_dept` | `term` | "各院系成绩分布 / 及格率" |
| `score_by_course` | `term`, `topN` | "哪门课挂科最多" |
| `dorm_occupancy` | `groupBy`(building/gender) | "宿舍入住率" |
| `loan_overdue_top` | `topN` | "图书逾期最多的人" |
| `forum_activity` | `days` | "论坛活跃度" |
| `repair_timeliness` | `days` | "报修处理时效 / 积压" |
| `approval_backlog` | — | "待审批积压情况" |
| `login_trend` | `days` | "登录活跃趋势" |

> `days` / `topN` 等参数**必须走白名单枚举校验**（如 `days ∈ {7,30,90}`），禁止直接拼进 SQL。

**前端**：驾驶舱（`/dashboard`）顶部加「AI 问数」输入框 + 结果卡片；或复用 `/ai` 页在 leader 账号下显示问数能力。

---

### 5.7 建议补充项（简述）

- **C7 学生学业助手**：`/api/ai/study`，注入**本人** `edu_elect`（成绩/学分）+ `edu_class` 课表 → 答"已修学分/挂科/绩点/选课建议"。**零越权风险**（SQL 强制 `student_id = 当前用户`）。
- **C8 报修智能分诊**：`api/af/repair.js` 提交时判 `{ urgency, dept, selfService }` → 写入工单备注 + 推给对应处理人；`selfService=true` 时提示学生可能属 `status=3`。
- **C9 公告摘要**：`api/af/notice.js` 发布时生成 ≤80 字摘要存 `af_notice` 新字段，列表页显示。
- **C10 失物匹配**：发布时用 AI 对不同类别描述做相似度打分，命中阈值双向 `notify`。
- **C11 数据异常监测**：定时任务（EdgeOne 定时触发或管理员手动触发）扫描 + 邮件。
- **C12 图书自然语言检索**：问题 → 抽取 `{keyword, category, level}` → 检索 `lib_book`。

---

## 6. 前端页面与交互

| 页面/改动 | 说明 |
|---|---|
| **新增 `/ai`** | 智能助手主页面。按角色动态显示能力（见 §1.4 累加式分级）；界面浅色调，主标识色随角色（`--ai-accent`） |
| **新增 `/admin/ai`** | AI 管理控制台（admin）：① 功能开关面板 ② 知识库维护（列表/编辑/CSV 导入） ③ 审核队列（待复核+日志） ④ 告警配置与发送记录 ⑤ 用量统计（token/调用次数，论文数据来源） |
| 改 `PortalShell.vue` | 菜单加「AI 助手」（全员可见）；`roles` 过滤沿用现有机制 |
| 改 `af/ApproveView.vue` | 审批行展开处加 AI 建议卡片 |
| 改 `m3/ForumView.vue` / `ForumThreadView.vue` | 待复核帖加角标（admin 可见） |
| 改 `admin/DashboardView.vue` | 顶部加 AI 问数入口 |
| 移动端 | 复用 `src/mobile.css`（只加 `@media (max-width:820px)` 块，铁律 #27） |

---

## 7. 工作量与风险

| 项 | 说明 |
|---|---|
| 新增文件 | 后端 6 个 lib + 5 个 api 目录文件；前端 2 个页面 + 5 处改动；schema-012 |
| 主要风险 1 | **网关额度未知**——该 key 是聚合网关，无公开配额文档，需上线后观察；对策：日配额 + 降级 |
| 主要风险 2 | **判定准确性**——论坛审核/审批建议可能误判；对策：一律"辅助+人工兜底"，不自动执行最终处置 |
| 主要风险 3 | **发帖链路耦合**——AI 判定挂在发帖上，AI 慢会拖慢发帖；对策：3s 超时 + 超时放行标记待复核 |
| 主要风险 4 | **service 层重构**是 C5 的前置，属"改动既有线上代码"；对策：重构后跑全量 `npm run check`（80 单测 + 56 项线上 e2e） |
| 论文素材 | 每条链路都有可量化的实测数据（延迟 / token / 准确率 / 拦截率），正好补论文 AI 章节 |

---

## 8. ★ 决定项（2026-10-09 已全部确认）

| # | 决定项 | 确认结果 |
|---|---|---|
| 1 | **知识库内容** | ✅ (a) **由我生成**。概况类可虚构；**系统功能与流程必须以代码为准**（见 §5.1 真实性分级） |
| 2 | **C5 是否做服务层重构** | ✅ (a) **抽 `lib/services/`**，AI 与人工共用同一套权限与审计 |
| 3 | **论坛审核时机** | ✅ (a) **同步判定 + 3s 超时降级**（超时放行并标记待复核） |
| 4 | **AI 助手入口形态** | ✅ (c) **独立页 `/ai` + 门户悬浮球，两者都要**；配色按角色（§1.4） |
| 5 | **是否要流式输出** | ✅ (b) **真流式打字机**。⚠ EdgeOne Node Functions 的 `ReadableStream` 流式响应需实测验证，**实现时做自动回退**：流式不可用 → 整段返回 + 前端模拟打字机 |
| 6 | **告警邮件收件人** | ✅ (a) **自动取 admin 角色用户的校园邮箱**（`ai.alert.emails` 留空时的兜底），也可在设置页显式指定 |
| 7 | **P5 建议项** | ✅ **C7~C12 全部做** |
| 8 | **实施范围** | ✅ (b) **C1~C12 全量一次做完** |
| 9 | **开关默认值** | ✅ 同意"**新 AI 能力默认关闭，由管理员显式开启**"（问答除外，默认开） |

---

## 9. ★ 实施计划（步骤级，2026-10-09 定，环境变量已配）

> 前置：`.env` 已配 `AI_QWEN_*`；EdgeOne 控制台已配同样 4 个变量。**⚠ 控制台 env 改后必须重新部署才生效**（铁律 #5）——线上 AI 生效以部署完成时间为准。
> 执行纪律：每阶段结束跑 `npm run check`（lint → 80 单测 → 库体检 → 56 项线上 e2e）+ `npm run build`；**提交用显式 add，禁 `git add -A`**（铁律 #2 交付流程）。

| 阶段 | 步骤 | 产出文件 | 验收 |
|---|---|---|---|
| **P0 准备** | 0.1 建立《知识库条目核对清单》——逐条标注依据的代码/文档，确保"系统与流程"真实 | `docs/AI-KB-SOURCES.md` | 清单覆盖选课/请假/报修/图书/宿舍/邮箱/论坛/权限 8 个域 |
| | 0.2 流式方案定型：写 `lib/sse.js` 探测封装，**流式不可用自动回退整段返回** | `lib/sse.js` | 本地两种模式都能返回 |
| **P1 底座** | 1.1 建表 | `database/schema-012-ai.sql` | `node scripts/migrate.mjs` 幂等通过 |
| | 1.2 统一出口 | `lib/ai.js` | 未配置/超时/解析失败均返回 null 不抛 |
| | 1.3 运行时开关 | `lib/ai-config.js` | 改 `sys_config` 后 30s 内生效，无需重新部署 |
| | 1.4 频控 | `lib/ai-guard.js` | 超限返回 49429 |
| | 1.5 知识库 | `lib/ai-kb.js` | 阈值内全量注入 / 超出走 TopK |
| | 1.6 告警 | `lib/alert.js` + `lib/lanqin.js` 补 `sendMail()` | 去重窗口内只发一封 |
| | 1.7 单测 | `tests/unit/ai-*.spec.js` | KB 打分、参数枚举、action 白名单校验全绿 |
| **P2 知识库** | 2.1 写正文（6000~8000 字，概况可虚构、流程必须真实） | `docs/AI-KB-CONTENT.md` | 抽查 10 条与系统实现一致 |
| | 2.2 入库脚本（幂等） | `scripts/seed-ai-kb.mjs` | 可重复跑不产生重复条目 |
| **P3 C1 问答** | 3.1 能力清单接口 | `api/ai/status.js` | 按角色返回能力，前端据此渲染 |
| | 3.2 问答接口（含流式） | `api/ai/chat.js` | 答学校问题正确 + 返回出处 |
| | 3.3 前端页面 + 悬浮球 + 路由 + 菜单 | `views/AIView.vue`、`components/AiOrb.vue`、`router`、`PortalShell.vue` | 四角色主色正确，移动端不溢出 |
| **P4 服务层** ✅ | 4.1~4.4 抽 `lib/services/{_actor,users,leave,notice,forum}.js`，现有 handler 改薄壳 | ✅ 5 个 service + 4 个 handler 改薄壳 | ✅ 线上 e2e **56/56 零回归** |
| **P5 C2+C3** ✅ | 5.1 审核判定 + 接入发帖/回复 | ✅ `lib/ai-review.js`、`api/forum/threads.js` | ✅ 线上 7/7：违规帖拦 `49006`、3s 硬上限、邮件已发 |
| | 5.2 审核队列接口 ✅ | ✅ `api/ai/review.js` | ✅ 处置落 `ai_review_log` + `sys_op_log` |
| | 5.3 四类告警源接入 ✅ | ✅ `lib/alert.js`、`lib/http.js`（500 触发）、`lib/ai.js`、`api/auth/login.js` | ✅ 邮件已收到（content_violation） |
| **P6 C5 管理** ✅ | 6.1 白名单操作注册表 + confirmToken | ✅ `lib/ai-actions.js`（11 动作） | ✅ 28 项单测：白名单/令牌/范围校验全绿 |
| | 6.2 两阶段接口 ✅ | ✅ `api/ai/action.js` | ✅ 线上 15 项：预览不改数据→确认→真执行，`via:ai` 审计可见 |
| | 6.3 前端确认交互 ✅ | ✅ `views/AIView.vue` | ✅ 影响清单+跳过原因+二次确认按钮 |
| **P7 C4+C6** ✅ | 7.1 问数模板库（10 个，参数枚举校验） | ✅ `lib/ai-insight.js`、`api/ai/insight.js` | ✅ 线上 5/5 模板正确命中；注入尝试被 enum 白名单兜住 |
| | 7.2 审批建议 + 接入审批页 ✅ | ✅ `lib/ai-approval.js`、`api/ai/approval-advice.js`、`af/ApproveView.vue` | ✅ 线上 22/22；能检出真实课表冲突（周五第9-10节《高等数学（下）》） |
| | 7.3 驾驶舱问数入口 | 改为统一走 `/ai` 页（同一套问数，不再单独嵌驾驶舱） | ✅ leader 可用（`/ai` 按角色选路） |
| **P8 C7~C12** ✅ | 8.1~8.6 学业助手 / 报修分诊 / 公告摘要 / 失物匹配 / 异常监测 / 图书检索 | ✅ `lib/ai-{study,triage,summary,lf-match,anomaly,lib-search}.js` + `lib/edu-stats.js` + `lib/book-meta.js` + 对应 api | ✅ 六项全部落地，单测 287 全绿 |
| **P9 控制台收尾** 🔶 | 9.1 AI 管理控制台 | ✅ `views/admin/AiAdminView.vue` + `api/ai/{config,kb,usage}.js` | ✅ 五个 Tab（开关/审核队列/知识库/告警/用量）；**此前新 AI 能力默认关但无界面可开，此页是必需品** |
| | 9.2 全量验证 | — | `npm run check` + `npm run build` + 线上 e2e |
| | 9.3 文档同步 | `PROGRESS` / `HANDOVER` / `API.md` / `DATABASE.md` / `ADR-9` | 文档与实现一致 |
| | 9.4 分层提交推送 + 线上验证 | — | 线上真实可对话 |

**提交策略**：P1 一个 commit（底座+建表）→ P2 一个（知识库）→ P3 一个（C1 问答）→ P4 一个（服务层重构，独立可回滚）→ P5/P6/P7/P8 各一个 → P9 收尾。**每个 commit 都能独立回滚**。

## 附：与现有系统的复用清单（不重复造）

| 复用 | 来源 |
|---|---|
| 权限/数据范围 | `lib/guard.js` — `requireRoles` / `dataScope` / `opLog` |
| 站内信通知 | `lib/notify.js` — `notify` / `notifyMany` / `roleUserIds` |
| 邮件发送 | `lib/lanqin.js` — 新增通用 `sendMail()` |
| 错误落库与远程诊断 | `lib/http.js` — `jsonError` 已写 `sys_op_log(error.500)` |
| 分页/CSV 导入导出范式 | `api/admin/users.js` / `api/lib/books.js` |
| 数据库访问与事务 | `lib/db.js` — `query()` / `withTransaction()` |
| 时间口径 | 一律 `NOW()` 落 UTC + 展示层 `src/utils/time.js` 的 `fmtTime()`（铁律 #25） |
| 移动端适配 | `src/mobile.css`（铁律 #27/#28） |
| 测试三层 | `npm run check`（铁律 #35）；AI 纯逻辑（意图白名单校验、参数枚举校验、KB 检索打分）**可单测** |
