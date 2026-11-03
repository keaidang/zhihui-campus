# keaidang mail · 开放 API 接入文档

> 版本 v1 ｜ 最后更新 2026-11-03
>
> 本文档面向接入方开发者。按顺序读完前三章即可开始发信；第四~十章是完整参考。

---

## 一、概述

keaidang mail 提供 HTTP 开放 API，供外部系统**以指定邮箱身份发送邮件**、**查询投递状态**、**读取收件箱**。

- **Base URL**：`https://email.9o.pw`
- **API 前缀**：`/api/open/v1`
- **协议**：HTTPS + JSON（UTF-8）
- **认证**：`Authorization: Bearer <Token>`
- **机器可读契约**：OpenAPI 3.1，可向我方索取 `openapi.json`

```
POST https://email.9o.pw/api/open/v1/send
```

> 该接口**只接受 API Token**，不接受浏览器 Cookie / Session。请勿把网页登录态当凭证用。

---

## 二、快速开始

### 2.1 你的接入信息

| 名称 | 值 | 说明 |
|---|---|---|
| Base URL | `https://email.9o.pw` | 固定，不用改 |
| Token | `lq_xxxx…`（单独交付） | **明文不写入文档**，收到后立即存入密钥管理 |
| 发信邮箱 | `wolf@9o.pw` | 你的系统以此地址对外发信 |
| 发信邮箱 ID | `mbx_WKqcd8u_3o00ZMf9lzIs0g` | 发信接口的 `mailboxId` 字段填这个 |

配置写法（任选其一）：

```bash
MAIL_BASE_URL=https://email.9o.pw
MAIL_TOKEN=lq_xxxxxxxxxxxxxxxx
MAIL_MAILBOX_ID=mbx_WKqcd8u_3o00ZMf9lzIs0g
```

> **关于 `wolf@9o.pw` 的登录密码**：仅在需要用 IMAP / POP3 / SMTP 客户端**直接登录收信**时才需要，
> 走本文档的 HTTP API 不需要密码。如确需，另行向我方索取，请勿在客户端明文硬编码。
>
> 需要增加更多发信地址（如 `noreply@9o.pw`）或调整配额，联系我方开通。

### 2.2 三行验证连通

```bash
# 1) 服务是否就绪（无需认证，返回 200 即正常）
curl -s https://email.9o.pw/readyz

# 2) Token 是否有效（返回你名下的邮箱列表）
curl -s -H "Authorization: Bearer $TOKEN" \
  https://email.9o.pw/api/open/v1/mailboxes

# 3) 发一封测试邮件给自己
curl -s -X POST https://email.9o.pw/api/open/v1/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mailboxId": "'"$MAILBOX_ID"'",
    "to": ["'"$MAILBOX_ID"'@9o.pw"],
    "subject": "接入测试",
    "text": "如果你收到这封信，说明链路已通。"
  }'
```

返回 `201` 且 `status` 为 `queued` 或 `sending`，即表示**已被接受**（注意：不等于已送达，见第七章）。

---

## 三、认证

### 3.1 请求头

```http
Authorization: Bearer lq_xxxxxxxx
Content-Type: application/json
```

### 3.2 Token 规则

| 项 | 说明 |
|---|---|
| 前缀 | `lq_` |
| 有效期 | 默认 **90 天**，到期需更换 |
| 明文 | **只在创建时显示一次**，请立即存入密钥管理 |
| 权限 | 由 Token 的 scope 决定，**只收缩、不放大**账号原有权限 |
| 失效场景 | ① 到期 ② 被撤销 ③ 账号密码被重置（会禁用该账号名下**全部** Token） |

### 3.3 申请与更换

Token 由我方管理员在后台创建，请提供：用途说明、需要的权限（发信 / 收信）、期望有效期。
**请勿在多套系统间共用同一个 Token** —— 一旦某套系统泄露，只能整把撤销，会连带其他系统中断。

建议每套系统单独申请，且只申请真正需要的权限（最小权限）。

---

## 四、通用约定

### 4.1 请求

- 方法：`GET` / `POST` / `DELETE`
- Body：`Content-Type: application/json`，UTF-8
- **服务端启用了严格字段校验**：请求体中出现文档未定义的字段会直接返回 `400`。
  例如不要额外传 `from`、`replyTo`、`priority` —— 这些字段不存在，传了就是报错。

### 4.2 响应

成功返回 JSON 对象；创建类操作返回 `201`。

失败统一为：

```json
{ "error": "invalid token" }
```

### 4.3 状态码

| 码 | 含义 | 是否可重试 |
|---|---|---|
| `200` | 成功 | — |
| `201` | 创建成功（发信、建邮箱） | — |
| `400` | 参数无效 / 校验失败（域名重复也算 400） | 修正参数后重试 |
| `401` | Token 缺失、无效或已过期 | 更换 Token |
| `403` | Token 缺权限，或发信地址未被授权 | 联系我方 |
| `404` | 资源不存在，**或该邮箱不属于此 Token 的拥有者** | 见第十一章 |
| `409` | 幂等键冲突 / 状态并发变化 | 见 §4.5 |
| `429` | 请求过频（含发信频率） | 退避后重试 |
| `500` | 服务端异常 | 可重试 |
| `507` | 邮箱配额已满 | 联系我方扩容 |

### 4.4 时间

所有时间字段均为 **UTC**，ISO 8601 格式，带 `Z` 后缀：

```
2026-11-03T07:48:52Z     ← 北京时间 2026-11-03 15:48:52
```

**展示给最终用户前请自行 +8 小时**，否则会差 8 小时。

### 4.5 幂等（重要）

发信接口支持 `Idempotency-Key` 请求头：

| 场景 | 结果 |
|---|---|
| 相同 key + 相同请求体 | 返回**原结果**，HTTP `200`，响应头带 `Idempotency-Replayed: true` |
| 相同 key + 不同请求体 | `409 Conflict` |
| 键保留时长 | **24 小时** |

**同一笔业务的重试必须复用同一个 key**，否则会重复发信（用户会收到两封）。

```http
Idempotency-Key: order-20261103-0001
```

建议直接用业务单据号，或 `业务类型 + 主键 + 版本`。

### 4.6 分页

读列表类接口用游标分页：

```
GET ...?limit=30&cursor=<上一页的 nextCursor>
```

`nextCursor` 为空字符串表示没有更多数据。`limit` 默认 30，最大 100。

---

## 五、发信（核心接口）

### 5.1 请求

```http
POST /api/open/v1/send
Authorization: Bearer lq_xxx
Content-Type: application/json
Idempotency-Key: <建议必填>
```

```json
{
  "mailboxId": "mbx_xxx",
  "to": ["bob@example.com"],
  "cc": [],
  "bcc": [],
  "subject": "系统通知：任务已完成",
  "text": "纯文本正文",
  "html": "<p>HTML 正文</p>",
  "attachments": [
    {
      "filename": "report.pdf",
      "contentType": "application/pdf",
      "contentBase64": "JVBERi0xLjQK..."
    }
  ]
}
```

### 5.2 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `mailboxId` | string | ✅ | 发信邮箱 ID，**必须属于此 Token 的拥有者** |
| `to` | string[] | ✅ | 收件人。与 `cc`、`bcc` 合计去重后 **≤ 100 个** |
| `cc` | string[] | — | 抄送 |
| `bcc` | string[] | — | 密送（收件人之间互不可见） |
| `subject` | string | 建议 | 邮件主题，建议 ≤ 200 字符 |
| `text` | string | 二选一 | 纯文本正文 |
| `html` | string | 二选一 | HTML 正文（`text` 与 `html` 至少给一个） |
| `attachments` | object[] | — | 附件，**≤ 20 个**，单个 ≤ 25 MB |

**附件对象**

| 字段 | 说明 |
|---|---|
| `filename` | 文件名，含扩展名 |
| `contentType` | MIME 类型，如 `application/pdf`、`image/png` |
| `contentBase64` | 文件内容的 Base64 字符串（不含 `data:...;base64,` 前缀） |

> 同时给 `text` 和 `html` 是最佳实践：支持 HTML 的客户端显示富文本，纯文本客户端降级显示。

### 5.3 响应 `201`

```json
{
  "id": "mail_q_N-yFnohObmzkOaE9d0eQ",
  "queueId": "snd_rxkShlxzOfUMhgIE4zY7KQ",
  "status": "queued",
  "messageId": "mail_q_N-yFnohObmzkOaE9d0eQ",
  "rfcMessageId": "<msg_YNe3k2G4f9z7UFuxnf9Img@9o.pw>",
  "mailboxId": "mbx_xxx",
  "mailboxAddress": "wolf@9o.pw",
  "subject": "系统通知：任务已完成",
  "recipients": ["bob@example.com"],
  "attemptCount": 0,
  "maxAttempts": 5,
  "createdAt": "2026-11-03T07:48:52.601245826Z"
}
```

| 字段 | 说明 |
|---|---|
| `id` | **稳定发信 ID**（`mail_*`），查状态用它 |
| `queueId` | SMTP 队列项 ID（`snd_*`）；`accepted` 状态下**不返回** |
| `status` | 投递状态，见第七章 |
| `rfcMessageId` | RFC 5322 `Message-ID`，可用于与我方日志对账 |
| `recipients` | 去重后的全部收件人（to + cc + bcc） |
| `attemptCount` / `maxAttempts` | 已尝试次数 / 最大尝试次数（默认 5） |
| `lastError` / `nextAttemptAt` | 失败原因 / 下次重试时间（仅失败时返回） |
| `recipientStatuses` | 每个收件人的最终状态（仅最终态时返回） |

### 5.4 错误

| 码 | 原因 | 处理建议 |
|---|---|---|
| `400` | 无收件人 / 超 100 个 / MIME 无效 / 附件超限 | 检查请求体 |
| `403` | 发信地址未被授权 | 确认 `mailboxId` 已授权给该 Token |
| `404` | **邮箱不存在，或不属于此 Token 的拥有者** | 见第十一章 FAQ 第 1 条 |
| `429` | 超出 SMTP 发信频率 | 指数退避重试 |
| `507` | 邮箱配额已满 | 联系我方清理或扩容 |

---

## 六、查询与读信

### 6.1 查询单封发信状态

```http
GET /api/open/v1/send/{id}
```

路径参数 `id` 可传发信返回的 `id`，也可传 `queueId`。只能查自己名下邮箱的邮件，否则 `404`。

响应结构与 §5.3 相同。

### 6.2 查完整投递时间线

```http
GET /api/open/v1/send/{id}/events
```

返回该邮件的队列变更与收件人级事件，排障时用。

### 6.3 重试 / 取消

```http
POST /api/open/v1/send/{id}/retry
POST /api/open/v1/send/{id}/cancel
```

仅对 `failed`（重试）、`queued` / `failed`（取消）状态有效。

> `GET /api/open/v1/send`（发信记录列表）响应较慢，**不建议放进同步链路**。
> 查状态请用 §6.1 的单条接口。

### 6.4 读收件箱

```http
GET /api/open/v1/mailboxes/{id}/messages?folder=Inbox&limit=30&cursor=&q=
```

| 参数 | 说明 |
|---|---|
| `folder` | `Inbox`（默认）/ 其他文件夹名 / `all`（全部，含 `Sent`） |
| `limit` | 默认 30，最大 100 |
| `cursor` | 上一页返回的 `nextCursor` |
| `q` | 关键词，匹配主题、发件人、收件人、摘要、正文 |

```json
{
  "items": [
    {
      "id": "mail_xxx",
      "mailboxId": "mbx_xxx",
      "folder": "Inbox",
      "messageId": "<message@example.com>",
      "subject": "Re: 系统通知",
      "from": "bob@example.com",
      "to": ["wolf@9o.pw"],
      "receivedAt": "2026-11-03T08:12:03Z",
      "snippet": "收到，明天处理。",
      "isRead": false,
      "hasAttachments": false
    }
  ],
  "nextCursor": ""
}
```

> `folder=all` 会**把已发送也列出来**。只做收件箱界面时请用默认 `Inbox`，或按 `folder` 自行过滤。
> 只能读自己名下且状态为 `active` 的邮箱。

### 6.5 邮件正文与附件

```http
GET /api/open/v1/messages/{id}        # 正文 + 附件元数据
GET /api/open/v1/attachments/{id}     # 下载附件
```

### 6.6 查询邮箱信息

```http
GET /api/open/v1/mailboxes        # 列表（一次性返回全部，不分页）
GET /api/open/v1/mailboxes/{id}   # 单个
```

返回 `{id, address, displayName, quotaMb, status, createdAt, ...}`。
**排 404 问题时先用它确认 `userId` 是否与 Token 拥有者一致。**

---

## 七、投递状态机

```
accepted ──▶ queued ──▶ sending ──▶ relayed ──▶ delivered
                 │          │           │
                 │          │           ├──▶ bounced / rejected / deferred
                 │          │           └──▶ complained
                 └──────────┴──▶ failed（最多重试 5 次）
                                 └──▶ canceled
```

| 状态 | 含义 | 建议动作 |
|---|---|---|
| `accepted` | 已入库，但未生成 SMTP 队列项 | 异常，联系我方 |
| `queued` | 已进入发送队列 | 等待 |
| `sending` | 正在投递 | 等待 |
| `relayed` | **我方上游 SMTP 已接受**，≠ 对方已收到 | 可视为链路通，但不要当"已读" |
| `delivered` | 收件方返回最终成功 | ✅ 成功 |
| `bounced` | 退信（地址不存在、对方拒收等） | 将该地址标记为无效 |
| `rejected` | 被对方拒收 | 检查内容/发信域声誉 |
| `deferred` | 对方延迟接收 | 一般会自动重试 |
| `complained` | 被标记为垃圾邮件 | 降低发送频率 |
| `partial` | 多个收件人最终状态不一致 | 逐收件人看 `recipientStatuses` |
| `failed` | 投递失败（已用尽重试） | 看 `lastError` |
| `canceled` | 已取消 | — |

**关键认知：`201 + queued` 只代表"已接受"，不代表"已送达"。**
业务上要把"受理成功"和"送达成功"分开记，否则退信时数据会是错的。

---

## 八、限制与配额

| 项 | 限制 |
|---|---|
| 收件人（to + cc + bcc 去重后） | ≤ 100 |
| 附件数量 | ≤ 20 / 封 |
| 单个附件大小 | ≤ 25 MB |
| 正文大小 | 建议 text ≤ 100 KB、html ≤ 200 KB |
| 邮件列表 `limit` | ≤ 100 |
| 幂等键有效期 | 24 小时 |
| Token 有效期 | 默认 90 天 |
| 投递自动重试 | 最多 5 次 |
| 超频 | 返回 `429` |
| 邮箱满 | 返回 `507` |

发信频率上限按账号策略设定，具体额度以我方通知为准。命中 `429` 时请**指数退避**（如 1s / 2s / 4s / 8s），不要固定间隔硬冲。

---

## 九、代码示例

### 9.1 Node.js 18+（零依赖）

```js
const BASE = 'https://email.9o.pw';
const TOKEN = process.env.MAIL_TOKEN;
const MAILBOX_ID = process.env.MAIL_MAILBOX_ID;

/**
 * 发信。失败抛错，调用方自行决定是否重试。
 * @param {{to: string|string[], subject: string, text?: string, html?: string}} opts
 * @param {string} idemKey 同一笔业务重试时必须复用
 */
export async function sendMail(opts, idemKey) {
  const res = await fetch(`${BASE}/api/open/v1/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(idemKey ? { 'Idempotency-Key': idemKey } : {}),
    },
    body: JSON.stringify({
      mailboxId: MAILBOX_ID,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    }),
    signal: AbortSignal.timeout(20_000),      // ★ 必须设超时
  });

  const raw = await res.text();                // ★ 先读文本，不要直接 res.json()
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }

  if (!res.ok) {
    const err = new Error(`发信失败 HTTP ${res.status}: ${data?.error || raw}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;                                 // { id, status, ... }
}

/** 查状态 */
export async function getStatus(id) {
  const res = await fetch(`${BASE}/api/open/v1/send/${id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await res.text();
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
```

### 9.2 Python 3.9+

```python
import json
import os
import urllib.error
import urllib.request

BASE = "https://email.9o.pw"
TOKEN = os.environ["MAIL_TOKEN"]
MAILBOX_ID = os.environ["MAIL_MAILBOX_ID"]


def send_mail(to, subject, text=None, html=None, idem_key=None):
    """发信。返回响应 dict；失败抛 urllib.error.HTTPError（.code / .read()）。"""
    body = {
        "mailboxId": MAILBOX_ID,
        "to": to if isinstance(to, list) else [to],
        "subject": subject,
    }
    if text:
        body["text"] = text
    if html:
        body["html"] = html

    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    }
    if idem_key:
        headers["Idempotency-Key"] = idem_key

    req = urllib.request.Request(
        f"{BASE}/api/open/v1/send",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:   # 201
        return json.loads(r.read().decode("utf-8"))


def get_status(mail_id):
    req = urllib.request.Request(
        f"{BASE}/api/open/v1/send/{mail_id}",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))
```

### 9.3 PHP 7.4+

```php
<?php
function keaidang_send_mail(string $to, string $subject, string $html, string $idemKey = ''): array {
    $token   = getenv('MAIL_TOKEN');
    $mailbox = getenv('MAIL_MAILBOX_ID');
    $payload = json_encode([
        'mailboxId' => $mailbox,
        'to'        => [$to],
        'subject'   => $subject,
        'html'      => $html,
    ], JSON_UNESCAPED_UNICODE);

    $headers = [
        'Authorization: Bearer ' . $token,
        'Content-Type: application/json',
    ];
    if ($idemKey !== '') {
        $headers[] = 'Idempotency-Key: ' . $idemKey;
    }

    $ch = curl_init('https://email.9o.pw/api/open/v1/send');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode($body, true);
    if ($code < 200 || $code >= 300) {
        throw new RuntimeException("发信失败 HTTP {$code}: " . ($data['error'] ?? $body));
    }
    return $data;
}
```

### 9.4 Java 11+

```java
import java.net.URI;
import java.net.http.*;
import java.time.Duration;

public class KeaidangMail {
    private static final String BASE = "https://email.9o.pw";
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();

    public static String send(String token, String mailboxId, String to,
                              String subject, String text, String idemKey) throws Exception {
        String json = String.format("""
            {"mailboxId":"%s","to":["%s"],"subject":"%s","text":"%s"}
            """, mailboxId, to, subject, text.replace("\"", "\\\""));

        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(BASE + "/api/open/v1/send"))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .header("Idempotency-Key", idemKey)
                .timeout(Duration.ofSeconds(20))
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpResponse<String> res = CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() >= 300) {
            throw new RuntimeException("发信失败 HTTP " + res.statusCode() + ": " + res.body());
        }
        return res.body();
    }
}
```

> 生产环境请用成熟的 JSON 库（Jackson / Gson）序列化，上面的字符串拼接仅为示例。

---

## 十、Webhook：接收投递结果

如果不想轮询，可让 keaidang mail 主动推送状态到你的服务。

请联系我方配置：

| 项 | 说明 |
|---|---|
| 回调地址 | 你的 HTTPS 端点（必须是公网可访问的 **HTTPS**） |
| 密钥 | 我方生成并交付，用于验签 |

### 请求头

```
X-LanQin-Webhook-Id: <事件唯一 ID>
X-LanQin-Timestamp:  <Unix 秒>
X-LanQin-Signature:  sha256=<hex>
```

### 验签

```js
import crypto from 'node:crypto';

function verify(rawBody, timestamp, signatureHeader, secret) {
  // 1) 时间窗口 ±5 分钟，防重放
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  // 2) HMAC-SHA256(secret, timestamp + "." + rawBody)
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)     // ★ 必须是原始 body 字符串
    .digest('hex');

  const given = String(signatureHeader || '').replace(/^sha256=/, '');
  // 3) 定长比较，防时序攻击
  return given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

> **注意**：验签必须用**原始请求体字符串**，不能用框架重新序列化后的 JSON —— 键顺序或空格差异会导致签名不匹配。

### 事件类型

`send.accepted`、`send.queued`、`send.retry`、`send.delivered`、`send.failed`、`send.canceled`、`delivery.<最终状态>`

### 可靠性

- 事件先持久化再投递，非 2xx 按退避重试，**最多 10 次**
- 已送达与重试耗尽的记录 **30 天后清理**
- **你的接口必须幂等**（用 `X-LanQin-Webhook-Id` 去重）—— 同一事件可能重复推送

---

## 十一、排错 FAQ

**1. 发信返回 `404`，但 `mailboxId` 我确认是对的**

最高频原因不是 ID 错，而是**这个邮箱不属于此 Token 的拥有者**。
Token 只能操作"自己名下、且状态为 active"的邮箱，否则一律 `404`（不是 `403`，容易误导）。

排查：

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://email.9o.pw/api/open/v1/mailboxes/$MAILBOX_ID
```

看返回的 `userId` 与 `status`。若 `userId` 与发 Token 的账号不是同一个，或 `status` 不是 `active`，联系我方调整归属。

**2. 返回 `401 invalid token`**

三种可能：Token 已过期（默认 90 天）、被撤销、或**该账号密码被重置过**（重置密码会禁用账号名下所有 Token）。请联系我方重新发放。

**3. 返回 `400`，字段看着都对**

服务端启用了严格字段校验：**多传了文档没定义的字段就会 400**。检查是否顺手加了 `from`、`replyTo`、`priority`、`template` 之类。

**4. 一直停在 `queued` / `sending`**

上游 SMTP 侧问题。用 `GET /send/{id}/events` 看时间线，把 `id` 提供给我方排查。

**5. 一直是 `accepted`**

邮件已入库但没生成发送队列，通常是投递配置问题，请联系我方。

**6. 收件箱读不到刚发的信**

- 自己发给自己时，邮件可能在 `Sent` 而非 `Inbox`；用 `folder=all` 复核
- 投递落库有秒级延迟，等几秒再查
- 确认查询的 `mailboxId` 就是收件那个邮箱

**7. 中文乱码**

请求体必须按 UTF-8 序列化。Python 用 `ensure_ascii=False`，PHP 用 `JSON_UNESCAPED_UNICODE`。

**8. Windows 下 cURL 报 `CRYPT_E_REVOCATION_OFFLINE`**

Windows schannel 的证书吊销检查失败，与服务无关。加 `--ssl-no-revoke`，或改用 Node / Python 发请求。

**9. 请求偶发卡住几十秒**

检查是否设了超时。**所有对外请求都应设 20 秒左右超时**，否则上游异常时会拖死你的业务线程。

---

## 十二、接入检查清单

- [ ] 已拿到 Base URL、Token、发信邮箱 ID
- [ ] Token 存进密钥管理，没有硬编码进仓库
- [ ] Token 只申请了实际需要的权限
- [ ] 所有请求都设了超时（≤ 20 秒）
- [ ] 响应先读文本再解析，异常不会打崩主流程
- [ ] 发信复用了 `Idempotency-Key`，重试不会重复发信
- [ ] 业务上区分"已受理（201/queued）"和"已送达（delivered）"
- [ ] 对 `429` 做了指数退避
- [ ] 对 `bounced` 做了地址失效处理
- [ ] 时间字段做了 UTC → 本地时区转换
- [ ] 记下了 Token 到期日（90 天）
- [ ] 若接 Webhook：验签用原始 body、按 `Webhook-Id` 幂等、响应 2xx 要快（先入库再异步处理）

---

## 十三、变更记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-11-03 | v1 | 首版发布：发信、状态查询、收信、Webhook、完整错误与限制说明 |

---

## 十四、支持

接入过程中遇到问题，请提供以下信息，可大幅缩短排查时间：

1. 请求时间（精确到分钟，**注明时区**）
2. 返回的 `id` 或 `queueId`（发信类问题）
3. HTTP 状态码 + 响应体原文
4. 请求体（**请隐去 Token 与收件人隐私**）
