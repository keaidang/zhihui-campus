# 邮件服务接口文档（LanQin Email · 9o.pw）

> 面向两类读者：
> ① 维护「智汇校园」的人 —— 看第四章（项目内封装层）；
> ② 接入 `wolf@9o.pw` 的外部系统 —— 看第三章 + 第五~十章。
>
> 上游产品：**LanQin Email**（开源自建邮箱系统，Go + Postfix/Dovecot/Rspamd，SQLite）
> 官方仓库：<https://github.com/smithwhere/LanQin-Email>
> 官方 API 文档：<https://github.com/smithwhere/LanQin-Email/blob/main/docs/API.md>
> 本项目使用的实例：**<https://email.9o.pw>**
>
> 最后核对时间：2026-11-03（据官方文档 + 本实例实测）

---

## 一、总览

「智汇校园」没有接第三方邮件服务，而是自建了一套 LanQin Email，所有发信、收信、开邮箱都走它的**开放 API**。

```
┌─────────────────┐        ┌──────────────────────────┐        ┌──────────────┐
│ 智汇校园         │        │  LanQin Email            │        │  收件人       │
│ node-functions   │──API──▶│  https://email.9o.pw     │──SMTP─▶│  QQ / Gmail / │
│ lib/lanqin.js    │        │  /api/open/v1/*          │        │  其他域        │
└─────────────────┘        └──────────────────────────┘        └──────────────┘
        ▲                              ▲
        │                              │
   你正在看的文档                 wolf@9o.pw 也给外部系统用
```

**两层接口，别搞混：**

| 层 | 位置 | 谁用 | 特点 |
|---|---|---|---|
| 封装层 | `node-functions/lib/lanqin.js` | 只有本项目的 Node 代码 | 12 个语义化函数、超时/错误兜底、域名缓存 |
| 开放 API | `https://email.9o.pw/api/open/v1` | 任何系统（含外部系统） | HTTP + Bearer Token，语言无关 |

外部系统**只应该用第二层**。封装层是本项目的内部实现，不要跨项目 import。

---

## 二、wolf@9o.pw 已就绪的资源

| 项 | 值 | 说明 |
|---|---|---|
| 邮箱地址 | `wolf@9o.pw` | 已在 9o.pw 域名下创建，状态 `active` |
| mailboxId | `mbx_WKqcd8u_3o00ZMf9lzIs0g` | **发信必填**，写死在配置里 |
| 域名 ID | `dom_39T0aMVf_DnFC6gs68dA8Q` | 9o.pw 的域名 ID，创建邮箱时用 |
| 归属用户 | `usr_VyQyDYDg0ifjrHbX2kQ-Ag`（`k@9o.pw`） | **关键约束**，见第十章「404 的真相」 |
| 邮箱密码 | `RWSTRoBS4QPWQxofrjQ3` | 用于 IMAP/POP3/SMTP 客户端登录，**不是** API 调用凭证 |
| 配额 | 1024 MB | 满了发信返回 `507` |
| API Token | **由管理员单独交付，不写入本文档** | 见第三章第 2 步 |

> 已做闭环实测（2026-11-03）：以 `wolf@9o.pw` 发信 → `status=relayed` → 收件箱收到，`Inbox` 与 `Sent` 各一条。发信链路正常。

---

## 三、外部系统 5 分钟接入

### 第 1 步：拿到三个值

```
BASE_URL   = https://email.9o.pw
TOKEN      = lq_xxxxxxxxxxxxxxxx（管理员交付）
MAILBOX_ID = mbx_WKqcd8u_3o00ZMf9lzIs0g
```

### 第 2 步：Token 怎么来（**强烈建议单独建，不要复用现有 key**）

开放 API **没有**创建 Token 的端点，必须在邮件后台手动建：

1. 登录 <https://email.9o.pw>（用 `k@9o.pw` 或 admin 账号）
2. 右上头像 → **个人中心 → API Token → 新建**
3. 只勾这三个 scope（够用且最小权限）：
   - `messages:send` —— 发信
   - `messages:read` —— 查发信状态、读收件箱
   - `mailboxes:read` —— 解析 mailboxId 归属（可选，便于排错）
4. **明文只显示一次**，立刻存进对方系统的密钥管理；丢了只能撤销重建
5. 默认 **90 天过期**，到期前记得换

> 为什么必须单独建：本项目现有的 `LANQIN_API_KEY` 是 admin 全权限（能删域名、删邮箱、改所有人密码）。给外部系统这把钥匙，等于把整个邮件服务器交出去。

### 第 3 步：发一封

```bash
curl -X POST "https://email.9o.pw/api/open/v1/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-20261103-0001" \
  -d '{
    "mailboxId": "mbx_WKqcd8u_3o00ZMf9lzIs0g",
    "to": ["someone@example.com"],
    "subject": "系统通知：任务已完成",
    "text": "纯文本正文",
    "html": "<p>HTML 正文</p>"
  }'
```

成功返回 `201`：

```json
{
  "id": "mail_q_N-yFnohObmzkOaE9d0eQ",
  "queueId": "snd_rxkShlxzOfUMhgIE4zY7KQ",
  "status": "queued",
  "messageId": "mail_q_N-yFnohObmzkOaE9d0eQ",
  "rfcMessageId": "<msg_YNe3k2G4f9z7UFuxnf9Img@9o.pw>",
  "mailboxId": "mbx_WKqcd8u_3o00ZMf9lzIs0g",
  "mailboxAddress": "wolf@9o.pw",
  "recipients": ["someone@example.com"],
  "maxAttempts": 5,
  "createdAt": "2026-11-03T07:48:52.601245826Z"
}
```

**`201` + `queued` 只代表"已入队"，不代表"已送达"。** 要确认送达，轮询 `GET /send/{id}` 看 `status`（见第七章）。

---

## 四、项目内封装层（`lib/lanqin.js`）

### 4.1 配置项

全部走环境变量，**代码里没有硬编码密钥**：

| 变量 | 必填 | 作用 | 当前值（示例环境） |
|---|---|---|---|
| `LANQIN_API_KEY` | ✅ | 开放 API Token | `lq_toQ…`（46 位） |
| `LANQIN_BASE_URL` | — | 实例地址，默认 `https://email.9o.pw` | `https://email.9o.pw` |
| `LANQIN_DOMAIN_ID` | ✅ | 默认域名 ID（`createMailbox` 不传域名时用） | `dom_OFazRTSXUfGYCzjMtYZw7g`（keaidang.com） |
| `LANQIN_SEND_MAILBOX_ID` | ✅ | **默认发信邮箱**，验证码与告警都用它 | `mbx_VjQgxhTvyIIxJivWddoN9Q`（system@keaidang.com） |
| `LANQIN_SYSTEM_MAILBOX_ID` | — | 发信邮箱的回退值 | 同上 |
| `LANQIN_SYSTEM_ADDRESS` | — | 邮件正文里展示的发件地址，默认 `system@keaidang.com` | `system@keaidang.com` |
| `LANQIN_OWNER_USER_ID` | ✅（建邮箱时） | 新建邮箱归属哪个用户。**不填会导致发信 404** | `usr_VyQyDYDg0ifjrHbX2kQ-Ag` |

`lanqinConfigured()` = `KEY && SEND_MAILBOX_ID` 都存在。所有方法在未配置时**不抛错**，返回 `{ok:false, error:'邮件服务未配置'}` —— 这是刻意的：邮件是旁路能力，不该让主流程崩。

> ⚠️ 项目里目前**没有 `.env.example`**，上面这张表就是唯一的环境变量清单。新环境部署时必须自备这些值。

### 4.2 十二个方法

| # | 方法 | 入参 | 返回 | 底层端点 | 用在哪 |
|---|---|---|---|---|---|
| 1 | `sendVerificationCode` | `(to, code, purpose='注册')` | `{ok,id,status}` / `{ok:false,error}` | `POST /send` | 注册 / 免密登录 / 找回密码 |
| 2 | `sendMail` | `({to, subject, html, text})` | 同上 | `POST /send` | 管理员告警邮件 |
| 3 | `querySend` | `(id)` | 发送对象 / `null` | `GET /send/{id}` | "已发送"列表回查状态 |
| 4 | `listDomains` | `({force=false})` | `{ok, items:[{id,name}]}` | `GET /domains` | 注册页可选域名（10 分钟缓存） |
| 5 | `isDomainAllowed` | `(domain)` | `true/false/null` | 同上（用缓存） | 注册时校验域名白名单 |
| 6 | `createMailbox` | `(localPart, password, displayName, domainName)` | `{ok,mailboxId,address}` | `POST /mailboxes` | 管理员开通校园邮箱 |
| 7 | `deleteMailbox` | `(mailboxId)` | `boolean` | `DELETE /mailboxes/{id}` | 开通失败时回退 |
| 8 | `resetMailboxPassword` | `(mailboxId, newPassword)` | `{ok}` | `POST /mailboxes/{id}/password` | 管理员重置 / 用户自助改密 |
| 9 | `isLocalPartTaken` | `(localPart)` | `true/false/null` | `GET /mailboxes?q=` | 注册前缀占用校验（尽力而为） |
| 10 | `listMessages` | `(mailboxId, {limit=20, cursor})` | `{ok,items,nextCursor}` | `GET /mailboxes/{id}/messages` | 收件箱 |
| 11 | `getMessage` | `(messageId)` | `{ok,message}` | `GET /messages/{id}` | 邮件详情 |
| 12 | `sendUserMail` | `(mailboxId, to, subject, html, text)` | `{ok,id,status}` | `POST /send` | 用户以自己校园邮箱发信 |

### 4.3 关键实现细节（改代码前必读）

**① 统一 `call()` 封装**

```js
async function call(method, path, body) {
  const res = await fetch(`${BASE}/api/open/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),   // ★ 20 秒硬超时
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}
```

- **一定读 `text()` 再自己 `JSON.parse`**：上游出错时返回的可能不是 JSON（网关 HTML、空 body），直接 `.json()` 会抛错，把 4xx 误装成 5xx。
- **一定带超时**：没有 `signal` 时，一次发信能挂到平台默认超时（本项目踩过，请求挂死拖满整个函数生命周期）。

**② 返回值一律 `{ok, ...}`，绝不抛错**

调用方只需要判 `r.ok`。这样邮件故障不会中断注册、公告发布、告警等主流程。

**③ `createMailbox` 必须带 `userId`**

```js
...(OWNER_USER_ID ? { userId: OWNER_USER_ID } : {})
```

不带时，LanQin 会用邮箱地址当成拥有者去找用户，找不到就新建一个"孤立用户"。这个邮箱**不属于当前 Token 持有者**，之后 `POST /send` 会返回 **404**（而不是 403），排查方向极易跑偏。

**④ `listDomains` 有 10 分钟模块级缓存**

```js
let DOMAIN_CACHE = { at: 0, items: [] };
```

- 命中缓存直接返回；查询失败时**优先回退缓存**，再回退失败才算错 —— 邮件服务抖动不能让注册页打不开。
- 只保留 `status === 'active'` 的域名。
- 改域名配置后最多 10 分钟才生效；需要即时生效传 `{force:true}`。

**⑤ `isLocalPartTaken` 是"尽力而为"**

上游 `/mailboxes` 不支持按前缀精确查，只能 `?q=` 模糊查再本地比对 `localPart`。查询失败返回 `null`（未知），调用方按"不阻塞"处理 —— 真正的唯一性由创建时服务器兜底校验。

---

## 五、开放 API —— 认证与通用约定

### 5.1 入口

```
https://email.9o.pw/api/open/v1
```

`/api/open` 是兼容别名。OpenAPI 契约：仓库内 `docs/openapi.json`。

**只接受 Token，不接受浏览器 Cookie/Session。**

### 5.2 认证头

```http
Authorization: Bearer lq_xxx
```

### 5.3 Scope（权限范围）

Scope **只收缩**用户已有权限，不会授予用户原本没有的能力。

| Scope | 用途 | 对应端点 |
|---|---|---|
| `domains:read` / `domains:write` | 查/管发信域名 | `/domains*` |
| `mailboxes:read` / `mailboxes:write` | 查/管邮箱（**重置密码算写**） | `/mailboxes*` |
| `messages:read` | 查发信状态、读邮件 | `GET /send*`、`/messages/*`、`/mailboxes/{id}/messages` |
| `messages:send` | 发信 | `POST /send` |
| `messages:manage` | 重试 / 取消投递 | `/send/{id}/retry`、`/cancel` |
| `aliases:read` / `aliases:write` | 别名 | `/aliases*` |
| `dns:read` / `dns:check` | DNS 记录与检查 | `/domains/{id}/dns-*` |

角色要求：域名/邮箱管理需要 **admin**；发信与读信 **user 即可，但只能操作自己拥有的 active 邮箱**。

### 5.4 状态码

| 码 | 含义 |
|---|---|
| `200` | 成功 |
| `201` | 创建成功（建邮箱、发信） |
| `400` | 参数无效 / 校验失败（**域名重复也是 400，不是 409**） |
| `401` | Token 缺失或无效 |
| `403` | Token 缺 scope，或发信地址未被授权 |
| `404` | 资源不存在，**或邮箱不属于 Token 拥有者** |
| `409` | 幂等键冲突 / 状态并发变化 |
| `429` | 超频（含 SMTP 发信频率） |
| `500` | 服务端错误 |
| `507` | 邮箱配额满 |

### 5.5 错误体

```json
{ "error": "invalid token" }
```

**请求体启用了 `DisallowUnknownFields()`** —— 多传一个 schema 里没有的字段，直接 `400`。拼参数时别顺手加 `from`、`replyTo` 这类字段（本文档没列的，就是没有）。

---

## 六、开放 API —— 端点全表

### 6.1 健康检查（无需认证）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/livez` | 进程存活 |
| GET | `/readyz` | 数据库 / schema / 存储 / worker 就绪，不可用返回 `503` |
| GET | `/healthz` | `/readyz` 别名 |

### 6.2 域名 Domains（admin）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/open/v1/domains` | 列表，**不分页**，含 `dkimPublicKey`、`dnsStatus` |
| POST | `/api/open/v1/domains` | `{name}` → 自动生成 DKIM，`dnsStatus=unchecked` |
| GET | `/api/open/v1/domains/{id}` | 单个域名 |
| POST | `/api/open/v1/domains/{id}` | `{status:"active"\|"disabled"}`（**用 POST，不是 PATCH**） |
| DELETE | `/api/open/v1/domains/{id}` | 删域名；**下面还有邮箱时返回 400** |
| GET | `/api/open/v1/domains/{id}/dns-records` | 该域需要的 MX/SPF/DKIM/DMARC |
| POST | `/api/open/v1/domains/{id}/dns-check` | 立即执行 DNS 检查 |

> 本实例现有域名：`9o.pw`、`keaidang.com`、`keaidang.top`、`ntzt.cn`、`uucu.de`、`vjjj.de`，全部 `active`。

### 6.3 邮箱 Mailboxes

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/open/v1/mailboxes` | 列表，**一次性返回全部，不分页** |
| POST | `/api/open/v1/mailboxes` | 创建，`201` |
| GET | `/api/open/v1/mailboxes/{id}` | 单个 |
| POST | `/api/open/v1/mailboxes/{id}` | 更新（`displayName` / `quotaMb` / `status` / `userId`，都可选，空值保留原值） |
| DELETE | `/api/open/v1/mailboxes/{id}` | 删除（**连同所有邮件**） |
| POST | `/api/open/v1/mailboxes/{id}/password` | 重置密码 —— **遏制性操作，见第十章** |

**创建请求字段**

| 字段 | 必填 | 说明 |
|---|---|---|
| `domainId` | ✅ | 已存在的域名 ID |
| `localPart` | ✅ | 本地部分，转小写，只保留 `a-z 0-9 . _ % + -` |
| `password` | ✅ | ≥ 8 位 |
| `displayName` | — | 省略则用邮箱地址 |
| `quotaMb` | — | 配额 |
| `ownerEmail` | — | 拥有者邮箱 |
| `userId` | — | 绑定已有用户，**优先级高于 `ownerEmail`** |

**拥有者解析顺序**：`userId` → `ownerEmail` → 用邮箱地址本身 → 都找不到则**自动建新用户**。

> 配额陷阱：本接口**不受**权限组的 `maxMailboxes` / `maxMailboxesPerDay` 限制，但创建的邮箱**仍计入**配额。批量建完可能让拥有者之后无法自助建邮箱。

**邮箱对象**

```json
{
  "id": "mbx_xxx", "userId": "usr_xxx", "userEmail": "alice@example.com",
  "domainId": "dom_xxx", "localPart": "alice", "address": "alice@example.com",
  "displayName": "Alice", "quotaMb": 1024, "status": "active",
  "createdAt": "2026-06-29T00:00:00Z"
}
```

### 6.4 发信 Send

```http
POST /api/open/v1/send
Authorization: Bearer lq_xxx
Idempotency-Key: <可选，建议填>
Content-Type: application/json
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `mailboxId` | ✅ | 发信邮箱，**必须属于 Token 拥有者** |
| `to` | ✅ | 收件人数组；`to`/`cc`/`bcc` 合计去重后 **≤ 100** |
| `cc` / `bcc` | — | 抄送 / 密送 |
| `subject` | — | 主题 |
| `text` / `html` | — | 正文，至少给一个 |
| `attachments` | — | `[{filename, contentType, contentBase64}]`，**≤ 20 个**，单个 ≤ 25 MB（受权限组 `maxAttachmentMb`） |

**响应**（`201`）

| 字段 | 说明 |
|---|---|
| `id` | 稳定发信 ID（`mail_*`），查状态用它 |
| `queueId` | SMTP 队列项 ID（`snd_*`），**`accepted` 状态下不存在** |
| `status` | 见第七章 |
| `rfcMessageId` | RFC 5322 `Message-ID` |
| `recipients` | 去重后的收件人 |
| `attemptCount` / `maxAttempts` | 投递次数（默认最多 5 次） |
| `lastError` / `nextAttemptAt` | 失败原因 / 下次重试时间 |
| `recipientStatuses` | 每个收件人的最终状态 |

**幂等键**

| 情况 | 结果 |
|---|---|
| 同 key + 同 body | 返回原结果，`200` + `Idempotency-Replayed: true` |
| 同 key + 不同 body | `409` |
| 保留时长 | **24 小时** |

**错误**

| 码 | 原因 |
|---|---|
| 400 | 无收件人 / 超 100 个 / MIME 无效 / 附件超限 |
| 403 | 发信地址未被授权 |
| 404 | 邮箱不存在**或不属于 Token 拥有者** |
| 429 | 超 SMTP 发信频率 |
| 507 | 邮箱配额满 |

### 6.5 发信状态与队列

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/open/v1/send` | 发信记录列表（分页） |
| GET | `/api/open/v1/send/{id}` | 单条状态，`{id}` 也可传 `queueId` |
| GET | `/api/open/v1/send/{id}/events` | 完整投递时间线（排错用） |
| POST | `/api/open/v1/send/{id}/retry` | 重试失败的队列项 |
| POST | `/api/open/v1/send/{id}/cancel` | 取消排队中 / 失败的任务 |

> ⚠️ **实测**：`GET /send?limit=5` 在本实例上 25 秒超时（2026-11-03）。**别把列表接口放进同步链路**；查状态请直接用 `GET /send/{id}`，秒回。

### 6.6 收信

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/open/v1/mailboxes/{id}/messages` | 邮件列表 |
| GET | `/api/open/v1/messages/{id}` | 正文 + 附件元数据 |
| GET | `/api/open/v1/attachments/{id}` | 下载附件 |

列表参数：

| 参数 | 说明 |
|---|---|
| `folder` | 默认 `Inbox`；`all` = 所有文件夹 |
| `limit` | 默认 30，**最大 100** |
| `cursor` | 传上一页的 `nextCursor`，空串表示没有更多 |
| `q` | 关键词，匹配主题 / 发件人 / 收件人 / 摘要 / 正文 |

响应项：`{id, mailboxId, folder, messageId, subject, from, to[], receivedAt, snippet, isRead, hasAttachments}`

> 权限：只能读**自己拥有的 active 邮箱**。**`folder=all` 会把 `Sent` 也列出来**（实测），做"收件箱"界面时要么用默认 `Inbox`，要么按 `folder` 过滤。

### 6.7 其他

| 方法 | 路径 | 说明 |
|---|---|---|
| — | `/api/open/v1/aliases` | 别名 CRUD |
| POST | `/api/open/v1/delivery-events` | **入站**投递事件（HMAC 签名，不用 Token） |

---

## 七、投递状态机

```
accepted ──▶ queued ──▶ sending ──▶ relayed ──▶ delivered
                 │           │          │
                 │           │          ├──▶ bounced / rejected / deferred
                 │           │          └──▶ complained
                 └───────────┴──▶ failed（会重试，最多 5 次）
                                 └──▶ canceled
```

| 状态 | 含义 | 要不要管 |
|---|---|---|
| `accepted` | 已存库，**没有 SMTP 队列项**（多为未配投递） | 要，通常说明投递没配好 |
| `queued` | 已入 SMTP 队列 | 等 |
| `sending` | 投递中 | 等 |
| `relayed` | **上游 SMTP 已接受**，≠ 收件人已收到 | 基本可认为通 |
| `delivered` | 收件方返回的最终成功事件 | ✅ |
| `bounced` | 退信（地址不存在等） | 要把地址标为无效 |
| `rejected` / `deferred` / `complained` | 拒收 / 延迟 / 投诉 | 视业务处理 |
| `partial` | 多个收件人结果不一致 | 要逐收件人看 |
| `failed` / `canceled` | 失败 / 已取消 | 看 `lastError` |

**要点：`201 + queued` 不是送达。** 需要确认送达就轮询 `GET /send/{id}`（间隔 ≥ 5 秒，最多查十几次），或接 Webhook（见第十一章）。

---

## 八、代码示例（外部系统可直接抄）

### 8.1 Node.js 18+（零依赖，推荐）

```js
const BASE = 'https://email.9o.pw';
const TOKEN = process.env.MAIL_TOKEN;               // lq_xxx
const MAILBOX_ID = 'mbx_WKqcd8u_3o00ZMf9lzIs0g';    // wolf@9o.pw

export async function sendMail({ to, subject, text, html }) {
  const res = await fetch(`${BASE}/api/open/v1/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      // 同一次业务重试要复用同一个 key，否则会重复发信
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      mailboxId: MAILBOX_ID,
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
      html,
    }),
    signal: AbortSignal.timeout(20_000),   // ★ 一定带超时
  });
  const raw = await res.text();            // ★ 先读文本，别直接 res.json()
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
  if (!res.ok) throw new Error(`发送失败 HTTP ${res.status}: ${data?.error || raw}`);
  return data;                             // { id, queueId, status, ... }
}

export async function getStatus(id) {
  const res = await fetch(`${BASE}/api/open/v1/send/${id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await res.text();
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
```

### 8.2 Python 3.9+

```python
import os, json, urllib.request

BASE = "https://email.9o.pw"
TOKEN = os.environ["MAIL_TOKEN"]
MAILBOX_ID = "mbx_WKqcd8u_3o00ZMf9lzIs0g"

def send_mail(to, subject, text=None, html=None, idem_key=None):
    body = {"mailboxId": MAILBOX_ID, "to": to if isinstance(to, list) else [to], "subject": subject}
    if text: body["text"] = text
    if html: body["html"] = html
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    if idem_key: headers["Idempotency-Key"] = idem_key
    req = urllib.request.Request(
        f"{BASE}/api/open/v1/send", data=json.dumps(body).encode(),
        headers=headers, method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:   # 201
        return json.loads(r.read().decode())
```

### 8.3 用 cURL 快速自检

```bash
# 1) 实例是否活着（不需要 Token）
curl -s https://email.9o.pw/readyz

# 2) Token 是否有效（读自己名下邮箱）
curl -s -H "Authorization: Bearer $TOKEN" https://email.9o.pw/api/open/v1/mailboxes

# 3) 发一封
curl -s -X POST https://email.9o.pw/api/open/v1/send \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mailboxId":"mbx_WKqcd8u_3o00ZMf9lzIs0g","to":["wolf@9o.pw"],"subject":"test","text":"hello"}'
```

> Windows Git Bash 里访问 `email.9o.pw` 可能报 `CRYPT_E_REVOCATION_OFFLINE`（schannel 吊销检查失败）。加 `--ssl-no-revoke`，或直接用 Node/Python 发请求（本项目实测 Node 正常）。

---

## 九、限制与配额汇总

| 项 | 限制 |
|---|---|
| 收件人 | 去重后 ≤ 100（to + cc + bcc） |
| 附件数量 | ≤ 20 |
| 单个附件 | ≤ 25 MB（权限组 `maxAttachmentMb`） |
| 邮件列表 | `limit` 默认 30，最大 100 |
| 里程事件 | 单次 ≤ 100 条，时间戳窗口 ±5 分钟 |
| 幂等键 | 保留 24 小时 |
| Token 有效期 | 默认 90 天 |
| 投递重试 | 最多 5 次（`maxAttempts`） |
| 状态推送重试 | 最多 10 次，记录 30 天后清理 |
| 邮箱满 | 发信 `507` |
| 超频 | `429` |
| 本项目用户发信 | 每人每日 50 封（`DAILY_SEND_LIMIT`，算在本系统侧，不在邮件服务器侧） |

---

## 十、七个坑（都是实测踩出来的）

**① 404 的真相：邮箱不属于 Token 拥有者**

`POST /send` 返回 404 时，九成人第一反应是"mailboxId 写错了"。实际最常见的是**邮箱归属错了**。LanQin 的语义是：Token 只能操作 `Token 拥有者` 名下（且 `active`）的邮箱。

所以建邮箱时务必带 `userId`：

```js
{ domainId, localPart, password, userId: 'usr_VyQyDYDg0ifjrHbX2kQ-Ag' }
```

`wolf@9o.pw` 已按此创建，归属 `k@9o.pw`。若将来换成另一个人的 Token 发信，会 404 —— 不是 bug。

**② 重置密码 = 踢掉所有会话 + 禁用所有 Token**

`POST /mailboxes/{id}/password` 是**遏制性操作**：同时结束该用户所有会话，并禁用其名下**所有 API Token**。

后果：管理员重置了某个用户密码，那台外部系统的 Token 就失效了，第二天开始全线 401。**给外部系统用的 Token 必须建在独立账号下**，别和人工改密的账号混在一起。

**③ `relayed` ≠ 送达**

`relayed` 只表示"我们的上游 SMTP 收下了"。真正到达要看 `delivered`，或看 `recipientStatuses`。把 `relayed` 当成功写进业务状态，会在退信时留下错误记录。

**④ 不带超时的请求会挂死**

本项目早期就吃过这个：`fetch` 没带 `signal`，上游卡住时整个函数被拖到平台超时，连带主流程（注册、发公告）一起失败。**所有对外请求必须 `AbortSignal.timeout()`。**

**⑤ 别直接 `res.json()`**

上游 4xx 时可能返回 HTML 或空 body。本项目的 `call()` 统一 `text()` → 手动 `JSON.parse` → 失败降级成 `{raw}`。直接 `.json()` 会把 400 变成未捕获异常。

**⑥ `GET /send` 列表很慢**

实测 25 秒超时（2026-11-03）。查单条状态用 `GET /send/{id}`，别在同步链路里拉列表。

**⑦ 时间是 UTC**

所有 `createdAt` / `receivedAt` 都是 `Z` 结尾的 UTC（如 `2026-11-03T07:48:52Z` = 北京时间 15:48:52）。直接展示给用户会差 8 小时。

---

## 十一、进阶：投递事件 Webhook

不想轮询 `GET /send/{id}`，可以让邮件服务器主动推。

**两种方向，别搞混：**

| 方向 | 端点 | 谁调谁 | 认证 |
|---|---|---|---|
| 入站投递事件 | `POST /api/open/v1/delivery-events` | 上游供应商 → 你的 LanQin | HMAC，**不用 Token** |
| 出站状态推送 | 你配置的 URL | 你的 LanQin → 你的系统 | HMAC |

**出站推送配置**（服务器侧环境变量）：

```env
LANQIN_STATUS_WEBHOOK_URL=https://your-system.example.com/hooks/mail
LANQIN_STATUS_WEBHOOK_SECRET=<随机长字符串>
```

**校验签名**：

```js
const expected = crypto
  .createHmac('sha256', SECRET)
  .update(`${timestamp}.${rawBody}`)   // ★ 用原始 body 字符串，不要用重新序列化的 JSON
  .digest('hex');
// 请求头：X-LanQin-Signature: sha256=<hex>
// 请求头：X-LanQin-Timestamp: <unix 秒>，超出 ±5 分钟拒绝
```

事件类型：`send.accepted` / `send.queued` / `send.retry` / `send.delivered` / `send.failed` / `send.canceled` / `delivery.<最终状态>`

可靠性：先写 SQLite outbox 再投递，非 2xx 按退避重试最多 10 次，记录 30 天后清理。**你的接口要幂等**（用 `X-LanQin-Webhook-Id` 去重）。

---

## 十二、排错速查

| 现象 | 最可能的原因 | 怎么办 |
|---|---|---|
| `401 invalid token` | Token 过期（默认 90 天）/ 被撤销 / 因改密被禁用 | 后台重建 Token |
| `403` | Token 缺 `messages:send`，或发信地址未授权 | 补 scope |
| `404` on `/send` | mailboxId 不属于 Token 拥有者（**最常见**） | 查 `GET /mailboxes/{id}` 的 `userId`，确认与 Token 拥有者一致 |
| `400 localPart is required` | 建邮箱漏了 `localPart` / `domainId` | 对照 6.3 字段表 |
| `400` 但字段看着都对 | 多传了 schema 之外的字段（`DisallowUnknownFields`） | 删掉文档没列的字段 |
| `429` | 发信太密 | 退避重试，或降低并发 |
| `507` | 邮箱配额满 | 清理邮件或调大 `quotaMb` |
| 一直 `accepted` | 服务器没配 SMTP 投递 | 找运维确认投递配置 |
| 一直 `queued` / `sending` | 上游 SMTP 卡住 | `GET /send/{id}/events` 看时间线 |
| 收件箱为空 | 查的是 `Inbox` 但邮件在别的文件夹 / 投递还没落库 | 用 `folder=all` 再看 |
| cURL 报 `CRYPT_E_REVOCATION_OFFLINE` | Windows schannel 吊销检查 | 加 `--ssl-no-revoke` 或改用 Node |
| 中文乱码 | 没有按 UTF-8 编码 body | `Content-Type: application/json` + UTF-8 序列化 |

---

## 十三、外部系统接入检查清单

- [ ] 已拿到 `BASE_URL` / `TOKEN` / `MAILBOX_ID` 三个值
- [ ] Token 只勾了需要的 scope（`messages:send` 起）
- [ ] Token 记在密钥管理里，没写进代码仓库
- [ ] 所有请求都设了超时（20 秒量级）
- [ ] 响应先读 text 再 parse，异常不炸主流程
- [ ] 发信用了 `Idempotency-Key`，重试不会重复发
- [ ] 只把 `201` 当"已接受"，送达靠 `delivered` 或 Webhook
- [ ] `mailboxId` 与 Token 拥有者是同一个人
- [ ] 时间字段做了 UTC → 本地时区转换
- [ ] 有 `429` / `507` / `404` 的告警，不要静默吞掉
- [ ] 记了 Token 到期日（90 天）

---

## 十四、变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-03 | 首版。创建 `wolf@9o.pw`（`mbx_WKqcd8u_3o00ZMf9lzIs0g`）并完成发信闭环实测（`relayed` → 收件箱收到）；依据 LanQin Email 官方 API 文档 + 本实例实测整理；记录 7 个实测坑（404 归属、改密禁用 Token、`relayed` 语义、无超时挂死、`res.json()` 误判、`GET /send` 慢、UTC 时区） |
