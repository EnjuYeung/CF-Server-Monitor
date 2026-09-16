# 项目说明

Server Monitor 独立二开：Vue 3 看板、Node.js 24 单主控、SQLite WAL，Docker bridge 部署；容器 HTTP/WS，反代 HTTPS/WSS。全新安装，最多 50 Agent、10 看板用户，支持主控与原生 Agent 同机。保留 Agent 协议、7 天历史、地区识别和备份。

入口 src/server.js，实时 src/realtime，存储 src/database，服务 src/services，界面 src/frontend。

原生 Go Agent 源码位于 agent/，基线为上游 v1.0.16；独立版本见 agent/release.json。仅构建和分发 Linux、FreeBSD 各 amd64/arm64，共 4 种程序。数据卷 agent-releases 保留历史版本，不依赖 GitHub Release。保持采集和协议兼容。

开发先运行 npm ci、npm run geoip:download、npm run build。遵守 testing.md，先搭环境再实际验证；运行 npm run test:all 和 npm run test:acceptance。部署改动需实测。结果写 TEST_REPORT.md，改动写 changelog.md。架构和代码地图见 architecture.md、code_map.md。不提交密钥或测试产物。

完整构建需要 Go 1.26.8；Docker 自带构建工具链。Agent 安装、更新或分发改动还需运行 npm run test:agent-deployment（先构建 server-monitor:agent-native 镜像），只使用隔离测试环境。
