# ARCHITECTURE · 架构与技术决策记录

> 论文标题（定稿）：**《基于云边协同与 Serverless 架构的"智汇校园"一站式服务平台设计与实现》**

## 1. 总体架构

**架构定性：云边协同（Cloud-Edge Collaboration）+ 全栈 Serverless。**
本项目没有传统意义上的"中心节点/自管服务器"——不存在需要自己运维的服务器；"边缘侧"与"中心云端"两类设施均以 Serverless 形态交付：

| 侧 | 组成 | 形态 | 你需要运维什么 |
|---|---|---|---|
| 边缘侧 | 全球 3200+ 边缘节点：静态资源 CDN 分发、Edge Functions（KV 会话/限流/计数） | 边缘 Serverless | 无 |
| 中心云端 | Node/Cloud Functions（业务 API、事务）+ TiDB Serverless（结构化数据） | 云端 Serverless | 无 |
| 答辩口径 | "边缘计算体现在哪"：静态资源就近分发（毫秒级）、认证会话与限流在边缘就近校验不回源、核心业务与强一致事务在云端完成——三层协同，即"云边协同设计" | | |

```
全部跑在 EdgeOne Pages 上：
  ├─ Vue 3 管理端        → Pages 静态托管（全球 CDN，桌面端专用地址）
  ├─ uni-app 小程序/H5端  → 独立地址静态托管（不做网页自适应，移动端体验独立设计）
  ├─ Edge Functions      → 边缘原生轻端点（KV 访问统计/诊断）、静态内容边缘缓存
  ├─ Node Functions      → 核心业务 API（连 MySQL）+ 入口限流（登录/注册/找回等）
  ├─ KV                  → 访问统计计数、功能开关、热数据计数
  ├─ Blob                → 图片、附件（M3 起为 sys_blob 表暂存，见 ADR-4）
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
| MySQL(TiDB) | 用户、课程、选课、成绩、审批流、请假、报修、公告、借阅、社团、论坛等结构化数据；**M3 起图片存 sys_blob 表（LONGBLOB，token 外链）** | 文件二进制的大规模存储（图床接入后迁出） |
| KV | 访问统计计数、config:*、限流窗口规划位（当前限流在 Node 内存，见 2.5） | 需要强一致的业务计数（选课名额！走数据库） |

**重要**：KV 是 60 秒最终一致，所有"不能错的计数"（选课名额、库存）必须走数据库事务，KV 只放可容忍延迟的计数。

### ADR-5 权限模型：guard.js 三层防线（2026-09-17 定稿）

- **第一层（前端路由守卫）**：登录态 + meta.roles，未登录带 redirect 去登录页（SSO 回跳体验）
- **第二层（guard.js requireRoles）**：**角色实时查库**，不信 JWT 内角色（撤权即时生效）；业务错误抛 HttpError 由 jsonError 按自带 status 返回
- **第三层（dataScope 数据范围）**：admin/leader=all、counselor=dept、其他=self，SQL 层强制拼接 WHERE，前端过滤只作展示
- 管理端写操作全部 `opLog()` 落 sys_op_log 审计；防自锁（不能禁自己/摘自己的 admin）
- 论文口径：RBAC + 数据范围双维权限模型，优于单一角色点表

### ADR-6 TiDB Serverless 连接韧性（2026-09-17 线上压测结论）

- **禁用 mysql2 execute()（预编译协议）**：TiDB Serverless 代理偶发 `malform packet error`，全项目统一 query() 文本协议（占位符转义防注入不变）
- db.js query() 内置**瞬时错误自动重试**（ECONNRESET/malform/握手/SSL/连接数上限，换连接最多 2 次）+ 连接池 5
- 随机 500 同步落 sys_op_log（action='error.500'）供远程诊断（线上无控制台）
- 论文口径：Serverless 数据库的瞬时故障是常态，数据访问层必须内建重试韧性

### ADR-7 通用审批流：两表引擎（2026-09-17 定稿）

- flow_instance（谁发起的什么业务，走到哪）+ flow_node（每个节点一个处理角色 + 处理留痕），与具体业务解耦
- 新审批业务（奖助/调宿）只需建业务单据 + 插 instance + 按 node_order 插节点，不新增流程代码
- 处理人实时匹配 handler_role + 数据范围（辅导员只审本院），杜绝指定死处理人

## 2.5 双运行时分工：Edge Functions vs Node Functions

| 特性 | Edge Functions | Node Functions |
|---|---|---|
| 运行位置 | 全球 3200+ 边缘节点 | 中心化数据中心 |
| 运行时 | V8 沙箱（受限 Web API） | 完整 Node.js（npm 全生态） |
| 冷启动 | 毫秒级 | 秒级 |
| KV 访问 | ✅（全局变量） | ❌ |
| WebSocket | ❌ | ✅ |
| CPU/时长 | 200ms | 120s 墙钟 |

**分工铁律：离 KV 近的轻活给 Edge（限流/计数/统计），碰数据库的重活给 Node（业务 API/事务）。** 两边路由同处 `/api` 命名空间，规划路径避免撞车。

**★ 平台关键行为（2026-09-20 实测踩坑，架构选型依据）**：边缘函数内 `fetch` 发起的子请求**不进入函数路由**——同域子请求走"节点缓存→静态源站"（拿到的是静态资源/SPA 回退），跨域子请求行为未文档化。**结论：Edge Functions 无法代理转发到 Node Functions，"边缘网关全量代理"架构在本平台不可行**（曾实现后实测 /api/gw 代理返回 SPA，已回滚）。因此：
- **接口限流落在 Node 侧**（lib/auth.js rateLimit，实例内存固定窗口：登录 IP+账号 5/min + IP 30/min、刷新 30/min、忘记密码 3/hour，均为市面常见频率）；KV 60s 最终一致也不适合做精确限流计数
- **边缘侧真实承担**（零额外跳数）：静态资源 CDN 分发、图片等静态内容边缘缓存（immutable）、**边缘原生端点**——`/api/edge/stats`（KV 访问统计，无 DB 依赖，边缘毫秒级响应）、`/api/kv-check`（KV 诊断）
- 论文口径：边缘=CDN 分发 + 边缘缓存 + KV 轻计算；云端=事务与强一致；限流在应用入口（Node）以内存窗口实现——三层各司其职，不为了"像云边协同"而强行加代理层

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
- **多端跨域（CORS）**：Node Functions 所有响应内置 CORS 头，OPTIONS 预检统一返回 204；白名单用环境变量 `CORS_ORIGIN`（逗号分隔多个域名），未配置默认 `*`（鉴权走 Bearer 无 Cookie，风险可控）。admin/m 子域名独立部署时必须配置
- **认证 API 防护清单**：注册 IP 频控（每 IP 每小时 5 次）+ 建用户/授角色事务化 + 唯一键冲突兜底；刷新令牌条件更新防并发竞态（双端同时刷新仅一方成功）；登录失败锁定（实例级内存，多实例尽力而为）
- **DATETIME 规范**：SQL 参数一律传 JS Date 对象（mysql2 按连接池 timezone 序列化），禁止手写 toISOString() 字符串——UTC 墙钟与池时区混用会产生 8 小时偏移

## 4. 关键技术亮点（论文/答辩素材）

1. **选课并发控制**：事务 + 唯一键占位 + 条件 UPDATE 防超卖（比 SELECT FOR UPDATE 更简洁，实测并发安全）
2. **通用审批流引擎**：flow_instance/flow_node 两表驱动，业务零侵入复用
3. **存储选型论证**：KV vs Blob vs 关系库的分工设计（KV 最终一致的边界）
4. **边缘全栈部署**：静态资源全球 CDN + Serverless API，零运维，git push 即部署
5. **RBAC + 数据范围双维权限**：guard.js 三层防线（路由守卫/实时查库/SQL 强制拼接）
6. **Serverless 数据库韧性**：瞬时错误识别 + 自动重试 + 错误落库远程诊断
7. **统一学术风门户 + SSO 回跳**：学术深蓝 + 素金点缀的玻璃拟态视觉，校园实景背景（2026-09-18 起不再按角色区分主题色，角色仅文字徽标）
