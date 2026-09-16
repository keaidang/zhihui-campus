# CONVENTIONS · 代码与 AI 协作规范

## 1. 代码规范

### 通用
- 语言：TypeScript 优先（Node Functions / 前端均可 ts）
- 命名：文件 `kebab-case.ts`，组件 `PascalCase.vue`，变量 `camelCase`，常量 `UPPER_SNAKE`
- 状态字段一律用常量枚举，禁止魔法数字散落代码（统一放 `constants.ts`）
- 统一响应处理走一个工具函数，错误码见 API.md

### Git
- 提交信息：`feat(模块): 说明` / `fix(模块): 说明` / `docs: 说明` / `refactor: 说明`
- 小步提交，每完成一个功能即提交
- 严禁提交：`.env`、连接串、密钥

## 2. AI 协作纪律

### 新会话开场白模板（每次必用）

> 读取 docs/ 全部文档和最近的 git log，总结当前项目状态和待办，然后开始实现：［具体任务］。遵守 CONVENTIONS.md 中的既有约定，不要引入新依赖除非确有必要。

### 会话纪律

1. **一个会话 = 一个模块的一个功能**，做完即收尾
2. 收尾时必须让 AI 同步更新：`docs/PROGRESS.md`（进度）＋ `docs/API.md`（新增端点）＋ `docs/DATABASE.md`（如改表）
3. **文档同步铁律：任何大改动/新信息/新决策，落盘到对应 docs 文档才算完成**——架构变了改 ARCHITECTURE.md，接口变了改 API.md，表变了改 DATABASE.md，决策变了补 ADR，进度变了改 PROGRESS.md。代码写完但文档没更新 = 任务没完成
4. 数据库和 API 的变更**先改文档再写代码**，文档是单一事实来源
5. 长会话警惕上下文退化：发现 AI 忘记约定时，重开会话走开场白模板，不要硬聊

### 铁律

- 不引入新框架/新依赖，除非在 ARCHITECTURE.md 记录决策
- 不改"不做清单"（PRD.md）里的边界
- 遇到与文档冲突的既有代码，先问、先改文档，不要静默分叉

## 3. 开发环境

- 本地：EdgeOne CLI 本地调试 Functions；TiDB 控制台或 DBeaver 管理数据
- 演示数据：跑 `seed/seed.js`（见 DATABASE.md 第 6 节）
