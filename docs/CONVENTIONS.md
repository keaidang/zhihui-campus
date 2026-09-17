# CONVENTIONS · 代码与 AI 协作规范

## 1. 代码规范

### 通用
- 语言：**JavaScript（ESM）**——Node Functions 与前端均为 .js/.vue，不引入 TS（与存量代码保持一致）
- 命名：API 文件 `camelCase.js`（路径即目录），组件 `PascalCase.vue`，变量 `camelCase`，常量 `UPPER_SNAKE`
- 状态字段一律用常量枚举并注释含义，禁止魔法数字散落
- 后端统一响应：`ok(data, message)` / `fail(code, message, status)` / `jsonError(e)`（lib/http.js）；业务错误抛 `HttpError`（lib/guard.js）
- **新业务模块统一走 lib/guard.js**：requireRoles + dataScope + opLog，禁止自造鉴权
- **DB 只走 lib/db.js 的 query()**（文本协议 + 瞬时重试），严禁 execute()
- 学期口径：`TERM='2026-2027-1'`（edu 相关 API 顶部常量，换学期统一改）

### Git
- 提交信息：`feat: 说明` / `fix: 说明` / `docs: 说明` / `chore: 说明`（正文可多行列变更明细）
- 小步提交，每完成一个功能即提交；push 即部署（约 1 分钟），推前必须 `npm run build` 通过
- 严禁提交：`.env`、连接串、密钥、调试产物（gitignore 白名单制：根目录 /*.txt、node-functions/*.txt 全忽略）

## 2. AI 协作纪律

### 新会话开场白模板（每次必用）

> 读取 docs/HANDOVER.md（先读这个）和最近的 git log，总结当前项目状态和待办，然后开始实现：［具体任务］。遵守 HANDOVER.md 铁律与 CONVENTIONS.md，不要引入新依赖除非确有必要。

### 会话纪律

1. **一个会话 = 一个模块的一个功能**，做完即收尾
2. 收尾时必须让 AI 同步更新：`docs/PROGRESS.md`（进度）＋ `docs/API.md`（新增端点）＋ `docs/DATABASE.md`（如改表）；大变更补 ARCHITECTURE.md ADR
3. **文档同步铁律：任何大改动/新信息/新决策，落盘到对应 docs 文档才算完成**——代码写完但文档没更新 = 任务没完成
4. 数据库和 API 的变更**先改文档再写代码**，文档是单一事实来源
5. 长会话警惕上下文退化：发现 AI 忘记约定时，重开会话走开场白模板，不要硬聊

### 铁律

- 不引入新框架/新依赖，除非在 ARCHITECTURE.md 记录决策
- 不改"不做清单"（PRD.md）里的边界（点餐已砍，勿复活）
- 遇到与文档冲突的既有代码，先问、先改文档，不要静默分叉

## 3. 开发环境与验证

- 本地：Node 22（管理器路径 `C:\Users\keaidang\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`，直接 `&` 前台调用）；TiDB 控制台管理数据
- 迁移：`& node.exe scripts/migrate.mjs database/schema-NNN-*.sql`；建号：`& node.exe scripts/grant-role.mjs <user> <role> --create [--name=][--no=][--dept=][--reset]`
- **线上验证范式**：一次性 Node 脚本（原生 fetch）直打线上 API 全链路断言，结果落盘、跑完即删；PowerShell Invoke-WebRequest 捕获不稳定，仅简单探测用
- 演示账号见 HANDOVER.md 第 2 节（admin/admin 为演示弱密码）
