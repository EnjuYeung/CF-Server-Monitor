# 测试环境与执行

遵守根目录 testing.md。先准备依赖、GeoIP 和前端构建，再执行测试；不使用生产数据库。

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

先安装 `agent/go.mod` 要求的 Go 工具链。`npm run build` 构建前端和全部 16 个 Agent 目标；`npm run build:frontend` 仅构建前端。
`npm run test:acceptance` 在既有主控验收之后运行 `test/agent-acceptance.js`，使用当前宿主机对应的实际二进制程序，覆盖下载校验、旧配置、HTTP/WS、配置下发、重启保留及坏下载。前台进程使用临时配置和 TMPDIR，不在宿主机注册服务。

`npm run test:agent-deployment` 要求 Docker 和预先构建的 `server-monitor:agent-native` 镜像（`docker build -t server-monitor:agent-native .`）。它预建隔离环境，在 internal bridge 中验证 TLS 下载、原生安装、v1.0.99 测试版本实际自更新到当前版本、主控重建及卸载。v1.0.99 仅为验收编译的旧版本，不是对外发布版本。证据保存在 `output/test-results/agent-integration/`，默认清理自己的测试容器和网络。
可通过 `TEST_DOCKER_CLI` 指定 Docker 包装命令，通过 `AGENT_TEST_IMAGE` 指定测试镜像。`AGENT_KEEP_TEST_ENV=1` 仅用于接续浏览器核验；使用后须按 browser-fixture.json 记录清理测试容器和网络。
