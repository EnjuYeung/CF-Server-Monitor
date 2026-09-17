# 测试环境与执行

遵守根目录 testing.md。先准备依赖、GeoIP 和前端构建，再执行测试；不使用生产数据库。

首页恢复回归包括 `dashboard-snapshot.test.js`（完整快照、旧响应竞争、延迟历史补取）和 `frontend-live-socket.test.js`（详情页时限、首页持续重连、卸载停止及请求失败保留数据）。浏览器验收需验证真实 `document.hidden`、后台 WS 更新、冻结/解冻、断网恢复和超过连接时限；Playwright 的默认焦点模拟会使标签页始终可见，不能将这种默认会话当成真实切换测试。使用独立 Chromium 并通过 `connectOverCDP(..., { noDefaults: true })` 接入，实测记录见 TEST_REPORT.md。

```bash
npm ci
npm run geoip:download
npm run build
npm run test:all
npm run test:acceptance
```

`test:all` 包含 Node 测试、Agent 配置脚本及原生 Go vet/test；`test:acceptance` 在临时目录启动真实主控、HTTP/WS 客户端和本地 Webhook，覆盖登录、服务器管理、上报、历史、备份、告警、权限、容量、写入失败、持久化和恢复。结束后关闭服务，证据保存在 `output/test-results/acceptance.json`。临时数据库路径记录在该文件内，可按需人工删除。

负载测试只允许明确提供的空测试主控，拒绝非空安装。先用独立 Compose 项目及独立 DATA_PATH 启动主控，然后：

```bash
TEST_BASE_URL=http://127.0.0.1:18091 TEST_API_SECRET='<测试主控密钥>' ADMIN_PATH='<测试安全路径>' node test/load.js
```

该测试创建 50 个服务器、50 条 Agent WS 和 10 条看板 WS，每两秒上报一次，持续 60 秒；验证全部确认、广播计数及健康检查。结果为 `output/test-results/load.json`。测试结束保留数据供检查，清理时只操作测试容器和测试数据目录。

部署验收另需实际构建镜像、启动 Compose、容器重建、验证数据保留；通过真实 HTTPS/WSS 反代验证 Cookie 和 Upgrade；用官方 Agent 验证 HTTP/WS 模式和配置下发。浏览器实际执行登录、增改服务器、看板/详情、设置保存和备份下载。外部通知渠道需配置专用测试账号后另行验收，禁止发到生产收件人。

本次结果、证据及未覆盖项目见 TEST_REPORT.md。

`test/admin-security.test.js` 覆盖安全路径、RFC TOTP 向量、二维码独立解码、绑定/验证/恢复码、防重放、会话撤销、限流、SQLite 重启与备份恢复。

`test/geoip-update.test.js` 使用预建临时目录、本地 HTTP 下载服务、真实 MMDB 文件及真实主控，覆盖每天更新、热加载、跨月重试、坏下载与体积限制、并发合并、停机取消、超时、持久化和手动地区优先。调度边界通过 Node 模拟时钟推进 24 小时，HTTP、MMDB 解析和文件读写均实际执行；不访问生产数据库或等待一天。已纳入 `npm run test:all`。


## 同仓库原生 Agent

先安装 `agent/go.mod` 要求的 Go 工具链。`npm run build` 构建前端和全部 4 个 Agent 目标（Linux/FreeBSD 各 amd64/arm64）；`npm run build:frontend` 仅构建前端。
`test/agent-build-targets.test.js` 使用完整构建的产物，实际验证四个 ELF 程序的 OS/CPU、HTTP 下载、SHA-256 和归档；`test/agent-install-platforms.test.js` 使用明确标注的 shell 测试载荷验证平台选择、校验与不支持的平台在下载前失败，不将该测试视为 Linux/FreeBSD 程序运行验收。
`npm run test:acceptance` 在既有主控验收之后运行 `test/agent-acceptance.js`，需要 Linux/FreeBSD amd64/arm64 主机，使用对应的实际二进制程序，覆盖下载校验、旧配置、HTTP/WS、配置下发、重启保留及坏下载。前台进程使用临时配置和 TMPDIR，不在宿主机注册服务。macOS/Windows 上原生阶段会明确报错；可单独执行 `node test/acceptance.js` 验证主控，但不得将其当作完整原生验收通过。

`npm run test:agent-deployment` 要求 Docker 和预先构建的 `server-monitor:agent-native` 镜像（`docker build -t server-monitor:agent-native .`）。它预建隔离环境，在 internal bridge 中验证 TLS 下载、原生安装、v1.0.99 测试版本实际自更新到当前版本、主控重建及卸载。v1.0.99 仅为验收编译的旧版本，不是对外发布版本。证据保存在 `output/test-results/agent-integration/`，默认清理自己的测试容器和网络。
可通过 `TEST_DOCKER_CLI` 指定 Docker 包装命令，通过 `AGENT_TEST_IMAGE` 指定测试镜像。`AGENT_KEEP_TEST_ENV=1` 仅用于接续浏览器核验；使用后须按 browser-fixture.json 记录清理测试容器和网络。

Agent v1.2.0 的每日检查由 Go `testing/synctest` 推进 24/48/72 小时，验证启用、关闭及取消边界；没有实际等待数天。部署套件覆盖 `jan-probe` 安装、更新、配置和流量保留、关闭自动更新及卸载。设置 `AGENT_LEGACY_DIST` 为保留的旧版发布目录（包含 manifest 和对应程序，例如 `agent-dist/v1.1.1`），可实际验证旧 `cf-probe` 自动升级为 `jan-probe`；应在修改源码前构建并保留该旧版本，不能用新源码冒充旧版迁移验收。没有指定时使用新源码构建低版本号载荷，仅验证新版更新流程。
