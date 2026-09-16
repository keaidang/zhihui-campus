# PROGRESS · 进度与待办

> 每次会话结束必须更新本文件。状态标记：[ ] 未开始 / [~] 进行中 / [x] 已完成 / [!] 有坑

## 当前状态

**阶段：阶段 0 项目基建（进行中）· 云端资源已就绪**

- 2026-09-16：TiDB Cloud Starter 集群 `biyesheji`（ap-southeast-1）创建完成
- 2026-09-16：`.env`（连接配置）+ `cert/isrgrootx1.pem`（CA 证书）落盘，`.gitignore` 已排除机密
- 2026-09-16：连通性读写测试全部通过（`scripts/db-test.py`，建库 `zhihui_campus` 成功）
- 2026-09-16：项目文件夹改名"智汇校园-一站式服务平台"→"智汇校园一站式服务平台"，Git 初始化完成

## 阶段计划

### 阶段 0 · 项目基建
- [x] 确定项目名：智汇校园
- [x] 确定架构：EdgeOne 全栈 + TiDB Serverless（备选云 RDS）+ KV + Blob
- [x] 建立文档体系（PRD/ARCHITECTURE/DATABASE/API/CONVENTIONS/PROGRESS）
- [x] 注册 TiDB Cloud Starter + 创建 zhihui_campus 库 + 连通性测试通过
- [x] Git 仓库初始化 + 首次提交（GitHub 远端：zhihui-campus）
- [ ] 初始化代码骨架（web-admin / miniprogram / node-functions / edge-functions / seed）
- [ ] EdgeOne Pages 创建项目、开通 KV、绑定命名空间
- [ ] 连接串写入 EdgeOne 环境变量（不进 Git）

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
