# Server Monitor

基于 CF-Server-Monitor 的独立二开版本。主控使用 Node.js 24、Vue 3、SQLite，以 Docker Compose bridge 网络部署；Go Agent 源码已纳入 `agent/`，以原版 v1.0.16 为功能基线，保留 HTTP / WebSocket 上报、配置下发和采集方式。

本版本只支持全新安装；单主控、最多 50 台 Agent、10 个看板用户，历史查询最长 7 天。无需 Workers、D1、Durable Objects 或 Turnstile。

## Docker 安装

准备 Docker Engine 与 Compose v2+。以下命令均在项目根目录运行：

```bash
cp .env.example .env
# 编辑 .env：将 API_SECRET 改为自己的随机密钥，至少 16 个字符
# 可用 openssl rand -hex 32 生成；不要保留示例值
# 另生成独立 ADMIN_PATH（至少 8 位随机字符），例如 openssl rand -hex 12

docker compose up -d --build
docker compose ps
curl -f http://127.0.0.1:8080/healthz
```

直接访问域名或 `/` 展示探针首页，匿名用户看不到设置齿轮。后台入口是 `http://127.0.0.1:8080/<ADMIN_PATH>`（将占位符替换为 `.env` 的实际值），旧 `/admin` 返回 404。通过安全入口登录后，首页右上角显示设置齿轮，点击进入后台。初始用户名为 `admin`，密码为 `.env` 中的 `API_SECRET`。后台可修改登录用户名和密码；Agent 仍使用环境变量中的 `API_SECRET`。公网访问请使用自己的 HTTPS 反向代理域名。

镜像构建时会下载 npm 依赖及当月 DB-IP Country Lite 地区数据库，首次构建需要网络。镜像内置初始 GeoIP 库，主控可离线启动；运行后会在后台每天检查更新。镜像支持 Node 官方 Linux amd64/arm64 基础镜像；本次实际覆盖的平台见 TEST_REPORT.md。

### 配置

| 变量 | 默认 / 用途 |
| --- | --- |
| API_SECRET | 必填，至少 16 字符；Agent 认证及初始管理员密码 |
| API_USER_NAME | 初始管理员用户名，默认 admin |
| ADMIN_PATH | 必填，独立生成的 8–128 位随机字母、数字、`_` 或 `-`；可带开头 `/`，不能含多级路径。缺失或无效时拒绝启动 |
| HOST_PORT | 宿主机映射端口，默认 8080 |
| BIND_ADDRESS | 默认 127.0.0.1，供本机反代和同机 Agent 使用 |
| DATA_PATH | 默认 ./data，映射到 /app/data；包含 SQLite、更新后的 GeoIP 库和 Agent 版本归档 |
| TRUSTED_PROXIES | 可信反代 IP/CIDR，逗号分隔；为空时忽略转发来源和 HTTPS 头 |
| PUBLIC_IP | 可选，同机 Agent 无公网信息时用于自动地区识别的 VPS 公网 IP |
| CORS_ALLOWED_ORIGINS | 仅独立前端跨域时填写精确 origin，逗号分隔 |

`DATA_PATH` 应位于本地磁盘。不要让多个主控进程或副本同时使用同一目录。启动脚本为挂载目录设置权限后，以 UID/GID 1000 运行主控。

## HTTPS / WSS 反向代理

容器只提供 HTTP/WS。参考 `deploy/nginx.conf.example`，由自己的 Nginx/Caddy 等代理管理域名和证书，并转发 WebSocket Upgrade。代理需要覆盖 `X-Forwarded-For`、`X-Forwarded-Host` 和 `X-Forwarded-Proto`。

将 `TRUSTED_PROXIES` 设为**主控实际看到的代理来源 IP/CIDR**。宿主机代理通过端口映射访问容器时，来源通常是 bridge 网关，可先查看：

```bash
docker network inspect "$(docker inspect "$(docker compose ps -q monitor)" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}')"
```

不要填 `0.0.0.0/0`。代理部署在另一个容器时，将代理接入相同 bridge 网络，使用 `http://monitor:8080`，并只信任代理地址或其专用网络。修改 `.env` 后执行 `docker compose up -d` 重新创建容器。

## 双重验证（2FA）

在安全入口登录后，打开「设置 → 安全设置 → 双重验证」，输入当前管理员密码并点击「设置双重验证」。使用 1Password 或 Google Authenticator 扫码，或手动保存页面中的密钥；采用 TOTP / SHA-1 / 6 位 / 30 秒。输入应用当前显示的六位验证码（保留开头的 0），点击「验证并启用」。绑定在 10 分钟后过期，未确认前不会启用。

启用后每次登录均需要密码和动态验证码，也可选择一次性恢复码。启用成功会显示 10 个恢复码，仅显示一次，请保存在安全位置。已使用的验证码不能再次使用，等待下一个 30 秒周期即可；手机和主控都应开启时间同步。关闭 2FA 也需要当前密码及一个未使用的验证码或恢复码。启用/关闭会使其他会话立即失效。

2FA 密钥加密存储于 SQLite，恢复码仅保存哈希。数据库备份包含该配置，恢复时必须保留原 `.env`，尤其是用于解密的 `API_SECRET`；不要直接更换该值。需要更换时先关闭 2FA，更新密钥和 Agent 配置并重建容器，再重新绑定。丢失验证器时用恢复码登录；验证器和恢复码同时丢失时没有网页绕过入口，需通过服务器维护恢复受控备份。

`ADMIN_PATH` 只用于隐藏后台入口；请生成独立随机值，不要复用管理员密码或 API_SECRET，不要公开该 URL。修改路径后重建容器，旧路径和原会话均失效。私人看板继续遵守原权限配置，匿名访问首页显示未公开提示，不自动跳到后台。

## Agent 安装与同机运行

登录后台添加服务器，复制该服务器的安装命令。安装脚本、程序、版本查询和自动更新均由当前主控 `/agent` 提供，无需 GitHub Release。Docker 构建时编译与上游一致的 16 种平台/架构程序；采集和连接模式仍由 Agent 自动协商。Agent 独立版本从 v1.1.0 开始，完整说明见 [agent/README.md](agent/README.md)。

主控和 Agent 位于同一 VPS 时，Agent 使用原生进程/服务采集宿主机；可将上报地址设为 `http://127.0.0.1:8080/update`，并使用后台生成的 UUID 和 API_SECRET。新配置使用 `CONTROLLER_URL`，同时兼容旧 `WORKER_URL`。不要在 Agent 所在的独立容器内把 `127.0.0.1` 当成宿主机。

主控启动时将内置 Agent 版本归档到数据卷 `agent-releases/`，镜像升级后仍可指定已保留的版本安装。自动更新默认关闭，启用后仍每 6 小时检查，但来源改为当前主控或显式配置的下载镜像。Agent 更新需修改 `agent/release.json` 的版本号后重新构建；仅更新主控界面不会强制升级 Agent。后台 SQLite 备份不包含二进制归档，如需保留旧版本下载能力，应另行备份该目录。

自动地区来自本地 GeoIP，支持 IPv4/IPv6。同机私网连接优先使用 Agent 提供的公网 IP，缺失时使用 `PUBLIC_IP` 或主控启动时发现的出口 IP。后台手动地区始终优先。识别粒度是国家/地区，库更新或出口 IP 变化可能影响结果。

IP 库在主控启动后后台检查一次，此后每 24 小时检查一次，按 UTC 当前月份获取 DB-IP Country Lite。上游免费库按月发布；内容相同时不重复写盘，新库校验通过后保存到 `data/geoip/dbip-country-lite.mmdb` 并立即加载，节点下一次上报即使用新库，无需重启主控或 Agent。主控重启会从持久库和镜像内置库中选择较新的有效版本。

下载超时、文件损坏、当月库尚未发布或写盘失败时继续使用当前库，次日再次尝试，不降级到旧版本。持久库损坏时可回退镜像内置库。日志事件为 `geoip_updated`、`geoip_unchanged`、`geoip_update_failed`；自动更新需要访问 `download.db-ip.com`，地区查询本身仍在本地进行。GeoIP 库可重新下载，不包含在后台 SQLite 备份中；保留数据目录可在容器重建后保留已更新的库。

## 手动备份与恢复

后台「数据库管理 → 下载数据库备份」下载完整 SQLite 一致性快照，包括服务器、设置、历史、告警状态和通知队列。备份文件含敏感配置，应自行保存到受控位置；`.env` 中的 API_SECRET 不在数据库内，需要另行保留。

恢复到同版本的新安装：

1. 执行 `docker compose stop monitor`。
2. 将当前数据目录整体移到安全位置，例如默认路径下执行 `mv data data.before-restore`，再 `mkdir data`。自定义 DATA_PATH 时替换为实际路径。
3. 将下载的快照复制为 `data/monitor.sqlite`，不要混入原数据库的 `-wal`、`-shm` 文件。
4. 使用原来的 API_SECRET，执行 `docker compose up -d`。
5. 检查健康状态、登录、服务器列表、历史及 Agent 重连。

恢复可能重发快照中未完成的通知。首版不提供自动备份和在线恢复。运行中的数据库请通过后台备份，不直接复制单独的主数据库文件。

## 更新与日志

```bash
# 更新代码前先手动备份
docker compose up -d --build
docker compose logs --tail=100 monitor
```

保留数据目录即可保留数据。普通停止会落库尚未写入的 WS 聚合数据；断电或强制杀进程可能丢失最近一个写入间隔内的内存样本。历史滚动保留 7 天；匿名访客最多查询 24 小时，管理员最多查询 7 天。

## 本地开发与验收

需要 Node.js 24.11+（24.x）和 Go 1.26.8。Docker 构建自带 Go 工具链，目标 Agent 机器只运行编译后的程序。

```bash
npm ci
npm run geoip:download
npm run build
cp .env.example .env
# 编辑 API_SECRET 和 ADMIN_PATH
npm start
```

前端开发：另开终端运行 `npm run dev:frontend`；Vite 将 API/WS 请求代理至本机 8080 主控。

```bash
npm run test:all
npm run test:acceptance
```

验收程序会预建隔离数据库和本地通知服务，通过真实 HTTP、WS 和数据库查询验证；证据在 `output/test-results`。负载测试见 `test/README.md`。

- `AGENTS.md`：项目简述和协作规则。
- `architecture.md` / `code_map.md`：架构和功能代码地图。
- `testing.md` / `TEST_REPORT.md`：固定验收标准和最近测试结果。
- `changelog.md`：最近改动与 P1 修复。
- `API.md` / `theme-develop.md`：接口和主题约定。

## 致谢

基于 [huilang-me/CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor) 与原版 [cfsm-agent](https://github.com/huilang-me/cfsm-agent)，保留原项目许可。IP Geolocation by [DB-IP](https://db-ip.com)，Country Lite 数据依 CC BY 4.0 提供，见 `geoip/NOTICE.md`。
