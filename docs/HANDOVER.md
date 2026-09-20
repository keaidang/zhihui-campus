# HANDOVER · AI/开发者交接文档

> 最后更新：2026-09-18。**新会话/新 Agent 开工前必读本文档**，再按需读 docs/ 其他文档。
> 一句话现状：智汇校园已上线 https://campus.keaidang.com/ ，认证 + 五角色 RBAC + M1 教务线 + M2 学工线全量可用，线上 16 步全链路验证通过。

## 1. 项目快照

| 项 | 值 |
|---|---|
| 项目 | 智汇校园 —— 一站式智慧校园服务平台（毕业设计） |
| 论文标题（定稿） | 《基于云边协同与 Serverless 架构的"智汇校园"一站式服务平台设计与实现》 |
| 线上地址 | https://campus.keaidang.com/ （EdgeOne Pages，git push 后约 1 分钟自动构建上线） |
| 仓库 | github.com/keaidang/zhihui-campus（main 分支） |
| 技术栈 | Vue3 + Element Plus + Pinia（前端）/ EdgeOne Node Functions（业务 API）/ TiDB Cloud Serverless（MySQL 8.0 兼容） |
| 虚拟学校 | 清北大学（校徽 public/logo.png、书法校名 public/name.png）；页脚备案 苏ICP备2026056678号 |
| 本地路径 | `C:\Users\keaidang\Desktop\毕设\智汇校园一站式服务平台` |

## 2. 演示账号（TiDB 里真实存在）

| 账号 | 密码 | 角色 | 备注 |
|---|---|---|---|
| **admin** | **admin** | admin+student | 超管（2026-09-18 用户指定弱密码，答辩演示用） |
| teacher01 | Zhihui@2026 | teacher | 王志远 T2001001，任教 3 个教学班 |
| counselor01 | Zhihui@2026 | counselor | 刘慧敏，计算机学院（本院数据范围） |
| student01 | Zhihui@2026 | student | 陈晓东 20261001，**已有选课+92 分成绩数据，勿清库** |
| student02 / student03 | Zhihui@2026 | student | 林小雨 / 赵子墨 |

- 建号/授权/重置密码：`& node.exe scripts/grant-role.mjs <user> <role> [--create] [--reset] [--name=姓名] [--no=学号]`
- SQL 迁移：`& node.exe scripts/migrate.mjs database/schema-NNN-*.sql`（幂等，可重复跑）
- **当前学期口径 `TERM='2026-2027-1'`** 硬编码在 edu 相关 API，换学期需统一修改

## 3. 代码地图

```
├─ docs/                      # 文档（单一事实来源，先改文档再改代码）
├─ database/                  # schema-001-auth / 002-base / 003-edu / 004-affair
├─ node-functions/
│  ├─ lib/                    # db.js(连接池+瞬时错误重试) http.js(统一响应) guard.js(鉴权/数据范围/审计) auth.js(JWT)
│  └─ api/
│     ├─ auth/                # register login refresh logout me
│     ├─ admin/               # meta users departments
│     ├─ edu/                 # course timetable score teach   ← M1 教务线
│     └─ af/                  # leave repair notice             ← M2 学工线
├─ edge-functions/            # KV 诊断位（kv-check 等）
├─ src/
│  ├─ api/request.js          # 统一请求封装（Bearer + 401 自动刷新重放）
│  ├─ stores/auth.js          # Pinia：双令牌，accessToken 仅内存
│  ├─ router/index.js         # 路由 + 登录/角色守卫（redirect 回跳）
│  ├─ components/PortalShell.vue  # 门户骨架：--role-accent 角色主题色 + 校园实景背景 + 按角色菜单
│  └─ views/
│     ├─ HomeView.vue         # 门户首页（SSO 联动：卡片点击→登录带 redirect→原路跳回）
│     ├─ LoginView.vue        # 统一身份认证（读取 ?redirect= 登录后回跳）
│     ├─ WorkbenchView.vue    # 工作台：角色配色账号卡 + 功能矩阵 + 常用资源(学信网/共青团/南通市图书馆/国图)
│     ├─ admin/               # UserManageView
│     ├─ edu/                 # ElectView ScoresView TeachView ScoreEntryView
│     └─ af/                  # LeaveView ApproveView RepairView RepairManageView NoticeView
└─ scripts/                   # migrate.mjs grant-role.mjs smoke-auth.mjs（白名单制，其余临时脚本不入库）
```

## 4. 五角色与页面权限（已定稿，勿动摇）

| 角色 | 主题色 | 菜单/能力 |
|---|---|---|
| student | 统一学术风 | 选课、成绩课表、请销假、报修、公告 |
| teacher | 统一学术风 | 我的课程、成绩录入、公告发布（本院） |
| counselor | 统一学术风 | 请假审批（本院）、报修处理、学生名册（本院）、公告 |
| leader | 统一学术风 | 纯只读，M4 驾驶舱（未做），公告 |
| admin | 统一学术风 | 全部 + 用户/角色管理独占 |

- **视觉方向（2026-09-18 用户定稿）**：不再按角色区分主题色，全站统一"学术深蓝 #17325c + 素金 #c8a35f 点缀 + 玻璃拟态卡片"，校园实景背景清晰透出；角色仅以文字徽标呈现
- 旧 `--role-accent` 机制已移除（PortalShell/WorkbenchView）；新 CSS 变量：--zc-gold、--zc-glass、--zc-glass-border（核对 :root）
- 角色判定三层：前端路由守卫（体验）→ guard.js requireRoles **实时查库**（真权限）→ dataScope SQL 层强制拼接（数据范围 self/dept/all）

## 5. 必须遵守的铁律（全部踩过坑）

1. **TiDB Serverless 禁用 mysql2 `execute()`（预编译协议）**：代理偶发 malform packet error。全项目统一 `db.js query()` 文本协议
2. **db.js query() 内置瞬时错误重试**（ECONNRESET/malform/握手/SSL，换连接最多 2 次）+ 连接池 5；**withTransaction 事务封装同样内置瞬时错误重试**（换新连接最多 2 次，要求业务幂等——选课/退课满足）—— 随机 500 的根治方案，**别删**
3. **500 会落库 sys_op_log(action='error.500')**，线上无控制台时用这个远程诊断真实错误
4. **新业务模块统一走 guard.js**：requireRoles + dataScope + HttpError + opLog（管理写操作必须审计留痕）
5. **JWT_SECRET 必须在 EdgeOne 控制台配置且选生产环境**；env 变量改后必须重新部署才生效
6. **背景层 z-index:-1 时 body 绝不能有不透明背景**（CSS 绘制顺序会盖住它）；CSS 变量只用未定义会静默失效，新增 var 引用必须核对 :root
7. **防超卖范式**：事务内先 `INSERT ... ON DUPLICATE KEY UPDATE` 选课记录（唯一键占位；退课记录重激活，已出分记录不可重选）→ 再条件 `UPDATE ... WHERE enrolled < capacity`，affectedRows=0 即名额满/重复选课
8. **DATETIME 一律传 Date 对象或 'YYYY-MM-DD HH:mm:ss' 字符串**，禁止 toISOString()（UTC 8 小时偏移坑）
9. KV 60 秒最终一致 → 选课名额等强一致计数一律走数据库
10. **gitignore 白名单制**：根目录 `/*.txt` 与 `node-functions/*.txt` 全忽略，scripts 只保留白名单——调试产物严禁入库

## 6. 交付与验证流程

1. 改代码 → `npm.cmd run build`（前端构建必须过）
2. `git add -A && git commit` → push（凭据在 Windows 凭据管理器；`git -c credential.helper= push <user:pass 编码后的 url> main`）
3. 等 ~95 秒部署 → 线上验证
4. **推荐验证方式**：写一次性 Node 22 脚本（原生 fetch）直打线上 API 全链路（登录拿 token → 逐接口断言 → 结果落盘），跑完即删。参考已删除的 verify-m1m2.mjs 模式：学生选课→防重→辅导员审批→销假→报修→教师录成绩→学生查成绩→越权回归 40301
5. 收尾必须同步 docs（见 CONVENTIONS.md 会话纪律）

## 7. 当前完成度

| 模块 | 状态 |
|---|---|
| 统一认证（双令牌/轮换/重放检测/锁定/审计） | ✅ 上线 |
| 五角色 RBAC + 组织架构（院系/班级）+ 用户管理 | ✅ 上线 |
| M1 教务：选课（防超卖）/课表/成绩单/教师录入 | ✅ 上线（16 步验证） |
| M2 学工：请销假审批流闭环/报修工单/公告 | ✅ 上线（16 步验证） |
| 门户：SSO 联动 + 角色主题工作台 + 资源链接 | ✅ 上线 |
| 安全审计（docs/AUDIT-2026-09-17.md） | ✅ 1P1+3P2 已修复 |
| M3 生活服务（图书/二手/失物/社团） | ❌ 未开始（PRD 有规划） |
| M4 校领导驾驶舱 | ❌ 未开始（leader 菜单有占位） |
| 院系班级管理页前端 | ❌ API 已就绪，仅差页面 |
| uni-app 小程序端 | ❌ 未开始 |

## 8. 下一步建议（优先级序）

1. 院系班级管理页（`/api/admin/departments` 已就绪）
2. M3 图书借阅（schema-005，lib_ 前缀，参考 DATABASE.md 草案）
3. M3 二手/失物/社团（标准 CRUD）
4. M4 驾驶舱（`requireRoles(['admin','leader'])` + scope=all + 聚合统计）
5. 论文素材沉淀：选课并发控制（db.js 防超卖范式）、审批流两表引擎、云边协同架构（ARCHITECTURE.md 已有口径）

## 9. 新会话开场白（复制即用）

> 读取 docs/HANDOVER.md 和最近 git log，总结当前项目状态，然后开始实现：［具体任务］。
> 遵守 HANDOVER.md 第 5 节铁律与 CONVENTIONS.md，不引入新依赖，完成后同步 docs 并提交推送。

## 演示数据（2026-09-19 批量生成，scripts/seed-demo.mjs，幂等可重跑）

- 规模：6 院系 / 14 班级（每班 28~31 人）/ **402 名学生 / 40 名教师 / 8 名辅导员 / 10 名校领导**；课程库 27 门，本学期教学班 59 个，选课记录约 2000 条
- 账号规则：`student004~student403`（学号 20261004+）、`teacher01~teacher40`（T2026xxxx）、`counselor01~08`（C2026xxxx）、`leader01~10`（L2026xxxx），**默认密码均为 `Zhihui@2026`**，学生账号有效期至 2027-07-31
- 每个班级均已指派辅导员；教师按院系随机排课（周一~周五 1-2节~9-10节）；学生每班选修本系 3~4 门 + 公共课，课表/选课/名册/成绩数据齐全
- 重建演示数据：`node scripts/seed-demo.mjs`（自动跳过已存在账号/班级/课程，可安全重复执行）

### 行政部门与行政人员（2026-09-20）

- 行政部门 10 个：校长室(xzs)、党委办公室(dw)、教务处(jwc)、学生工作处(xgc)、校团委(tw)、人事处(rsc)、财务处(cwc)、招生就业处(zjc)、后勤保障处(hqc)、图书馆(tsg)，共 29 名行政人员（leader 角色）
- 账号规则：部门编码小写+序号（如 `jwc01` 教务处、`xzs01` 校长室），工号 A2026xxx，**默认密码 `Zhihui@2026`**
- sys_department 新增 dept_type 字段（college=教学院系 / admin=行政部门）；开课院系下拉仅显示教学院系
- 重建：`node scripts/seed-admin-staff.mjs`（幂等，自动执行 schema-006）
