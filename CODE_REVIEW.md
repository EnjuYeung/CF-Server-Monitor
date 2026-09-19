# 项目代码审查（2026-09-19）

审查基线：`2a2694c`。初次只审查、构建和验证，发现 9 项有实际复现证据的问题，以及 3 类结构性维护问题。随后按用户授权完成以下修复；未部署生产。下文原始发现及行号保留为修复前审查记录，当前实现请以代码地图和本节为准。

## 修复结果（2026-09-19）

| 发现 | 处理 |
| --- | --- |
| F01 | `services/adminSettings.js` 原子保存和版本撤销，保护异步竞争、2FA 状态及外观增量；前端要求重新登录 |
| F02 | `notifications/delivery.js` 显式区分送达、失败、无渠道；outbox 保留未发送记录 |
| F03 | `server_presence` 持久记录认证接收时间，在线判定共用且兼容长上报周期 |
| F04 | `services/servers.js` 统一删除和缓存失效，`LatestReports` 单一实例所有者 |
| F05 | 共享静态字段名单不包含月流量，首页和详情的动态指标正常更新 |
| F06 | 首页定时完整快照合并及订阅更新，不再只更新旧节点的延迟 |
| F07 | `serverInput.js` 统一新增、编辑与导入校验，导入反馈具体字段错误 |
| F08 | 排序和批量编辑完整校验后事务提交，写入错误整体回滚 |
| F09 | 删除 8 个旧公开脚本，根路径旧下载入口 404，原生分发和协议兼容保留 |
| S01 | 清除无调用者缓存 API、空回调、恒真分支和内部模拟 HTTP；接入必要的历史缓存失效 |
| S02 | 计费、探测和字段定义放入 shared；合并最新上报及单台/批量表单实现 |
| S03 | 拆分实时状态、资源窗口、节点生命周期、各类通知、前端命令与表单；维持单进程架构 |

新增回归位于 `test/credential-change.test.js`、`test/review-regressions.test.js`、`test/agent-commands.test.js`；最终命令、浏览器及 Docker 结果见 TEST_REPORT.md。结构检查未发现后端静态导入环；没有把“模块已拆分”解释为每个大型页面都完成了全面重构。

整体判断：单进程 Node.js、SQLite 和 Vue 的部署边界清楚，适合既定规模。当前主要问题集中在数据状态的归属、不同入口的校验一致性，以及上游实现保留过多。目录已经分层，但部分职责仍集中在大模块中，且同一数据存在多个更新和清理入口。

## 已复现问题

### F01 · P1 · 修改管理员密码没有撤销旧会话

位置：[密码保存](/opt/1panel/jan_monitor/src/handlers/admin.js:575)、[保存后的处理](/opt/1panel/jan_monitor/src/handlers/admin.js:622)、[JWT 验证](/opt/1panel/jan_monitor/src/middleware/auth.js:98)。

密码保存只更新密码哈希并断开当前看板 WS，没有改变 `admin_security.version`。后续鉴权检查的是 JWT 签名、入口摘要、到期时间和该版本号，未关联密码变化。因此已经取得的旧 JWT 仍保留完整管理权限，最长到原来的七天有效期结束；断开 WS 也不能阻止重新认证。

复现 R07：修改密码返回 200；旧密码重新登录返回 401，新密码返回 200；修改前签发的 JWT 调用 `get_settings` 仍返回 200。修改密码不能用于撤销已经泄露的会话。

建议将凭证修改与会话版本更新放在同一事务中，复用现有 2FA 会话撤销机制；明确要求重新登录，或为当前经过验证的会话重新签发令牌。

### F02 · P2 · 关闭通知渠道会把未发送的队列消息标记为已送达

位置：[无渠道时直接返回](/opt/1panel/jan_monitor/src/services/notification.js:673)、[队列成功判断](/opt/1panel/jan_monitor/src/services/outbox.js:21)。

`sendNotification()` 在没有渠道时返回 `undefined`，正常发送成功也返回 `undefined`。队列把任何非错误结果都写成 `delivered_at`，无法区分“成功送达”和“根本没有发送”。如果已有待重试消息，此时关闭 Webhook 并清空 Token，下一次调度会静默结束这些消息的重试。

复现 R06：关闭渠道后处理一条待发消息，没有发送请求，但数据库变为 `delivered_at != null`、`attempts = 1`、`last_error = null`。

建议让发送器返回明确的结果类型，区分送达、失败、未配置渠道。关闭通知应保留待发状态，或明确记录取消；不能记作送达。

### F03 · P2 · 离线告警使用历史落库时间，误报正在上报的节点

位置：[离线时间判断](/opt/1panel/jan_monitor/src/services/notification.js:873)、[WS 写入节流](/opt/1panel/jan_monitor/src/realtime/RealtimeHub.js:1102)。

系统允许两分钟离线阈值，也允许 180 秒历史写入间隔。`checkOfflineNodes()` 只读取 `server_latest.timestamp`，未使用最近一次认证上报的接收时间。WS 已经收到新样本、尚未到历史写入时刻时，告警仍使用旧时间。

复现 R05：预置距今约 150 秒的历史写入，设置 180 秒间隔和两分钟离线阈值，再通过真实 WS 发送当前样本。连接正常、最新实时包年龄约 24 ms、ACK 为 `persisted:false`，随后离线检测仍为该节点入队离线告警。历史写入时刻由夹具预置，没有实际等待 150 秒。

建议单独维护经过认证的 `last_seen` 接收时间，并让告警与看板在线判断共用；历史采样时间和写入节流不应决定节点是否在线。HTTP 模式下还应处理上报周期长于离线阈值的配置冲突。

### F04 · P2 · 删除节点后，历史缓存与第二份上报缓存没有清理

位置：[删除处理](/opt/1panel/jan_monitor/src/handlers/admin.js:684)、[Hub 清理](/opt/1panel/jan_monitor/src/realtime/RealtimeHub.js:458)、[独立上报缓存](/opt/1panel/jan_monitor/src/utils/latestReportCache.js:7)、[历史缓存读取](/opt/1panel/jan_monitor/src/database/schema.js:95)。

删除会级联清理 SQLite 数据和 Hub 内部缓存，但没有清除 `latestReportCache.js` 的全局 Map，也没有调用已经存在的 `clearMetricsHistoryCache(id)`。同一 UUID 被重新导入后，API 会再次返回已经删除的数据。

复现 R01：上报 CPU=73，读取历史和详情，导出节点、删除后重新导入。SQLite 的历史行数和最新状态行数均为 0，API 却返回一条 CPU=73 的历史以及一个旧上报包。24 小时历史缓存可维持 15 分钟，其他范围按各自 TTL 保留。

建议由一个节点生命周期入口统一清除历史、最新状态和实时缓存。最新样本应只有一个内存所有者；短期修复也应覆盖单删、批删、重新导入和主控关闭。

### F05 · P2 · 月流量被当作静态字段，持续打开的看板显示旧值

位置：[实时字段删除列表](/opt/1panel/jan_monitor/src/utils/historyFields.js:80)、[首页定时合并](/opt/1panel/jan_monitor/src/frontend/views/Dashboard.vue:1087)、[月流量计算](/opt/1panel/jan_monitor/src/frontend/composables/useServerCardData.js:60)。

`net_rx_monthly`、`net_tx_monthly` 在所有实时广播中被删除。首页虽每分钟请求完整服务器快照，却只合并延迟历史；卡片的月流量和额度百分比因此不更新。详情页也把这两个字段列入 `STATIC_FIELDS`，修复时需要一并核对。

真实 Chromium 复现：100 GB 额度的节点，月流量从 10 GB 上报到 30 GB，CPU 从 11% 到 44%。CPU 和累计流量立即更新；等待实际 60 秒定时 REST 请求完成，月流量仍为 10 GB / 10.0%。重新加载后才显示 30 GB / 30.0%。截图已检查，浏览器没有脚本异常。

建议把月流量作为动态指标传递，或在定时快照中合并该字段并保留已有的时间戳竞争保护。不能用累积流量替代月周期流量。

### F06 · P2 · 已打开的首页不会发现新增节点

位置：[新增节点后仅清列表缓存](/opt/1panel/jan_monitor/src/handlers/admin.js:642)、[快照只遍历既有节点](/opt/1panel/jan_monitor/src/frontend/views/Dashboard.vue:1094)、[订阅使用当前节点 ID](/opt/1panel/jan_monitor/src/frontend/views/Dashboard.vue:1131)。

新增与导入没有通知前端更新节点集合；当前 WS 订阅仅包含旧列表的 ID。定时 REST 已返回新节点，但页面只遍历原有 `servers.value` 合并延迟，新节点永远没有加入列表，也不会加入实时订阅。

真实 Chromium 复现：打开只有一个节点的首页，通过管理 API 添加第二个节点并上报。一次完整的定时 REST 请求后，API 有两台服务器，页面仍只显示一台；重新加载后出现第二台。切回页面等触发完整快照的操作可以恢复，持续打开的页面无法自行发现。

建议定时刷新同步节点集合及元数据，并在集合变化后更新订阅；或统一发送节点集合变更事件。新增、导入、删除、排序应使用一致的通知机制。

### F07 · P2 · 导入绕过编辑校验，保存出无法再次编辑的节点

位置：[导入直接绑定字段](/opt/1panel/jan_monitor/src/handlers/admin.js:915)、[编辑入口校验](/opt/1panel/jan_monitor/src/handlers/admin.js:721)、[下发时再次回退默认值](/opt/1panel/jan_monitor/src/utils/agentConfig.js:266)。

编辑会校验采样间隔、上报间隔、重置日、探测地址和流量校正，导入却直接写入其中多数原始值。同一配置在不同入口有不同约束，随后生成 Agent 配置时又可能被回退成默认值，形成数据库、界面和实际下发三种结果。

复现 R03：导入 `reset_day=99`、`collect_interval=999`、`report_interval=999`、非法探测地址以及文本流量校正值，返回 `imported=1`，数据库保留这些值。把同一行原样送入编辑接口，返回 400，错误为 `collect_interval is not allowed`。

建议提取共用的服务器输入校验与规范化函数，供新增、编辑和导入调用。导入可以继续逐条跳过，但应返回具体字段错误，且不能保存协议无法接受的数据。

### F08 · P2 · 排序接口返回失败时已经写入部分顺序

位置：[排序循环](/opt/1panel/jan_monitor/src/handlers/admin.js:700)。

循环中每校验一个 ID 就立即写入；后面的 ID 非法时提前返回 400，既不回滚前面的写入，也不清理列表缓存。前端看到的是失败与旧列表，数据库则已经改变。

复现 R02：提交 `[有效的第二台节点 ID, "invalid-uuid"]`，响应 400，但该节点 `sort_order` 从 1 变为 0；随后后台列表仍从缓存返回 1。

建议先验证完整数组、重复 ID 和目标存在性，再在同步事务中写入，成功后统一失效缓存。前端批量编辑也存在逐条写入、失败后直接返回的相似结构，见 [批量编辑](/opt/1panel/jan_monitor/src/frontend/views/admin/index.vue:1799)；本轮未将其作为另一个已复现问题计数。

### F09 · P2 · 旧脚本 Agent 仍随前端发布，分发入口没有收敛

位置：[旧 Linux 脚本](/opt/1panel/jan_monitor/public/install.sh:10)、[Windows 脚本](/opt/1panel/jan_monitor/public/cf-server-monitor.ps1:101)、[全量复制 public](/opt/1panel/jan_monitor/scripts/build.js:25)、[静态文件服务](/opt/1panel/jan_monitor/src/runtime/http.js:57)。

新的 `/agent/install.sh` 使用自托管原生程序和校验，但 `public/` 仍含另一套上报、采集、服务安装和更新实现，并被 Vite/public 复制流程打包。旧 Linux/macOS/Windows 脚本标记为 1.3.8，安装的是旧 `cf-probe`，形成与当前原生 `jan-probe v1.2.0` 并行的分发路径。这也与架构文档中“不再打包或提供 Windows 安装脚本”的声明不符。

复现 R04：完整构建后的临时主控对 `/install.sh`、`/install-mac.sh`、`/cf-server-monitor.ps1`、`/uninstall.ps1` 全部返回 200，新的 `/agent/install.sh` 也返回 200。旧脚本合计 11,426 行，其中不含原生 Agent 源码。本轮只下载核实，没有执行这些旧安装器。

建议保留单一的安装分发入口：停止打包完整旧采集器；需要保留旧 URL 时，提供明确的迁移/重定向处理。不能只删除构建后的文件，因为下一次 Vite 构建仍会从 `public/` 复制。原生源码中用于配置兼容和旧服务迁移的实现应另行保留。

## 无效代码、重复实现与职责边界

### S01 · 无效缓存 API、不可达分支和旧内部路由

以下结论通过源码定义、调用点搜索和模块依赖分析获得，不表示执行过每一个旧分支：

- [cache.js](/opt/1panel/jan_monitor/src/utils/cache.js:115) 的 `checkServerExists`、`getLatestMetricsCache`、`setLatestMetricsCache` 没有调用者。实际最新指标查询直接读 SQLite，但每次落库仍调用空缓存的清理函数。`clearMetricsHistoryCache(id)` 也没有调用者，不过 F04 说明它目前是“应该接入却遗漏”的函数，不应直接删掉。
- [RealtimeHub.js](/opt/1panel/jan_monitor/src/realtime/RealtimeHub.js:61) 的 `parseAllowedOrigins`、`_isWebSocketUpgrade`、`_createAgentWssUnavailableResponse` 没有调用者；空的 `webSocketClose`、`webSocketError` 也没有接入真实 socket。有效的握手和连接清理已在 `server.js` / `acceptSocket()` 中实现。
- [_shouldCacheResourceAlertSamples](/opt/1panel/jan_monitor/src/realtime/RealtimeHub.js:1536) 恒为 true，`resourceAlertCacheActiveUntil` 仍不断赋值，却不再控制行为；基于 inactive 状态的生产分支已失效。
- [Hub 的 `/push/`、`/batch-push`](/opt/1panel/jan_monitor/src/realtime/RealtimeHub.js:1297) 没有生产调用者，后者仅被单元测试直接调用。HTTP 上报生产入口已经直接调用 `hub.ingest()`，旧入口及相关归一化流程增加了维护面。
- [Basic 凭证入口](/opt/1panel/jan_monitor/src/middleware/auth.js:165) 的 `validateCredentials()` 没有调用者，当前登录直接使用 `validatePasswordCredentials()`。

建议先删除已证实无调用者的内部代码，再把仍在使用的内部 `Request/Response/JSON` 调用替换为普通方法。`handlers/dashboard.js`、`agentConfigNotify.js` 和通知评估目前还在通过 `hub.fetch('http://internal/...')` 调用同进程对象，这不是 Agent 对外协议要求。

### S02 · 重复的领域规则没有单一来源

[后端计费](/opt/1panel/jan_monitor/src/utils/serverBilling.js:89) 和 [前端 server 工具](/opt/1panel/jan_monitor/src/frontend/utils/server.js:90) 逐字重复了 `normalizePrice`、`detectBillingCycle`、`normalizeBillingCycle`、`renewExpireDateIfNeeded` 四个导出函数，合计 60 行；其依赖的币种、周期别名及日期辅助函数也高度重叠。前后端对设置、探测字段和静态/动态指标还有各自的名单与默认值。

重复的风险已经由 F05 和 F07 展现：字段分类或校验只在一个入口修正时，其余入口继续运行旧规则。建议把不依赖 Node/Vue 的计费、校验和字段定义放入小型 `src/shared/` 模块；本地化标签留在前端。不同传输协议仍保留各自的边界转换。

另外，两份最新上报 Map 的更新语义不同：独立缓存按样本时间拒绝倒退，Hub 缓存按接收顺序覆盖。Dashboard 再读出、回填并合并两者。单进程部署没有跨实例缓存需求，建议合并所有权并提供明确的读取/删除接口，避免继续增加同步补丁。

### S03 · 通知与实时模块职责过宽，并已形成循环依赖

静态依赖存在 `notification.js → outbox.js → notification.js` 环：通知模块入队事件，队列反向引用同一通知模块中的发送器。当前 ESM 能运行该循环，本轮没有把循环本身当成启动故障；问题是事件判定、渲染、各渠道发送、HTTP 重试与可靠队列缺少清晰边界，F02 正是返回约定不明确带来的后果。

模块规模与实际职责：

| 模块 | 行数 | 集中承担的职责 |
| --- | ---: | --- |
| RealtimeHub.js | 1,873 | socket 适配、认证后上下文、配置推送、写入聚合、最新包、资源告警窗口及持久化、内部路由 |
| notification.js | 1,398 | 多种事件判定、流量周期与续期、模板格式化、多个渠道、HTTP 重试、队列入队 |
| admin/index.vue | 1,988 | 登录、设置规范化、节点编辑、批量编辑、安装命令生成、数据库操作、多站点状态 |
| ServerDetail.vue | 1,820 | 图表配置、历史读取、样本回放、指标归并和 socket 生命周期 |

行数仅是定位线索；真正需要调整的是上述职责的交叉。建议在现有单进程内拆出事件判定与发送器、指标状态与传输适配、后台表单与安装命令生成，让路由/页面负责组合。无须引入微服务或新的部署组件。

## 验证与处理顺序

已执行 `npm ci`、`npm run geoip:download`、`npm run build`、`npm run test:all`、`npm run test:acceptance`。87 项 Node 测试、Agent 配置、Go vet/test、19 项主控验收和 6 项原生 Agent 验收全部通过。这些结果与上述问题并不矛盾：新增复现覆盖了既有套件未覆盖的组合和生命周期边界。

证据位于 `output/test-results/review-20260919/`：`reproduce.mjs` / `reproduction.json`、`browser.mjs` / `browser.json`、两张浏览器截图和 `structure.json`。运行结果已写入 [TEST_REPORT.md](/opt/1panel/jan_monitor/TEST_REPORT.md:3)。证据文件和测试数据不纳入版本控制。

建议按以下顺序处理：

1. 修复 F01 会话撤销，以及 F02–F04 的通知与缓存正确性。
2. 修复 F05–F08 的页面数据同步、共用校验和事务边界，并把本轮复现加入对应回归覆盖。
3. 收敛 F09 分发入口，再清理 S01 中明确无用的代码。
4. 借助上述边界测试，逐步合并 S02 的领域规则并拆分 S03 的职责。

审查主要覆盖主控入口、HTTP/WS、存储与缓存、设置/管理、告警与队列、首页/详情更新链路、原生 Agent 构建和分发边界。原生运行验证限于 Linux amd64；四个平台已构建，FreeBSD/arm64 真机、长期负载、真实外部通知渠道及全部平台采集细节未逐项验证。本次未修改 Agent 安装/更新/分发实现，因此没有重跑 Docker Agent 部署套件，也没有部署生产环境。
