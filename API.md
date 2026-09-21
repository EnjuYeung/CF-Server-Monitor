# Server Monitor API

版本 3.0.0，核对日期 2026-09-16。Base URL 是容器 HTTP 地址或反代 HTTPS 域名；容器默认端口 8080。所有管理操作使用 JSON，备份返回 SQLite 二进制。

## 认证与限制

- Agent：HTTP 请求体或 WS 上报消息中提供 `id`（后台生成 UUID）和 `secret`（API_SECRET）。
- 管理员：`POST /<ADMIN_PATH>/api`，JSON 为 `{"action":"login","username":"admin","password":"..."}`。成功返回 `{success:true,token,...}`，并设置 HttpOnly、SameSite=Lax Cookie；可信 HTTPS 反代下增加 Secure。
- 管理及受限 REST：`Authorization: Bearer <token>`。WS 可使用 Bearer、登录 Cookie 或 `?token=<token>`；查询参数中的 token 必须避免记入代理访问日志。
- ADMIN_PATH 由 `.env` 指定，8–128 位随机字符；旧 `/admin` 页面和接口均返回 404。匿名 `/api/config` 不包含此路径；管理员响应才包含 `admin_path`。
- 2FA 启用时，正确密码先返回 `{requiresTwoFactor:true}`，不签发 token/Cookie。再次携带原用户名、密码及 `otp`（六位字符串）或 `recoveryCode` 完成登录。
- JWT 有效期 7 天。前端按 API origin 保存令牌；私人看板拒绝匿名请求。隐藏服务器对匿名 REST 返回 404，对匿名 WS 不推送。
- 请求体与 WS 单消息上限 2 MiB。登录/2FA 管理每 IP 每分钟最多 20 次，账户总计 100 次；涉及验证码的尝试全账户最多 10 次/分钟，超限返回 429 和 Retry-After: 60。最多 50 台服务器、200 条同时存活 WS（资源保护上限；业务目标 50 Agent + 10 看板）。
- 无 Turnstile 流程。生产公网入口使用 HTTPS/WSS。

## 接口地图

| 方法与路径 | 权限 | 用途 |
| --- | --- | --- |
| GET /healthz | 无 | `{ok:true,storage:"sqlite"}`，执行数据库探测 |
| `GET /`、`GET /<ADMIN_PATH>` | 无 | 注入站点配置后的前端页面 |
| GET /api/config | 按站点设置 | 版本、前端配置、可见性；管理员可见 Agent 最新版本 |
| GET /api/servers | 公共站点匿名，否则管理员 | `{servers,latestReportUpdates,...}` |
| GET /api/server?id=UUID | 同上 | 单节点当前状态 |
| GET /api/history/all?id=UUID&hours=24 | 同上；超过 24 小时需管理员 | 按时间升序的历史数组 |
| POST /update | Agent Secret | 指标上报、配置协商、流量校正确认 |
| WS /update | 上报消息内认证 | Agent 实时上报及配置下发 |
| WS /api/ws | 按站点/节点可见性 | 实时订阅 |
| `POST /<ADMIN_PATH>/api` | 除登录/退出外需管理员 | 管理动作，见下表 |
| `POST /<ADMIN_PATH>/backup` | 管理员 | 下载完整 SQLite 快照；同时只允许一份备份任务 |
| POST /clearHistory | 管理员 | 清空历史，保留服务器、设置及最近持久化状态 |
| POST /api/theme_options | 管理员 | 保存 `{theme_options:{...}}` |

没有旧数据库迁移、Cloudflare 用量或 Durable Object 健康接口。历史 `hours` 只接受 `0.167,0.5,1,6,12,24,48,96,168`；其他值返回 400。

## Agent HTTP

```json
{
  "id": "后台生成的 UUID",
  "secret": "API_SECRET",
  "metrics": {
    "timestamp": 1789540000000,
    "cpu": 42,
    "ram_total": 1073741824,
    "ram_used": 268435456,
    "net_rx": 1000,
    "net_tx": 2000
  }
}
```

示例时间戳必须替换为当前毫秒值。保留原 Agent 指标字段和 `samples` / `batch` 样本数组格式，每个元素包含 `ts` 及 `metrics`（也支持协议中的 data/payload）。最多接受最近 300 个有效样本；历史落库使用原有聚合策略。超过未来 60 秒或早于 7 天的样本返回 400。

Agent 版本通过 `X-Agent-Version` 上报。配置协商使用 `X-Agent-Config-Schema` 与 `X-Agent-Config-MD5`，兼容现有 schema 7。配置变化时返回 200 及原键值串；未变化时返回 204。不协商的旧客户端成功返回 200 `OK`。HTTP 和 WS 使用同一套指标与配置规范化逻辑。

写库失败返回 500，不返回成功确认。相同 UUID、相同时间戳幂等覆盖一条历史；不同 UUID 同时上报互不覆盖。`rx_correction` / `tx_correction` 确认流程保持原协议。

## Agent WebSocket

连接 `/update`，版本/配置元数据可放在原有 Upgrade headers 和配置 query 中。主控发送 `hello` 后，Agent 发送与 HTTP 相同的认证与指标包。

成功返回：

```json
{"type":"ack","ts":1789540000000,"persisted":true,"nextD1WriteAfterMs":60000,"nextWssReportAfterMs":2000}
```

`persisted:false` 表示本次处于写入间隔内，样本仍在内存聚合；不能理解为已持久化。字段 `nextD1WriteAfterMs` 是保留的协议名，不代表还使用 D1。配置变化通过原 `config` 消息下发；关闭 WS 或处于禁用时段时返回 409/相应错误消息，原 Agent 回退 HTTP。

连接消息串行处理。无看板订阅时保留原 Agent 降频行为；管理端设置决定持久化间隔和 WS 推送间隔。普通停止落库待写聚合；强制断电不保证尚未确认持久化的数据。

## 看板 WebSocket

连接 `/api/ws?subscribe=all` 或使用节点 ID。握手后可发送：

```json
{"type":"subscribe","scope":"all","ids":["UUID"]}
```

服务器返回 `hello`、`subscribed`，更新为 `batchUpdate`，其 `updates` 元素含 `serverId`、接收时间与 `samples`。样本字段和现有前端一致。客户端应复用项目 `createLiveSocket` 的重连/空闲逻辑，按 serverId 合并数据。

服务端在推送时重新检查隐藏状态，不能通过猜 UUID 绕过权限。管理员令牌到期或修改站点可见性时连接关闭，前端重新鉴权。

## 管理动作

全部发送到 `/<ADMIN_PATH>/api`，JSON 含 `action`。

| action | 参数与用途 |
| --- | --- |
| login / logout | 登录 / 清除登录 Cookie；前端同步删除本地 token |
| get_settings | 返回站点设置和 Agent 配置所需信息 |
| list | 全部服务器（包括隐藏节点）及在线统计 |
| add | name、server_group 等；返回 id，上限 50 |
| edit | id 与完整服务器编辑字段；建议先 list 再合并修改 |
| delete / batch_delete | id / ids；级联删除历史与最新状态 |
| save_order | orders：按顺序排列的 UUID 数组 |
| save_settings | settings 对象；保存系统、采集、通知及外观设置 |
| save_theme_options | theme_options 对象 |
| start_theme_preview / clear_theme_preview_auth | 主题预览认证 |
| send_test_notification | 实际发送测试通知，仅在用户配置的测试渠道使用 |
| export_servers | 返回 servers 数组，仅配置；完整备份请用 `/<ADMIN_PATH>/backup` |
| import_servers | servers 数组；重复/无效 UUID 跳过，返回 imported/skipped/skippedIds |

## 错误与备份

常见状态：400 参数错误/超容量，401 认证失败，403 禁止访问，404 不存在/不可见，409 备份冲突或 Agent WS 未启用，413 请求过大，426 需要 WS Upgrade，429 登录限流，500 内部或持久化故障，503 停机/连接容量保护。错误正文一般为 `{error,code}`；部分运行时错误为文本或简单 JSON，客户端应以 HTTP 状态为准。

备份响应 `Content-Type: application/vnd.sqlite3`、`Content-Disposition: attachment`、`Cache-Control: no-store`。这是在线一致性快照；恢复步骤见 README.md。备份含数据库内敏感配置，不包含环境变量中的 API_SECRET。

## 2FA 管理动作

请求地址为 `/<ADMIN_PATH>/api`，以下动作均需有效 Bearer token，响应不缓存。安全设置不通过 `save_settings` 修改，也不在 `get_settings` 中返回密钥或恢复码。

| action | 参数 | 响应 |
| --- | --- | --- |
| two_factor_status | 无 | enabled、recoveryCodesRemaining |
| two_factor_setup | password（当前密码） | secret、uri（otpauth）、qrCode（本地 PNG data URL）、expiresAt；10 分钟有效并绑定当前会话 |
| two_factor_enable | password、otp | enabled、token、recoveryCodes（仅本次返回）；替换客户端 token |
| two_factor_disable | password、otp 或 recoveryCode | enabled:false、token；替换客户端 token |

TOTP 为 SHA-1、六位、30 秒，容忍前后一个时间步，已接受的时间步及之前的验证码不可再次使用。恢复码消费与状态写入为 SQLite 同步事务。启用/关闭会改变会话版本并撤销现有看板 WS；原令牌不再通过 REST 或 WS 认证。ADMIN_PATH 变化同样使旧令牌失效。


## 原生 Agent 分发（只读，无需管理员会话）

- `GET /agent/install.sh`、`/agent/install.ps1`：本项目安装脚本。
- `GET /agent/latest`：当前可用的最新稳定版版本号，纯文本；没有产物时为 404。
- `GET /agent/releases.json`：manifest 数组，字段 `schema_version:1`、`version`、`published_at`、`prerelease`、`assets:[{name,size,sha256}]`。
- `GET /agent/<version>/manifest.json`、`checksums.txt`：指定版本元数据和 SHA-256 清单。
- `GET /agent/<version>/cf-probe-<os>-<arch>[.exe]`：只提供 manifest 登记的对应程序，流式响应。支持 HEAD；其他方法为 405，不存在的版本/平台为 404。

只读目录同时包含镜像内置和数据卷归档的版本，内置版本优先；不接受文件上传或远程编译请求。
这些接口不携带服务器凭据。安装和更新必须校验 SHA-256；下载失败不会回退到上游 Release。
已认证 `/api/config` 的 `last_agent_version` 现在来自此目录，不再查询 GitHub。
