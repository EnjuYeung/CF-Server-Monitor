# 功能代码地图

更新时间：2026-09-17；版本：3.0.0。

| 用户功能 / 维护任务 | 主要入口 | 下游模块 / 验证 |
| --- | --- | --- |
| 安装与启动 | Dockerfile、compose.yaml、scripts/container-entrypoint.js | src/server.js；A01、D01 |
| HTTP、反代、健康检查 | src/runtime/http.js、src/server.js | test/runtime-http.test.js；D04 |
| Agent HTTP 上报 | src/handlers/update.js | src/services/ingestion.js、src/database/schema.js；A04 |
| Agent WS、配置下发 | src/realtime/RealtimeHub.js | src/utils/agentConfig.js、agentConfigNotify.js；A05、D03 |
| 安全入口、登录、权限、会话 | src/utils/adminPath.js、src/middleware/auth.js、src/handlers/admin.js | src/frontend/utils/adminAccess.js；A02、A11、S01/S07/S08 |
| 2FA 绑定、动态码与恢复码 | src/services/twoFactor.js、src/handlers/twoFactor.js | TwoFactorPanel.vue、AdminLogin.vue；test/admin-security.test.js S02–S06 |
| 服务器增删改、排序、导入导出 | src/handlers/admin.js | src/utils/serverBilling.js、cache.js；A03、A03b、A13 |
| 看板与节点详情（条形图、环形图、列表） | src/handlers/dashboard.js | src/frontend/views/Dashboard.vue、ServerDetail.vue；视图偏好：src/frontend/utils/displayMode.js；A05、B03 |
| 首页顺序、分组和地区筛选 | src/frontend/views/Dashboard.vue | src/utils/cache.js 的 sort_order 升序；前端连续展示、单选分组与地区交集；src/frontend/styles/main.css；G01–G08 |
| 中/英/日文及默认语言 | src/frontend/utils/i18n.js、src/frontend/utils/locales/ja.js | src/utils/language.js、settings.js；TerminalHeader.vue、SettingsPanel.vue；test/frontend-i18n.test.js、A02b、A15 |
| 历史曲线与采样 | src/index.js、src/database/schema.js | src/utils/historyFields.js、metrics.js；A07、A14 |
| 看板延迟实时窗口与柱图 | src/frontend/utils/latencyWindow.js、views/Dashboard.vue | composables/useServerCardData.js、components/ServerLatencyPanel.vue；test/dashboard-latency-window.test.js、frontend-latency-window.test.js；A05、L01–L07 |
| 数据库初始化、事务、持久化 | src/database/schema.js、sqlite.js | test/history-query.test.js；A12、A15、D02 |
| 自动地区识别、手动地区及每日 IP 库更新 | src/services/geolocation.js、geoipDatabase.js、scheduler.js、src/handlers/admin.js | scripts/download-geoip.js、geoip/NOTICE.md、test/geoip-update.test.js；A06、GU01–GU09 |
| 离线 / 资源 / 流量 / 到期通知 | src/services/notification.js | src/services/outbox.js、scheduler.js；A09、A10 |
| 流量周期和报告计算 | src/services/notification.js | test/traffic-report.test.js |
| 手动备份 | src/handlers/backup.js | src/frontend/views/admin/components/DatabasePanel.vue；A08、A16、B02 |
| 后台系统、外观、主题配置 | src/utils/settings.js、src/handlers/admin.js | src/frontend/views/admin/components/SettingsPanel.vue |
| 前端入口、API 会话、WS 重连 | src/frontend/main.js、utils/http.js、utils/api.js | test/frontend-live-socket.test.js、frontend-api-base.test.js |
| 前端 HTML、第三方主题与 CSP | src/handlers/frontend.js、theme.js、src/utils/csp.js | theme-develop.md |
| Agent 版本、安装与下载 | src/services/agentDistribution.js、src/utils/version.js | agent/install.sh；主控 /agent 与 data/agent-releases；NA01/NA06、agent-install-platforms.test.js |
| 原生 Agent 采集与协议 | agent/internal/cfprobe、agent/cmd/cf-probe | 源码基线 v1.0.16；原生版本见 agent/release.json；NA02–NA05 |
| Agent 自动更新与版本归档 | agent/internal/cfprobe/update.go、src/services/agentDistribution.js | 主控 manifest、SHA-256、原平台服务重启；native_distribution_test.go |
| Agent 多平台构建 | agent/tools/build/main.go、scripts/agent.js | Linux/FreeBSD 各 amd64/arm64 共 4 个目标；agent-build-targets.test.js、Go 测试及 Docker 多阶段构建 |
| 构建 | scripts/build.js、vite.config.js | npm run build、Dockerfile、.github/workflows/test.yml |

## 测试入口

- `test/acceptance.js`：真实 HTTP、WS、SQLite、Webhook、重启和恢复；生成 `output/test-results/acceptance.json`。
- `test/*.test.js`：协议、采样、告警、通知、前端连接和可信反代回归。
- `test/agent-config.js`：Agent 配置兼容与规范化。
- `test/load.js`：明确指定的空测试主控，50 Agent / 10 看板、60 秒负载；拒绝非空数据库。
- `TEST_REPORT.md`：最近一次验收、命令、证据和未覆盖范围。`testing.md`：固定验收标准。

## 已移除路径

原 `src/durable`、数据库迁移/周分区文件、Wrangler 配置、Workers/Pages 部署工作流、Turnstile 组件和 Cloudflare 用量页面已删除。不要重新依赖这些平台组件。协议兼容字段中的旧命名不代表平台依赖。

后台捐赠模块及二维码、看板地图展示及 Leaflet/世界地图资源已删除；地区识别、地区筛选和国旗资源仍保留。
