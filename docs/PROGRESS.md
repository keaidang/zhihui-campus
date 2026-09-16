# PROGRESS · 进度与待办

> 每次会话结束必须更新本文件。状态标记：[ ] 未开始 / [~] 进行中 / [x] 已完成 / [!] 有坑

## 当前状态

**阶段：阶段 0 项目基建（进行中）· 云端资源已就绪**

- 2026-09-16：TiDB Cloud Starter 集群 `biyesheji`（ap-southeast-1）创建完成
- 2026-09-16：`.env`（连接配置）+ `cert/isrgrootx1.pem`（CA 证书）落盘，`.gitignore` 已排除机密
- 2026-09-16：连通性读写测试全部通过（`scripts/db-test.py`，建库 `zhihui_campus` 成功）
- 2026-09-16：项目文件夹改名"智汇校园-一站式服务平台"→"智汇校园一站式服务平台"，Git 初始化完成
- 2026-09-16：首次提交 `5be781a` 推送成功 → **GitHub 远端：github.com/keaidang/zhihui-campus**（阶段 0 完成）

## 阶段计划

### 阶段 0 · 项目基建
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
  - 数据库：schema-001-auth.sql 已执行（sys_user / sys_role / sys_user_role / sys_refresh_token / sys_login_log + 3 个基础角色）
  - 后端认证 API：register / login / refresh / logout / me + health（node-functions/），冒烟测试通过
  - Edge Functions：/api/kv-check（KV 连通性验收用）
  - Web 门户前端：Vue3 + Element Plus + Pinia，首页（一站式模块矩阵）+ 登录/注册页，本地构建通过
  - 安全：bcrypt + JWT 双令牌 + 刷新轮换/重放检测 + 登录锁定 + 审计日志 + 参数化查询 + 安全响应头
- [ ] **待用户：控制台环境变量新增 `JWT_SECRET`**（值在本地 .env，见 scripts/edgeone-env-paste.txt v3）
- [ ] **待用户：确认 EdgeOne 构建设置**：框架预设 Vite / 构建命令 `npm run build` / 输出目录 `dist`（若控制台未自动识别）
- [ ] **待用户：git push 后验收**：首页 UI → 注册 → 登录 → /api/health → /api/kv-check
- [ ] 已知优化项：Element Plus 全量引入导致主 chunk 1.2MB，后续改按需引入 + manualChunks 分包
- [ ] 控制台：配置环境变量（对照 scripts/edgeone-env-paste.txt 逐条粘贴）
- [ ] 控制台：Git 集成连接 keaidang/zhihui-campus（main 分支，push 即自动部署）
- [ ] 初始化代码骨架（web-admin / miniprogram / node-functions / edge-functions / seed）

### 阶段 1 · 地基（先做，其他模块全依赖它）
- [ ] 统一登录 + JWT + KV session
- [ ] RBAC 权限 + 管理端布局与动态菜单
- [ ] 学生管理 CRUD + 学籍档案

### 阶段 2 · 核心三件套
- [ ] 选课：列表/课表/选退课/时间冲突检测/并发扣名额 + 压测脚本
- [ ] 图书：书目/副本/借还/逾期
- [ ] 宿舍：楼栋/房间/分配/报修工单流转

### 阶段 3 · 扩展模块（每个 3~5 天一个）
- [ ] 社团管理
- [ ] 校园点餐（模拟支付）
- [ ] 二手交易
- [ ] 失物招领
- [ ] 健身打卡（KV 计数）

### 阶段 4 · 收尾
- [ ] 数据可视化大屏
- [ ] 消息通知（站内信）
- [ ] 种子数据完善、全流程演示彩排
- [ ] 论文初稿（架构选型、数据库设计、并发控制为三章核心素材）

## 已知坑与备忘

- KV 为 60 秒最终一致 → 选课名额/库存一律走数据库，KV 只放容忍延迟的计数
- TiDB Serverless 有冷启动，演示前先预热一次请求
- Supabase 免费版 7 天不活跃休眠（当前未选用，仅备忘）
- Node Functions 连接池 max 设 5~10，防连接数打满
- **DATETIME 一律传 Date 对象**：toISOString() UTC 字符串 + 连接池 timezone('+08:00') 会造成 8 小时偏移（已踩坑修复）
- **多端独立域名部署时必须配 CORS_ORIGIN 环境变量**（Node Functions 已内置 CORS 响应头与 OPTIONS 预检，未配 CORS_ORIGIN 时默认放行）
- sys_refresh_token 过期/吊销记录暂无清理任务，量大后需定期清理（低优先级）
- 登录失败锁定为实例级内存版，多实例下尽力而为，后续可迁 KV

## 变更记录

- 2026-09-16：项目初始化、TiDB 就绪、阶段 1 地基上线（认证 + 门户）
- 2026-09-16（深夜）：地基代码审计后修复——P1 刷新令牌时区偏移 8h、P1 刷新页面丢登录态（main.js 挂载前 restoreSession）；P2 注册接口 IP 频控 + 建用户/授角色事务化 + 唯一键冲突兜底、P2 刷新令牌条件更新防并发竞态、P2 全端点 CORS/OPTIONS 支持；UI 改版为庄重学术蓝风格（登录页参照传统"统一身份认证"版式：深蓝灰半透明卡片 + 校名抬头；背景纱罩减薄使照片清晰显形）

