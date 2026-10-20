# AI 能力盘点与升级方向（2026-10-20）

> 触发：现场验收时出现两个「明明有数据，AI 却说找不到」的现象 ——
> ①「审批通过方欣雪的请假」→ 没有匹配到可操作的目标；
> ②「禁用 教师账号teacher01」→ 找不到。
>
> 本文按 **故障复盘 → 能力全景 → 缺口清单 → 升级路线** 四段组织。
> 结论先行：**不是模型能力不行，而是 3 处代码缺陷 + 4 处解析/上下文缺口。**
> 本次已全部修复这 3 处缺陷，并补齐"多轮上下文"与"账号名归一化"两项缺口；
> 其余（实体引用、分页、学生侧写操作、多动作任务）按下述路线推进。

---

## 1. 故障复盘

### 1.1 批准请假：从上线起 100% 失败（P0 代码缺陷）

**现象**：查询能返回「#2120413 方欣雪 · 病假 · 审批中」，紧接着说「审批通过方欣雪 的请假」，
却得到「没有匹配到可操作的目标」；给单号也一样。

**复现（只读 preview，未改任何数据）**：

```
关键词「方欣雪」  → ✖ 49402 没有匹配到可操作的目标
单号 2120413     → ✖ 49402 没有匹配到可操作的目标
（对照）驳回「方欣雪」→ ✔ 1 个目标
```

**根因**：`lib/ai-actions.js` 的 `approve_leaves.resolve`

```js
const { kept, skipped, warnings } = await resolveLeaveTargets(actor, p); // kept 恒为 undefined
return { targets: kept, skipped, warnings };                            // targets 恒为 []
```

而 `resolveLeaveTargets` 返回的是 `{ targets }`。
于是 `previewWriteAction` 收到空目标，抛出统一文案「没有匹配到可操作的目标」。
`reject_leaves` 因为**直接透传**同一个函数而正常工作 —— 这就是"能驳回、不能批准"这个
诡异现象的来源，页面上完全看不出是代码 bug。

`git log -L` 显示该解构自 `a2779b8`（C5 首次落地）起就存在，即**批准请假这条链路从未成功过一次**。

**为什么难发现**：错误被伪装成"数据不存在"。
安全设计里所有"拒绝"都收敛到同一句话，这条**代码错误**借道了**业务拒绝**的文案。

**修复**：
1. `approve_leaves.resolve` 改为直接 `return resolveLeaveTargets(actor, p)`；
2. `previewWriteAction` 增加**结构自检** —— `resolve` 必须返回 `{ targets: [...] }`，
   否则抛 `49500 内部错误（缺少 targets）`，不再伪装成"没找到"；
3. 回归测试：`tests/unit/ai-actions.spec.js`（结构断言）+ `tests/unit/ai-hardening.spec.js`（连库）+ `scripts/ai-check.mjs` 第 7 节。

### 1.2 禁用 teacher01：账号在库，但解析不到（P1 能力缺口）

**事实核查**：`teacher01` 确实存在（`id=9602428`，王志远，计算机科学与技术学院，`status=1` 启用）。
所以不是数据问题。

**三种触发路径**（同一句话，结果不同）：

| 场景 | 模型抽出的参数 | 结果 |
|---|---|---|
| admin +「禁用教师账号teacher01」 | `usernames:["teacher01"]` | ✔ 命中 |
| admin + 同一句（模型把整段塞进数组） | `usernames:["教师账号teacher01"]` | ✖ 精确 `IN` 落空 → "找不到" |
| 辅导员 +「禁用teacher01」 | `usernames:["teacher01"]` | ✖ 不在本院范围 → "未找到账号（或不在你的数据范围内）" |

**根因**：
1. `findUsersByNames` 只做**精确 `IN` 匹配**（username / real_name），
   模型把「教师账号」这类角色前缀一起塞进来就必然落空；
2. 失败文案把「账号不存在」和「存在但不在你的数据范围」**混为一谈**，且不给任何建议；
3. 无实体链接（entity linking）：上一轮查出来的账号/单号，下一轮不会被自动引用。

**修复**：
1. 新增 `nameVariants()`：剥掉「账号/帐号/老师/同学/教师/的/标点」等噪声，
   并补一个 ASCII 账号名候选（`教师账号teacher01` → `teacher01`）。
   **命中判定仍然是 SQL 精确 `IN`**，不引入 `LIKE`，不会误伤同名前缀账号；
2. 未命中时给出**范围内**的相近账号建议（走 `findUsers` 的 scope，不泄露范围外账号是否存在），
   并明确提示"你的数据范围不是全校，只能操作本院账号"；
3. 端到端验证：「教师账号teacher01」→ ✔ 1 个目标：王志远（teacher01）· 计算机学院。

### 1.3 顺带查出的第三个问题：待审批单「第 101 条之后」对 AI 不可见（P1）

`listLeaves` 固定 `LIMIT 100`，而 AI 的 `query_leaves` / 审批目标解析都在这 100 条里**内存筛**。

线上实测：`status=1` 共 **113** 条 → 最早的 13 条彻底不在 AI 视野内。

- 修复前：按最早一条（`#2090241` 任杰姬）的姓名查 → 查不到；
- 修复后：同样查询 → ✔ 1 行命中。

**修复**：`listLeaves(actor, { status, keyword, ids, limit })` —— `keyword` / `ids` 下推到 SQL，
`limit` 默认 100、硬夹 500；`resolveLeaveTargets` 用 `keyword`/`ids` 精确命中，
`query_leaves` 也改为 SQL 过滤（显示上限仍 50 行）。
这与 `services/users.js#findUsersByNames` 是**同一类坑**（"先分页再内存筛"），
修法与注释口径保持一致。

**同一类缺陷的其余两处，也一并修掉**：

| 动作 | 原来的隐性上限 | 现在 |
|---|---|---|
| `revoke_notice` / `pin_notice` | 只在「最新 50 条公告」里找 id | 新增导出 `loadNoticeForWrite(actor, id)`，按 id 直接取 + 服务层权限校验 |
| `confirm_violation` | 只在「最新 50 条审核记录」里找 id | 新增 `getReviewRecord(id)`，按 id 直接取 |

---

## 2. 能力全景（当前到底能做什么）

### 2.1 三条链路与选路

```
前端 AIView / AiOrb
   ├─ 有可执行动作（admin/counselor/teacher） → POST /api/ai/action
   │     一次调用三用：改数据（预览+确认） / 问数模板 / 纯回答
   ├─ 只有问数权限（leader）                → POST /api/ai/insight
   └─ 其余（student 等）                     → POST /api/ai/chat（SSE 流式）
```

优先级：`action` > `insight 模板` > `结构化 query` > `纯回答`。

### 2.2 18 项能力与落点

| 编号 | 能力 | 入口 / 前端 | 核心实现 |
|---|---|---|---|
| C1 | 校园智能问答（带出处、逐字流式） | `/ai`、悬浮球 | `api/ai/chat.js`、`lib/ai-kb.js`、`lib/sse.js` |
| C2 | 论坛 AI 审核 | 发帖/回复自动 | `lib/ai-review.js`、`api/ai/review.js` |
| C3 | 异常告警邮件 | 定时/触发 | `lib/alert.js`、`lib/ai.js#alertAiFailure` |
| C4 | AI 审批助手 | 审批页卡片 | `lib/ai-approval.js`、`api/ai/approval-advice.js` |
| C5 | 对话式系统管理（12 个动作白名单 + 二次确认） | `/ai`（admin） | `lib/ai-actions.js`、`api/ai/action.js` |
| C6 | 信息问数（10 个模板） | `/ai`、`/dashboard` | `lib/ai-insight.js`、`api/ai/insight.js` |
| C7 | 学生学业助手 | `/ai` 学业模式 | `lib/ai-study.js`、`api/ai/study.js` |
| C8 | 报修智能分诊 | 提交报修时 | `lib/ai-triage.js`、`api/af/repair.js` |
| C9 | 公告 AI 摘要 | 公告列表 | `lib/ai-summary.js`、`af_notice.summary` |
| C10 | 失物智能匹配 | 发布拾获物时 | `lib/ai-lf-match.js` |
| C11 | 数据异常监测 | 管理端手动/定时 | `lib/ai-anomaly.js`、`api/ai/anomaly.js` |
| C12 | 图书自然语言检索 | 图书馆页 | `lib/ai-lib-search.js`、`api/ai/lib-search.js` |
| C13 | 通用结构化查询（6 实体 × 白名单字段） | `/ai` | `lib/ai-entity.js`、`lib/ai-query.js` |
| C14 | 问办合一 · 业务直达 | `/ai` 气泡卡片 | `lib/ai-shortcuts.js` |
| C15 | 智能公文/邮件助理 | 写信弹窗 | `api/ai/mail-compose.js`、`MailView.vue` |
| C16 | 选课避坑与排课检查 | 选课页 | `lib/ai-study.js`、`ElectView.vue` |
| C17 | 驾驶舱 AI 简报 | `/dashboard` | `api/ai/briefing.js` |
| C18 | 长文档切分入库 | AI 管理控制台 | `api/ai/kb.js`、`AiAdminView.vue` |

### 2.3 动作白名单（12 个）

- **只读（4）**：`query_users`、`query_leaves`、`query_notices`、`query_review_queue`
- **写（8）**：`disable_users`、`enable_users`、`approve_leaves`、`reject_leaves`、
  `publish_notice`、`revoke_notice`、`pin_notice`、`confirm_violation`

### 2.4 安全边界（不可回退的 6 条）

1. 模型**不生成 SQL**：只输出白名单 `entity / field / op / metric`，SQL 片段由服务端写死；
2. 值全参数化，`LIKE` 的通配符被剔除；
3. 数据范围（`dataScope`）由服务端按角色**强制注入**，模型看不到也改不掉；
4. 写操作必须**两阶段确认**（5 分钟 JWT、绑定操作者、执行前重新解析目标）；
5. 批量写必须显式 `all:true` **且**带范围，否则拒绝（防"一句话把全校禁了"）；
6. 审计完全复用 `lib/services/*`，`via:ai` 前缀可追溯。

### 2.5 现存的硬上限（模型再聪明也越不过去）

| 限制 | 值 | 出处 |
|---|---|---|
| 结构化查询明细 / 聚合 / 绝对上限 | 20 / 10 / 50 行 | `ai-entity.js#LIMIT_HINT` |
| 账号查询列表 | 50 行 | `query_users` |
| 账号批量候选 | 200 行 | `findUsers` |
| 请假单列表 | 100 行（可传 `limit`，硬夹 500） | `listLeaves` |
| 单次指令长度 | 300 字 | `api/ai/action.js` |
| 一次只能一个动作 | 1 个 `action` + 1 组 `params` | `PARSE_RULES` |
| 历史轮次 | 4 条 × 400 字 | `aiJson#history` |

---

## 3. 能力缺口清单（按"用户能不能感知到"排序）

### P0 · 会造成"看起来系统有 bug"的

| # | 缺口 | 现象 | 根因 | 状态 |
|---|---|---|---|---|
| 1 | 批准请假解析失败 | 永远"没有匹配到可操作的目标" | `resolve` 解构了不存在的字段 | ✅ 已修 |
| 2 | 账号名带前缀就找不到 | 「教师账号teacher01」找不到 | 只做精确 `IN` | ✅ 已修 |
| 3 | >>100 条的数据"看不见" | 点名也查不到 | 分页后内存筛 | ✅ 已修（请假）；`query_users` 仍为 50 行展示 |
| 4 | 单轮无状态 | "驳回刚才那条"无反应 | `/api/ai/action` 只收 `text` | ✅ 已修（history + 前 5 行摘要） |
| 5 | 写操作**不可撤销** | 误批/误禁只能手工回滚 | 只有二次确认，无快照回滚 | ⬜ 待做（阶段 3） |
| 6 | 查询空结果不解释 | "共 0 条"，用户不知道是没数据还是条件太严 | 未做零结果诊断 | ⬜ 待做（阶段 2） |

### P1 · 明显限制能力上限的

| # | 缺口 | 影响 |
|---|---|---|
| 7 | **一次只能一个动作** | "把这 3 条批了再发个公告"需要说两遍；模型也只能二选一 |
| 8 | **批量只能 `all` + 单一筛选** | 无法表达"本周所有病假""软件学院 2602 班以外的" |
| 9 | 实体只有 6 个 | 报修、宿舍、图书、社团、公告、邮件**完全不能问** |
| 10 | 只读动作只有 4 个 | 查报修/查借阅/查宿舍/查成绩只能靠模板或自由查询 |
| 11 | 学生侧**零写操作** | 请假、报修、选课、借书都必须去页面点，AI 只能指路 |
| 12 | 无分页/钻取/导出 | 50 行封顶，想看第 51 行没有办法 |
| 13 | 无实体引用（entity ref） | 依赖模型从历史里"读"单号，措辞一变就丢 |
| 14 | 无进度反馈 | `action` 链路 2~4 秒白屏，用户以为卡住 |

### P2 · 工程质量与治理

| # | 缺口 | 说明 |
|---|---|---|
| 15 | 评测集只覆盖 11 类问法 | 缺**写操作端到端**与"多种措辞抽参一致性" |
| 16 | 无缓存 | 同一个人重复问同一个问题会重复付费 |
| 17 | 成本只落流水，无报表 | `ai_usage_log` 有数据，管理端只展示总量 |
| 18 | 全链路单模型单轮 | 没有 function-calling / 工具循环；本地小模型无兜底 |

---

## 4. 升级方向

### 阶段 2 · 把"查得到"升级为"指得准"（建议优先，1~2 天）

**2.1 实体引用（entity reference）—— 消灭"它/这条"**

- 服务端在 `action` / `insight` / `query` 的响应里带一个**引用块**：
  ```json
  { "ref": { "entity": "leave", "ids": [2120413], "labels": ["#2120413 方欣雪 · 病假"] } }
  ```
- 前端把它随 `history` 一起回传；后端在 `params` 缺失时**用它兜底**：
  `approve_leaves` 无 `leaveIds`/`keyword` 但有 `ref.entity === 'leave'` → 用 `ref.ids`。
- 好处：**不再依赖模型从历史里"读"单号**，措辞怎么变都能落到同一条记录；
  且引用只在服务端生成/校验，模型仍无法指定任意 id（越权面不增加）。

**2.2 零结果诊断**

`runStructuredQuery` / `runReadAction` 返回 0 行时，自动做一次"放宽一个最严条件"的探测，
回答从「共 0 条」升级为「按「病假 + 本院 + 近 7 天」没有记录；去掉时间条件后有 12 条」。

**2.3 分页与钻取**

`query` 增加 `page`，返回 `total`（`COUNT(*)` 同一 WHERE）；
前端表格加"下一页 / 只看这 20 条里的第 N 条"。**行数硬上限保持不变**（安全边界不动）。

**2.4 学生侧 3 个写操作（先做最刚需的）**

| 动作 | 复用服务层 | 需要的确认清单 |
|---|---|---|
| `apply_leave` | `services/leave.js#applyLeave` | 类型/起止时间/事由全文，强调"提交后进入待审批" |
| `submit_repair` | `services/repair.js` | 位置/描述/AI 分诊的紧急度与责任部门 |
| `borrow_book` | `services/library.js` | 书名、可借副本、应还日期 |

全部走同一套白名单 + 预览 + 二次确认 + `via:ai` 审计，不新增任何新的信任面。

### 阶段 3 · 把"指令"升级为"任务"（3~5 天）

**3.1 多动作**：`PARSE_RULES` 允许 `actions:[{action,params}]`（上限 3），
服务端逐个 `resolve`，合并成**一张确认清单**，一次确认后按序执行；
任一步失败则停止并报告已完成/未完成（不静默跳过）。

**3.2 条件式批量**：`leaveIds/keyword/all` 之外支持 `filters`：
```json
{ "action": "approve_leaves", "params": { "filters": { "type": "病假", "days": 7, "deptId": 2 } } }
```
`filters` 的字段与取值**全部来自注册表**（复用 `ai-entity.js` 的字段白名单），
与 C13 共用一套编译逻辑 —— 模型依然写不出 SQL。

**3.3 撤销**：写操作前落一份"变更前快照"（`sys_op_log.detail` 已具备载体），
新增 `undo_last_action`（仅本人、5 分钟内、仅可逆动作：禁用/启用、公告、审批）。

**3.4 实体与只读动作扩充**（6 → 12 实体）

| 新增实体 | 主要字段 | 典型问法 |
|---|---|---|
| `repair` | 类型/状态/紧急度/处理时长 | "哪个楼报修最多""平均多久修好" |
| `dorm` | 楼栋/房间/入住率 | "3 号楼还有几间空" |
| `book` | 分类/库存/逾期 | "计算机类还有哪些可借" |
| `club` | 社团/成员/申请 | "哪些社团还在招人" |
| `notice` | 范围/置顶/时间 | "本周发了几条公告" |
| `mail` | 收发/未读 | "我最近有没有未读邮件" |

### 阶段 4 · 质量与成本（持续）

- 评测集从 11 类扩到 **30 类**，其中**写操作端到端 8 类**（预览→确认→审计全链路）；
- 增加"同一意图 × 5 种措辞"的抽参一致性检查（`scripts/ai-eval.mjs` 已有框架）；
- 相同 `(role, question)` 的 5 分钟结果缓存（只读链路），直接降成本；
- 管理端加"按能力 / 按角色 / 按天"的用量与失败率报表（数据已在 `ai_usage_log`）。

### 明确**不做**的四件事（安全底线，避免"能力升级"变成"风险升级"）

1. 不让模型写 SQL / 调任意接口 —— 结构化描述 + 白名单是这套系统的地基；
2. 不开放"任意 id"参数让模型直接执行（`targetIds` 必须来自服务端解析结果）；
3. 不放宽二次确认，也不延长令牌有效期；
4. 不让模型决定数据范围（`scope` 永远由服务端按角色注入）。

---

## 5. 本次改动清单

| 文件 | 改动 |
|---|---|
| `node-functions/lib/ai-actions.js` | ①`approve_leaves.resolve` 改为透传；②`previewWriteAction` 增加 `targets` 结构自检（`49500`）；③新增 `nameVariants()` 账号名归一化 + 范围内相似账号建议；④`resolveLeaveTargets` 改为 SQL 侧过滤（`keyword`/`ids`，批量上限 200）；⑤`query_leaves` 关键字下推 |
| `node-functions/lib/services/leave.js` | `listLeaves` 支持 `keyword` / `ids` / `limit`（默认 100、硬夹 500），修复">100 条不可见" |
| `node-functions/lib/services/notice.js` | 导出 `loadNoticeForWrite`（并在查询里带 `title`），供"按 id 撤公告/置顶"复用 |
| `node-functions/lib/ai-review.js` | 新增 `getReviewRecord(id)`，供"按 id 处置审核记录"复用 |
| `node-functions/lib/ai.js` | `aiJson` 支持可选 `history`（4 条 × 400 字，仅作上下文） |
| `node-functions/api/ai/action.js` | 接收并裁剪 `history`；`PARSE_RULES` 增加"指代消解"规则 |
| `src/api/ai.js` | `runAiAction(text, history)` |
| `src/views/AIView.vue` | 指令链路带上历史；`contentWithRows()` 把表格前 5 行写进消息正文（让下一轮能引用单号/账号） |
| `tests/unit/ai-actions.spec.js` | `nameVariants` 4 条 + 结构自检 2 条 |
| `tests/unit/ai-hardening.spec.js` | 连库回归：批准请假（单号/姓名）、账号名归一化 |
| `scripts/ai-check.mjs` | 新增第 7 节「写操作的目标解析」5 项（批准请假 ×2、>100 条可见性、账号名归一化、公告按 id 取），纳入 `npm run check:ai` |
| `node-functions/lib/ai-intent.js` | **新增**：确定性意图识别 + 槽位抽取（`classifyIntent` / `extractNames` / `extractTargets` / `slotsForAction` / `mergeParams`），纯函数零 IO |
| `node-functions/api/ai/status.js` | 动作清单改为按**注册表**返回（counselor 9 个 / teacher 3 个不再为空），新增 `canAct` |
| `tests/unit/ai-intent.spec.js` | **新增 59 条**：33 种说法 → 动作、姓名候选、槽位、合并、按动作过滤 |

---

## 7. ★ 追加（同日）：确定性意图层 —— 让"各种说法"都能对上指令

**用户反馈**：「审批请假怎么说都很难实现，说姓名没用，感觉这些功能很多说法都用不了。」

**问题本质**：在此之前，一句话能不能变成动作**完全押在模型抽参上**。模型的稳定性不受我们控制，
于是同一意图换个说法（"把假批了""给过了吧"）就抽不出参数；把姓名塞错字段
（`usernames` vs `keyword`）就必然落空。**这不是模型不够聪明，而是我们不该把"能不能用"押在它身上。**

**新增 `lib/ai-intent.js`（纯函数、零 IO、可穷举单测）**

| 能力 | 说明 |
|---|---|
| `classifyIntent(text)` | 动词（强 2 分 / 弱 1 分）+ 宾语（1 分）打分，**并列最高分时返回 null 交还模型**；必须"有动词 + （有宾语 或 有明确目标 或 两个强动词）"才算操作意图 |
| `extractNames(text)` | 剥掉动词/宾语/噪声后剩下的 2~4 字中文片段即**姓名候选**（`通过方欣雪的请假` → `方欣雪`）；只是候选，命中仍由 SQL 判定 |
| `extractTargets(text)` | 单号（标签位≥2 位 / 裸数字≥4 位）、账号（含数字的 ASCII）、请假状态、账号状态、批量、意见、公告标题/正文、公告与审核记录编号 |
| `slotsForAction()` | 按动作过滤槽位：发公告时不会把"周末电"当人名去查库 |
| `mergeParams()` | **模型优先、规则补空、数组取并集**（"方欣雪和唐晨凡"不会只处理一半） |

**接入方式（`api/ai/action.js`）**：模型仍然是首选；只有两种情况规则层才接管 ——
① 模型说"这不是指令"或给了不存在的 key；② 模型抽到了 action 但**参数全空**，
或规则判断非常确定（≥4 分）却与模型不一致。响应里的 `intent.via` 会标注
`model` / `rule` / `rule_override`，便于线上复盘。

**同时修掉的两处"用不了"**：

1. **辅导员/教师在页面上根本拿不到动作链路**：`api/ai/status.js` 原先把动作清单挂在
   `features.adminAction`（其 roles 只有 admin）上，于是 counselor 的 9 个动作、teacher 的 3 个动作
   在 `/api/ai/status` 里是空数组，前端 `routeOf()` 永远走"纯问答"分支 —— **后端支持、页面上却用不了**。
   现在按注册表返回，并新增 `canAct` 字段。
2. **"只给姓名"被当成"没给范围"拒绝**：`disable_users` 原本要求 `usernames` 或 `all:true`，
   `{keyword:'方欣雪'}` 会直接抛「请说明要对哪些账号执行」。现在 ≤5 个命中即视为明确目标，
   >5 个要求收窄 —— 既听得懂，又不会一句话批量误伤。

**实测（规则层单独跑，**完全不调用模型**，只走 preview 不写库）**：

```
审批通过方欣雪的请假 → approve_leaves {"names":["方欣雪"]} → ✔ #2120413 方欣雪 · 病假 · 审批中
把方欣雪的假批了     → approve_leaves {"names":["方欣雪"]} → ✔ 同上
驳回方欣雪的请假     → reject_leaves  {"names":["方欣雪"]} → ✔ 同上
给方欣雪过了吧       → approve_leaves {"names":["方欣雪"]} → ✔ 同上
禁用教师账号teacher01 → disable_users {"usernames":["teacher01"]} → ✔ 王志远（teacher01）
把teacher01停用      → disable_users {"usernames":["teacher01"]} → ✔ 同上
禁用方欣雪           → disable_users {"names":["方欣雪"]} → ✔ 方欣雪（student580）
看看待审批的请假     → query_leaves  {"status":"1"} → ✔ 113 条，显示前 50
有多少个禁用的账号   → query_users   {"countOnly":"1","status":"0"} → ✔ 42 个
```

**安全边界没有松动**：规则层不知道 actor 是谁、不查库、不执行任何写操作；
它只产出**候选**，命中与否由 SQL + `dataScope` 决定，写操作仍必须走预览 + 二次确认。
新增 59 条单测（`tests/unit/ai-intent.spec.js`）覆盖 33 种说法 + 槽位/合并/过滤。

---

## 8. 验证方式
```bash
npm test                 # 536 个单测（本轮累计新增 85 个），0 失败
npm run lint             # 0 error
npm run check:import     # 102 个模块加载自检，0 失败
npm run check:ai         # 连真实库 21 项：21 通过 / 0 失败（含新增第 7 节）
npm run build            # 构建通过
```

真实库实测（只走 preview，未写库）：

```
关键词「方欣雪」        → ✔ 1 个目标：#2120413 方欣雪 · 病假 · 审批中
单号 2120413            → ✔ 1 个目标：#2120413 方欣雪 · 病假 · 审批中
教师账号teacher01       → ✔ 1 个目标：王志远（teacher01） · 计算机科学与技术学院
teacher01的账号         → ✔ 1 个目标：王志远（teacher01） · 计算机科学与技术学院
按姓名查最早一条待审批  → ✔ 1 行（修复前不可见）
```

