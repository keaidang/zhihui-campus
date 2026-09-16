# ARCHITECTURE · 架构与技术决策记录

## 1. 总体架构

```
全部跑在 EdgeOne Pages 上：
  ├─ Vue 3 管理端        → Pages 静态托管（全球 CDN，桌面端专用地址）
  ├─ uni-app 小程序/H5端  → 独立地址静态托管（不做网页自适应，移动端体验独立设计）
  ├─ Edge Functions      → 登录态校验（KV Session）、限流、计数
  ├─ Node Functions      → 核心业务 API（连 MySQL）
  ├─ KV                  → Session、功能开关、热数据计数
  ├─ Blob                → 图片、附件
  └─ TiDB Cloud Serverless → 结构化业务数据（MySQL 兼容）
```

**前端多端策略（定稿）**：不采用响应式自适应网页，各端独立——管理端桌面专用；移动端以微信小程序为主 + H5 独立地址（uni-app 一套代码编译两端，维护成本低）；三端共用同一套 `/api` 后端，鉴权 Token 统一。

唯一外部依赖是数据库；其余全部 Serverless，Git 推送即部署。

## 2. 关键技术决策（ADR）

### ADR-1 为什么不用微服务（SpringCloud 等）

单人毕设，微服务带来注册中心、网关、链路追踪等运维负担，收益为零。采用**单体分层 + 模块化包结构**，模块间通过公共服务层解耦。

### ADR-2 为什么不用纯 KV + Blob 存储全部数据

- KV 为 60 秒最终一致 → 选课并发扣名额会超卖
- KV 无条件查询/JOIN/事务 → 学生、选课、成绩等关系型业务无法承载
- 免费版配额小（单命名空间 1GB，每日读写次数有限）
- 结论：KV/Blob 放在擅长位置，结构化数据进关系库

### ADR-3 数据库选 TiDB Cloud Serverless 而非自建/云 RDS

- MySQL 语法兼容，论文技术栈无需改为 PostgreSQL
- 免费额度（行存储 5~25GB + 2.5 亿 RU/月）覆盖毕设量级
- 支持设置消费上限，防意外扣费
- 预案：答辩前如需绝对稳定，可 mysqldump 迁移到最低配云 RDS（表结构完全兼容）

### ADR-4 存储分工表

| 存储 | 放什么 | 不放什么 |
|---|---|---|
| MySQL(TiDB) | 用户、课程、选课、成绩、借阅、宿舍、工单、订单、商品、帖子等结构化数据 | 文件二进制 |
| KV | session:token、config:*、count:*（打卡天数/访问计数）、限流窗口 | 需要强一致的业务计数（选课名额！走数据库） |
| Blob | avatar/、market/、lost/、notice/ 下的图片附件 | 小键值状态 |

**重要**：KV 是 60 秒最终一致，所有"不能错的计数"（选课名额、库存）必须走数据库事务 + 乐观锁，KV 只放可容忍延迟的计数。

## 2.5 双运行时分工：Edge Functions vs Node Functions

| 特性 | Edge Functions | Node Functions |
|---|---|---|
| 运行位置 | 全球 3200+ 边缘节点 | 中心化数据中心 |
| 运行时 | V8 沙箱（受限 Web API） | 完整 Node.js（npm 全生态） |
| 冷启动 | 毫秒级 | 秒级 |
| KV 访问 | ✅（全局变量） | ❌ |
| WebSocket | ❌ | ✅ |
| CPU/时长 | 200ms | 120s 墙钟 |

**分工铁律：离 KV 近的轻活给 Edge（登录态/限流/计数），碰数据库的重活给 Node（业务 API/事务）。** 两边路由同处 `/api` 命名空间，规划路径避免撞车。

**KV 实例信息（定稿）**：命名空间 `zhihuicampus`，绑定到项目的变量名同为 `zhihuicampus` —— Edge Functions 内通过 `zhihuicampus.get()/put()` 访问（key 前缀规范见 DATABASE.md：session: / config: / counter: / ratelimit:）。

## 2.6 数据库连接规范（已验证可用）

- 连接配置在项目根 `.env`（已 gitignore），键：`DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME / DB_CA_PATH`
- 端口 **4000**（非 3306）；TiDB 强制 TLS，CA 证书 `cert/isrgrootx1.pem`（ISRG Root X1，公开证书可入库）
- **线上 CA 传递方案（定稿）**：EdgeOne 环境变量值**上限 1000 字符**且禁止换行，PEM 证书（base64 后 1856 字符）超限无法放入 → **最终决策：线上不配置 DB_CA_CERT**。Node.js 运行时内置信任库含 ISRG Root X1，`ssl: { rejectUnauthorized: true }`（或不传 ca）即可直连 TiDB，已实测验证（scripts/noca-test.py）。本地开发仍可用 `.env` 的 `DB_CA_PATH` 显式加载证书；代码端做兼容：有 DB_CA_CERT 就还原 PEM，没有就走系统信任库
- Node Functions 连库模板：`mysql2` + 连接池 `connectionLimit: 10` + `ssl: { rejectUnauthorized: true }`（线上默认走系统信任库；本地如需显式 CA 用 `.env` 的 DB_CA_PATH）
- Serverless 冷启动会导致首次 TLS 握手 1~2 秒，演示前先预热一次请求
- 连通性自检脚本：`scripts/db-test.py`（本地验证用，不参与部署）

## 3. 安全要点

- 数据库连接串放 EdgeOne **环境变量**，严禁提交进 Git
- 数据库账号最小权限（仅 CRUD 本库），开启 SSL
- Node Functions 使用**连接池**，max 设 5~10（免费版连接数上限低）
- 密码 bcrypt 哈希存储；JWT 有效期 2h + 刷新机制

## 4. 关键技术亮点（论文/答辩素材）

1. 选课并发控制：数据库乐观锁 + 唯一键防重复选课
2. 存储选型论证：KV vs Blob vs 关系库的分工设计
3. 边缘全栈部署：静态资源全球 CDN + Serverless API，零运维
4. RBAC 权限模型：统一账号体系支撑全部模块
