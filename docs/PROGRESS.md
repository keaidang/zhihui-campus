# PROGRESS · 进度与待办

> 每次会话结束必须更新本文件。状态标记：[ ] 未开始 / [~] 进行中 / [x] 已完成 / [!] 有坑

## 当前状态

**阶段：一期（M1 教务线 + M2 学工线）全量上线并验证 ✅**

- 线上：https://campus.keaidang.com/ （EdgeOne Pages，git push 即部署）
- 已交付：统一认证、五角色 RBAC + 组织架构、用户管理、M1 教务（选课防超卖/课表/成绩）、M2 学工（请销假审批流/报修/公告）、门户 SSO 联动 + 角色主题工作台
- 质量基线：安全审计完成（docs/AUDIT-2026-09-17.md）；M1+M2 线上 16 步全链路验证通过
- 新会话/新 Agent 开工：**先读 docs/HANDOVER.md**

- 2026-09-16：TiDB Cloud Starter 集群 `biyesheji`（ap-southeast-1）创建完成
- 2026-09-16：`.env`（连接配置）+ `cert/isrgrootx1.pem`（CA 证书）落盘，`.gitignore` 已排除机密
- 2026-09-16：连通性读写测试全部通过（`scripts/db-test.py`，建库 `zhihui_campus` 成功）
- 2026-09-16：项目文件夹改名"智汇校园-一站式服务平台"→"智汇校园一站式服务平台"，Git 初始化完成
- 2026-09-16：首次提交 `5be781a` 推送成功 → **GitHub 远端：github.com/keaidang/zhihui-campus**（阶段 0 完成）

## 阶段计划

### 阶段 0 · 项目基建（全部完成）
- [x] 确定项目名：智汇校园
- [x] 确定架构：EdgeOne 全栈 + TiDB Serverless（备选云 RDS）+ KV + Blob
- [x] 建立文档体系（PRD/ARCHITECTURE/DATABASE/API/CONVENTIONS/PROGRESS）
- [x] 注册 TiDB Cloud Starter + 创建 zhihui_campus 库 + 连通性测试通过
- [x] Git 仓库初始化 + 首次提交（GitHub 远端：zhihui-campus）
- [x] GitHub 推送完成（用户终端执行；凭据此前已存于 Windows 凭据管理器，无需重新授权）
- [x] EdgeOne CLI v1.6.40 安装完成（托管工作区，入口 `scripts/eo.cmd`）
- [x] EdgeOne 登录完成（国际站 Global，账号 keaitx@gmail.com）
- [x] Makers 项目关联完成：`eo.cmd makers link -n zhihui-campus`（关联配置在项目根 `.edgeone/`）
- [x] 生成控制台粘贴清单 `scripts/edgeone-env-paste.txt`（6 个环境变量 + CA 证书全文）
- [x] 控制台：开通 KV 并创建命名空间 `zhihuicampus`、绑定项目（KV 绑定变量名：`zhihuicampus`）
- [x] **阶段 1 地基代码完成（2026-09-16 晚）**：
  - 数据库：schema-001-auth.sql 已执行（sys_user / sys_role / sys_user_role / sys_refresh_token / sys_login_log）
  - 后端认证 API：register / login / refresh / logout / me + health（node-functions/），冒烟测试通过
  - Edge Functions：/api/kv-check（KV 连通性验收用）
  - Web 门户前端：Vue3 + Element Plus + Pinia，首页 + 登录/注册页
  - 安全：bcrypt + JWT 双令牌 + 刷新轮换/重放检测 + 登录锁定 + 审计日志 + 参数化查询 + 安全响应头
- [x] 控制台环境变量 JWT_SECRET 配置（生产环境）+ Git 集成自动部署（2026-09-17 验证）
- [x] 域名 https://campus.keaidang.com/ 绑定生效 + ICP 备案页脚

### 阶段 1 · 地基 + 基础部分（2026-09-17 完成）
- [x] 统一登录 + JWT 双令牌（KV session 备案，当前 Bearer 直验）
- [x] RBAC 五角色（student/teacher/counselor/leader/admin）+ guard.js 权限中间件（实时查库 + 数据范围）
- [x] 组织架构：sys_department（6 院系）+ sys_class + sys_user 扩展（user_no/dept_id/class_id）
- [x] 用户管理页（搜索/启停/角色分配/归属设置，防自锁/防越权）
- [x] 安全审计一轮（docs/AUDIT-2026-09-17.md：1 P1 + 3 P2 全修复）

### 阶段 2 · 一期双线（2026-09-17 深夜完成）
- [x] **M1 教务线**：schema-003（edu_course/edu_class/edu_elect）+ 选课 API（事务 + 条件 UPDATE 防超卖 + 唯一键防重选）+ 学生选课页 + 成绩课表页（GPA 统计）+ 教师课程/成绩录入页
- [x] **M2 学工线**：schema-004（flow_instance/flow_node 通用审批流 + af_leave/af_repair/af_notice）+ 请销假闭环（申请→审批→销假）+ 报修工单（提交/受理/完成）+ 公告（发布/置顶/撤回，院系定向）
- [x] 门户：主页 4 张服务卡 SSO 联动（未登录带 redirect 去登录→原路跳回）、工作台五角色主题色 + 账号信息卡 + 常用资源链接
- [x] 线上 16 步全链路验证（选课→审批→销假→报修→录成绩→查成绩→越权回归 40301）

### 阶段 3 · M3 生活服务（未开始）
- [ ] 图书借阅（schema-005）
- [ ] 二手交易 / 失物招领 / 社团活动

### 阶段 4 · 收尾（未开始）
- [ ] M4 校领导驾驶舱（只读大屏）
- [ ] uni-app 小程序端
- [ ] 种子数据完善、全流程演示彩排
- [ ] 论文初稿（选课并发控制 / 审批流引擎 / 云边协同为三章核心素材）

## 已知坑与备忘

- **TiDB Serverless 禁用 mysql2 execute()（预编译协议）**——统一走 db.js query() 文本协议；query() 已内置瞬时错误重试 + 连接池 5，别删
- **线上 500 会落库 sys_op_log(action='error.500')**，远程诊断真实错误用它
- **当前学期口径 TERM='2026-2027-1'** 硬编码在 edu 相关 API，换学期需统一修改
- 演示账号 admin/admin 为用户指定弱密码（2026-09-18），对外开放前必须改强密码
- KV 为 60 秒最终一致 → 选课名额/库存一律走数据库，KV 只放容忍延迟的计数
- TiDB Serverless 有冷启动，演示前先预热一次请求
- Supabase 免费版 7 天不活跃休眠（当前未选用，仅备忘）
- **DATETIME 一律传 Date 对象或 'YYYY-MM-DD HH:mm:ss'**：toISOString() UTC 字符串 + 连接池 timezone('+08:00') 会造成 8 小时偏移（已踩坑修复）
- **多端独立域名部署时必须配 CORS_ORIGIN 环境变量**（Node Functions 已内置 CORS 响应头与 OPTIONS 预检，未配 CORS_ORIGIN 时默认放行）
- sys_refresh_token 过期/吊销记录暂无清理任务，量大后需定期清理（低优先级）
- 登录失败锁定为实例级内存版，多实例下尽力而为，后续可迁 KV

## 变更记录

- 2026-09-16：项目初始化、TiDB 就绪、阶段 1 地基上线（认证 + 门户）
- 2026-09-16（深夜）：地基代码审计后修复（时区偏移/丢登录态/频控/事务化/CORS）；UI 改版庄重学术蓝
- 2026-09-17：品牌与合规上线（域名/校徽/书法校名/ICP 备案）；登录 500 破案（JWT_SECRET 注入 + TiDB 文本协议）；功能架构定稿（五角色 + 一期双线 + 砍点餐）
- 2026-09-17（晚）：基础部分落地（schema-002 五角色/院系/班级、guard.js、管理端 API、PortalShell/工作台/用户管理）；安全审计修复（P1 归属越权 + sys_op_log 审计 + 保留用户名 + 仓库卫生）；db.js 瞬时错误重试根治随机 500（15/15 压测零 500）
- 2026-09-17（深夜）：**M1 教务线 + M2 学工线全量上线**（schema-003/004、7 个业务 API、9 个业务页面）；主页 SSO 联动；工作台五角色主题改版（--role-accent）+ 校园实景背景 + 资源链接；16 步线上验证全过；修复公告 LEFT JOIN/出分课程课表消失/选课返回体三个 bug
- 2026-09-18：admin 密码按用户要求重置为 `admin`（弱密码，演示专用）；**文档全面更新 + 新增 HANDOVER.md 交接文档**

## 下一步

- [ ] 院系班级管理页（API 已就绪，前端待做）
- [ ] M3 图书借阅（schema-005）
- [ ] M3 二手/失物/社团
- [ ] M4 驾驶舱
- [ ] 已知优化项：Element Plus 按需引入 + manualChunks 分包（主 chunk 偏大）

