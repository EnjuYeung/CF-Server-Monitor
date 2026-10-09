# 最近一次测试报告

## 架构重构生产发布（2026-10-09）

按用户授权，将前两项已验收的架构重构一起部署生产：https://jm.zedy.cc。**14:15:27（Asia/Shanghai）**启动新容器，14:15:36 健康检查通过；**14:17:08**完成数据、上报与公网复核。生产 `server-monitor:local` 和发布标签 `server-monitor:architecture-20261009` 指向完整验收的镜像 **`sha256:b32c0ce3d386c2954e68011517abf675e26fdbf41e91d9a76e20ff8069e4576f`**，未重新构建另一份发布产物。原生 Agent 仍为 v1.3.0，两架构文件与既有生产归档 SHA-256 相同。

发布前先搭建 `--network none` 的生产数据副本容器、全新浏览器配置目录和只读验证脚本，备份在线 SQLite 一致快照及生产配置，再在副本启动已验收镜像。沿用当前 Compose 项目、生产 `.env`、数据卷、端口及网络，只替换主控镜像；未安装、重启或手动更新任何远程 Agent。

| 编号 | 用户功能、操作与预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| AP01 | 发布的是已通过完整验收的源码/产物，Agent 版本归档兼容 | 发布前再比对镜像与工作区，113 个源码、315 个静态文件全相同；v1.3.0 manifest 与既有归档相同。`release-source.json` | 通过 |
| AP02 | 保存生产数据和回滚版本，再在断网副本实际启动 | 备份 integrity=ok，16 节点、5 项设置、179,178 条历史和 39 个归档/地区库文件；副本健康、首页、后台、配置、版本及 manifest 全 200，节点/设置/固定历史内容哈希保持。`prepare-result.json`、`production-copy-result.json` | 通过 |
| AP03 | 用既有 Compose 执行 `up -d --no-build monitor`，验证配置及数据保持 | 容器 healthy、重启 0；环境、端口、挂载、网络、重启策略、init、停止宽限均相同，SQLite integrity=ok，节点/设置/固定历史保持。`deployment-result.json` | 通过 |
| AP04 | 公网验证应用路由和新前端资源 | 健康、首页、看板、配置、Agent 版本/manifest 及新 Dashboard JS 全 200，16 个公开节点；JS 与验收产物 SHA-256 相同。`public-verification.json` | 通过 |
| AP05 | Chromium 访问生产 HTTPS，检查桌面/手机及三个视图，接收真实 WSS | 1440/375px 各显示 16 节点、无横向页面溢出；条形/环形/列表切换通过；运行异常及本站 HTTP 错误 0，WSS 收到 hello/subscribed/batchUpdate。已人工阅读两张截图。`browser.json`、`production-dashboard-*.png` | 通过 |
| AP06 | 发布后确认所有 Agent 恢复上报、持久数据及归档保持 | 16/16 节点在新容器启动后上报，复核时最长报告年龄 4.2 秒；历史 179,259 行，固定范围 178,216 行内容相同，5 项设置、16 节点、删除意图及原 39 个文件保持。`final-result.json`、`database-final.json` | 通过 |
| AP07 | 清理生产副本与测试进程，保留受保护回滚材料 | 副本容器、数据复制目录、临时环境文件均清理；浏览器正常退出 0，无本轮测试容器。备份目录 0700，私密文件 0600。 | 通过 |

证据位于 Git 忽略的 `output/test-results/architecture-production-20261009/`。备份：`/opt/1panel/apps/jan_monitor/backups/architecture-20261009T061250Z/`；回滚标签：`server-monitor:rollback-architecture-20261009t061250z`，指向原生产镜像 `sha256:862f09e0c4dac25ba496b9c5455269690dcff8a884028de42d493b600375c7a5`。固定历史比较留出一小时保留期余量，避免正常七天清理产生误报。提交目标为当前 `codex/self-hosted-native-agent` 分支，仅纳入源码、契约测试及文档，环境、备份、数据和截图均不纳入 Git。

## 首页看板实时状态模块重构（2026-10-09）

本轮按确认范围仅重构首页状态流程，保留此前 Agent 上报模块改动。新增 `state/dashboardState.js` 的只读 `state` / `start()` / `stop()` interface，浏览器 adapter 使用真实 HTTP/WS、时钟与生命周期事件；详情页连接策略和 Agent 协议未改动。测试使用 Node **24.21.0**、Go **1.26.8**、SQLite WAL 和全新临时数据，未访问生产主控、安装宿主服务或更新远程 Agent。

开发前执行 `npm ci`、`npm run geoip:download`、完整基线 `npm run build`。先搭建独立主控进程、随机回环端口、假凭据、Xvfb Chromium 与测试 TLS 反代，再执行真实浏览器验收；测试浏览器使用一次性证书，外部汇率请求由固定测试响应替代。最终构建再次成功。日志、数据库、DOM、截图和 JSON 位于 Git 忽略的 `output/test-results/dashboard-state-refactor/`。

以下 DS 编号对应 `test/dashboard-state.test.js` 的 17 项公共 interface 契约，测试通过 adapter 驱动网络、计时与恢复事件，未访问内部 Map。原六项单独快照函数测试由完整流程测试替换；延迟窗口算法、实际 Vue 柱图与传输 adapter 测试保留。

| 编号 | 用户功能、操作与预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| DS01 | 启动两次、载入快照/配置/统计，关闭延迟详情后周期补取；只启动一个会话且持续补取 | 2 个节点、地区/在线/流量统计正确；计时器为 1 秒及 60 秒，新节点订阅生效。`targeted-tests.log` | 通过 |
| DS02 | 初始化缓存多样本回放，再模拟冻结 10 秒和离线；三种时间分别推进 | CPU 10→30，采样时间到 NOW，显示时间到 NOW+1 秒，接收时间不变；离线后显示时间停止。`targeted-tests.log` | 通过 |
| DS03 | 逆序重复批次后提交单样本及旧采样包；有序回放、新包替换等待样本 | CPU 40→73，旧采样不能回退指标但接收时间更新。`targeted-tests.log` | 通过 |
| DS04 | 提交 601 样本后提交替换批次；缓存有上限且不继续旧批次 | 第 0 个样本被裁掉，新批次 CPU 701→702，旧批次不再播放。`targeted-tests.log` | 通过 |
| DS05 | 暂停 REST，推入较新 WS 后释放旧快照；资料和历史补取不能覆盖新指标 | CPU 73、名称/分组更新；本地延迟 65 与持久历史 150 同时保留。`targeted-tests.log` | 通过 |
| DS06 | 补取较新持久指标，再回放旧缓存；不得回退到旧采样 | CPU 42、采样/显示时间保持新快照。`targeted-tests.log` | 通过 |
| DS07 | 接收时间领先持久采样，更新同桶实时延迟后补取；按采样时间决定历史新旧 | 延迟 65、丢包 15、本地 sample_ts 保留，不回退到持久值 306。`targeted-tests.log` | 通过 |
| DS08 | 清空持久历史后补取，再加入未持久实时样本；清空生效且新样本保留 | 已持久的旧延迟清空，20 桶保持空缺；更新后的实时延迟 70 保留。`targeted-tests.log` | 通过 |
| DS09 | 过在线期限后提交重复旧采样，再补取旧 REST；接收更新恢复在线且不回退 | CPU 10/采样时间保持，接收时间前移、online 0→1，旧快照不撤销。`targeted-tests.log` | 通过 |
| DS10 | 两来源使用同 UUID，分别提交实时包和回放；指标/延迟不串来源 | CPU 分别 81/72，延迟分别 81/72，总计 2，组合标题保持。`targeted-tests.log` | 通过 |
| DS11 | 删除快照节点、递送旧连接回调、恢复同 UUID，再推进时钟 | 删除后始终 0 节点；恢复 CPU 5 不继承旧回放，新连接更新为 6。`targeted-tests.log` | 通过 |
| DS12 | 修改一个来源的订阅，再移除/重新加入另一来源 | 仅变更订阅关闭；重新加入 CPU 20，不继承旧 CPU 77 缓存。`targeted-tests.log` | 通过 |
| DS13 | 分来源逐次完成快照，另一来源失败/CORS，随后成功空集合 | 未完成/失败来源保留节点；剩余计数 2→1→0，错误来源正确；成功空快照删除节点。`targeted-tests.log` | 通过 |
| DS14 | 密集发送 focus/可见/连接恢复/周期事件，再发送 online/resume/bfcache | 一个进行中 REST，健康连接复用；强制恢复重连，正在连接时普通 focus 不重复连接。`targeted-tests.log` | 通过 |
| DS15 | 隐藏期间 resume，切回后跨过延迟桶 | 切回执行一次重连；新桶留空，旧真实延迟保留，未伪造数据。`targeted-tests.log` | 通过 |
| DS16 | 请求中停止，再释放 REST、旧 WS/状态/计时/恢复回调 | AbortSignal 中止，计时器/事件/连接清理，状态不再变化；重复停止仅关闭一次。`targeted-tests.log` | 通过 |
| DS17 | 初始配置或快照等待时停止，再完成初始化 | 两种场景都未启动订阅/事件/计时器，也未加入晚到节点。`targeted-tests.log` | 通过 |

| 编号 | 综合验证、操作与预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| DV01 | 定向测试状态流程、延迟窗口与真实传输 adapter | **25/25**，其中状态契约 17；无失败/跳过。`targeted-tests.log` | 通过 |
| DV02 | 执行最终 `npm run test:all` | **150/150 Node**，Agent 配置、`go vet ./...`、`go test ./...` 均成功。`test-all.log` | 通过 |
| DV03 | 执行 `npm run test:acceptance`，验证真实网络、写库、重启/恢复与前台原生 Agent | **主控 19/19、原生 Agent 7/7**；50 Agent / 10 看板、7 天历史、清空及持久化故障均通过。`acceptance.log`、`controller-acceptance.json`、`native-acceptance.json` | 通过 |
| DV04 | 完整 `npm run build` 与独立 Docker 候选构建 | 前端成功、Linux amd64/arm64 两类 Agent 校验成功。`build.log`、`docker-build.log` | 通过 |
| DV05 | 在无网络和全新匿名卷启动候选镜像，实测 HTTP/WS、清空历史和正常停止 | 健康/首页/后台均 200，WS 确认及回放 CPU 84 正确；正常退出 0，停止后历史仍 0 行。`container-smoke.json`、`container.log` | 通过 |
| DV06 | 比较候选镜像源码/静态产物与工作区，清理隔离容器及卷 | **113 个源码、315 个静态文件** SHA-256 全部相同；冒烟和复制检查容器/卷均删除。`source-parity.json` | 通过 |
| DV07 | 检查改动格式、新文件空白和测试产物排除 | `git diff --check` 成功，新模块/adapter/契约测试/术语表无行尾空白；测试证据均被 Git 忽略。 | 通过 |

真实 Chromium 使用同一脚本比较已保存的基线与最终构建；harness SHA-256 均为 `0573aebe9154aa43a33e4d1152d7dfc909a2a641f53dc4481e0faf1f5c7d7b9d`。基线资源 `Dashboard-CYdvwrqg.js` 为 **8/11**，最终 `Dashboard-cWuKcD3K.js` 为 **11/11**。基线有三处确定失败：旧 WS 帧恢复已删除节点、卸载未中止 REST、两个来源同 UUID 将 A 的 CPU 覆盖为 B 的 82%。以下 DB 项分别映射浏览器脚本的 BR 编号。

| 编号 | 用户功能、操作与预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| DB01 | 在全新主控加载首页，经真实 HTTP 上报后接收 WS 更新 | CPU 20、2 个节点、1 条 all 订阅，REST/WS 均正常。BR01 | 通过 |
| DB02 | 真正切换 Chromium tab 隐藏，期间上报，再切回；复用健康连接 | 创建连接数 1→1，关闭数 0→0，CPU 更新为 30。BR02 | 通过 |
| DB03 | CDP 冻结页面、上报、解冻后再上报；回放及连接恢复 | 连接创建数 1→2，CPU 40→41 恢复。BR03 | 通过 |
| DB04 | 浏览器离线并断开仅测试主控的 viewer 连接，再恢复网络 | online 恢复，CPU 50→51，后续实时更新继续。BR04 | 通过 |
| DB05 | 截停真实 REST 51 响应，先推送 WS 94，再释放旧响应 | DOM CPU 始终保持 94。BR05 | 通过 |
| DB06 | 删除 A，快照确认仅剩 anchor，通过真实 WS 递送已在途旧 A 帧 | 旧帧成功发送一次，DOM 仍只有 anchor，A 未恢复；基线在相同测试失败。BR06 | 通过 |
| DB07 | 两个独立主控进程和 HTTPS 回环反代使用同 UUID，分别上报，再切换环形/列表/条形 | 两来源最终 CPU 分别 73/84，各视图维持两个节点；B 详情 href 带 apiIndex=1。基线混为 82/82。BR09 | 通过 |
| DB08 | 1440/375 视口截图、DOM 宽度及运行异常检查，再人工阅读截图 | scrollWidth 分别 1432/375，无横向页面溢出；运行异常 0，标题、统计、卡片和两来源数值可读。BR07、三张 PNG | 通过 |
| DB09 | 暂停真实快照请求时进入详情页；卸载中止请求 | 捕获该请求 `Network.loadingFailed`，`net::ERR_ABORTED`、`canceled:true`。基线未中止。BR11 | 通过 |
| DB10 | 卸载首页后发 focus/online/resume/bfcache；不得重建首页请求或订阅 | `/api/servers` 请求 0、all 订阅 0，仅详情订阅存活。BR08 | 通过 |
| DB11 | 真实 Agent WS 发送两样本，观察首页播放及延迟 | CPU 65→66、延迟 18ms，原 persisted/nextD1WriteAfterMs 确认字段可用。BR10 | 通过 |

最终浏览器证据：`2026-10-09T04-59-33-283Z-candidate-final-1001396/results.json`；基线：`2026-10-09T04-59-32-030Z-baseline-final-harness-1001239/results.json`。两套均记录 DOM、网络事件和进程清理；候选所有 fixture 主控、Chromium、Xvfb 均退出 0，无该测试前缀残留进程。两套捕获一条预期的冻结/bfcache WS 关闭浏览器日志，随后恢复验收通过，没有将该网络关闭当作 JavaScript 运行异常。

首次浏览器脚本只识别 bar CPU、删空后无存活连接可递送旧帧，以及 HTTP 多来源不满足应用仅接受 HTTPS 的运行配置，属于测试前置问题；已补 ring selector、anchor 和一次性 TLS 反代。同一修正后的脚本完整重跑基线/候选，上述三处业务差别与前置失败分别保留证据。

候选镜像 `server-monitor:dashboard-state-test-20261009`，ID `sha256:b32c0ce3d386c2954e68011517abf675e26fdbf41e91d9a76e20ff8069e4576f`。仅保留本地工作区改动和候选镜像，未提交、推送或部署生产；Agent 安装/更新/分发源码无变化，本轮未运行 `test:agent-deployment`。

首次有界回放测试将起始采样与时钟位置设置成不一致，修正测试前置条件后通过，业务回放规则未为该断言调整。验收证据复制首次误用原生 JSON 路径，已从实际 `agent-integration/native-acceptance.json` 正确归档；主控与原生验收命令本身成功。`npm ci` 提示三项既有 high 依赖审计告警，依赖和锁文件未修改。

## Agent 上报处理模块重构（2026-10-09）

本轮将 HTTP/WS 的 Agent 上报校验、采样聚合、接收记录、回放、历史写入及生命周期集中到 `src/services/agentReports.js`。验证使用 Node **24.21.0**、Go **1.26.8**、真实 SQLite WAL、回环 HTTP/WS 和独立前台 Agent。Docker 测试使用全新匿名数据卷及 `--network none`，不挂载生产数据，不安装或更新宿主服务。

开发前先执行 `npm ci`、`npm run geoip:download`、`npm run build`，并在全新临时目录实际启动主控，健康、首页和安全后台入口均返回 200。最终完整构建再次成功，产物仅 Linux amd64/arm64 两类 Agent，版本仍为 v1.3.0；Agent 源码、发布配置和安装分发逻辑未改动，因此本次未运行安装/分发专项 `test:agent-deployment`。

本节日志和 JSON 证据位于 `output/test-results/report-intake-refactor/`，由 Git 忽略。以下结果来自实际运行与数据库断言。

| 编号 | 用户功能、实际操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| IR01 | 分别通过 HTTP/WS module interface 提交旧采样时间的数据，检查发布时的数据库及接收时间；HTTP 先写后接收，WS 先接收后写 | 两种流程均成功；HTTP 发布时历史 1 行，WS 发布时 0 行；最后接收时间使用当前主控时间，历史保持原采样时间。`targeted.log` | 通过 |
| IR02 | 提交 metrics、samples、batch 格式及秒级时间，检查版本、地区、元数据和回放；保持原协议归一化 | 三条历史 CPU 均 25、地区 CN、版本 1.3.0；元数据保存在历史，实时包继续省略静态字段。`targeted.log` | 通过 |
| IR03 | 提交空、数组、缺失指标、超未来/过去窗口的数据，并提交精确边界样本；异常无副作用，边界可用 | 无效输入均拒绝，历史、接收和发布为空；恰好 7 天前及 60 秒后的样本成功。`targeted.log` | 通过 |
| IR04 | 逆序提交 305 个样本，查询聚合历史与完整实时样本；只保留最新 300 个且保持聚合规则 | 实时 300 个样本递增；历史 CPU 平均 154.5、入站速率峰值 300、磁盘读峰值 304，实时末样本 CPU 304。`targeted.log` | 通过 |
| IR05 | 用真实 SQLite trigger 使历史/最新状态事务失败，再解除故障重试；不能伪报持久化，WS 待写样本可恢复 | 两种事务均回滚、无最新持久状态；HTTP 不接收/发布，WS 保留接收/发布；重试后 WS CPU 平均 20、速率峰值 90，HTTP CPU 30。`targeted.log` | 通过 |
| IR06 | 按节点先写 WS、节流一包、插入 HTTP，再到 WS 写入间隔；窗口跨连接且 HTTP 不消耗它 | WS 剩余等待 59 秒，到期写入；历史 CPU 为 10、20、60，HTTP 与 WS 聚合相互独立。`targeted.log` | 通过 |
| IR07 | WS 产生待写窗口后清空历史，检查最新状态/接收/回放，再接收新样本并关闭；旧窗口不能恢复 | 最新持久 CPU 10、回放 CPU 90 与接收保留；写入间隔保留，关闭只写新 CPU 20。`targeted.log` | 通过 |
| IR08 | 删除节点并恢复相同 UUID，检查回放/接收，再上报并关闭；新节点不继承旧窗口 | 接收、回放清空，新节点首次 WS 立即写入，最终历史只有 CPU 20。`targeted.log` | 通过 |
| IR09 | 受控延迟发布 adapter，关闭时仍有 WS 上报在处理；等待后补写完整窗口 | 关闭等待发布完成；历史 CPU 10、60，待写速率峰值 90 保留。`targeted.log` | 通过 |
| IR10 | 在真实写入失败、异常恢复前清空历史或删除/恢复节点；旧聚合不能重新入队 | 两种事件序列均在关闭后保持历史 0 行。`targeted.log` | 通过 |
| IR11 | 发布 adapter 暂停期间清空历史或删除/恢复，再恢复旧上报并关闭；旧上报不能重建历史窗口 | 返回 persisted=false，历史始终 0 行；删除后接收/回放仍为空。`targeted.log` | 通过 |
| IR12 | HTTP 发布期间开始关闭，再提交新的 HTTP/内部上报；关闭等候已有任务并拒绝新任务 | 新任务返回关闭错误；已有 HTTP 正常完成，历史仅 a 节点 CPU 25。`targeted.log` | 通过 |
| AR13 | 在实际 Hub 的告警 adapter 暂停期间删除/恢复同 UUID，创建新首页/详情订阅，再恢复旧上报；旧推送不进入新节点 | 两种订阅消息均为 0，历史 0 行、接收 0、回放为空；补上删除后异步投递的失效检查。`test-all.log`、`targeted.log` | 通过 |
| AR14 | 执行最终 `npm run test:all`；Node、配置、Go 检查全部通过 | **139/139 Node 测试**，失败/跳过 0；Agent 配置测试、`go vet ./...`、`go test ./...` 均退出 0。定向 59/59，其中上报模块契约 16 项。`test-all.log`、`targeted.log` | 通过 |
| AR15 | 执行最终 `npm run build`；完整前端和两个架构原生 Agent 可构建 | 两类产物校验成功；Vite 构建、静态资源复制成功。`build.log` | 通过 |
| AR16 | 执行最终 `npm run test:acceptance`，真实 HTTP/WS/SQLite 和前台原生 Agent 验证正常/异常、持久化、重启与容量 | **主控 19/19、原生 Agent 7/7** 通过；50 Agent / 10 看板收到 500 个节点更新，写入故障不伪报成功；7 天清理、重启/备份恢复及清空后停机均通过。`acceptance.log`、`controller-acceptance.json`、`native-acceptance.json` | 通过 |
| AR17 | 构建候选 Docker 镜像并在隔离网络、全新卷实际启动，上报两包 WS、读取 REST 回放、清空历史并正常停止；停止不能恢复旧历史 | HTTP/健康/首页/后台均 200；WS 首包 persisted=true、次包 false，确认字段兼容；回放 CPU 84，校正确认不新增历史，目录只含两架构；停止退出 0，停止后历史仍 0 行。`docker-build.log`、`container-smoke.json`、`container.log` | 通过 |
| AR18 | 逐文件比较最终镜像与工作区源码，检查测试容器清理及改动格式；镜像包含完整改动且不遗留测试容器 | **111 个源码文件** SHA-256 全部相同，无缺失；本轮测试容器 0，`git diff --check` 通过，新文件无行尾空白。`source-parity.json` | 通过 |

候选镜像为 `server-monitor:report-intake-test-20261009`，实际 ID `sha256:cb7973883eba58ab5d0bf808c890338927913f896dd989218d7455608ba982e5`。隔离容器及其匿名测试卷已删除，候选镜像保留供后续审阅；本轮仅修改工作区，未提交、推送或部署生产。

初次新契约测试错误地期望实时包保留静态元数据；按原协议修正断言后通过。镜像测试脚本先误用内部 `payload` 读取 REST 的 `data` 字段，随后只读卷上的 WAL 查询缺少可写共享内存目录；修正 REST 断言、复制已停止的数据库到检查容器临时目录后通过。失败日志保留，本轮业务程序未因这些测试脚本问题调整。`npm ci` 提示三项既有 high 依赖审计告警，依赖及锁文件未修改。

## 工程技能配置验证（2026-10-08）

本轮按用户确认配置 Matt Pocock 工程技能：新增三个 `docs/agents/` 配置文件、追加 `AGENTS.md` 入口，并更新本报告及 changelog.md。实际启用 GitHub Issues，补建四个分流标签；以下结果来自文件校验和真实 GitHub CLI/API 调用。

| 编号 | 验收项与实际操作 | 结果与证据 | 状态 |
| --- | --- | --- | --- |
| MP01 | 保留项目说明并追加技能入口，逐字核对原 AGENTS.md 与已确认草稿 | 原说明完整保留，`## Agent skills` 恰好一处，三个配置文件与草稿逐字一致 | 通过 |
| MP02 | 检查入口引用、标签角色映射与领域文档布局 | 三个配置路径全部存在；五个默认角色映射完整；采用 single-context，术语表与 ADR 保持按需创建 | 通过 |
| MP03 | 启用并实际读取 GitHub Issues | PATCH `repos/EnjuYeung/CF-Server-Monitor` 后 GET 返回 `has_issues: true`；`gh issue list --repo EnjuYeung/CF-Server-Monitor --state open --limit 1 --json number` 退出 0 | 通过 |
| MP04 | 补建标签后实际查询，并与原有标签逐项比较 | 新增 `needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`，沿用 `wontfix`；原有十个标签的名称、颜色、说明全部保留 | 通过 |
| MP05 | 对最终六个改动文件检查格式与范围 | 文件内容及新增配置无行尾空白；暂存后执行 `git diff --cached --check`，只包含 AGENTS.md、三个配置文件及本报告、changelog.md | 通过 |

本轮是文档与仓库协作配置，未修改业务源码、依赖、Agent 产物或部署配置，未重新运行 npm 安装、应用构建或业务验收。原始配置核验回执保存在本次临时草稿目录，未纳入 Git；未创建测试 Issue 或修改现有 Issue。

## Archify 项目架构图验证（2026-10-08）

本轮交付为架构文档图，类型 `architecture`。产物目录 `.archify/architecture-server-monitor-20261008-190825/`，其中 `candidate.json` 为规格，`server-monitor.html` 为独立交互式 HTML；支持节点/路径查看、明暗切换及导出。未修改业务代码、安装/更新/分发实现或部署配置，因此本轮未运行 `npm ci`、GeoIP 下载、应用构建、`test:all`、`test:acceptance` 或 `test:agent-deployment`，不将图表校验当作应用验收。

测试前复用已安装的 Chromium `/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`，使用本地文件验证，不启动或访问生产主控。当前工作区有既有未提交改动，隔离源码快照固定为 `2fc4ad477ddfbe019c151038184f3c4dab2e9947`；33 个文件与原工作区逐字节核对，来源保存在 `source-provenance.json`，不引用未经验证的上游行号。原仓库 HEAD、分支和索引没有改动。

| 编号 | 用户功能、实际操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| AR01 | 架构与当前源码对应，核对部署入口、协议、存储及服务职责 | `finalize --repo-root .../source-snapshot --quality showcase`：24 处引用、固定快照、本地链接验证成功；33 个源码文件与快照提交内容相同 | 通过 |
| AR02 | 独立 HTML 可交付，节点、路由、标签与边界布局有效 | `finalize` 的 validate、deliver、严格 check 均 pass；showcase 9/9、0 errors、0 warnings，交叉、模糊通道、箭头及标签冲突为 0。`server-monitor.finalize-summary.json`、`server-monitor.finalize.json`、`server-monitor.delivery.json` | 通过 |
| AR03 | 浏览器能实际显示，桌面视口不溢出、文字可读、主题和查看器控件正常 | 同一 `finalize` 的 browser-check 为 pass；浅色 1440×900、1600×1000、1920×1080、2048×1320，深色两端视口均通过；1440 下最小投影文字约 7.57px。`server-monitor.browser-check.json` | 通过 |
| AR04 | 人工复核截图中的中文、布局、连线与主题，预期无裁切或遮挡 | `visual-check --require-provenance --summary` 通过；实际读取 1440×900 和 2048×1320 的明暗四张 PNG，中文正常、全部节点及连线可见，主控边界清楚、无标签重叠。人工 `visual_review: passed`，布局修正 0 轮。`visual-check/server-monitor.visual-check.json` 和同目录联系页/PNG | 通过 |

实际命令（在项目根目录，先 finalize 再 visual-check）：

```bash
ARCHIFY_CHROME=/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome node /root/.agents/skills/archify/bin/archify.mjs finalize architecture .archify/architecture-server-monitor-20261008-190825/candidate.json .archify/architecture-server-monitor-20261008-190825/server-monitor.html --repo-root .archify/architecture-server-monitor-20261008-190825/source-snapshot --quality showcase --json
ARCHIFY_CHROME=/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome node /root/.agents/skills/archify/bin/archify.mjs visual-check .archify/architecture-server-monitor-20261008-190825/server-monitor.html --out-dir .archify/architecture-server-monitor-20261008-190825/visual-check --summary --require-provenance
```

最终规格 SHA-256：`0bd16312399f566b39b329859e1c3c984eaf834fddbaa8b4b3c3c64a93f7758f`；HTML SHA-256：`4a88a3690ffa54cdf4f4f0cc76116f22113b2f89d4a04f3f8e1e5f06d35da594`。早期校验发现隔离快照缺 origin 和一处引用超出文件末行，均已修正；首次浏览器发现未自动定位 Chromium，指定已安装路径后完整重跑通过。截图成功和人工视觉复核分别记录，没有将机器截图结果直接作为人工通过结论。产物为本地生成文件，不提交源码快照或测试截图。

## 家庭 OpenWrt 路由器 Agent 升级（2026-10-08）

按用户本次明确授权，仅通过 SSH 别名 **router** 更新家庭路由器的 Agent。系统为 **ImmortalWrt 24.10.6、Linux x86_64**，原生 procd 服务，主控节点 **ImmortalWRT**；Agent 于 **17:58:43–17:58:44（Asia/Shanghai）** 从 **v1.2.0 升至 v1.3.0**。使用此前生产阶段已完整验收和发布的同一 Linux amd64 程序，SHA-256 为 `9d98e1278f418161be86ec6065d3240b5a5b30bfe874fcf0ff59892ddd7e97e8`。沿用已通过的 Node/Go、主控、原生 Agent 及 11 项隔离部署专项验收；本轮没有业务源码改动或路由器软件包安装。

升级前只读检查架构、磁盘、内存、Agent 进程/配置/服务和网络。保存旧程序、配置、月流量、原 procd 脚本及两个自启动链接，并核对归档内程序/配置/服务 SHA-256。通过 SSH 传送压缩的已验收程序，先校验大小、哈希并实际运行 `version`；同目录原子替换 `/usr/bin/jan-probe`，仅执行原有 `/etc/init.d/jan-probe restart`。保留原服务脚本与全部配置，脚本包含 Agent 检查失败时恢复旧程序的回退；实际升级成功，未触发回退。

| 编号 | 用户功能、实际操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| OR01 | 先确认兼容性、资源及正确节点，保留可回滚副本 | Linux x86_64，原程序及运行进程为 v1.2.0；配置 UUID 匹配主控 ImmortalWRT、无删除意图；overlay 可用约 684 MiB、内存可用约 14.9 GiB。受保护压缩备份 3,131,523 字节，程序、配置、服务内容哈希及启动链接核对通过。`before.json`、`state.json`、备份 `router-agent-before.tar.gz` | 通过 |
| OR02 | 原子更新 Agent，保持原安装和 procd 自启动 | 上传 3,136,429 字节 gzip，解压程序 7,573,666 字节；运行新版 `version` 后替换，仅重启 Agent；安装与运行进程 SHA-256 均为已验收值，procd 实例 running，PID 19556。配置全文、325 字节原服务脚本及两个自启动链接完全一致，AUTO_UPDATE 保持 1。`upgrade.json`、`after.json`、`verification.json` | 通过 |
| OR03 | 家庭网络配置、接口、路由、防火墙和关键服务保持 | `/etc/config/network`、`dhcp`、`firewall`、`openclash`、`dropbear` 共 5 项内容 SHA-256 完全相同；LAN/loopback/modem/WAN 接口状态及地址保持，IPv4/IPv6 默认路由和 IPv4 策略规则相同，防火墙结构哈希相同，boot ID 未变。procd、ubusd、netifd、dnsmasq、odhcpd、rpcd、pppd、clash PID 均保持，SSH 主守护进程仍在。`before.json`、`after.json`、`verification.json` | 通过 |
| OR04 | 升级后 DNS 和外网仍可用，Agent 正常上报且月流量保留 | 升级前后均实际执行本机 DNS 查询、HTTPS 健康请求和 1.1.1.1 ping，全部通过；18:00:44 核查主控已收到安装完成后的 v1.3.0 新报告，距检查 57 秒。流量 PERIOD_START 相同，RX/TX 周期计数均不下降；Agent RSS 14,080 KiB、9 线程。`verification.json`、`agent-resources.txt` | 通过 |
| OR05 | 清理本轮临时程序，保存私密回滚与执行记录 | 原程序、配置、流量、服务和启动链接备份及重启日志归档保留在主控受保护目录；路由器 `/tmp/jan-router-agent-v130-*` 和 `/usr/bin/.jan-probe-router-*` 本轮临时文件为 0，Agent 服务仍正常；清理首次失败备份产生的空目录。`cleanup.json` | 通过 |

备份目录：`/opt/1panel/apps/jan_monitor/backups/router-agent-20261008T095500Z/`，目录 0700、文件 0600。证据目录：`output/test-results/router-agent-20261008/`，Git 忽略；未提交密钥、设备配置或测试产物。原程序 SHA-256 为 `4fdbe75c8e3053cd7e6a78e4ee34962355069b919ac29fe2921353b725ec2c46`。

首次备份 SSH 传输中断；重连核对 boot ID、网络关键 PID 和 Agent 版本保持后，重新传输并校验成功。首次上传准备因本地内存输入对象不支持子进程 stdin 而失败，改用字节输入后完成；两次均发生在程序替换之前。防火墙比较使用 `nft -s -t list ruleset` 排除包计数及动态集合元素，接口/IPv6 路由比较排除自然递减的有效期。验证范围为路由器接口、关键服务和规则状态，以及本机 DNS、外网 HTTPS/ICMP；未从家庭终端发起端到端访问测试。没有修改或重启网络、DNS、代理和防火墙服务，也没有重启路由器。

## 自动卸载功能生产部署与 11 台 VPS Agent 升级（2026-10-08）

按用户授权先部署生产主控，再更新 SSH 配置中的 VPS，排除 **router、unraid**。主控于 **17:26:24（Asia/Shanghai）** 启动新版本，访问地址 https://jm.zedy.cc；生产镜像 `server-monitor:local` 与已通过下节完整回归、验收和真实 systemd 卸载测试的候选完全一致，ID 为 **`sha256:862f09e0c4dac25ba496b9c5455269690dcff8a884028de42d493b600375c7a5`**，发布标签 `server-monitor:remote-uninstall-20261008`。原生 Agent 最新版本为 **v1.3.0**。

SSH 升级于 **17:29:58–17:33:17** 完成，11 台均从 v1.2.1 升至 v1.3.0，实际平台为 Linux amd64。全部使用严格 SSH 主机密钥校验；Evoxt 本次已有信任记录正常，未改动 SSH 配置或信任记录。程序经 SSH 传送、校验 SHA-256 后，运行原生 `install` 沿用已有配置；ix-entry 传输约 3 分钟，校验完成后才安装。amd64 程序 SHA-256：`9d98e1278f418161be86ec6065d3240b5a5b30bfe874fcf0ff59892ddd7e97e8`。

| 编号 | 用户功能、实际操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| RP01 | 将已完整验收的程序发布生产，确认镜像与工作区一致 | 镜像 Node 24.21.0；逐文件核对源码、前端、入口及 Agent 产物共 432 个文件，差异 0，manifest 仅 Linux amd64/arm64。`candidate-files.json` | 通过 |
| RP02 | 发布前保留生产数据和回滚版本 | 使用 Node SQLite 在线 backup 得到一致快照，integrity=ok，17 节点、5 项设置、185,396 条历史；备份生产环境、容器元数据、Compose、34 个既有 Agent 归档文件和地区库，保留旧镜像回滚标签。`state.json`、受保护备份中的 `database-before.json`、`files-before.json` | 通过 |
| RP03 | 新镜像先在生产数据副本上实际启动，验证迁移和文件保留 | 独立容器 `--network none`、关闭调度；健康、首页、后台入口、配置、版本和 manifest 接口均 200；节点/设置内容哈希一致，固定范围 184,373 条历史内容哈希一致，原 35 个归档/地区库文件未变，新删除意图表为空，新版本归档增加 4 个文件。`production-copy-result.json`、`copy-database.json` | 通过 |
| RP04 | 生产替换容器，沿用端口、环境、数据和网络，节点恢复上报 | 使用既有 Compose、项目与生产 `.env` 执行 `up -d --no-build monitor`；环境、端口、挂载、网络、重启策略完全一致。17:36:00 复查 healthy、重启 0、integrity=ok，17/17 节点收到近期上报；节点/设置及固定范围历史哈希保持，历史为 185,439 条，原文件不变，Agent 归档合计 38 个文件。`deployment-result.json`、`database-after-deploy.json`、`database-final.json`、`final-result.json` | 通过 |
| RP05 | 公网 HTTPS 能访问新版本并实际下载两个架构 | 健康、首页、配置、latest、目录和 manifest 均 200，latest=v1.3.0；两架构程序实际下载，大小及 SHA-256 与已验收本地产物一致，历史版本仍在目录，仅公开 Linux。`public-verification.json` | 通过 |
| RP06 | 只更新授权 SSH 范围，核对节点身份后执行 | 13 个配置别名中排除 router/unraid，剩余 11 台全部严格校验登录、匹配既有 SERVER_ID 和主控地址，无待执行删除意图；上传程序先验大小及 SHA-256，再运行原生安装器。`ssh-preflight.json`、`ssh-upgrade.json` | 通过 |
| RP07 | 升级后程序运行、原配置和月流量保留，主控收到新版报告 | 安装后及最终再次 SSH 核对 11 台：程序与运行进程哈希一致，jan-probe.service active，配置全文 SHA-256 相同、权限 0600，AUTO_UPDATE=1 保持，PERIOD_START 相同，RX/TX 周期计数不下降。17:36:00 主控 11/11 版本 v1.3.0，均有安装完成后的新上报，距检查 8–38 秒。各节点 `*-before.json`、`*-after.json`、`*-final.json`、`final-result.json` | 通过 |
| RP08 | 真实生产看板在桌面/手机显示节点并接收实时消息 | Chromium 实际打开 HTTPS 看板，1440/375px 各显示 17 个节点，页面异常、HTTP 错误和横向溢出均 0；WSS 收到 hello/subscribed/batchUpdate。已查看桌面截图。`browser.json`、`production-dashboard-*.png` | 通过 |
| RP09 | 完成升级后清理临时程序，保留私密回滚副本 | 11 台本轮 `/tmp/jan-agent-upgrade-v130-*` 均清理，服务仍 active；原配置、流量、服务单元和安装日志归档到本地受保护备份，另保留经哈希核对的旧程序。生产副本容器、复制数据和临时环境文件清理完成。`ssh-cleanup.json`、各节点 `*-cleanup.json` | 通过 |

| SSH 别名 | 主控节点 | 运行程序 / 主控上报版本 | 状态 |
| --- | --- | --- | --- |
| bytevirt | ByteVirt | v1.3.0 / v1.3.0 | 通过 |
| aaitr | AaITR-LAX | v1.3.0 / v1.3.0 | 通过 |
| lightlayer | Lightlayer-HKG | v1.3.0 / v1.3.0 | 通过 |
| netcup | netcup-VIE | v1.3.0 / v1.3.0 | 通过 |
| ix-entry | QCloud-CAN | v1.3.0 / v1.3.0 | 通过 |
| attvps | ATTVPS-LAX | v1.3.0 / v1.3.0 | 通过 |
| dmit-lax | DMIT-LAX | v1.3.0 / v1.3.0 | 通过 |
| dmit-tyo | DMIT-TYO | v1.3.0 / v1.3.0 | 通过 |
| evoxt | Evoxt-KUL | v1.3.0 / v1.3.0 | 通过 |
| moe | Moe-LON | v1.3.0 / v1.3.0 | 通过 |
| xhosts | xHosts-LHR | v1.3.0 / v1.3.0 | 通过 |

发布备份：`/opt/1panel/apps/jan_monitor/backups/remote-uninstall-20261008T092301Z/`，目录 0700，环境、容器元数据、SQLite 及节点配置归档 0600；回滚镜像标签 `server-monitor:rollback-remote-uninstall-20261008t092301z`。证据目录：`output/test-results/remote-uninstall-production-20261008/`，Git 忽略。保留期历史比较固定在备份 ID 范围，并给 7 天过期边界留出 1 小时，避免正常滚动清理造成假失败。

首次生产副本 HTTP 检查因夹具使用错误的版本目录路径、未归一化后台路径而失败，修正 `smoke.py` 后通过，生产切换在最终检查通过后进行。汇总时修正了归档计数表达式，只统计文件，不将版本目录计入；实际为 34 个既有文件加 4 个新版文件。自动卸载执行证据沿用下节隔离 HTTP/WSS 及真实 systemd 的 11 项部署专项验收；本轮生产保持全部 17 个节点，仅验证发布、升级与恢复上报。未改动业务源码或其他 VPS 的更新策略。

## 后台删除节点自动卸载 Agent（2026-10-08）

本节记录主控删除指令和原生 Agent **v1.3.0** 的开发、构建及隔离验收；后续生产部署与 11 台 VPS 升级见上方记录。Agent 需升级至 v1.3.0 才能自动卸载。在线 WS 在删除时执行，HTTP 在下次上报执行，离线 Agent 重连后执行。普通 404、网络故障和无效签名不会触发卸载。

环境：Node.js **24.21.0**、Go **1.26.8**、Docker **29.8.2**，Chromium **153.0.8010.12**。开发前依次执行 `npm ci`、`npm run geoip:download`、`npm run build`，保留修改前真实 v1.2.1 程序用于旧版兼容和实际升级。使用全新临时 SQLite、专用测试凭据、隔离 internal bridge、TLS 反代和独立 Agent 容器；systemd 环境预建测试镜像，私有 cgroup namespace，不挂载宿主系统目录或 cgroup。仅测试容器安装/卸载服务。

| 编号 | 用户功能、实际操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| RU01 | 安装依赖和 IP 库后完整构建，保留两个 Linux 目标 | 修改前 v1.2.1 和修改后 v1.3.0 的完整构建退出 0；候选 Docker 构建退出 0，镜像 manifest 与最终本地 manifest 逐字节一致，仅 Linux amd64/arm64。`npm-ci.log`、`baseline-geoip.log`、`baseline-build.log`、`build.log`、`final-agent-build.log`、`docker-build.log`、`image-agent-manifest.json` | 通过 |
| RU02 | GUI 单台/批量删除后在线发送，离线及重启后补发；恢复和失败输入正确 | RM01–RM05 真实 HTTP、WS、SQLite 全通过：已认证 WS 关闭前收到签名命令，HTTP 下次请求收到同一命令，主控重建不丢失；错误密钥、未知/缺失 UUID 无卸载命令，同 UUID 恢复取消意图，批量失败整批回滚，未登录删除无效。`removal-controller.log`、`test-all.log` | 通过 |
| RU03 | Agent 校验卸载意图并停止，普通错误不误删，失败缓存不持续增长 | Go 使用 Node 生成的固定 HMAC 向量，实连 HTTP/WS 验证取消和本地意图，校验错误签名/UUID/时间/命令 ID 拒绝，检查文件 0600、重配置意图失效及自定义前台配置隔离；450 次实际采样后仅 300 个样本，请求低于 2 MiB。Go vet/test 及额外 `go test -race ./internal/cfprobe` 退出 0。`test-all.log`、`final-agent-tests.log`、`go-race.log` | 通过 |
| RU04 | 完整回归及真实主控、原生 Agent 仍可使用 | `npm run test:all` 退出 0：124/124 Node、Agent 配置、Go vet/test 通过；`npm run test:acceptance` 退出 0：19/19 主控及 7/7 原生验收通过，新增 NA07 确认删除后真实 HTTP Agent 退出，重启直接停止，不触碰宿主服务。`test-all.log`、`acceptance.log`、`controller-acceptance.json`、`native-acceptance.json` | 通过 |
| RU05 | 在 TLS 容器实际安装、升级、WSS 删除、HTTP 离线删除、重建及旧版回退 | `npm run test:agent-deployment` 最终退出 0，ND01–ND09 全部通过；修改前真实 v1.2.1 自更新到 v1.3.0；ND07 WSS 删除后程序、配置、进程及临时卸载器消失；ND08 暂停纯 HTTP Agent、批量删除并重建主控，恢复后自行卸载；ND09 真旧版仍运行，手动卸载回退可用。`agent-deployment.log`、`deployment.json` | 通过 |
| RU06 | 真正 systemd 系统服务和 cfsm 用户服务可自行卸载 | 启用 `AGENT_SYSTEMD_TEST_IMAGE` 后，ND10–ND11 实际在 systemd PID 1 容器安装、上报并删除，独立卸载单元完成清理；系统/用户服务文件、程序和配置移除，未再运行 Agent。与 ND01–ND09 合计 11/11。`agent-deployment.log`、`deployment.json` | 通过 |
| RU07 | 用户从浏览器确认删除，桌面/手机及三语言提示可用 | Chromium 实际登录隔离 HTTPS 后台，中/英/日文 × 1440/375px 共 6 组检查自动卸载提示、旧版手动命令、弹窗宽度和确认按钮；最后实际点击删除，随后检查容器程序/配置和 Agent 进程已清除。页面异常 0，已查看中文桌面和日文手机截图。`browser.json`、`browser.log`、`delete-*.png` | 通过 |

部署专项命令使用修改前真实 `AGENT_LEGACY_DIST=.../baseline-agent/v1.2.1` 和预建 `AGENT_SYSTEMD_TEST_IMAGE=server-monitor:remote-uninstall-systemd-test`。候选镜像 `server-monitor:agent-native`，ID **`sha256:862f09e0c4dac25ba496b9c5455269690dcff8a884028de42d493b600375c7a5`**。证据目录：`output/test-results/remote-uninstall-20261008/`；构建产物、日志和隔离数据库由 Git 忽略，未提交。

初始额外 race 检查发现原有每日更新测试的共享计数未同步，已修正测试同步并重跑 Go vet/test 和 race 检查通过；日志保留为 `go-race-initial.log`。初次 systemd 验收因服务不继承 `SSL_CERT_FILE` 而无法信任测试自签名证书，第二次准备证书时遇到 systemd 启动清理 `/tmp` 的时序；改为用例开始前等待 systemd 启动完成并安装测试 CA，重跑全部 11 项通过。初始失败保留于 `initial-agent-deployment.log`、`initial-deployment.json` 和 `preparation-ca-initial.log`。没有改产品逻辑绕过 TLS 校验。

本轮创建的测试容器、隔离网络和临时安装/systemd 镜像已清理，记录在 `cleanup.json`；保留候选镜像和 Git 忽略的证据目录供核验。

实际运行平台为 Linux amd64；arm64 完成交叉编译、ELF/下载与 SHA-256 检查，未在 arm64 真机执行。OpenRC/procd/Synology 的独立卸载进程路径未做实机验收，systemd-run 不可用时的单元文件回退未做实际验收。删除指令只针对本版本主控记录的新删除事件；升级前已删除且没有删除意图记录的节点仍需手动清理。用户自定义前台运行只停止，不自动删除宿主服务。

## SSH 批量升级 9 台生产 Agent（2026-10-08）

按用户明确授权更新本机 SSH 配置中的节点，排除 `router`、`dmit-lax`、`unraid`。`evoxt` 首次连接因 SSH 主机密钥与既有记录不一致而被严格校验拒绝；用户随后明确选择保留 Evoxt，本轮没有登录或手动升级该节点。最终更新范围为下表 9 台，全部从 v1.2.0 升至 **v1.2.1**。

使用当前已验收的 Linux amd64 程序，SHA-256 为 `92d7d7f63f7fd16d5f821169374998a403e3d4c0d002c45796f7886d0c4a486e`。8 台通过重启原生服务触发已有自动更新，16:16:19–16:16:34（Asia/Shanghai）完成安装；ix-entry 的公网下载超时后，通过 SSH 传送同一已校验程序，16:27:29 使用原生安装器沿用已有配置完成升级。

| SSH 别名 | 主控节点 | 实际升级方式 | 运行程序及主控上报版本 | 状态 |
| --- | --- | --- | --- | --- |
| bytevirt | ByteVirt | 启动检查、自动下载及安装 | v1.2.1 / v1.2.1 | 通过 |
| aaitr | AaITR-LAX | 启动检查、自动下载及安装 | v1.2.1 / v1.2.1 | 通过 |
| lightlayer | Lightlayer-HKG | 启动检查、自动下载及安装 | v1.2.1 / v1.2.1 | 通过 |
| netcup | netcup-VIE | 启动检查、自动下载及安装 | v1.2.1 / v1.2.1 | 通过 |
| ix-entry | QCloud-CAN | SSH 传送、校验及原生安装 | v1.2.1 / v1.2.1 | 通过 |
| attvps | ATTVPS-LAX | 启动检查、自动下载及安装 | v1.2.1 / v1.2.1 | 通过 |
| dmit-tyo | DMIT-TYO | 启动检查、自动下载及安装 | v1.2.1 / v1.2.1 | 通过 |
| moe | Moe-LON | 启动检查、自动下载及安装 | v1.2.1 / v1.2.1 | 通过 |
| xhosts | xHosts-LHR | 启动检查、自动下载及安装 | v1.2.1 / v1.2.1 | 通过 |

| 编号 | 用户功能、实际操作及预期 | 实测证据 | 状态 |
| --- | --- | --- | --- |
| PA01 | SSH 连接目标并核对既有安装，确保升级正确节点 | 9 台均为 Linux x86_64、root 系统服务；读取白名单配置匹配主控 SERVER_ID；旧程序和运行进程 SHA-256 均对应 v1.2.0，本地 AUTO_UPDATE=1 | 通过 |
| PA02 | 重启触发已有自动更新，完成下载、校验、安装及重启 | 8 台执行 `systemctl restart jan-probe.service` 成功；journalctl 记录 target=v1.2.1、systemd-run、60 秒延迟及新版启动；再次启动检查均记录 current version is up to date | 通过 |
| PA03 | ix-entry 自动从公网下载新版，确认实际结果 | `/agent/latest` 返回 v1.2.1，版本目录 HTTP 200；程序下载持续增长至约 6.3 MB，但 16:20:19 日志为 `auto update download failed target=v1.2.1: context deadline exceeded`，未完成安装 | 失败，已用 PA04 完成升级 |
| PA04 | 对下载超时的 ix-entry 通过 SSH 分发同一程序，并沿用现有配置安装 | 本机和传送后的 7,536,802 字节程序 SHA-256 均匹配上述发布校验值；`new.bin install` 退出 0，服务 active/running，程序版本和 `/proc/MainPID/exe` 均为已校验 v1.2.1 | 通过 |
| PA05 | 升级后实际服务可用，配置、自动更新和月流量保留 | 9 台 service 均 active/running；安装文件和运行进程 SHA-256 匹配新版；配置全文哈希与升级前相同，AUTO_UPDATE=1 保留；traffic.dat 的 PERIOD_START 不变、RX_PERIOD/TX_PERIOD 均未减少 | 通过 |
| PA06 | 从主控确认所有目标以新版本恢复认证上报 | 16:29:23 通过 Node SQLite `readOnly:true` 查询，9/9 节点 server_latest 的 agent_version 均为 v1.2.1，认证接收时间为 16:28:23–16:28:40 | 通过 |
| PA07 | 清理本轮 ix-entry 的临时程序与配置副本 | 确认安装文件及运行进程 SHA-256 后删除本轮唯一临时目录，4 个文件、15,074,595 字节；目录不存在，安装后程序仍返回 v1.2.1 | 通过 |

没有修改 Agent、主控业务代码、自动更新策略或远端 SSH 信任记录。使用此前完整构建、回归及隔离安装/更新验收通过的同一 v1.2.1 程序，本轮未重新构建或重跑完整测试套件；本节仅报告上述生产 SSH、服务、程序校验、持久配置/流量及真实上报的实际验证。没有生成本地测试产物或提交密钥，原生日志保留在各机器 journal 中。Evoxt 未经本轮手动更新，但截至 16:29:23 主控也已收到它的 v1.2.1 上报。

## GUI 仍显示 Agent v1.2.0 的只读核查（2026-10-08）

2026-10-08 16:01–16:03（Asia/Shanghai）核查生产版本接口、SQLite 最新上报及同机原生 Agent。主控已提供 v1.2.1，17 台节点仍实际运行并上报 v1.2.0；后台版本列读取节点上报的 `agent_version`。现有自动更新在 Agent 启动时检查，随后每 24 小时检查；主控部署不会主动触发各节点升级。本节仅记录诊断，没有修改业务代码、重启服务或升级生产 Agent。

| 编号 | 核查项、实际操作及预期 | 实测结果 | 状态 |
| --- | --- | --- | --- |
| AV01 | curl 查询主控回环和公网 `/agent/latest`，确认新版已发布 | `http://127.0.0.1:26129/agent/latest`、`https://jm.zedy.cc/agent/latest` 均成功返回 `v1.2.1` | 通过 |
| AV02 | 使用 Node SQLite `readOnly:true` 查询节点最新版本、接收时间和后台更新标记 | 08:01:59 UTC 查询：17/17 节点最新版本均为 `v1.2.0`，认证接收时间均在 08:01:20–08:01:22 UTC，后台 `auto_update` 均为 `1` | 通过 |
| AV03 | 查询同机 systemd 服务、程序版本、白名单配置及更新日志 | `jan-probe.service` 正在运行，`jan-probe version` 返回 v1.2.0；本地 `AUTO_UPDATE=1`。11:22:58 启动检查访问主控失败，日志为 `connect: connection refused`；此后没有新的自动更新检查记录 | 通过 |

同机 Agent 未重启时，按现有 24 小时间隔，下一次检查约为 10 月 9 日 11:23（Asia/Shanghai）。其他节点的本地配置及更新日志未远程核查，后台勾选值不能证明它们安装时已启用本地更新；具体检查时间取决于各节点进程。已启用本地自动更新的 systemd 节点可通过重启 `jan-probe` 触发启动检查，成功下载后按现有 60 秒延迟安装。这是只读诊断，未运行构建、完整回归或隔离部署测试，未将既有验收结果计作本轮通过。

## Linux 双架构 Agent 生产部署及测试、备份数据清理（2026-10-08）

已于 **2026-10-08 15:48:13（Asia/Shanghai）** 开始切换至已验收镜像，15:48:44 完成部署及节点恢复检查；15:55:16 完成用户要求的清理。生产地址：https://jm.zedy.cc。`server-monitor:local` 和发布标签 `server-monitor:linux-only-20261008` 指向 `sha256:6c759939ceb74192beea544eac4189b1bbb3c6d00c7dc0253092c5fa7a1715b6`；内置 Agent 为 **v1.2.1**，仅发布 Linux amd64/arm64。

部署直接使用此前完整构建、118 项 Node 回归、Agent 配置/Go vet/test、19 项主控、6 项原生和 6 项隔离 Docker 验收通过的镜像，没有重新生成未验收的程序。发布前逐文件核对 109 个源码文件、315 个前端资源、入口、package.json、安装脚本和 Agent manifest；与工作区验收版本一致。镜像 npm 安装/裁剪只规范化 package-lock 中 chart.js、picomatch、vite、vue 的 4 个 peer 元数据标记，其余锁定内容完全一致。

| 编号 | 用户功能、实际操作及预期 | 实测结果 | 状态 |
| --- | --- | --- | --- |
| LXP01 | 发布前用生产数据库及归档副本运行候选，确认新版本不破坏既有数据 | SQLite 在线一致性快照 integrity=ok；断网隔离容器的 5 个 HTTP 路由均 200，latest=v1.2.1，公开目录仅 Linux，各历史版本 FreeBSD 下载均 404；17 节点、5 项设置、185,207 条历史及旧归档保持一致 | 通过 |
| LXP02 | 使用原 Compose 环境、卷、端口和网络替换主控，保存配置及历史 | 容器 healthy、重启 0；环境变量逐值一致，端口仍为 127.0.0.1:26129→8080，生产数据卷、网络、init 和 unless-stopped 均保留；节点/设置完整内容哈希一致，历史 185,207→185,213，7 天保留期内缺失 0 | 通过 |
| LXP03 | 历史 Agent 文件继续保留，新版本正确归档，公网仅提供 Linux | 原 30 个归档文件 SHA-256 全部不变，新增 v1.2.1 的 4 个文件，共 34 个；公网 6 个主控/安装/目录路由均 200，latest=v1.2.1，两个新 Linux 程序实际下载后大小和 SHA-256 正确；所有公开历史版本的 FreeBSD amd64/arm64 下载均 404 | 通过 |
| LXP04 | 真实节点重新连接，公网看板、移动布局及登录入口可用 | 17/17 个部署前活跃节点均有切换后认证上报；Chromium 实际显示 17 张卡片，1440px/375px 页面正常且手机无横向溢出，收到 WSS batchUpdate，页面异常 0，桌面/手机截图已查看；后台接受现有用户名/密码并正确要求二步验证 | 通过 |
| LXP05 | 按用户要求删除测试和备份数据，保留生产配置、历史及 Agent 归档 | 删除工作区 output、生产 backups、6 个 /tmp 测试夹具、旧本地 v1.1.1/v1.2.0 构建目录及生产卷中的 2 个遗留 .backup SQLite 辅助文件；共 1,660 个文件、1,319,629,696 字节（约 1.23 GiB）。移除 5 个测试/旧发布/回滚镜像标签；仅保留当前 local 和 linux-only 发布标签 | 通过 |
| LXP06 | 删除后再次确认真实服务与数据完整，测试/备份路径确已消失 | 全部目标路径不存在，生产容器仍 healthy、重启 0；数据库 integrity=ok，17 节点、5 项设置的内容哈希及 34 个归档文件完全一致，历史已增至 185,256；公网健康、节点、最新 Agent 接口继续返回 200 | 通过 |

本轮曾因 package-lock 原始字节哈希与 npm 规范化后的 peer 元数据不同而暂停发布，确认其余锁定内容完全一致后继续；初次公网夹具读取仅登录后可见的版本字段，以及等待二步验证后的列表，均属夹具假设错误，调整为公开版本接口和实际二步验证入口后通过。未修改凭据、二步验证配置或消耗验证码/恢复码。生产后台验证到既有二步验证入口；登录后的安装/卸载交互由此前隔离环境的 36 组浏览器检查及生产资源一致性验证覆盖。

原始日志、截图、隔离数据库及临时生产快照已按用户明确要求删除，验证汇总保留于本文；历史章节中的 output 证据路径保留为当时执行记录，相关文件本轮已清理。生产 `.env`、SQLite/WAL、GeoIP 和 Agent 历史归档保持在原卷中，Node/Go 开发工具链及当前构建产物保留。没有手动安装或强制升级生产机器上的 Agent；已启用本地自动更新的节点仍按既有启动/24 小时检查机制获取新版。

## Agent 仅保留 Linux：FreeBSD 代码与分发清理（2026-10-08）

Agent 独立版本从 **v1.2.0** 递增为 **v1.2.1**，默认构建和镜像只携带 Linux amd64/arm64。删除 FreeBSD 专用采集文件、安装识别分支、校验命令回退和后台选项，公开接口不再暴露任何版本的 FreeBSD 程序。历史归档读取兼容保留，避免移除平台导致同版本 Linux 历史程序也不可用；归档文件不自动删除。原始上游说明和既有历史报告保留原文。

使用独立工具目录中的 Node.js **24.21.0**、Go **1.26.8**、Docker **29.8.2** 和 Chromium **153.0.8010.12**。开发前依次运行 `npm ci --no-audit --no-fund`、`npm run geoip:download`、`npm run build`，保留修改前实际构建的 v1.2.0 四平台产物供归档升级验证；GeoIP 为 2026-10 库。测试预建全新 SQLite、专用夹具凭据、随机回环端口或独立 Docker bridge，关闭浏览器和归档升级夹具的调度；未使用生产数据。

| 编号 | 用户功能、操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| LX01 | 准备依赖/IP 库后完整构建，镜像仅携带两个 Linux 程序 | 修改前、后完整构建及 `docker build --progress=plain -t server-monitor:agent-native .` 均退出 0；镜像 `/app/agent-dist/` 仅 `install.sh`、`v1.2.1`，版本目录仅两个程序及 manifest/checksums，本地与镜像 manifest 完全一致，运行时无 Go 编译器。`npm-ci.log`、`baseline-geoip.log`、`baseline-build.log`、`build.log`、`docker-build.log`、`archive-upgrade.json` | 通过 |
| LX02 | 拒绝 FreeBSD 构建/安装，Linux 两架构及其 uname 别名正常 | 实际执行 `-targets freebsd/amd64`、`freebsd/arm64`、混合 `linux/amd64,freebsd/arm64` 均退出 1、报告 unsupported target，未创建输出目录。Shell 平台用例验证 Linux x86_64/amd64、aarch64/arm64，FreeBSD amd64/arm64 等不支持目标在任何下载前失败。`reject-targets.json`、`test-all.log` | 通过 |
| LX03 | 当前和历史 Linux 可下载，FreeBSD 不出现在目录且不可下载 | 回归实际检查两个 64 位 Linux ELF 的 CPU/OS、大小、SHA-256、HTTP 和归档；混合平台旧归档完整保留并只公开 Linux，只有 FreeBSD 的版本不参与 latest/目录且文件、manifest/checksums 均返回 404。`test-all.log` | 通过 |
| LX04 | 实际后台安装/卸载只提供 Linux，三语言桌面和手机复制可用 | Chromium 实际登录隔离 HTTPS 主控，在中/英/日文、1440/375px 下检查选项恰为 Linux systemd、其他 Linux；逐一切换当前用户/专用用户/其他 Linux 的安装和卸载方式，共 36 组剪贴板逐字比较通过，安装复制后关闭弹窗，提示无 FreeBSD，页面异常 0。`browser.json`、`browser.log`、`install-mobile.png`（已查看） | 通过 |
| LX05 | 完整回归及真实主控、Agent 核心流程可用 | `npm run test:all` 退出 0：118/118 Node、Agent 配置、Go vet/test 全部通过；`npm run test:acceptance` 退出 0：19/19 主控、6/6 原生验收，覆盖下载、HTTP/WS、配置下发、配置/流量/历史保留及坏下载拒绝。`test-all.log`、`acceptance.log`、`controller-acceptance.json`、`native-acceptance.json` | 通过 |
| LX06 | 在隔离容器中实际安装、更新、重建、关闭更新及卸载 | `npm run test:agent-deployment` 退出 0，ND01–ND06 全部通过；TLS/WSS 实连，v1.0.99 测试程序实际自更新到 v1.2.1，服务仍为 jan-probe，配置/月流量保留；主控重建后旧版本/数据保留且探针重新上报，卸载后程序和配置消失。目录仅两个 Linux 目标，FreeBSD 下载为 404。`agent-deployment.log`、`deployment.json`、`linux-install.log`、`linux-update.log`、`linux-uninstall.log` | 通过 |
| LX07 | 已有 v1.2.0 四平台归档升级和再次重建，历史完整且 Linux 可继续安装 | 在全新隔离数据卷预置修改前实际构建的 v1.2.0，然后启动和重建新镜像；两轮均健康，latest=v1.2.1，公开两个版本各仅 Linux 两目标；每轮四个 Linux 文件实际下载校验通过，旧/新版本 FreeBSD GET/HEAD 均 404，旧归档 6 个文件 SHA-256 完全不变，新版本正确归档。`archive-upgrade.json` | 通过 |

首次浏览器夹具使用 HTTP，实际复制被页面既有 HTTPS 要求阻止；改用预建隔离 HTTPS 反代后通过，失败证据保留在 `browser-initial-http.*`。首次归档升级夹具将端口直接发布到 Docker internal 网络，Docker 未提供公开端口；调整为独立 bridge 加回环发布后通过，初始记录保留在 `archive-upgrade-initial-internal.*`。两次均为测试环境问题，没有修改产品逻辑来绕过。

开发阶段证据目录：`output/test-results/linux-only-agent-20261008/`（Git 忽略，后续按用户要求删除）。测试镜像 ID：`sha256:6c759939ceb74192beea544eac4189b1bbb3c6d00c7dc0253092c5fa7a1715b6`。本轮创建的容器和网络已清理；后续生产部署与清理见本文顶部记录。原生实际运行平台为 Linux amd64，arm64 完成交叉编译、ELF 检查和下载校验，未在 arm64 真机执行；Docker 使用后台进程模式和合成 v1.0.99 旧版本，不将本轮记为真实 systemd 用户服务或旧 cf-probe 服务迁移验收。

## 国家地区旗帜恢复与生产部署（2026-10-08）

已于 **2026-10-08 15:20:09（Asia/Shanghai）** 部署至 https://jm.zedy.cc。生产镜像 `server-monitor:local` 对应候选 `server-monitor:region-flags-20261008`，镜像 ID 为 `sha256:cee2dbb7aa362dfed5f70e91b3987c05aa0b8324d4a1278edaee8448a8336ffe`。仅移除地区旗帜强制映射、恢复台湾 SVG，并同步修正 Scriptable 脚本；GeoIP 更新机制和地区数据未改动。

开发环境使用独立工具目录中的 Node.js **24.21.0**、Go **1.26.8** 和缓存的 Chromium **153.0.8010.12**。修改前依次完成 `npm ci --no-audit --no-fund`、`npm run geoip:download` 和 `npm run build`；宿主默认 Node 26 的首次安装产生引擎提示，随后以 Node 24 重做安装。测试预先准备全新临时 SQLite、专用测试凭据和随机回环端口；浏览器和容器夹具关闭调度，不使用生产数据。

| 编号 | 用户功能、实际操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| FL01 | 安装依赖、准备 IP 库、完整构建后可正常启动 | Node 24 安装和修改前/后完整构建退出 0；生成 Linux/FreeBSD amd64/arm64 四类 Agent 及前端；GeoIP 为 2026-10 库。`npm-ci-node24.log`、`baseline-geoip.log`、`baseline-build.log`、`build.log` | 通过 |
| FL02 | TW/HK/MO/CN/US 分别显示对应旗帜 | 实际创建 5 台隔离节点并上报，检查条形/环形/列表三种首页视图、地区筛选、详情、后台，图片路径分别为 tw/hk/mo/cn/us，图片加载成功；375px 无横向溢出，桌面和手机截图已查看。修改前 TW 加载 cn，修改后加载 tw。`baseline-browser.json`、`fixed-browser.json`、`fixed-desktop.png`、`fixed-mobile.png` | 通过 |
| FL03 | 原始台湾 SVG 与小组件地区映射恢复 | HTTP `/flags/tw.svg` 与上游 v7.5.0 及最初导入文件一致，SHA-256 `931757f06b9ee751fd1a0cc8dd7cf862e21fdcaf894d10ed7bcc68dabcca59ad`；实际执行 Scriptable 源码中的映射函数，TW/HK/MO/CN/US、带空格小写、空值和 XX 共 8 项通过。连同 FL02 共 39 项检查，页面异常 0。`fixed-browser.json` | 通过；未使用实体 iOS 设备 |
| FL04 | 完整回归与实际主控/Agent 验收 | `npm run test:all` 退出 0，118/118 Node 测试、Agent 配置及 Go vet/test 全部通过；`npm run test:acceptance` 退出 0，19/19 主控及 6/6 原生 Agent 验收通过。`test-all.log`、`acceptance.log` | 通过 |
| FL05 | 部署已测试产物且保留数据和运行参数 | 候选镜像 315 个资源哈希与已测试 dist 一致，Agent manifest 与原生产完全一致；断网隔离容器检查 5 个 HTTP 路由和 5 张旗帜成功。部署前在线 SQLite 备份 integrity=ok；部署后 17 台节点、5 项设置的完整内容哈希一致，历史 184,689→184,703，Agent 归档逐文件一致；端口、挂载、网络、环境变量值保留，容器 healthy、重启 0。`docker-build.log`、`deployment.json` | 通过 |
| FL06 | 公网用户可正常看到旗帜且节点继续上报 | 首页、配置、节点接口及健康检查均 200；公网 5 张旗帜与源码哈希一致，首页 TW/HK/CN/US 及台湾详情图片实际加载成功，375px 无横向溢出，收到真实 WSS batchUpdate，页面异常 0；17/17 节点均有部署后新上报。台湾节点截图已查看。`production.json`、`production-taiwan.png` | 通过 |

首次浏览器检查在连续改变详情 hash 路由时读取了上一节点内容；夹具改为每个详情页从空白页独立进入后通过，初始记录保留在 `baseline-browser-initial.*`、`baseline-browser-navigation.*`。首次候选构建受根目录 `.dockerignore` 排除 dist 影响，改用只含已测试 dist 和对应源码的独立构建上下文后通过。首次上线按原顺序比较环境变量数组未通过，触发自动回滚；改为排序后逐值核对重新上线通过，初始失败记录保留在 `deployment-initial.json`、`release-initial.log`。没有将失败记录覆盖为通过。

证据目录：`output/test-results/region-flags-20261008/`，由 Git 忽略。生产备份：`/opt/1panel/apps/jan_monitor/backups/region-flags-20261008T072001Z`（目录 0700、环境文件和 SQLite 备份 0600）；回滚镜像：`server-monitor:rollback-region-flags-20261008t072001z`。部署记录也保留在备份的 `verification/deployment.json`。本次没有改动 Agent 安装、更新或分发，无需运行 `test:agent-deployment` 专项；实体 iOS 小组件需由用户重新复制更新后的脚本验证。

## CI 探针测试矩阵仅保留 Linux（2026-10-05）

提交 `d172116` 推送至 `codex/self-hosted-native-agent` 后，GitHub Actions 运行 [37262134043](https://github.com/EnjuYeung/CF-Server-Monitor/actions/runs/37262134043)。

| 编号 | 用户功能、操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| CI01 | 推送后整次 CI 通过，不再被 macOS 专属用例拖累 | 运行结论 success：`test`（构建、`test:all`、`test:acceptance`）97s、`agent-platforms (ubuntu-latest)` 17s、`docker`（amd64/arm64）167s，均 success；矩阵只剩 ubuntu-latest，无取消任务 | 通过 |
| CI02 | 对比修改前 | 运行 37261343273（`e29c726`）：`test`、`docker`、ubuntu 通过，macOS 因 `TestRemoveInstalledFilesRemovesDarwinLegacyUserLog`、`TestUserUninstallResidualsIncludesDarwinLegacyUserLog` 失败，Windows 被取消，整次 failure；9/30 运行 36705792708 相同 | 已记录 |

## 主控容器改名部署（2026-10-05）

**2026-10-05 11:46:56（Asia/Shanghai）** 以容器名 `jan-monitor` 重新部署，镜像沿用 `sha256:b06c264d…`（本日字体本地化版本），仅 Compose 增加 `container_name`。

| 编号 | 用户功能、操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| CN01 | 名称默认 `jan-monitor`，同机测试项目可覆盖 | 生产 `.env` 下 `docker compose config` 渲染 `container_name: jan-monitor`；`CONTAINER_NAME=monitor-test` 时渲染为 `monitor-test`；仓库、宿主 cron 和配置中无旧容器名引用 | 通过 |
| CN02 | 部署前备份数据 | `node:sqlite` 在线备份 23,006 页，integrity=ok，17 节点、5 项设置、204,765 条历史；`.env` 同时备份，目录 0700、文件 0600 | 通过 |
| CN03 | 替换容器且保留运行参数 | 旧容器移除，仅 `jan-monitor` 运行；healthy、重启 0、`unless-stopped`、init、`127.0.0.1:26129->8080`、`/opt/1panel/apps/jan_monitor/data`、网络 `jan_monitor_monitor` 均与原容器一致 | 通过 |
| CN04 | 公网访问和数据持续 | 公网 `/`、`/api/config`、`/api/servers`、`/healthz` 均 200；17/17 节点重启后重新上报，历史继续写入，反代无新错误；浏览器首页 `/api/config` 207ms 开始、无 Google 请求 | 通过 |
| CN05 | 首页实时推送 | 公网 WSS 携带 17 个节点 ID 订阅，548ms 收到首个 `batchUpdate`，10 秒内 23 批、17 节点均更新。首次用空 `ids` 订阅无推送，系 `_shouldDeliver` 既有规则，非本次故障 | 通过 |

## 首页字体本地化与生产部署（2026-10-05）

已于 **2026-10-05 11:35:43（Asia/Shanghai）** 部署至 https://jm.zedy.cc，镜像 `server-monitor:local` = `sha256:b06c264da36060f778f8996f948d17a216c527262b9cbe9f531ae4155811a4a9`；回滚镜像 `server-monitor:rollback-20261005-before-local-fonts`（`sha256:2d9f4c6e…`，即部署前生产镜像）。仅改前端样式、字体资源和 Vite 配置，不改数据库、接口或 Agent。环境：宿主 Node.js 26.7.0（构建、单元及主控验收），镜像 Node.js 24；宿主无 Go，未运行 `test:agent-native` 和原生 Agent 验收，本次 Agent 代码未改动。

| 编号 | 用户功能、操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| FONT01 | 复现：在 `fonts.googleapis.com` 不可达的网络中打开首页 | 部署前浏览器资源计时：主 JS/CSS 在 0.4s 内下载完成，Google Fonts 请求 20,024ms 后失败（status 0），`/api/config` 在 **20,655ms** 才开始；本机经代理请求该域名 3 次均在约 10s 后 TLS 失败。反代日志中用户请求 `/` 后约 20s 才出现 `/api/config`。主控直连 `/api/servers` 约 4ms，经反代约 17ms | 已复现 |
| FONT02 | 字体随源码本地托管，样式不再引用远程样式表 | 新增 `test/frontend-fonts.test.js` 3 项：源码 CSS 无远程 `@import`/Google Fonts，6 个 woff2 文件存在且魔数为 `wOF2`，构建产物 6 个字体均为 `/static/` 文件且无 `data:`。旧 `main.css` 下前 2 项失败；内联字体的构建下第 3 项失败；修改后 3/3 通过 | 通过 |
| FONT03 | 完整回归 | `npm test` **118/118** 通过；`node test/acceptance.js` **19/19** 通过（`output/test-results/acceptance.json`）；`npm run build:frontend` 通过 | 通过 |
| FONT04 | 部署后首页不再等待第三方字体 | 公网浏览器：DOMContentLoaded 321ms，`/api/config` **321ms** 开始，Dashboard 分块 458ms 开始，119 个卡片元素渲染，Google 请求 0；拉丁子集 163ms 内加载，`JetBrains Mono` 生效 | 通过 |
| FONT05 | 6 个子集均可加载且不违反 CSP | 首次部署时 1.6KB 子集被 Vite 内联为 `data:`，浏览器报 CSP `font-src` 拦截；增加 `assetsInlineLimit` 规则重新构建部署后，主动加载西里尔/希腊/越南/拉丁扩展字符，6 个字体状态均为 `loaded`，CSP 违规 0；公网 6 个字体 200、`font/woff2`、`Cache-Control: public, max-age=31536000, immutable` | 通过 |
| FONT06 | 容器切换与健康 | `docker compose ... up -d --no-build --force-recreate --wait` 后 healthy、重启 0，日志仅启动和 GeoIP 事件；数据卷、端口与环境沿用 | 通过 |

部署后控制台仍有既有问题：自定义背景图 `ol.zedy.cc` 跳转到 `s3.jgbman.cc`，后者不在 CSP `img-src`，背景被拦截；与本次改动无关，未修改设置。RakSmart Agent 调查结论见 changelog.md 同日记录。

## 上游局部改造生产部署、清理与分支同步（2026-09-30）

已于 **2026-09-30 18:35:13（Asia/Shanghai）** 部署至 https://jm.zedy.cc。生产镜像继续使用 `server-monitor:local`，对应候选 `server-monitor:upstream-improvements-20260930`，镜像 ID `sha256:2d9f4c6e80bb87d7d2b9e70c6c74b4fdc2a6e2daca2c6b31f59ff3e8f3b5a475`。部署前基于已通过的 115 项 Node 测试、19 项主控验收、6 项原生 Agent 验收及 5 组隔离浏览器检查构建 Docker 镜像；部署沿用生产数据，未回滚数据库。

| 编号 | 用户功能、操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| UPD01 | 构建镜像，确保生产运行已验证代码与资源 | 105 个源码/清单、309 个前端资源哈希一致；依赖版本一致，仅 4 个 peer 元数据标记规范化；当前 Agent manifest 与生产归档相同；`docker-build.log`、`source-integrity.json` | 通过 |
| UPD02 | 备份数据并用生产副本预先检查新镜像 | SQLite 在线一致性备份 integrity=ok，16 节点、5 项设置、202,318 条历史、30 个 Agent 归档文件；断网候选首页、后台入口、静态资源、版本目录和安装脚本均正常，节点/设置/归档不变；`candidate-smoke.json` | 通过 |
| UPD03 | 切换容器，保持端口、挂载、网络和环境 | 容器 healthy，端口/挂载/环境核对一致；34 次回环探测中 8 次失败，首末失败样本相隔 1.412 秒，不等同精确中断时长；`deployment.json`、`switch-health-probes.json` | 通过 |
| UPD04 | 公网桌面/手机页面、明暗和语言切换、真实 WSS 更新 | HTTPS 和本地静态资源哈希匹配，16 张卡片、5 批实时推送、36 个新鲜月流量样本；无页面错误、无主控请求失败、无樱花元素/素材请求，手机无横向溢出，后台登录页正常；截图已查看。一个既有外部图标地址存在 TLS 错误，单独保留记录；`production-smoke.json`、`production-mobile-stable.json` | 主控通过，外部图标异常 |
| UPD05 | 实际历史查询保持数据语义，旧数据和真实 Agent 持续可用 | 在生产副本对 16 节点的 6/24/168 小时共 48 组查询逐条深比较，全部与旧窗口查询一致；本地/公网 6/24 小时接口均 200、120 点。保留期内历史缺失 0，60 条超过 7 天的数据按原规则清理，16 台 Agent 均有部署后新上报，节点/设置/30 个归档及环境一致；`history-production.json`、`persistence-final.json` | 通过 |
| UPD06 | 短时观察，区分服务异常和已有客户端失败 | 连续 7 轮、约 30 秒内外网健康检查均 200，16 台持续上报，容器重启 0，无意外运行异常。日志中有超限请求 413 和提前断开；反代日志证实同一来源在切换前已存在 413/499，HTTP 处理与旧镜像逐字节一致，保留原有 2MiB 限额；`steady-state.json`、`request-audit.json`、`http-handler-unchanged.json` | 通过，已有客户端错误另记 |
| UPD07 | 清理刚才的测试数据，保留生产和回滚能力 | 删除本轮 2 个验收临时目录、2 个对比快照目录、隔离生产副本、开发及部署临时证据目录，以及本轮生成的 3 个公共测试结果文件；生产数据、历史 Agent 归档、旧测试记录和工具链保留；`cleanup.json` | 通过 |

首次公网浏览器检查因把外部图标 TLS 失败计作主控资源故障而失败；首次健康观察因把客户端中断和已有限额拒绝计作内部异常而失败。原始失败记录分别保留为 `production-smoke-initial.log`、`steady-state-initial.json`。后续检查明确记录这些问题并单独核对主控资源、实际数据、健康状态及意外异常，没有将失败请求记录改写为零。手机补拍等待明暗过渡结束，布局正常。

生产备份：`/opt/1panel/apps/jan_monitor/backups/upstream-improvements-20260930T103411Z`，目录 0700、环境与数据库备份 0600。回滚镜像：`server-monitor:rollback-upstream-improvements-20260930t103411z`。部署记录保留在备份的 `verification/`，本轮隔离测试原始数据已按用户要求清除，验收与性能结果保留在本文及部署摘要中；备份、密钥及测试产物均不提交 Git。仅同步 `codex/self-hosted-native-agent`，不新建分支或 PR，不修改 `main`。

## 上游实现局部改造与樱花遗留清理（2026-09-30）

当前分支 `codex/self-hosted-native-agent`，修改前提交 `aa8ca54`；参考主线 `dfb9bf1` 及此前隔离对比结论，仅迁入已验证的长历史索引取样和首页推送聚合思路。保留 Node.js 单主控、SQLite WAL、UUID、7 天滚动历史、通知 Outbox、独立接收时间及现有认证策略。请求超时、短区间丢包峰值处理存在边界问题，本轮保持分支实现。本节为部署前开发验证记录，后续部署和清理见上方记录。

环境：Node.js **24.21.0**、npm **11.19.0**、Go **1.26.8**、Chromium **153.0.8010.12**。修改前按顺序执行 `npm ci --no-audit --no-fund`、`npm run geoip:download`、`npm run build`，均退出 0；GeoIP 为 2026-09 库。主控验收与浏览器使用预先建立的全新临时 SQLite、随机回环端口、测试凭据和关闭的调度器；性能比较使用同一个独立内存数据库。未读取或修改生产数据库、环境文件及 Agent 归档。

| 编号 | 用户功能、实际操作及预期 | 验证方式与实测证据 | 状态 |
| --- | --- | --- | --- |
| UP01 | 安装依赖、准备地区库并完整构建，主控及 4 类 Agent 产物可用 | `baseline-install.log`、`baseline-geoip.log`、`baseline-build.log`；完整构建再次通过，`final-build.log` | 通过 |
| UP02 | 查询 7 天历史，减少区间扫描开销且保持返回结果 | 同一 SQLite、20,160 条记录、120 点，清应用缓存后测 9 次；修改前中位 **17.221ms**、修改后 **0.535ms**，逐条深比较完全相同；查询计划为现有 server/time 覆盖索引取 id，再按整数主键读取完整行；`benchmark.json` | 通过 |
| UP03 | 历史起止边界、空桶、节点隔离、完整样本及关闭探测按原规则显示 | 新增 `test/history-query.test.js` 用例：包含起止点、排除前后及未来半毫秒样本；保留每桶最后一条、NULL/false、GPU 文本及磁盘数据；短历史仍显示恢复后的 0% 或启用后的 100%；`targeted.log` | 通过 |
| UP04 | 50 节点集中上报到 10 看板，降低首页消息数，详情仍立即更新 | 实际 Hub 函数、同等模拟订阅：**500→10 帧**，序列化消息 **63,400→49,930 字节**，均送达 500 个样本，详情均 1 帧；逐节点保留 `reportTs`；真实 HTTP/WS 容量验收 A13 也送达 500 个节点更新，批次耗时 262ms；`benchmark.json`、`acceptance.json` | 通过 |
| UP05 | 集中回放、权限变化、节点重建、停机及读库异常不导致额外丢样本、泄漏或未捕获异常 | `test/frontend-batching.test.js`：450 个样本按 300+150 提前/定时发送；250ms 到期前不发送首页帧，详情即时；隐藏节点、过期会话及变更订阅按发送时状态过滤；删除后同 UUID 重建没有旧数据；关闭先发送待发批次；真实 SQLite 表暂不可读时记录错误、下一轮恢复发送。故障捕获前用例确实失败，修正后通过；`delayed-read-failure-before.log`、`targeted.log`（48/48） | 通过 |
| UP06 | 删除樱花/Mikus 遗留后，已有用户仍可正常使用原界面 | 浏览器在旧 `theme_options.mikus=1` 配置下验证首页、详情及后台：装饰元素和素材请求均 0；CPU 实时更新到 81/82，375/1440px 无横向溢出，明暗切换、三种视图、地区/分组筛选正常；中英日分别保存设置并关闭成功弹窗；7 天历史 HTTP 200、120 点、11 个图表画布及详情实时更新；`browser.json` 的 UI01–UI05、桌面/手机截图已查看 | 通过 |
| UP07 | 完整回归覆盖存储、上报、通知、认证及前端既有功能 | `npm run test:all` 退出 0；**115/115 Node 测试**、Agent 配置测试、Go vet/test 全部通过；`test-all.log` | 通过 |
| UP08 | 用户实际能安装启动、管理节点、查询历史、备份恢复、连接真实 Agent | `npm run test:acceptance` 退出 0；**19/19 主控验收、6/6 原生 Agent 验收**，包括 50 Agent/10 看板、故障上报、重启和通知持久化、真实 HTTP/WS 模式切换；`acceptance.log`、`acceptance.json`、`native-acceptance.json` | 通过 |

开发阶段证据目录：`output/test-results/upstream-improvements-20260930/`，由 Git 忽略，部署后已按要求清理。`validation.json` 记录的最终命令、退出码和时长，以及性能摘要保留于生产备份的 `verification/predeployment-summary.json`。性能数据是本地隔离 SQL/序列化实验，非生产压测；首页聚合增加最多约 250ms 等待，跨窗口分散上报的收益较小。源码、静态资源与构建产物中已无 Mikus/樱花引用，4 个素材共移除 487,090 字节；保留明暗模式和既有后台设置，旧 JSON 不再被内置前端使用。

浏览器用例前几轮因测试假定条形图/一位小数、地区代码大写及漏关闭保存弹窗而超时；截图已确认实际数据正常更新。修正用例、显式选择视图并完成保存弹窗操作后，5 组检查全部通过。开发期间早期日志和截图分别记录为 `browser-initial-failure.*`、`browser-second-failure.*`、`browser-third-failure.*`、`browser-filter-selector-failure.*`、`browser-save-modal-failure.*`，未将失败记录覆盖为通过；这些临时文件现已按清理要求移除。

本轮未修改 Agent 安装、更新、分发源码、Dockerfile 或 Compose；未运行 `test:agent-deployment` 专项。开发验证时未切换生产，后续部署见上方记录。临时测试程序、数据库、截图及日志不提交 Git。

## 原版界面恢复上线（2026-09-21）

已于 **2026-09-21 19:31:52（Asia/Shanghai）** 恢复至 https://jm.zedy.cc。本地部署代码提交 `b634679`，候选镜像 `server-monitor:ui-restored-20260921`，镜像 ID `sha256:543bd05395372ccdc72ec96007a9ad938fc25451409b1f0d655b5a226db7de44`。使用当前数据库，未将旧数据库回滚。

| 编号 | 操作及预期 | 实测结果与证据 | 状态 |
| --- | --- | --- | --- |
| URD01 | 构建候选并核对已测代码与资源 | 106 个源码/清单、313 个资源一致；依赖版本一致，仅 npm 的 4 项 peer 标记规范化；Agent manifest 无变化，source-integrity.json | 通过 |
| URD02 | 数据备份、回滚准备及断网候选检查 | SQLite integrity=ok；16 节点、5 设置、30 个 Agent 归档；断网生产副本启动且关闭调度，HTTP/资源/版本及配置保留通过 | 通过 |
| URD03 | 切换服务，端口/挂载/环境保持 | 容器 healthy；31 次探测中 5 次失败，首末失败样本相隔 0.809 秒；deployment.json | 通过 |
| URD04 | 公网桌面、手机、语言、明暗、登录及 WSS | 原版终端圆点和布局恢复，全局新动效/按钮/品牌元素数量 0；16 卡片、16 批新数据；浏览器错误与失败请求均 0，production-smoke.json；桌面与手机截图已查看 | 通过 |
| URD05 | 检查数据未丢失且全部节点恢复 | 初检 4/16 节点新上报，等待后复检 16/16；107,458 条旧历史逐条保留，总历史 107,490；节点/设置/30 个归档及环境保持，integrity=ok，重启 0；persistence-final.json | 通过 |
| URD06 | 继续观察 30 秒并清理隔离副本 | 7 轮内外网健康检查均 200，16 台持续上报，运行错误为空；隔离副本已移除、备份和回滚镜像保留；steady-state.json、cleanup.json | 通过 |

证据：`output/test-results/ui-restore-deploy-20260921/`（不入 Git）。备份：`/opt/1panel/apps/jan_monitor/backups/ui-restored-20260921T113132Z`；回滚镜像：`server-monitor:rollback-ui-restored-20260921t113132z`。直接同步既有分支，不创建 PR。


## 恢复原版界面验证（2026-09-21）

用户确认恢复到樱花/星空改版之前的原版 UI。基线取自本机原生产镜像 server-monitor:theme-expiry-20260921，未读取旧数据库覆盖生产。Node 24.21.0 / Go 1.26.8；修改前 npm ci、geoip:download、完整 build，恢复依赖后再次 npm ci 与完整 build。隔离临时 SQLite、回环随机端口、关闭调度，证据在 output/test-results/ui-restore-20260921/。

| 编号 | 操作及预期 | 实测证据 | 状态 |
| --- | --- | --- | --- |
| UR01 | 核对首页、详情、后台、弹窗和样式已恢复原版 | 102 个源码文件与原镜像逐字节一致，仅 Dashboard.vue 为保留多选而不同；baseline-comparison.json | 通过 |
| UR02 | 打开桌面/手机，原版终端页头和字体出现，新装饰/按钮/工具区不再存在 | Chromium 在 320/375/414/768/1440px 验证无横向溢出；3 个终端圆点、原版标题及 JetBrains Mono 字体声明；新 UI 元素数量 0；桌面/手机截图已查看 | 通过 |
| UR03 | 三种视图、财务弹窗、详情、后台登录/页签/编辑保存、手机弹窗和三语言 | 实际点击及管理 API 核对保存结果；browser.json 的 8 组检查、pageerror=[]；外部汇率请求被测试主动阻断 | 通过 |
| UR04 | 保持地区/分组多选、并集与交集、溢出菜单连续选择、取消及刷新重置 | 14 项真实浏览器检查通过，multiselect.json；没有退回单选行为 | 通过 |
| UR05 | 完整回归、真实主控及原生 Agent 验收 | test-all.log：106/106、Agent 配置、Go vet/test；acceptance.log：主控 19/19、原生 6/6；构建成功，git diff --check 通过 | 通过 |

源码中已删除未使用的新 UI 组件、依赖和设计文件；前端字体恢复原版的 Google Fonts 引用和等宽回退。没有新增 Agent 安装、更新或分发逻辑。


## 顶部布局生产部署（2026-09-21）

已于 **2026-09-21 19:01:41（Asia/Shanghai）** 部署至 https://jm.zedy.cc。部署代码提交为 `9313558`，候选镜像 `server-monitor:layout-20260921`，镜像 ID `sha256:bae387e8265d97bc5c043af0c485058adcab95159052b4b78934f77a45d4696a`；生产沿用 `server-monitor:local`。此前未提交的已上线改动一并纳入代码提交，本次相比原生产镜像仅 4 个前端源码文件及两份依赖清单变化。下方“未部署”描述为各轮开发阶段记录，本次已完成上线。

| 编号 | 操作与预期 | 实际验证及证据 | 状态 |
| --- | --- | --- | --- |
| LP01 | 构建镜像并确保与已测版本一致 | Docker 构建成功；134 个源码/清单、313 个前端资源哈希一致，依赖锁完全一致；Agent manifest 不变，source-integrity.json | 通过 |
| LP02 | 备份、准备回滚并隔离验证 | 一致性 SQLite 备份 integrity=ok，16 节点、5 设置、30 归档文件；断网生产副本启动候选，调度关闭，HTTP/资源/安装脚本/版本目录正常，节点设置归档无变化 | 通过 |
| LP03 | 切换 Compose，保持运行参数与数据 | 容器 healthy，端口/挂载/环境一致；32 次健康探测中 5 次失败，首末失败样本相隔 0.809 秒，不等同精确中断时长；deployment.json | 通过 |
| LP04 | 公网桌面/手机页面及真实实时数据 | HTTPS、静态资源哈希、标题在樱花右侧、无筛选前置文字、按钮等尺寸、苹方优先、卡片 12px；语言/主题/动效与登录页检查通过；WSS 16 批、16 卡片，pageerror=[]、失败请求=[]；production-smoke.json，桌面/手机截图已查看 | 通过 |
| LP05 | 比较生产数据，确保旧数据保留且 Agent 恢复 | 106,497 条切换前历史全部保留，总历史增至 106,529；16 台均已重新上报，节点/设置/30 个归档文件不变；SQLite integrity=ok，重启次数 0；persistence-final.json | 通过 |
| LP06 | 浏览器退出后观察 30 秒并清理副本 | 7 轮内外网健康请求均 200，16 台 Agent 持续上报，runtimeErrors=[]，容器 healthy/零重启；已删除隔离数据副本，备份与回滚镜像保留；steady-state.json、cleanup.json | 通过 |

证据位于 Git 忽略的 `output/test-results/layout-deploy-20260921/`。备份目录 `/opt/1panel/apps/jan_monitor/backups/layout-20260921T110118Z`，切换前快照 `monitor-pre-switch.sqlite`；回滚镜像 `server-monitor:rollback-layout-20260921t110118z`。环境备份权限 0600、备份目录 0700，生产凭据及测试产物不入 Git。未创建 PR。


## 移除筛选前置文字（2026-09-21）

环境：Node 24.21.0 / Go 1.26.8，开发前完成 npm ci、geoip:download、完整 build；修改后前端构建成功。浏览器使用全新临时 SQLite 和随机回环端口，调度关闭，未部署生产。证据目录 output/test-results/filter-labels/ 不纳入 Git。

| 编号 | 功能、操作和预期 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- |
| FL01 | 查看首页地区和分组，不显示前置“地区”“分组”文字，按钮直接左对齐 | 320/375/414/768/1440px 浏览器断言 dashboard-filter-label 数量 0，无横向溢出；browser.json、home-light.png、home-mobile-light.png | 通过 |
| FL02 | 点击地区/分组组合筛选并切换三种视图，既有行为保持 | 浏览器真实点击，19 组检查、pageerror=[]；包括动效、后台保存、弹窗焦点及 50 节点 | 通过 |
| FL03 | 安装、构建和完整回归 | setup.log、build.log；首轮管理入口限流用例出现 404/429 差异，无后端修改，完整复跑 106/106、Agent 配置与 Go vet/test 通过，test-all-retry.log | 通过（首轮失败已记录） |

npm run test:acceptance 实际退出 0，主控全部用例及原生 Agent 6/6 通过，证据 acceptance.log。

本次没有调整字体或 Agent 分发逻辑，未运行部署专项。原始首轮失败日志保留，未将其覆盖或宣称从未失败。


## 首页顶部布局协调（2026-09-21）

环境：Node 24.21.0 / Go 1.26.8；先执行 npm ci、geoip:download、完整 build，再修改。使用预建临时 SQLite、随机回环端口主控及 Chromium，关闭调度；没有部署生产。证据：output/test-results/header-layout/（Git 忽略）。

| 编号 | 功能、操作及预期 | 实测方式与证据 | 状态 |
| --- | --- | --- | --- |
| HL01 | 打开首页，标题位于樱花右侧且与设置区对齐 | DOM 为“✿樱昼 · 星夜”，樱花右边界不超过标题左边界，品牌与按钮不重叠；browser.json | 通过 |
| HL02 | 查看统计摘要下的地区、分组和视图工具区，边界协调且不重叠 | 320/375/414/768/1440px 检查：统计在筛选上方，分组在地区下方；桌面视图位于地区右侧；手机单列；无全页溢出 | 通过 |
| HL03 | 操作地区/分组多选、三种视图、动效、主题和语言 | 实际浏览器点击验证组合筛选、视图切换、动效持久化及减少动态效果；详情、后台编辑保存、弹窗焦点、50 节点检查通过，19 组记录、pageerror=[] | 通过 |
| HL04 | 查看最终截图、按钮尺寸及字体圆角保持 | home-light.png、home-mobile-light.png；实际查看截图；桌面 40×40、手机 44×44，卡片 12px、筛选 8px、苹方优先 | 通过 |
| HL05 | 完整构建与回归，确保现有功能正常 | build.log、final-build.log；test-all.log：106/106 Node、Agent 配置、Go vet/test 通过；git diff --check 通过 | 通过 |
| HL06 | 真实主控和原生 Agent HTTP/WS/SQLite 验收 | 首轮全部用例报告通过但进程退出 143，未将其视为完整成功；重跑 npm run test:acceptance 退出 0，主控及原生 6/6 通过，acceptance-retry.log | 通过 |

限制：测试机没有苹方，截图使用回退字体。未进行本轮生产部署或 Agent 分发变更，未运行部署专项；保留前次测试记录供追溯。


## 首页标题与样式微调（2026-09-21）

环境：隔离临时 SQLite、回环随机端口主控、Chromium，关闭调度；无生产数据访问。首次默认环境为 Node 26 且 Go 不在 PATH，完整构建失败；修正为现有工具链 Node 24.21.0 / Go 1.26.8 后重新执行 npm ci、geoip:download、完整 build，再开始修改。修改后重新完整构建。证据位于 Git 忽略的 output/test-results/header-polish/。

| 编号 | 功能、操作与预期 | 验证方式、实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| HP01 | 打开首页，站点标题仅保留一份并位于樱花左侧，无顶部固定品牌文字 | Chromium DOM 断言品牌文字为“樱昼 · 星夜✿”，重复标题数量 0，标题右边界小于樱花左边界；home-light.png、home-mobile-light.png 已查看 | 通过 |
| HP02 | 在桌面/手机检查动效、语言、主题、管理按钮尺寸一致 | 实测匿名首页 3 个可见按钮，后台 4 个按钮；桌面 40×40、手机 44×44；初次测试误期望匿名首页显示管理按钮，修正夹具断言后通过；browser.json | 通过 |
| HP03 | 查看卡片、筛选、弹窗圆角及字体 | 卡片计算样式 12px、筛选 8px，标题字体以 PingFang SC 开头，字体网络请求为空；查看截图及实际打开编辑、财务、批量和删除弹窗 | 通过 |
| HP04 | 在 320/375/414/768/1440px 检查看板，并操作明暗、动效、视图、筛选、语言及后台表单 | 无全页水平溢出，动效关闭持久化/减少动态效果禁用通过，50 节点、详情和弹窗保存/焦点检查通过；浏览器 19 组记录、pageerror=[]；browser.json | 通过 |
| HP05 | 安装、构建与完整回归，确保既有业务不回退 | ci.log、geoip.log、baseline-build.log、build.log；test-all.log：106/106 Node、Agent 配置及 Go vet/test 通过 | 通过 |
| HP06 | 真实 HTTP/WS/SQLite 与原生 Agent 验收 | npm run test:acceptance 退出码 0；主控全部用例、原生 Agent 6/6 通过，acceptance.log | 通过 |

限制：测试机未安装苹方，验证了优先字体声明及系统回退，未验证 macOS/iOS 上实际苹方字形。本轮仅修改并验证工作区，未部署生产；不涉及 Agent 安装、更新或分发逻辑，未运行部署专项。原始测试产物不提交。


## 樱昼 / 星夜生产部署（2026-09-21）

已于 **2026-09-21 17:49:33（Asia/Shanghai）** 部署至 `https://jm.zedy.cc`。候选镜像 `server-monitor:dream-ui-20260921`，生产 Compose 标签仍为 `server-monitor:local`；镜像 ID `sha256:bf14b872fe13a13256eeb34534f75fbdb05860148bcd038507d87d5a68a0c9bb`。沿用原端口、挂载、环境文件与 Compose 项目。

| 编号 | 操作及预期 | 实测结果与证据 |
| --- | --- | --- |
| DUDEP01 | 构建候选并核对已验收源码/资产 | 134 个源码/清单、410 个资源哈希一致；依赖锁一致，原生 Agent manifest 无变化，source-integrity.json |
| DUDEP02 | 一致性备份与回滚准备 | 16 节点、5 条设置、104,680 条历史；SQLite integrity=ok，30 个归档文件，备份目录 0700、环境文件 0600，deployment.json |
| DUDEP03 | 用断网生产副本启动候选，禁止调度器外部写入 | HTTP、9 个 JS/CSS、安装脚本和版本目录通过；节点/设置/归档未变化，candidate-smoke.json |
| DUDEP04 | Compose 切换并核对运行参数 | healthy、RestartCount=0，端口/挂载/环境不变；31 次探测中 5 次未成功，首末失败样本间隔 0.81 秒，不等同精确中断时长 |
| DUDEP05 | 公网 HTTPS 桌面/手机、深浅色、语言、动效开关、后台登录及 WSS | 16 卡片；16 次实时批次与新月流量样本；浏览器 pageerror=0、请求失败=0；静态资源哈希与候选一致，production-smoke.json 及截图 |
| DUDEP06 | 浏览器关闭后独立观察 30 秒 | 7 轮内外网健康请求均 200，16 节点持续上报；无匹配的 HTTP/WS/异常日志，steady-state.json |
| DUDEP07 | 比较切换前快照与现有数据库及归档 | 104,680 条旧历史逐行全部保留，总历史增至 104,721；节点/配置/30 归档未变，16 节点均已在切换后上报，SQLite integrity=ok，persistence-final.json |
| DUDEP08 | 清理隔离验证副本 | 删除本轮 production-data-copy；候选检查容器与浏览器已关闭，备份和回滚镜像保留，cleanup.json |

备份：`/opt/1panel/apps/jan_monitor/backups/dream-ui-20260921T094908Z`，最终快照为 `monitor-pre-switch.sqlite`。回滚镜像：`server-monitor:rollback-dream-ui-20260921t094908z`。初次切换后检查仅 8 台完成新上报，未据此宣布完成；等待后 16 台全部通过。没有修改生产服务器配置、写入测试节点或触发测试通知。

全部证据位于 Git 忽略目录 `output/test-results/dream-ui-deploy-20260921/`；Docker 构建日志位于 `output/test-results/dream-ui/docker-build.log`。本次上线已验收的工作区内容，未提交或推送 Git。Agent 安装/更新/分发逻辑及程序未变，未额外运行 agent-deployment。下方“未部署生产”为上线前历史记录。

## 樱昼 / 星夜 UI 重构（2026-09-21）

环境：Node 24.21.0、Go 1.26.8、本机 Chromium 1234。修改前执行 npm ci、geoip:download、完整 build；依赖变更后再次 npm ci、完整 build。浏览器启动随机回环端口的真实主控、临时 SQLite、关闭调度器，管理 API 写入虚构节点与指标，不连接生产。最终临时目录 `/tmp/monitor-dream-ui-3Rss6H`；浏览器脚本、JSON、18 张截图和命令日志位于 Git 忽略的 `output/test-results/dream-ui/`。

| 编号 | 实际操作 | 验证结果 |
| --- | --- | --- |
| DU01 | npm ci、npm run build | 通过；final-ci.log、final-build.log。构建四种原生程序及 Vue 资源，最后注释调整后 build:frontend 也通过 |
| DU02 | npm run test:all | 106/106 Node、Agent 配置、Go vet/test 通过，test-all.log |
| DU03 | npm run test:acceptance | 主控 19/19、原生 Agent 6/6 通过，acceptance.log |
| DU04 | 首页 320/375/414/768/1440px，后台 320/375/414/768px | 全页无水平溢出；宽表格保留自身滚动；375px 设置表单与编辑弹窗边界通过 |
| DU05 | 首页亮暗切换、三种视图、地区和分组连选 | 条形/环形/列表可用；同类并集与跨类交集结果正确；截图人工复核 |
| DU06 | 详情、登录、后台服务器/设置/数据库及财务/编辑/批量编辑/删除确认 | 真实导航与操作通过；编辑保存经 API 回读确认；删除只取消、不执行删除 |
| DU07 | 编辑弹窗连续 12 次 Tab、Escape，财务弹窗关闭 | 焦点留在模态框；Escape 关闭；财务关闭后焦点回到触发按钮；移动弹窗完整处于视口内并可内部滚动 |
| DU08 | 动效按钮关闭、刷新、重新开启、emulateMedia reduced-motion | 偏好保留；关闭/减少动态效果时背景节点移除；减少动态效果时按钮禁用 |
| DU09 | 模拟 document.hidden + visibilitychange；手机视口 | CSS animation-play-state 为 paused；手机 8 花瓣 / 16 星，桌面 18 / 32，无逐帧 Vue 更新 |
| DU10 | 50 节点，三种动效状态各采样约 3 秒 | 性能数据如下；全部 50 卡片存在，pageerror=0 |
| DU11 | 手机循环中/日/英，读取动态按钮可访问名称 | 三种语言和按钮名称存在，无全页溢出 |
| DU12 | 浏览器将实际主题 token 转换为 sRGB 后计算对比度 | 正文/卡片：浅 13.86、深 13.83；次级文字/卡片：浅 7.06、深 7.93；主按钮字/底：浅 7.19、深 9.15。不是全页面所有状态的自动无障碍审计 |

最终性能采样（未限速、未限 CPU、50 节点中 6 个准备了在线指标，其余为离线容量夹具）：

| 状态 | 帧间隔 P95 | 最大帧间隔 | 主线程任务 / 约3秒 | 脚本 / 布局 |
| --- | --- | --- | --- | --- |
| 星夜开启 | 16.8ms | 33.4ms | 377.7ms | 12.6ms / 0ms |
| 樱昼开启 | 16.8ms | 33.4ms | 318.3ms | 12.2ms / 0ms |
| 动效关闭 | 16.7ms | 16.8ms | 182.8ms | 11.4ms / 0ms |

前一轮主线程采样分别为 338.8 / 334.2 / 245.8ms，说明短测存在波动；未声称严格因果开销或低端手机帧率保证。帧间隔由 requestAnimationFrame 采样，任务/脚本/布局由 Chromium Performance.getMetrics 差分；并非 Lighthouse、INP 或真实用户 Core Web Vitals。web-perf 所需 Chrome DevTools MCP 未配置，因此未完成该技能完整审计，使用既有 Playwright/CDP 测试替代。字体请求全部同源，最终首页加载 5 个 Unicode 分片，合计 260,232 字节；未依赖 Google Fonts。

浏览器无 pageerror。测试主动中止两个外部汇率域名请求，8 条 ERR_FAILED 均为预设隔离行为，界面显示内置汇率回退；不计为网络全部成功。调试中实际发现并修复旧 modal-dialog 的 position 覆盖新 Dialog 定位、视图选中态颜色及冗余嵌套边框；也调整了减少动态效果异步等待、保存成功弹窗关闭等测试等待条件。最终整套浏览器重跑通过。Hallmark 截图复核覆盖首页亮暗、手机首页、财务、设置与手机编辑/后台；保留用户明确要求的 emoji 和装饰动画例外。

未部署生产、未提交 Git；未更改 Agent 安装/更新/分发逻辑，因此未运行 agent-deployment。既有实时订阅、地区多选及其他工作区改动保留。

## 首页地区与分组多选（2026-09-21）

环境：Node 24.21.0、Go 1.26.8；修改前完成 `npm ci`、`npm run geoip:download`、`npm run build`。默认 shell 首次构建因没有 Go 且 Node 为 26 失败，改用已有 `/tmp/monitor-toolchain-lflYI6/go/bin` 工具链后通过。浏览器使用本机 Chromium 1234、随机回环端口、临时空 SQLite；先通过管理 API 准备 21 台虚构服务器，再打开页面验收，不连接生产。

| 编号 | 功能 / 实际操作 | 预期结果 / 验证方式 | 状态与证据 |
| --- | --- | --- | --- |
| MS01 | 启动隔离主控并打开首页 | 默认显示全部 21 台且保持顺序；浏览器读取实际 DOM | 通过，browser.json |
| MS02–MS03 | 连选 US、JP，再连选 Alpha、Beta | 地区并集、分组并集，两类条件取交集，按钮状态一致 | 通过，browser.json |
| MS04 | 切换环形、列表、条形 | 三种视图保持同一筛选结果及顺序 | 通过，3 项实际 DOM 断言 |
| MS05–MS08 | 取消一个地区、构造无匹配组合、逐类清空 | 其余选项保留，无匹配显示空状态，清空恢复不限 | 通过，browser.json |
| MS09 | 同时选择未知地区和 US | 两类服务器均展示 | 通过，browser.json |
| MS10 | 刷新页面 | 与既有行为一致，不持久化筛选，恢复全部 | 通过，browser.json |
| MS11–MS12 | 390px 手机视口，在更多菜单连选两地区，点菜单外再打开，逐项取消 | 菜单支持连续选择，外部点击关闭，选择保留，全部取消后入口不再高亮 | 通过，browser.json、mobile.png |
| MS13 | `npm run build`、`npm run test:all` | 全平台构建及既有回归通过 | 通过，build.log；106/106 Node、Agent 配置、Go vet/test，test-all.log |
| MS14 | `npm run test:acceptance` | HTTP/WS、SQLite、重启持久化和原生 Agent 兼容 | 通过，主控 19/19、原生 Agent 6/6，acceptance.log |

浏览器共 14 项结果，pageerror 为 0。测试脚本首轮因默认浏览器版本路径失效未启动，指定已安装 Chromium 后运行；调试期间修正了“更多”按钮匹配到隐藏测量按钮及点击被菜单遮挡区域的测试定位问题，最终全程重跑通过。证据位于 `output/test-results/multiselect/`，均为 Git 忽略产物。未部署生产，未改 Agent 安装、更新、分发，因此未运行 agent-deployment。

## 主题商店删除与到期提醒修复生产部署（2026-09-21）

已于 **2026-09-21 15:49:54（Asia/Shanghai）** 部署到 `https://jm.zedy.cc`。候选标签 `server-monitor:theme-expiry-20260921`，生产标签 `server-monitor:local`，镜像 ID `sha256:6ef330147e8a24f9c8fe8018045cdb72449dcae6e8f5715dda75ca844c12b29d`。沿用原 Compose 项目、环境文件、数据卷及 `127.0.0.1:26129`；容器 healthy，RestartCount=0。

| 编号 | 操作 / 功能 | 预期和验证方式 | 结果与证据 |
| --- | --- | --- | --- |
| DEP01 | 构建候选镜像，比较已验收源码及资源 | 与本地测试版本一致，Agent 归档无冲突 | 通过；source-integrity.json：106 文件、313 资源匹配；依赖版本一致，仅规范化 npm peer 标记；相对生产仅 8 个主题商店/到期修复文件变化 |
| DEP02 | 一致性备份数据库、环境、Compose、GeoIP 和 Agent 归档，保留旧镜像 | 可回滚，数据库 integrity=ok | 通过；deployment.json；备份目录 0700、环境文件 0600；切换前再次备份 |
| DEP03 | 生产数据副本运行候选，network=none、关闭调度器 | 16 节点/设置/归档不变，HTTP、9 个 JS/CSS、Agent 目录正常 | 通过；candidate-smoke.json，/theme=404，资源哈希匹配，SQLite integrity=ok |
| DEP04 | 既有 Compose 重建 monitor 并等待健康 | 新镜像就绪，端口、挂载、环境保持一致 | 通过；deployment.json、compose-up.log；切换期间 26 次健康采样中 1 次失败，不据此推算精确中断时长 |
| DEP05 | 公网及回环 HTTP、桌面/手机浏览器和实时 WSS | 新资源加载、后台登录页正常、16 节点展示并接收新上报 | 通过；production-smoke.json：HTTPS 证书验证、9 资源哈希、/theme=404、WSS hello/subscribed/batchUpdate、16 个含月流量的新样本；浏览器 errors=[]、failedRequests=[]；手机截图已查看 |
| DEP06 | 对比切换前后 SQLite、环境和 Agent 归档 | 原数据保留，到期修复按正常调度执行 | 通过；persistence-final.json：16 节点及配置内容不变，102,059 条切换前历史全部保留，30 个归档文件一致，integrity=ok；新增当天 expiry_report_last，1 条到期事件已标记送达 |
| DEP07 | 浏览器关闭后连续观察 30 秒 | 7 次健康检查成功、16 台 Agent 持续上报、无运行错误或重启 | 通过；steady-state.json：公网/回环均 200，recentAgents=16，runtimeErrors=[]，restarts=0 |

备份目录：`/opt/1panel/apps/jan_monitor/backups/theme-expiry-20260921T074910Z`，最终切换快照为 `monitor-pre-switch.sqlite`。回滚镜像：`server-monitor:rollback-theme-expiry-20260921t074910z`。旧镜像及完整备份保留；候选检查容器和可重建生产测试副本已删除。未触发额外测试通知，实际到期事件由生产调度器按原设置自动发送；未修改管理员配置。

首轮持久化检查使用全部 settings 行相等断言，因修复后新增正常的 `expiry_report_last` 失败；已改为对节点和其余配置作内容哈希比较，并单独核对到期日期及队列送达记录。首轮与浏览器并行的日志观察记录 17 条 `[http] Premature close`，原始结果保留于 steady-state-first.json；浏览器关闭后独立 30 秒观察通过，不宣称部署全程没有提示。

验证证据位于 `output/test-results/theme-expiry-deploy-20260921/`，被 Git 忽略。本次部署已验收工作区内容，未提交/推送 Git；下方“未部署生产”为本次上线前的历史记录。Agent 安装、更新、分发代码及程序未变化，未重复运行 agent-deployment 套件；此前 106 项 Node、Agent 配置/Go、19 项主控和 6 项原生 Agent 验收结果已核对。

## 修复到期提醒缺少函数导入（2026-09-21）

本次修复上一节主题商店删除验收发现的既有缺陷：`expiry.js` 补齐 `getTrafficPeriodKeys` 导入。运行规则及通知格式不变。新增真实 HTTP 配置、SQLite 持久化和本地 Webhook 回归，并加强 A10 的独立到期事件断言。未部署生产，未修改生产配置或数据。

环境先准备完成：Node 24.21.0、Go 1.26.8；`npm ci`、`npm run geoip:download`、`npm run build` 均成功，四个平台 Agent 构建校验通过。测试使用临时空数据库、随机回环端口、本地 Webhook，调度器自动运行关闭，显式调用定时任务同一服务验证确定性时间边界。

| 编号 | 功能 / 操作 | 预期与验证方式 | 状态与实际证据 |
| --- | --- | --- | --- |
| EX01 | 修复前执行新增 expiry-notification.test.js | 测试必须捕获原有错误 | 通过（预期失败）：ReferenceError、false !== true，退出 1；before.log |
| EX02 | HTTP 创建两天后跨日仍待提醒的服务器，调用到期检查并发送 | SQLite 新增到期事件，本地 HTTP Webhook 收到服务器名和剩余天数 | 通过：首日一条，event=服务器到期提醒、clients=[Expiry fixture]、剩余3天；delivered_at 写入；after.log |
| EX03 | 同日重复检查、重启主控后再次检查 | SQLite 队列仍一条，不重复提醒 | 通过；持久去重日期 2026-09-21 |
| EX04 | 上海时间 23:59 到次日 00:00（UTC 日期未变） | 新增下一天提醒，剩余天数更新 | 通过；去重日期 2026-09-22、剩余2天、第二条实际送达 |
| EX05 | 推进到服务器过期后再检查 | 无待提醒服务器，不生成新事件或占用新日期 | 通过；队列仍两条、日期仍 2026-09-22 |
| EX06 | npm run test:all | Node、Agent 配置、Go vet/test 全部通过 | 通过；106 tests、106 pass、0 fail，退出 0；test-all.log |
| EX07 | npm run test:acceptance | HTTP/WS、备份恢复、原生 Agent 回归及到期事件独立断言通过 | 通过；19 项主控、6 项原生 Agent，退出 0；A10 queuedEvents=5、expiryEvents=1、duplicateReportEvents=0；无到期检测 ReferenceError |
| EX08 | git diff --check | 无补丁空白错误 | 通过，退出 0 |

证据位于 `output/test-results/expiry-fix-20260921/`，测试产物被 Git 忽略。新增测试先失败再通过，已证实能阻止本次缺陷回归；上一节所记的到期通知问题现已修复。

## 删除主题商店（2026-09-21）

范围：删除商店面板、后台入口、清单代理及缓存、中英日专用文案和旧待办；保留第三方主题加载及管理 API、深浅色和 Mikus 设置。保留工作区既有标签、财务等修改。未部署生产，未操作生产数据库。

环境：Node 24.21.0（从现有 Node 24 镜像提取）、Go 1.26.8（官方 golang 镜像工具链）、Chromium 1234；先完成依赖安装、GeoIP 准备与完整四平台构建，再进行最终测试。主控及原生 Agent 验收使用临时独立数据目录和随机回环端口。

| 编号 | 功能 / 操作 | 预期与验证方式 | 结果 / 证据 |
| --- | --- | --- | --- |
| TS01 | 删除清单接口；实际 GET /theme | 返回 404，不提供远程商店清单 | 通过；acceptance A01 removedThemeStore=404；browser.json TS01 |
| TS02 | 中英日登录后台，切换保留页签 | 仅服务器、设置、数据库管理三个入口，面板可切换，无商店组件 | 通过；browser.json TS02-zh/en/ja；admin-zh/en/ja.png |
| TS03 | 浏览器监控请求和 JS 异常 | 无 /theme、CFSM-Theme-Store 请求，无运行异常 | 通过；browser.json errors=[]、storeRequests=[] |
| TS04 | 三种语言下保存 Mikus JSON 后刷新读取 | 设置正常保存、Mikus 启用且刷新后保留 | 通过；browser.json 三种语言 mikusPersisted=true |
| TS05 | npm ci、npm run geoip:download、npm run build | 依赖安装、GeoIP 准备、Vue 和四个平台 Agent 构建成功 | 通过；Node 24 下安装 0 vulnerabilities，GeoIP 2026-09，4 verified artifacts，Vite 389 modules |
| TS06 | npm run test:all | Node 回归、Agent 配置、Go vet/test 通过 | 通过；test-all.log：105 tests、105 pass、0 fail；agent config tests passed；Go 测试退出 0 |
| TS07 | npm run test:acceptance | 实际 HTTP/WS、SQLite、备份恢复和原生 Agent 验收 | 命令退出 0，19 项主控和 6 项原生 Agent 断言通过；但到期通知存在下述既有异常，不能据此认定该子功能通过 |
| TS08 | 搜索 src/dist 并检查补丁 | 无商店符号、URL 及空白错误 | 通过；rg 无 themeStore/ThemeStore/THEME_STORE/CFSM-Theme-Store 命中；git diff --check 退出 0 |

证据目录：`output/test-results/theme-store-removal-20260921/`，测试脚本、截图、日志均被 Git 忽略。代码及文档删除可从 Git 历史恢复，未删除用户数据。

测试过程说明：宿主机 Node 26.7.0 且无 Go，首次完整构建因 `go ENOENT` 失败，已切换到上述要求的工具链完成。首次 Node 测试误与重构建同时运行，dist 清理窗口使首页返回 503，造成安全测试后续级联失败；构建完成后重新完整执行 test:all，105 项全部通过，首轮日志保留在 test-all-first.log。

既有缺陷：`src/services/notifications/expiry.js:61` 使用 `getTrafficPeriodKeys` 但未导入，该文件与 HEAD 一致，本次未修改。A10 实际日志出现 `ReferenceError`，服务捕获异常并返回 false，但测试只检查聚合队列数量，仍报告 PASS。因此本次明确不将到期通知视为验证通过；此问题不影响主题商店删除，留待单独修复。

## 服务器标签独立配色与价格计费（2026-09-19）

实现独立七色表和严格的 `标签<color>` 语法，支持小写内置色名、`#RGB`、`#RRGGBB`。未指定颜色的标签按原六色顺序及自身位置循环；标签仅按英文逗号拆分、保留大小写，其他配色格式按普通文字显示。旧标签保持数据库原文，无需迁移。移除“白嫖中”对财务计算的影响，价格 0 才显示免费，负一不再作为免费哨兵。

### 环境和证据

- 先执行 `npm ci`、`npm run geoip:download`、`npm run build`；Node.js v24.21.0、Go 1.26.8、Chromium，测试使用临时 SQLite 和回环随机端口，凭据独立于生产。
- 专项证据：`output/test-results/tag-colors-20260919/`（Git 忽略）；正式回归 `test/server-tags.test.js` 共 4 项，覆盖严格后缀、英文逗号、大小写、HEX、默认映射、长度边界、存储幂等及财务规则。
- 新增共享 `serverTags.js`、共用渲染 `ServerTags.vue`、问号帮助 `ServerTagsHelp.vue`；移除前后台重复的 `tagColorClass` / `splitTags`、六个 `.tag-color-*` CSS 类、卡片 composable 中旧标签逻辑、财务 `hasFreeTag` 和 `-1` 免费分支。帮助复用已有 `HelpTooltip`，未建立第二套提示交互；热更新复用既有 WS 重连补取机制。

| 编号 | 功能 / 实际操作 | 预期结果 | 实际证据 | 状态 |
| --- | --- | --- | --- | --- |
| TC01 | 隔离主控新增旧格式标签，在首页及后台检查 | 原六色循环，lower/UPPER/case/Case 原样显示 | `browser.json`：七个标签顺序及 CSS 色值逐项匹配，text-transform=none | 通过 |
| TC02 | 真实后台编辑输入 green、短 HEX、完整 HEX、重复标签并保存；保持条形/环形首页打开 | 后台和两个首页颜色一致，无需手动刷新，数据保存准确 | `browser.json`：热更新 1124ms，页面 reload=0；三处文本/颜色一致，重复标签正常 | 通过 |
| TC03 | 打开财务弹窗，检查带“白嫖中”的正价格服务器、零价、负价节点 | 计费与标签无关，仅零价显示免费 | 两台正价格节点显示 ¥15.00 / ¥30.00；零价显示免费，负价无免费标记且不计入金额 | 通过 |
| TC04 | 保存方括号/冒号/圆括号、大写色名、非支持色名、不合法 HEX、中文逗号、HTML 样式文本 | 仅规定后缀被识别，其他原样显示为普通文字 | `browser.json`：8 个标签及默认颜色匹配，中文逗号不拆分，HTML 不生成 img、不弹出 alert | 通过 |
| TC05 | 实际批量编辑为白/黑/蓝标签，再清空并重新设置 | 标签实时改变、删除；文字与背景可读 | 页面 reload=0，白底黑字、黑底白字，批量保存和清空均热更新 | 通过 |
| TC06 | 实际条形/环形视图 × 默认/Mikus CSS 状态 × 深/浅色 × 320/375/414/768/1440px | 明确颜色跨主题一致，不强制大写、无横向溢出 | 40 种组合通过，同时断言实际环形卡片数量；桌面/手机截图已查看 | 通过 |
| TC07 | 编辑框标签问号悬停、键盘 Tab/Escape、外部点击；手机点击展开关闭，切换中英日 | 沿用原交互/浮层，列出七个颜色及规则，手机无溢出 | `browser.json`：交互通过，七个色样、HEX 和默认顺序提示可见，help-desktop/mobile.png 已查看 | 通过 |
| TC08 | 导出并重新导入带配色的节点，再重启隔离主控 | 标签原文、大小写与色值后缀保持 | 原节点和导入节点重启后 tags 与保存文本完全一致 | 通过 |
| TG01 | 完整构建与回归 | 既有业务和 Agent 保持正常 | `test-all.log`：105/105 Node，配置及 Go vet/test；主控 19/19、原生 Agent 6/6 | 通过 |
| TG02 | 构建候选镜像，核对本地源码/资产并使用断网生产副本启动 | 候选即已测版本，原数据/归档可兼容 | `source-integrity.json`：108 个源码/清单、313 个构建文件一致；`candidate-smoke.json`：15 节点、设置/归档不变，SQLite integrity=ok | 通过 |

浏览器脚本前两轮失败均保留原始日志：第一次在已聚焦问号上再次调用 focus，没有触发新的键盘焦点事件；改为实际 Tab/Shift+Tab 后通过。第二次测试脚本在 about:blank 执行 localStorage 初始化，被浏览器拒绝；将夹具初始化限定到 HTTP(S) 文档后通过。最终再次显式固定条形/环形视图并校验对应 DOM，8 个流程、40 个布局、pageerror=[] 全部通过。未修改产品代码来规避这些测试工具问题。

已于 **2026-09-19 22:09:57（Asia/Shanghai）** 部署到 `https://jm.zedy.cc`，运行镜像 `sha256:bb3171ef49c5dfc971f01038e7cf5cb7ebefca581edb9df548a5823e1fbda50c`，容器 healthy、RestartCount=0。

| 编号 | 功能 / 实际操作 | 预期结果 | 实际证据 | 状态 |
| --- | --- | --- | --- | --- |
| TP01 | 原 Compose 项目替换主控，核对生产环境、端口和挂载 | 运行已测镜像，配置/数据卷保持 | `deployment.json`：环境、端口、挂载逐项一致；200ms 探针 31 次，5 次失败，首末失败跨度 0.808 秒（不是精确停机时长） | 通过 |
| TP02 | 公网逐台检查条形/环形、1440px/375px 标签 | 旧标签保留原文，默认配色与大小写正确，无溢出 | `production.json`：15 台节点、17 个自定义标签，在四种组合中逐项核对文字/背景/前景/大小写样式通过；手机卡片截图已查看 | 通过 |
| TP03 | 两入口读取 JS/CSS，公网打开财务并观察 WSS | 正式资产匹配，财务仅按价格展示，实时推送正常 | 两入口各 9 个 JS/CSS 哈希匹配；13 张付费卡片与正价格节点一致；WSS hello=1、subscribed=1、batchUpdate=45，pageerror=[] | 通过 |
| TP04 | 等待节点重连后与切换前快照逐行核对 | 全部节点恢复，设置/标签/历史/归档保留 | `persistence-final.json`：15/15 节点切换后上报，15 节点及 3 条设置完整相同；54,578 条切换前历史逐行保留，核验时历史增至 54,626；30 个归档哈希一致，SQLite integrity=ok | 通过 |
| TP05 | 浏览器退出后持续 30 秒观察健康与上报 | 服务持续健康、无新增运行错误 | `steady-state.json`：7 轮、14 次 HTTP 200，各轮 15 台近期上报，runtimeErrors=[]，容器无重启 | 通过 |

第一次公网浏览器检查已完成全部标签、资产和财务断言，并完成 WSS 握手/订阅，但在 15 秒数据等待窗口内未收到批次而失败；原结果保留在 `production-first.json` / `.log`。随后确认 15 台节点均已切换后重新上报，允许正常重连等待后复测，收到 45 批更新并通过，未修改生产代码或配置。浏览器操作期间存在 `[http] Premature close` 请求提前关闭日志，最终独立 30 秒观察无新增；不声称整段发布日志完全无告警。

滚动全部节点后立即截图，手机首张卡片曾因既有 `content-visibility: auto` 尚未绘制而在截图中空白；逐台 DOM、文本、颜色断言均通过。补充实际滚入视口、等待绘制并捕获 `production-bar-mobile-card.png` / `production-ring-mobile-card.png`，两张均已查看，标签和卡片正常。

备份目录：`/opt/1panel/apps/jan_monitor/backups/tag-colors-20260919T140703Z`，含环境文件、一致性数据库、Agent 归档和切换前 `monitor-pre-switch.sqlite`；目录 0700、环境文件 0600。回滚镜像：`server-monitor:rollback-tag-colors-20260919t140703z`。沿用原 `.env`、`127.0.0.1:26129` 和数据目录；未向生产写入测试标签或修改服务器配置，全部编辑、批量、导入和重启写测试仅在隔离环境完成。

本次浏览器、隔离主控及候选检查容器已关闭，生产测试副本已清理，备份与回滚镜像保留。源码和文档修改保留在工作区，未提交/推送 Git；测试产物位于 Git 忽略目录。本次未更改 Agent 安装/更新/分发逻辑，未额外运行 `test:agent-deployment`，主控部署已独立实测。

## 财务弹窗按服务器展示剩余价值（2026-09-19）

将首页 `$ finance --summary` 弹窗中的六个独立汇率框替换为服务器剩余价值卡片：名称、剩余天数、剩余价值在卡片内横向排列，桌面两列、768px 及以下一列。顺序沿用后台保存的服务器顺序，免费、白嫖标签及无有效正价格的节点不展示；隐藏服务器继续由公共 API 排除。保留顶部三项汇总、汇率来源和币种切换，删除“已计价、已到期、无到期日”统计。

- 环境：Node.js v24.21.0、Go 1.26.8、Chromium，临时 SQLite / 回环随机端口；先执行 `npm ci`、`npm run geoip:download`、`npm run build`。修改后完整构建并执行全套测试，最终样式修正后再次完整构建和浏览器复测。
- 剩余天数按剩余毫秒数向上取整，过期为 0 天，无到期时间/无效日期为 `—`；金额复用已有折算和封顶公式。日期异常不冒充有效剩余天数。中/英/日文案同步。
- 证据目录：`output/test-results/finance-summary-20260919/`，Git 忽略。浏览器接口使用固定汇率夹具以验证精确金额，不将夹具结果描述为第三方汇率可用性测试。

| 编号 | 功能 / 操作 | 预期结果 | 实际证据 | 状态 |
| --- | --- | --- | --- | --- |
| FS01 | 启动隔离主控，后台 API 添加 50 台节点并反向保存排序，打开财务弹窗 | 按后台顺序展示付费节点，免费/白嫖/隐藏/无有效价格不展示 | `browser.json`：44 张卡片，名称顺序逐项匹配；365 元年付剩 100 天为 100 元，12 美元月付剩 15 天在夹具汇率下为 30 元；到期、无日期、无效日期、提前续费封顶、不足一天均通过 | 通过 |
| FS02 | 检查新卡片、六个旧汇率框及三个旧统计，切换 USD 后刷新 | 旧框和统计移除，顶部三项汇总保留；新卡片和汇总统一币种，偏好持久化 | `browser.json`：旧 DOM=0，汇总=3，USD 年付测试显示 $20.00，刷新仍选择 USD；当天缓存命中 | 通过 |
| FS03 | 重启隔离主控，再查询服务器；实际关闭/重开弹窗 | 排序和计费数据持久化，关闭与 OK 可用 | `browser.json`：重启后公共列表顺序一致，弹窗关闭/重新打开成功 | 通过 |
| FS04 | 将所有测试节点通过后台批量改为免费 | 不展示服务器卡片，显示空状态 | `browser.json`：卡片数 0，空状态可见 | 通过 |
| FL01 | 中/英/日 × 深/浅色 × 320/375/414/768/1440px | 无横向溢出，字段横排，桌面两列，窄屏一列，50 节点可滚动至最后 | `browser.json`：30 种布局通过；四张深浅色桌面/手机截图已查看。首轮发现币种标签换行，修正后完整复测 34 项均通过，pageerror=[] | 通过 |
| FR01 | 完整回归和真实主控/原生 Agent 验收 | 既有功能保持 | `test-all.log`：101/101 Node、Agent 配置、Go vet/test 通过；`controller-acceptance.json` 19/19，`native-acceptance.json` 6/6 | 通过 |
| FD01 | 构建候选 Docker 镜像，核对源码、前端和 Agent 归档 | 镜像与浏览器已测版本一致 | `source-integrity.json`：105 个源码/清单、312 个构建文件一致，依赖版本和 Agent manifest 与生产一致 | 通过 |
| FD02 | 备份生产数据/环境/归档和旧镜像，将数据副本挂到断网候选容器 | 候选能使用现有数据，生产节点/设置/归档不变 | `prepare.log`、`candidate-smoke.json`：15 台节点，SQLite integrity=ok，HTTP 和 8 个 JS/CSS 通过，network=none | 通过 |

已于 **2026-09-19 21:35:54（Asia/Shanghai）** 部署到 `https://jm.zedy.cc`，生产容器 healthy，RestartCount=0。

| 编号 | 功能 / 操作 | 预期结果 | 实际证据 | 状态 |
| --- | --- | --- | --- | --- |
| FD03 | 原 Compose 项目替换主控并等待健康 | 原环境、端口、数据卷保持，生产运行候选镜像 | `deployment.json`：环境、挂载、端口逐项一致，镜像 `sha256:d7ead91c065e9db6747e84285e14c1a20bcae9e9f3ebf719f63c904582e89496`；200ms 探针 32 次，5 次失败，首末失败跨度 0.81 秒（不是精确停机时长） | 通过 |
| FP01 | 公网 Chromium 点击剩余价值，在桌面和手机检查，再切换 JPY 并刷新 | 13 台付费服务器依后台顺序展示，2 台免费节点不展示，币种偏好持久化，旧框/旧计数消失 | `production.json`：15 台节点、13 张卡片；1440px 两列、375px 一列，无横向溢出、最后卡片可见、pageerror=[]；两张实际主题截图已查看 | 通过 |
| FP02 | 回环和公网读取全部 JS/CSS，观察 WSS 连接及真实更新 | 正式资产与已测构建相同，推送持续可用 | `production.json`：两入口各 8 个 JS/CSS 哈希匹配；WSS hello=2、subscribed=2、batchUpdate=10 | 通过 |
| FP03 | 对比切换前一致性快照与生产节点、设置、全部历史及归档 | 数据保留，所有 Agent 在切换后继续上报 | `persistence-final.json`：15/15 节点均切换后上报；15 节点、3 条设置、53,933 条旧历史及 30 个归档哈希保持，核验时历史增至 53,963 条；SQLite integrity=ok | 通过 |
| FP04 | 浏览器退出后持续检查两入口健康、近期上报和日志 | 主控持续健康，真实上报继续 | 复查 `steady-state.json`：30 秒 7 轮、14 次 HTTP 200，每轮 15 台近期上报，无新增 HTTP/WS 错误，重启次数 0 | 通过（首轮日志告警见下） |

首轮持续检查的健康请求与 15 台节点上报均正常，但期间记录 3 条 `[http] Premature close`，因此“日志无错误”断言失败，原始结果保存在 `steady-state-first.json` / `.log`。浏览器操作期间也有此类请求提前关闭日志，未据此推断服务端数据损坏。再次独立观察 30 秒，健康、上报、日志断言全部通过；不将整段部署日志描述为完全无告警。

生产沿用 `127.0.0.1:26129`、`/opt/1panel/apps/jan_monitor/.env` 和原始数据目录。备份：`/opt/1panel/apps/jan_monitor/backups/finance-summary-20260919T133440Z`（含切换前 `monitor-pre-switch.sqlite`），目录 0700、环境文件 0600；回滚镜像：`server-monitor:rollback-finance-summary-20260919t133440z`。本次测试浏览器、隔离主控和候选测试容器已关闭，生产测试副本已删除，部署备份及回滚镜像保留。源码修改保留在工作区，未提交或推送 Git。

此次没有修改 Agent 安装、更新或分发逻辑，未额外运行 `test:agent-deployment`；主控容器部署已独立实测。

## 首页切回延迟与丢包缺样修复（2026-09-19，已部署生产并完成清理）

已修复历史快照合并误用上报接收时间的问题：以 `sample_timestamp` 判断历史写入进度，保留尚未落库的实时延迟/丢包点。缺少该字段时沿用 `timestamp`、`last_updated` 的兼容回退。修复提交 `4b61d45` 已同步 GitHub 并于 **2026-09-19 20:20:52（Asia/Shanghai）** 部署至 `https://jm.zedy.cc`，未创建 PR。正式首页后台停留 8 分 45.597 秒后切回，14 台当前区间尚未落库的节点保留实时样本，全程误清空次数为 0。按用户要求完成部署备份、生产测试副本及旧主控镜像清理。下方 TR01–TR06 为修复前问题核实记录。

### 本轮环境与验收

- Linux amd64，Node.js v24.21.0、Go 1.26.8、Chromium 有界面模式 / Xvfb。开发前执行 `npm ci`、`npm run geoip:download`、`npm run build`，修改后重新完整构建四目标 Agent 和前端。
- 浏览器使用新建临时 SQLite、回环随机端口及测试凭据；真实 WS 上报、真实标签页隐藏/切回，等待实际一分钟周期刷新，并通过 CDP 暂停/恢复页面。未加速系统时钟。条形图与环形图的已保存截图均已查看。
- 证据目录：`output/test-results/tab-return-fix-20260919/`（Git 忽略）。Node/Go、主控与原生 Agent 验收在最终本地构建完成后执行；Docker 构建使用独立文件系统，不与本地 dist 清理竞争。

| 编号 | 功能 / 操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| TF01 | 对旧代码运行新增的接收/落库时间分离测试，再应用修复 | 测试能捕捉当前格被清空、同格退回旧值，并在修复后保留最新值 | `regression-before.log`：新增两项均失败（undefined/306，期望 65）；`regression-after.log`：快照及延迟窗口 12/12 通过，同时验证零丢包、真实缺口、超时、禁用探针和已持久化历史清空 | 通过 |
| TF02 | 未落库样本显示后切换真实标签页、重复焦点刷新、切换两种卡片视图、等待一分钟刷新、解冻恢复 | 53/63/73ms 及 0/1/2% 保持，下一条实时样本可继续更新 | `browser.json` 六项结果均 true，pageerror=[]；`isolated-after-return-tooltip.png` 显示切回后 53ms，`isolated-bar-fixed.png` 显示后续 54ms；清空已持久化历史后所有柱按预期缺样 | 通过 |
| TF03 | 全量回归及真实 HTTP/WS/SQLite、原生 Agent 验收 | 既有行为保持，真实上报尚未落库时 REST 刷新不覆盖实时延迟和丢包 | `test-all.log`：101/101、配置与 Go vet/test；`controller-acceptance.json` 19/19，A05 新增 `retainedAfterRefresh=true`；`native-acceptance.json` 6/6 | 通过 |
| TF04 | 构建候选镜像、核对源码/资产/归档、使用生产一致性快照在断网容器启动 | 镜像包含已测试修复，生产配置和数据可兼容使用 | `source-integrity.json`：源码、312 个构建文件与已测版本一致，Agent manifest 与生产一致；`candidate-smoke.json`：15 台节点、设置、归档不变，数据库 integrity=ok，HTTP 与 8 个 JS/CSS 校验通过 | 通过 |
| TF05 | 将已测试内容写入 GitHub 当前分支，再用原 Compose 项目替换生产容器 | Git、候选镜像及生产源码一致；沿用环境、端口和数据卷 | `git-publish/published.json`：逐个文件树哈希一致，分支仅快进；`deployment.json`：远端提交 `4b61d45`，容器 `4fb38e087e4c`，healthy，环境/端口/挂载不变 | 通过 |
| TF06 | 正式首页后台停留 525.597 秒，在新六分钟区间开始后切回并观察 20 秒 | 刷新不丢弃已有实时延迟/丢包点 | `production-summary.json`：12 次 REST、3894 批 WS、364 次 DOM 状态变化，`unexpectedClears=0`、`pendingNodesRetained=14`、pageerror=[]；8 个生产 JS/CSS 与已测构建一致，`production-return.png` 已查看 | 通过 |
| TF07 | 部署后等待全部 Agent 上报，对比节点、设置、历史及 Agent 归档 | 原有数据保留并持续接收新数据 | `persistence-final.json`：15 台均在部署后上报；15 节点、3 条设置不变；51,681 条切换前历史逐行全部保留；30 个归档哈希不变，SQLite integrity=ok、RestartCount=0 | 通过 |
| TF08 | 浏览器退出后连续 30 秒检查回环与公网健康、上报和运行日志 | 持续健康，所有 Agent 活跃，无新增 HTTP/WS 错误 | `steady-state.json`：7 轮共 14 次 HTTP 200，每轮 15 台近期上报，runtimeErrors=[]，数据库完整性与容器状态正常 | 通过 |
| TF09 | 上述验收通过后删除部署备份、生产副本及旧镜像，再复查实际运行数据 | 清理指定产物，当前主控与数据继续可用 | `cleanup-result.json`、`post-cleanup.json`：7 个部署备份目录、6 个 `production-data-copy`、1 个旧镜像已删除；备份目录为空，仅保留 `server-monitor:local 515614703a47`；15 节点、52,057 条历史及 30 个 Agent 归档仍在，两入口健康 200 | 通过 |

生产镜像为 `server-monitor:local`，ID `sha256:515614703a471d3d0b681721854ce50ed964c8c3f14c312f400c8df99481c94d`。切换时 200ms 探针采样 32 次，其中 5 次失败，首末失败跨度 0.809 秒；这是采样结果，不作为精确停机时长。原 `.env`、`127.0.0.1:26129` 和 `/opt/1panel/apps/jan_monitor/data` 保持一致。

主机未配置命令行 GitHub 推送凭据，因此使用已连接且有仓库写权限的 GitHub 账号同步此前 3 个未推送提交及本次修复，保留每个提交的文件树与说明，不强制覆盖远端。GitHub 创建的新提交元数据使 SHA 更新；本次本地原提交 `e00abbd` 与远端 `4b61d45` 的文件树均为 `c0cefe9d971e1e40735f35361635e84191374394`，本地分支已对齐远端，原本地历史保留为 `archive/local-history-before-github-sync-20260919`。

清理在生产浏览器与持续健康验证通过后执行：`/opt/1panel/apps/jan_monitor/backups/` 下全部 7 个部署备份目录和测试结果目录中的 6 份生产数据副本已移除，删除的备份文件逻辑大小合计 2,425,411,323 字节（不是镜像层实际回收空间）。旧镜像 `3b29b116f283` 和临时候选标签已移除，Docker 仅保留当前主控镜像标签。下方历史报告中的旧备份路径与回滚镜像已按本次授权清理；生产数据卷和原生 Agent 历史版本归档保持。测试浏览器、临时主控和候选检查容器均已关闭。

本轮仅修改前端历史合并逻辑及相关测试、文档，未更改 Agent 安装、更新或分发逻辑，因此不额外重跑 Agent 安装部署套件；Docker 主控启动与实际部署单独验证。

## 首页切回标签页后最新延迟、丢包缺样核实（2026-09-19，仅核实）

**问题属实，隔离环境及正式首页浏览器均已复现。** 正式首页后台停留 7 分 54.319 秒后切回，15 台服务器中有 7 台已显示数值的最新延迟/丢包柱被刷新成“无样本”，服务器仍在线，3 秒检查时这些节点均已随新上报恢复。隔离复现中，最新延迟数字仍为 53ms，但三网延迟及丢包的最右侧六个柱同时缺样；已落库的对照节点正常，新 WS 样本可恢复，再次刷新又复现。本次只记录诊断结果，未修改业务代码、生产配置或部署。

### 环境、操作与证据

- 按要求先执行 `npm ci`、`npm run geoip:download`、`npm run build`，使用 `/tmp/jan-monitor-tools/env.sh` 中的 Node.js v24.21.0 / Go 1.26.8；完整构建前端及四目标 Agent，依赖审计 0 vulnerabilities。
- 隔离环境使用全新临时 SQLite、回环随机端口、两台测试节点和真实 HTTP / WS。WS 节点历史写入周期 180 秒，首个已存样本预置在上一个六分钟柱区间，后续样本、页面事件均使用真实时间；不改系统时钟或应用源码。HTTP 对照节点已保存当前区间的数据。
- Chromium 在 Xvfb 中以有界面模式运行。通过 `connectOverCDP({ noDefaults: true })` 连接，避免 Playwright 默认的持续可见模拟；实测 `document.hidden` 的 true→false 事件。隔离测试后台停留 3.107 秒，说明长时间隐藏不是必要条件。
- 正式站点仅匿名读取 `https://jm.zedy.cc` 页面/API，并观察浏览器本地状态；生产 Dashboard 与 playback 两个 JS 文件哈希和本次构建一致，15 台节点的历史/实时上报配置为 30 秒 / 2 秒。真实后台驻留约 8 分钟，在 20:00 六分钟图区间开始后 4 秒切回，针对当前区间尚未落库的边界进行检查；没有注入生产数据或加速时钟。
- 证据位于 `output/test-results/tab-return-20260919/`，受 Git 忽略。`reproduce.mjs`、`real-browser.mjs` 为隔离复现程序；`reproduction.json`、`reproduce.log`、`isolated-before.png`、`isolated-after-return-tooltip.png` 保存操作、接口值、DOM 与已查看截图。生产观测为 `production-observe.mjs`。

| 编号 | 功能 / 实际操作 | 预期结果 | 验证方式与实际证据 | 状态 |
| --- | --- | --- | --- | --- |
| TR01 | 安装依赖、下载地区库、完整构建后启动独立主控并加载首页 | HTTP、WS、SQLite 和页面可用 | `npm-ci.log`、`geoip-download.log`、`build.log`；健康检查、两台卡片及实时 53ms 显示均通过 | 通过 |
| TR02 | 实时样本尚未落库时，切到另一真实标签页再切回 | 已显示的当前延迟/丢包样本保留 | `reproduction.json`：WS ACK `persisted=false`；切回后六个柱从 53/63/73ms、0/1/2% 变为“无样本”，数值标题和在线状态保留 | 失败，已复现 |
| TR03 | 对照已落库节点，并在异常后发送下一条 WS 样本，再触发焦点刷新 | 对照不空白；新样本可显示，后续刷新保持 | 对照始终保留 83/93/103ms 与 0/1/2%；异常节点收到下一条上报后恢复 54/64/74ms，再次刷新六个柱再次缺样 | 对照与恢复通过；重复刷新失败 |
| TR04 | 正式首页保持后台，观察真实周期刷新与最新柱变化 | 已收到的当前区间样本不被刷新清空 | `production-hidden-interim.json`、`production-interim-clears.json`：19:54:05.655（Asia/Shanghai）有 8 台节点在同一 19:54 区间由有效数值变为“无样本”；后续实时样本在 370–1693ms 内恢复 | 失败，线上已观察到 |
| TR05 | 正式首页后台停留 474.319 秒后真实切回，并继续观察 20 秒 | 当前实时数据保持完整 | `production-observation.json`、`production-summary.json`、已查看的 `production-return.png`：20:00:04.011 切回，7 台在线节点出现 8 次“同一区间已有值→无样本”转换（其中一台重复清空）；每次在 63–1541ms 后恢复，3 秒检查时这些节点均已恢复；收到 11 次 REST、3729 批 WS，pageerror=[] | 失败，线上切回已复现 |
| TR06 | 完整回归及真实主控、原生 Agent 验收 | 既有测试无失败 | `test-all.log`：Node 99/99、配置及 Go vet/test 通过；`test-acceptance.log`、`controller-acceptance.json` 19/19、`native-acceptance.json` 6/6 | 通过，但未覆盖本缺陷 |

### 已定位原因及范围

1. `src/frontend/views/Dashboard.vue:1156` 在页面可见、重新获得焦点等事件中调用 `refreshData({ preserveLive: true })`；每分钟定时刷新也使用这条路径。
2. `src/utils/metrics.js:217` 分别返回 `sample_timestamp`（已落库样本时间）和 `last_updated`（最近认证上报接收时间）。WS 实时上报可以先广播而未到历史写入周期，见 `src/realtime/RealtimeHub.js:752`。
3. `src/frontend/utils/latencyWindow.js:65` 却将 `snapshot.last_updated` 当作落库时间，过滤掉时间不大于它的本地实时柱样本。隔离证据中，已落库样本为 19:47:59.000，实时样本为 19:52:07.503，接收时间为 19:52:07.514；实时样本尚未落库，仍被错误丢弃。
4. 主指标合并正确保留较新的实时数值，因此可以出现“数字 53ms 仍在、柱提示无样本”。随后 REST 中的 `latestReportUpdates` 受 `Dashboard.vue:786` 的严格时间递增过滤，同时间戳样本不会重新补回柱中，只能等待后续新样本或历史写入。

当前六分钟区间还没有历史样本的节点会显示空柱，已保存该区间样本的节点通常不空，因此只影响部分服务器。已有 `test/dashboard-snapshot.test.js` 将 `last_updated` 设为旧的历史时间，没有覆盖接收时间已前进、落库时间未前进的组合；全套测试通过不能抵消本次浏览器复现的失败。

本次已确认的是最新柱缺样及下一次实时上报恢复，未将其描述为服务端历史丢失或持续无法恢复。生产统计只计入同一时间格中“已有样本→无样本”的转换，排除本来就缺样的节点。按用户“先核实”的范围保留原实现；没有进行修复发布，也未触发 Agent 安装、更新或分发变更，未重跑 Docker 部署验收。专用浏览器与隔离主控已关闭，临时浏览器配置及专项测试数据库已清理。

## 审查修复正式部署（2026-09-19）

已于 **2026-09-19 17:13:56（Asia/Shanghai）** 将修复提交 `cc0b315` 部署到 `https://jm.zedy.cc`。容器 healthy、RestartCount=0；15 台节点均恢复上报，公网 HTTPS/WSS、月流量字段和桌面/手机页面实测通过。切换前的 47,922 条历史、全部节点与设置、30 个 Agent 归档文件完整保留。已按用户要求提交 Git，未创建 PR；下方“未部署生产”的内容为本次发布前的历史验证记录。

### 发布验收

| 编号 | 功能 / 实际操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| RD01 | 暂存并检查改动，提交修复，重新构建候选镜像并运行全套验收 | 提交、镜像、已测源码一致，无密钥或测试产物入库 | `cc0b315`；Node 99/99、Agent 配置和 Go vet/test、主控 19/19、原生 6/6、Docker 6/6；`source-integrity.json` 核对 105 个源码/清单及 312 个构建文件 | 通过 |
| RD02 | 备份生产环境文件、Compose、在线一致性 SQLite、GeoIP 和 Agent 归档，保留旧镜像 | 数据与配置可恢复，旧镜像可回滚 | `prepare-deploy.log`、`deployment.json`：备份 SQLite integrity=ok，目录 0700、环境文件 0600；切换前再次在线备份 | 通过 |
| RD03 | 将生产数据副本挂载到断网候选容器启动 | 新 schema 可创建，节点/设置不变，静态资源及原生归档匹配 | `candidate-smoke.json`：network=none、15 节点、server_presence 创建成功、8 个 JS/CSS 与浏览器已测构建一致；旧脚本 8 个 URL 均 404，原生安装器可用 | 通过 |
| RD04 | 用原 Compose 项目替换 monitor 服务 | 新容器健康，原环境、端口和数据挂载保持 | `compose-up.log`、`deployment.json`：容器 `0f35b22760bc` healthy，原配置逐项相同；200 ms 健康采样 33 次，失败 5 次，首末失败间隔 0.81 秒 | 通过 |
| RD05 | 等待 Agent 重连，再逐行对比节点/设置、历史和归档哈希 | 原数据完整保留，真实上报写入新增 presence 并继续增加历史 | `reconnection.json`、`persistence-final.json`：15/15 presence，15 节点及 3 条设置相同，47,922 条旧历史全部保留，核验时历史增至 47,991；30 个归档哈希相同，SQLite integrity=ok | 通过 |
| RD06 | 从回环和公网读取页面/资源/下载目录；Chromium 查看桌面、手机并滚动到最后节点 | HTTPS/WSS 可用，所有节点显示，旧入口下线，新版本及历史 Agent 目录正常 | `production-smoke.json`：两入口 8 个 JS/CSS 哈希匹配；15 张卡片，WSS hello/subscribed 和 50 批更新，46 个新样本含月流量；手机无横向溢出、末尾卡片渲染、后台登录页正常，pageerror/requestfailed=[] | 通过 |
| RD07 | 关闭测试浏览器后继续检查回环/公网健康及近期上报 | 健康检查持续成功，全部 Agent 继续上报，无新增运行错误 | `steady-state.json`：30 秒、7 轮共 14 次 HTTP 200；每轮 15 台近期上报；无新增 HTTP/WS 错误日志 | 通过 |

运行镜像 `server-monitor:local`，候选保留标签 `server-monitor:review-fixes-20260919`，ID `sha256:3b29b116f2833db264da25e10d638f73cfbc01fc05d55e40d7d87e33e8a9a629`。沿用 `/opt/1panel/apps/jan_monitor/.env`、`127.0.0.1:26129` 和原数据卷。回滚镜像为 `server-monitor:rollback-review-fixes-20260919t090906z`；备份目录 `/opt/1panel/apps/jan_monitor/backups/review-fixes-20260919T090906Z/`，最终切换前快照为其中的 `monitor-pre-switch.sqlite`。

本轮证据目录为 `output/test-results/review-fixes-deploy-20260919/`（Git 忽略）。提交前暂存区检查补清理了两个新文件中的 5 处行尾空格，因此重新构建并对最终提交重跑全部回归和 Docker 验收；未改变业务逻辑。镜像锁文件仅有 npm prune 去除的 4 个 peer 元数据标记与本地不同，依赖版本和完整性信息一致，且与原生产镜像锁文件一致。浏览器沿用上一轮已测前端，核对全部构建文件哈希后再在生产实测。

首轮 presence 检查在重启后过早执行，仅 5/15 节点已重新上报；没有修改 Agent 或生产配置，等待正常重连/上报周期后为 15/15，并完整重跑持久化核验。手机末尾卡片使用既有 `content-visibility: auto` 延迟绘制，初次脚本在滚动后立即读取文字过早；增加等待实际渲染的断言后通过，未修改页面样式或降低断言。原失败日志分别保留为 `presence-first-check.log`、`mobile-first-check.log`。

测试浏览器运行期间，主控出现若干 `[http] Premature close` 日志；公网请求断言及浏览器 pageerror/requestfailed 检查均通过。关闭浏览器后的 30 秒复查无新增 HTTP/WS 错误，不将整段发布日志描述为完全无警告。

公网验证未登录生产后台、修改账号/2FA、添加或删除节点；这些写操作已在隔离环境验收。本次只更新主控，未向 VPS 执行 Agent 安装/升级/卸载；原生版本仍为 v1.2.0，历史版本保留。测试容器和浏览器已关闭，桌面及手机首屏/底部截图已查看。探针失败跨度不是精确停机时长，短时验证不代表长期稳定性保证。

## 审查问题修复、去重与职责拆分（2026-09-19，未部署生产）

已修复下方审查记录中的 F01–F09，并完成 S01–S03 对应的无效代码清理、重复实现合并和职责拆分。最终版本 Node 回归 99/99、Agent 配置与 Go vet/test、主控验收 19/19、原生 Agent 验收 6/6、Docker 部署验收 6/6 全部通过；Chromium 实际等待一分钟验证首页刷新，并验证详情月流量及密码修改后重新登录。50 Agent / 10 看板连接持续 60 秒负载复验通过。旧审查中的失败记录保留为修复前证据，不代表当前状态。

### 环境与执行

- Linux amd64；Node.js v24.21.0、Go 1.26.8、Docker 29.7.2。主机命令显式加载 `/tmp/jan-monitor-tools/env.sh`，未使用系统默认 Node 26。
- 开发前执行 `npm ci`、`npm run geoip:download`、`npm run build`；修改后重新完整构建前端和 Linux/FreeBSD 各 amd64/arm64 四个 Agent 程序。地区库为 2026-09，原生 Agent 版本仍为 v1.2.0，未修改其采集实现或发布版本。
- HTTP/WS、浏览器和负载验证使用先行创建的临时 SQLite、回环随机端口及测试凭证；Docker 使用隔离 internal bridge 和独立 TLS 反代。未读取生产数据、重启生产服务或向真实通知渠道发送消息。
- 最终构建完成后依次运行 `npm run test:all`、`npm run test:acceptance`。构建 `server-monitor:agent-native` 后运行 `npm run test:agent-deployment`；浏览器及负载程序分别为证据目录下的 `browser.mjs`、`load.mjs`。

### 验收项

| 编号 | 功能 / 实际操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| RF01 | 准备依赖、地区库并完整构建最终代码 | 前端和四目标产物可用 | `npm-ci.log`、`geoip-download.log`、`build.log`；Docker 构建见 `docker-build.log` | 通过 |
| RF02 | 真实登录、修改账号/密码，复用旧 Bearer/Cookie/WS 凭证；制造设置并发、哈希升级竞争和事务写入失败 | 凭证与会话版本原子变化，旧会话不可复用；已启用 2FA、恢复码状态及并发外观增量保留；失败无部分提交 | `test/credential-change.test.js`、`test-all.log`；浏览器 `passwordChangeRequiresLogin=true`、`newPasswordLogin=true`；另完成独立鉴权复核 | 通过 |
| RF03 | 无通知渠道、发送失败、发送成功时分别处理待发事件 | 无渠道保留待发且不增加尝试；失败退避；仅明确送达才写 delivered_at | `test/review-regressions.test.js` F02；真实 HTTP 验收中的本地 Webhook；无真实外部渠道调用 | 通过 |
| RF04 | 预置旧历史、设置 180 秒间隔和两分钟离线阈值，再真实 WS 上报并检测离线 | 即使 ACK 为 persisted=false，也记录新接收时间且不产生离线告警 | F03：持久 presence 新、历史仍旧；共用在线判断；旧历史时间由夹具预置，非等待 150 秒 | 通过 |
| RF05 | 分别单删和批删节点后导入相同 UUID，再查询历史、快照和资源窗口 | SQLite 及内存状态均清理，不恢复旧样本或告警窗口 | F04 真实 HTTP/WS/SQLite 生命周期；每种删除方式使用独立节点 ID，避免读缓存掩盖问题 | 通过 |
| RF06 | 经新增、编辑、导入提交非法间隔、重置日、探测地址、流量校正，以及合法配置 | 入口遵循同一校验，非法数据不入库，导入提供逐条错误 | F07；`test/agent-commands.test.js` 共享表单、计费和探测规则检查 | 通过 |
| RF07 | 提交后半段非法、重复、不存在的排序 ID，以及非法批量编辑；注入 SQLite 写入故障 | 提交前完整校验；写入故障整体回滚，无部分排序或编辑 | F08 真实 API 与数据库故障触发器 | 通过 |
| RF08 | 关闭三网详情，保持首页打开；月流量 10→30 GB、CPU 11→44%；新增节点并等待实际一分钟；进入详情再上报 40 GB | 月流量实时变化，周期刷新发现新节点并订阅，详情动态更新 | `browser.json`：30 GB/30%、两节点、详情 40 GB；程序断言新节点后续 WS CPU=66、详情 CPU=55；两张截图已查看，pageerror=[] | 通过 |
| RF09 | 请求 8 个旧根路径脚本和原生安装入口；检查安装/卸载命令 | 旧脚本全部 404，原生 `/agent/install.sh` 可用，保留四平台分发和协议 | F09 真实 HTTP；Docker ND01 同样校验旧 URL；命令 shell 语法及引用检查 | 通过 |
| RF10 | 运行完整主控/Agent 回归和真实程序验收 | 既有鉴权、协议、采集、历史、地区识别及备份恢复行为保持 | `test-all.log`：Node 99/99、配置及 Go 测试；`controller-acceptance.json` 19/19、`native-acceptance.json` 6/6 | 通过 |
| RF11 | 隔离 Docker 中安装、HTTPS/WSS 上报、自动更新、重建主控、禁用自动更新及卸载 | 四目标可下载，更新保留配置与流量，重建保留历史和版本归档，卸载完成 | `agent-deployment.log`、`deployment.json` ND01–ND06；合成旧版本 v1.0.99→v1.2.0，非真实旧服务迁移测试 | 通过 |
| RF12 | 搜索调用点、解析后端静态导入、比较共用规则及检查删除清单 | 消除已确认重复所有权和循环依赖，旧公开脚本不存在 | `structure.json`：backendCycles=[]、unusedImports=[]、legacyPublicScripts=[]；无用导入检查为启发式，不等于证明全项目无死代码 | 通过（静态检查） |
| RF13 | 50 条 Agent WS 每两秒上报，10 条看板 WS 接收，持续实际 60 秒；结束后检查 presence | 全部确认、广播且主控健康，所有节点接收时间持久化 | `load.json`、`load.log`：1500 reports、15000 deliveredUpdates、health P95=34.2 ms、errors=[]，50 条近期 presence | 通过 |

F01 按 `codex-security:fix-finding` 要求完成独立边界分析及修复后只读复核，补查真实 HTTP/Cookie/WS 入口、2FA/恢复码消费和受控异步竞争；发现的外观覆盖、事务外告警状态清理及并行旧密码哈希升级问题已纳入修复和回归。没有变更 Agent 的 `API_SECRET` 或把 Agent 鉴权与管理员会话混用。

本轮证据目录：`output/test-results/review-fixes-20260919/`（Git 忽略）。测试主控、Agent、浏览器及本轮 Docker 测试容器已结束，保留隔离测试证据供复核；未提交凭证或测试产物。源码改动见 changelog.md、architecture.md、code_map.md；发现与处理映射见 CODE_REVIEW.md。

过程中曾修正新增测试夹具的字段/调用匹配及浏览器按钮大小写定位。另有一次全套回归与前端构建并行运行，构建清理 dist 导致首页暂时 503、相关用例失败；原日志保留为 `test-all-build-race.log`。之后先完成构建、再串行运行完整回归及验收，得到上表最终通过结果，未降低业务断言。

限制：未部署生产；未在 FreeBSD 或 arm64 真机运行，四目标仅完成构建、下载和校验，原生执行为 Linux amd64。Docker 使用合成旧版本夹具，`legacyServiceMigrated=false`，不宣称本轮复验了真实旧 `cf-probe` 服务迁移。未测试真实外部通知服务或长时间稳定性；一分钟负载结果不外推为长期容量保证，Go 测试复用了工具链缓存。

## 项目代码审查与缺陷复现（2026-09-19）

基线 `2a2694c`；本轮仅审查和验证，未修改业务代码或部署。现有回归全部通过，另以 HTTP/WS、SQLite 和 Chromium 确认 9 项行为问题；完整分析及结构问题见 [CODE_REVIEW.md](CODE_REVIEW.md)。下表中的“失败（已复现）”表示实际行为不满足该验收项，不表示既有测试命令失败。

环境：使用 `/tmp/jan-monitor-tools/env.sh` 中的 Node.js v24.21.0、Go 1.26.8；先执行 `npm ci`、`npm run geoip:download`、`npm run build`，四个 Agent 目标及前端构建成功。测试主控使用提前创建的全新临时数据目录、回环地址随机端口与测试凭证，调度关闭；没有读取生产数据或发送真实渠道通知。Chromium 使用既有本地工具，浏览器外部请求被阻止。

| 编号 | 功能 / 实际操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| RV01 | 安装依赖、下载地区库、完整构建 | 环境与四平台产物准备完成 | `npm-ci.log`、`geoip-download.log`、`build.log`；GeoIP 2026-09，4 目标构建完成 | 通过 |
| RV02 | 运行 `npm run test:all` | 既有主控与 Agent 回归通过 | `test-all.log`：Node 87/87、Agent 配置及 Go vet/test 通过 | 通过 |
| RV03 | 运行 `npm run test:acceptance` | 真实主控和本机 Agent 流程通过 | `acceptance.log`、`controller-acceptance.json` 19/19、`native-acceptance.json` 6/6 | 通过 |
| RV04 | 删除节点后重新导入同一 UUID，再读取历史及实时快照 | 已删除历史和最新状态不再返回 | `reproduction.json` R01：SQLite history/latest 均 0 行，API 历史仍 1 条、旧上报仍 1 包，CPU=73 | 失败（已复现） |
| RV05 | 提交先合法后非法的排序 ID 数组 | 返回失败时不改变原顺序 | R02：HTTP 400，但 sort_order 从 1 变 0，后台缓存仍返回 1 | 失败（已复现） |
| RV06 | 导入非法间隔、重置日、地址和校正值，再原样编辑 | 导入与编辑遵循相同校验 | R03：导入 1 条非法记录，原样编辑返回 400 | 失败（已复现） |
| RV07 | 从完整构建的主控读取新旧安装脚本 URL | 发布内容符合原生四平台分发边界 | R04：旧 Linux/macOS/Windows 安装器及 Windows 卸载器仍 HTTP 200；只读取，未执行 | 失败（已复现） |
| RV08 | 设置 180 秒落库间隔和两分钟离线阈值，预置 150 秒前落库状态，再真实 WS 上报并运行离线检测 | 新上报的节点不产生离线告警 | R05：socket 正常，实时包约 24 ms，persisted=false，却产生离线事件；旧时刻由夹具预置，未等待 150 秒 | 失败（已复现） |
| RV09 | 关闭通知渠道后处理已有待发队列 | 未发送的消息不应标为已送达 | R06：无发送请求却写入 delivered_at、attempts=1、last_error=null | 失败（已复现） |
| RV10 | 修改管理员密码后继续使用旧 JWT | 旧凭证对应会话撤销或要求重新验证 | R07：旧密码登录 401，新密码 200，但旧 JWT 读取管理设置仍 200 | 失败（已复现） |
| RV11 | 页面持续打开，月流量 10→30 GB、CPU 11→44%，等待真实一分钟刷新 | 月流量、额度比例与其他指标一起更新 | `browser.json`：CPU=44%，周期 REST 已完成，月流量仍 10 GB/10%；重载才为 30 GB/30%；截图已查看 | 失败（已复现） |
| RV12 | 页面持续打开时新增节点并上报，等待周期 REST | 页面加入节点并更新订阅 | `browser.json`：API 两节点，页面一节点；重载后两节点；浏览器 pageerror=[] | 失败（已复现） |
| RV13 | 搜索调用点、解析静态导入及比较函数源码 | 识别可验证的重复代码和依赖边界 | `structure.json`：notification/outbox 循环依赖；4 个逐字相同计费函数合计 60 行；旧 public 脚本 11,426 行；无调用者明细见审查报告 | 完成（静态分析） |

本轮证据目录：`output/test-results/review-20260919/`（Git 忽略）。复现程序和浏览器程序均已关闭自己的主控、socket 和浏览器，临时数据库路径保留在 JSON 中供复核。原有自动化套件不包含上述新增边界；复现脚本退出成功表示采集完成，不能视为业务验收通过。

未进行生产部署、Docker 安装/更新/卸载验收、FreeBSD/arm64 真机或长时间负载验证；原生实测为 Linux amd64，Go 工具链使用现有测试缓存。没有业务实现变更，因此未添加功能变更日志，未提交测试数据或凭证。

## 后台顶栏与退出按钮右边界对齐（2026-09-17）

**已修复并于 2026-09-17 17:01（Asia/Shanghai）部署至 `https://jm.zedy.cc`。** 顶栏与下方面板统一使用 20px 水平内边距；刷新/退出按钮组换行后继续靠右。Chromium 在隔离环境的 1440、768、390、320px，中/英/日文，深色/浅色共 24 种组合下测得顶栏按钮组与退出按钮右边界差均为 0px；公网已核对同一构建的资源哈希及浏览器加载的对齐样式。

开发前使用 Node.js v24.21.0 / Go 1.26.8 依次执行 `npm ci`、`npm run geoip:download`、`npm run build`，全部完成，依赖审计 0 vulnerabilities，四个 Agent 目标完整构建。修改前预建全新临时 SQLite、回环地址主控和 Chromium 环境并实际登录取样；修改后运行 `npm run build:frontend`、`npm run test:all`、`npm run test:acceptance`。通知调度关闭，未读取生产数据。

| 编号 | 功能 / 实际操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| AL01 | 修改前真实登录后台、进入设置，切换宽度/语言/主题 | 复现并量化偏差 | `before.json`：24 种组合；同一行布局偏差 4px，手机英文/日文换行后偏差约 104–185px；`before-1440.png`、`before-390.png` 已查看 | 通过 |
| AL02 | 修改后重复 24 种组合，测量顶栏和退出按钮边界 | 两组右边界一致，顶部三个按钮保持等大，换行不破坏对齐 | `after.json`：所有 rightDelta=0，三个按钮均 36×36、顶边一致、有可访问名称；按钮组均位于视口内，页面宽度未增加；桌面、390px 和 320px 截图已查看 | 通过 |
| AL03 | 点击语言和主题、刷新页面、点击首页/后台入口，再退出并重访后台 | 偏好保留、跳转正常、退出后要求登录 | `after.json`：preferencesPersist=true、logoutWorks=true、returnToAdminRightDelta=0，首页顶栏仍为 16px 留白，pageerror=[] | 通过 |
| AL04 | 完整回归、主控与原生 Agent 验收、构建检查 | 既有功能保持正常 | `test-all.log`：Node 87/87、Agent 配置及 Go vet/test 通过；`controller-acceptance.json` 19/19、`native-acceptance.json` 6/6；前后构建及 `git diff --check` 通过 | 通过 |

证据目录为 `output/test-results/admin-alignment-20260917/`（Git 忽略），浏览器脚本为 `browser.mjs`，测试主控及浏览器已关闭。此项仅修改 CSS，未修改部署配置或 Agent 安装/更新/分发逻辑，未运行 Docker 部署套件。

320px 英文设置页在修改前后均存在 15px 的表单横向溢出，本次顶栏与退出按钮仍在视口内且对齐，未将整页无溢出记为通过。初次浏览器检查因此调整为验证无新增溢出；另修正了退出验收预期（实际返回首页，再进入后台才显示登录框），复验通过，初次记录保留。原生验收结果的归档复制首次使用了错误文件路径，已从 `agent-integration/native-acceptance.json` 正确归档，不涉及测试失败。

### 本项正式部署验收

| 编号 | 功能 / 实际操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| ALD01 | 构建候选镜像，核对源码及验收记录，备份当前配置/SQLite/GeoIP/Agent 归档并保留旧镜像 | 发布内容来自已验收修改，具备完整回滚资料 | `docker-build.log`、`source-integrity.json`、`prepare-deploy.log`：89 个源码/清单文件已核对，相对原镜像仅 main.css 改变；87 项回归、19 项主控、6 项原生及 24 种浏览器布局证据齐全；备份 SQLite integrity=ok | 通过 |
| ALD02 | 将生产数据副本挂载到 network=none 的候选容器，访问健康/页面/API/Agent 目录和静态文件 | 原数据正常读取，资源与浏览器已测版本一致 | `candidate-smoke.json`：13 节点，8 个 JS/CSS 哈希匹配，v1.2.0 Agent 归档不变，旧版本保留且每版公开四个目标；预检容器已清理 | 通过 |
| ALD03 | 切换前再次在线备份数据库，使用既有 Compose 项目重建 monitor 服务 | 新容器健康，环境/端口/数据卷保持一致 | `deploy.log`、`deployment.json`：容器 96b4906c826b healthy，RestartCount=0；200ms 探针采样 32 次、失败 5 次，首末失败间隔 0.803 秒 | 通过 |
| ALD04 | 逐行比较切换前后的节点和设置、检查旧历史及归档哈希 | 已有数据全部保留，继续接收上报 | `persistence-final.json`：13 节点、3 条设置相同；3341 条旧历史全部保留，检查时已增至 3367 条；30 个 Agent 归档文件 SHA-256 不变；SQLite integrity=ok | 通过 |
| ALD05 | 回环地址和公网 HTTPS 读取页面/资产，Chromium 桌面与手机切换语言/主题并等待真实 WSS 更新 | 修复资源已发布，浏览器及实时数据正常 | `production-smoke.json`：两条入口 8 个静态资源哈希均匹配；桌面/手机加载的后台对齐规则为 padding-inline=20px、margin-left=auto；WSS hello/subscribed 和 26 批更新，包含打开页面后的新样本；pageerror/requestfailed=[]，390px 首页溢出为 0，后台登录页正常 | 通过 |

运行镜像 `server-monitor:local`，ID `sha256:a3b4e99ace1ad6527c30b60e1d2a209920900bb1c910630daf0bd3a51a6bcd38`；部署时间 `2026-09-17T17:01:58.126113+08:00`。沿用 `/opt/1panel/apps/jan_monitor/.env`、`127.0.0.1:26129` 和原数据卷。回滚镜像 `server-monitor:rollback-admin-alignment-20260917-170007`；备份 `/opt/1panel/apps/jan_monitor/backups/admin-alignment-20260917-170007/`（目录 0700、环境文件 0600）。

部署证据位于 `output/test-results/admin-alignment-deploy-20260917/`（Git 忽略），公网桌面和手机截图已查看，验证浏览器已关闭。公网复验读取页面和 CSS 规则，未登录生产后台或修改设置；后台像素对齐及退出操作的实际验证来自 AL02/AL03 的隔离环境。探针失败间隔是采样结果，不作为精确停机时长。源码核对发现 Docker 的 npm prune 去掉锁文件内 4 个 peer 元数据标记；确认依赖版本和完整性信息一致，候选锁文件与旧生产镜像完全相同后通过检查。

## 后台界面更新正式部署（2026-09-17）

**已将已验收的后台界面更新部署到 `https://jm.zedy.cc`。** 容器 healthy、RestartCount=0；公网 HTTPS 页面和 WSS 实时更新正常，13 台服务器、设置和切换前历史完整保留。采用此前通过 87 项回归、19 项主控、6 项原生 Agent、6 项 Docker 部署和 10 项浏览器专项的同一候选镜像，没有重新生成未经验证的程序。

| 编号 | 功能 / 实际操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| UD01 | 备份配置、在线一致性数据库快照、GeoIP 和 Agent 归档，保留旧镜像 | 可回滚，备份完整且不会把测试写入生产 | `deployment.json`、`archive-before.json`：13 节点，备份 SQLite integrity=ok，30 个归档文件记录哈希；切换前再次备份 | 通过 |
| UD02 | 候选镜像以生产数据副本在 network=none 容器启动 | 原数据可读取，页面/资产和旧 Agent 目录正常 | `candidate-smoke.json`：13 节点、8 个 JS/CSS 与浏览器测试构建一致，v1.2.0 归档不变；`source-integrity.json`：86 个源码文件与工作区一致 | 通过 |
| UD03 | 使用既有 Compose 项目更新 monitor 服务 | 新容器健康，沿用端口、环境及持久卷 | `compose-up.log`、`deployment.json`：healthy，环境/端口/挂载完全一致；200ms 探针观察到 6 次失败，首末失败间隔 1.003 秒 | 通过 |
| UD04 | 对比切换前数据库、环境和 Agent 归档 | 节点、设置、历史和程序全部保留 | `persistence-final.json`：13 台节点和 3 条设置逐行一致，2561 条旧历史全部保留、检查时增至 2574 条；30 个归档文件哈希一致；SQLite integrity=ok | 通过 |
| UD05 | 访问回环地址和正式 HTTPS 页面、后台入口、静态资产及 Agent 目录 | 新界面已实际发布，旧版本仍可下载 | `production-smoke.json`：两条入口全部 HTTP 200，8 个 JS/CSS 哈希与已测试构建一致，v1.1.0/v1.1.1/v1.2.0 目录均保留、每版公开四个目标 | 通过 |
| UD06 | 公网 Chromium 桌面/手机查看并点击语言、主题按钮，等待真实 Agent 更新 | 方形控件和切换可用，无溢出、页面异常和连接错误 | `production-smoke.json`：36×36、语言及主题切换通过、手机横向溢出 0；WSS 收到 hello/subscribed 和 13 批数据，包含页面打开后的真实新样本；pageerror/requestfailed 均为空，后台登录表单正常渲染 | 通过 |

部署时间 `2026-09-17T16:12:06.485428+08:00`，容器 `e9bde803eb70`；运行镜像 `server-monitor:local`，ID `sha256:51e971435c205db74f8b684be9e5720e9879425d2e12413d0caa2cd7bd252919`。沿用 `/opt/1panel/apps/jan_monitor/.env`、`127.0.0.1:26129` 和原数据卷；回滚镜像 `server-monitor:rollback-admin-ui-20260917-161051`，备份 `/opt/1panel/apps/jan_monitor/backups/admin-ui-20260917-161051/`（目录 0700、环境文件 0600）。

本轮没有修改生产设置或远端 Agent；后台保存、删除、账号密码和 2FA 等操作已在前一轮隔离环境实测，公网复验只读访问页面并切换浏览器本地显示偏好。切换中观察到的失败间隔是采样结果，不作为精确停机时长。证据位于 `output/test-results/admin-ui-deploy-20260917/`（Git 忽略），预检容器和浏览器进程已清理。

## 后台设置与交互精简（2026-09-17）

**清单中的界面与交互已完成，随后已部署正式站点，部署记录见上文。** 使用独立数据库、HTTP/HTTPS 主控及 Chromium 验证真实页面和剪贴板。最终 Node 回归 87/87、Agent 配置与 Go vet/test、主控验收 19/19、原生 Agent 验收 6/6、浏览器专项 10/10 通过；Docker 安装、更新、重建和卸载验收 6/6 通过。安全框内账号修改、重新登录、TOTP 绑定及恢复码关闭均实测。

### 环境和命令

- Linux amd64；Node.js v24.21.0、Go 1.26.8，工具链来自 `/tmp/jan-monitor-tools/`。系统默认 Node 为 26，本轮开发与验收命令显式使用项目要求的 Node 24。
- 开发前按顺序执行 `npm ci`、`npm run geoip:download`、`npm run build`，依赖审计为 0 vulnerabilities；完整构建 Linux/FreeBSD 各 amd64/arm64 四个原生程序及前端。
- 修改前先启动全新隔离主控、准备三台测试节点与本地 TLS 代理，并在浏览器登录后保存原始界面截图。通知调度关闭，未使用生产数据库或向真实通知渠道发送消息。
- 修改后执行 `npm run build:frontend`、`npm run test:all`、`npm run test:acceptance`；构建 `server-monitor:admin-ui-20260917` 和 `server-monitor:agent-native`，执行 `AGENT_TEST_IMAGE=server-monitor:admin-ui-20260917 npm run test:agent-deployment`。
- 浏览器专项脚本：`node output/test-results/admin-ui-20260917/browser.mjs`；候选镜像检查：同目录 `candidate-smoke.mjs`。脚本、日志、JSON、截图与测试凭证均位于 Git 忽略的证据目录，未纳入源码。

### 验收项

| 编号 | 功能 / 实际操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| UI01 | 打开隔离 HTTPS 后台，用真实表单登录 | 成功加载三台服务器 | `browser.json` UI01：实际表单及 HTTP 登录，servers=3 | 通过 |
| UI02 | 查看未设/零流量阈值及已设 2048GB 的服务器，点击复制流量 | 无限制显示并复制 `∞`，有限制继续显示容量 | 实际列表为 `∞`、`2 TB`、`2 TB`；读取真实系统剪贴板为 `∞` | 通过 |
| UI03 | 单台勾选、取消、再启用自动更新并保存；再批量启用 | 不出现自动更新警告，保存结果正常 | `browser.json` UI03：开关状态立即变化、后台实际保存为 1，批量全部为 1，浏览器 confirm/dialog=0 | 通过 |
| UI04 | Linux 当前用户/专用用户、其他 Linux、FreeBSD 四种安装方式逐一复制 | 剪贴板等于完整预览，成功后关闭弹窗 | 四次真实剪贴板逐字比对，均含当前主控 `/agent/install.sh`、自动更新参数；copyModal 全部关闭 | 通过 |
| UI05 | 注入 Clipboard API 拒绝，再注入回退复制失败 | 正常回退复制后关闭；完全失败时保留命令并提示 | 回退使用实际文本域和系统剪贴板，内容相等；失败路径显示手动复制提示，原弹窗保留且临时文本域清除 | 通过 |
| UI06 | 删除弹窗切换 Linux/其他 Linux/FreeBSD 及专用用户，复制卸载命令，再删除测试节点 | 下载源输入消失，使用当前主控，原删除功能正常 | `browser.json` UI06、`delete-after.png`：命令与剪贴板一致，下载源为当前主控，删除后节点数 2 | 通过 |
| UI07a | 点击语言按钮依次切换中/日/英，刷新并跳转首页/后台 | 单按钮循环，文案和语言偏好持久化 | `browser.json` UI07：ja/en/zh 完整循环，刷新保留日文，首页/后台入口可用 | 通过 |
| UI07b | 点击主题按钮、使用 Enter/Space，再改变模拟系统配色 | 深色/浅色/跟随系统循环且偏好保存 | UI07：三种偏好正确，auto 随系统改变，刷新保持深色，键盘操作通过 | 通过 |
| UI07c | 桌面与手机、三种语言和明暗主题下测量顶栏 | 语言、主题、设置/主页三个按钮均为等大正方形 | UI07/UI08 的 DOM 实测：每个按钮 36×36，顶边一致，均有可访问名称和悬停提示；没有旧的按钮列表 | 通过 |
| UI08a | 在 1440px/390px、中/英/日、深色/浅色的 12 种组合查看通知框 | Bot Token 和 Chat ID 上下排列且左右对齐 | `browser.json` UI08：输入框左边差和宽度差均为 0，上下间距为正；页面横向溢出 0；四张 `settings-*.png` 留存，桌面/手机截图已检查 | 通过 |
| UI08b | 检查安全框并保存普通设置 | 没有 JWT 前端编辑入口，也不提交密钥 | UI08/UI09：JWT 输入数 0，保存请求无 jwt_secret；SQLite 内密钥摘要保存前后相同 | 通过 |
| UI08c | 在合并后的安全框修改用户名和密码，再重新登录 | 管理员登录与 2FA 位于同一框，原功能正常 | UI08/UI09：同一 security-settings 内含账号与双重验证；不匹配密码被拒绝，新账号密码真实登录成功 | 通过 |
| UI08d | 查看 PING 框、输入无效及有效地址并保存 | 仅四项可编辑，无效地址阻止保存，隐藏字段不被覆盖 | UI08/UI09：四个输入组；非法 URL 禁止保存，合法 host:port 保存；请求无 Node 1–4 及名称，预置旧 Node 1 值和名称保持 | 通过 |
| UI09 | 保存通知凭证、PING 和账号密码，检查请求、API、数据库并重新登录 | 配置真实保存，隐藏字段及 JWT 保留 | `browser.json` UI09：通知两项、custom_ct 均读取一致，旧节点保留，JWT 未变，重新登录成功 | 通过 |
| UI10 | 在合并安全框用新密码启用 TOTP，再使用一个恢复码关闭 | 完成绑定、显示 10 个恢复码、成功关闭 | `browser.json` UI10：实际设置 API 和表单流程；浏览器 pageerror=0，confirm/dialog=0 | 通过 |
| UI11 | 停止隔离主控，将其数据副本交给最终 Docker 镜像启动 | 重启后配置和密钥保留，构建资产匹配浏览器已测版本 | `candidate-smoke.json`：network=none，健康/页面/登录正常，2 节点、通知及 PING 配置保留，JWT 相同、2FA 关闭状态保持、SQLite integrity=ok；8 个 JS/CSS SHA-256 与本地构建一致 | 通过 |
| UI12 | 执行完整回归和主控、原生验收 | 既有主控、协议、采集、历史和权限行为保持 | `test-all-final.log`：87/87、配置和 Go 测试；`controller-acceptance.json` 19/19、`native-acceptance.json` 6/6 | 通过 |
| UI13 | 在独立 Docker 网络安装 Agent、自动更新、重建主控、关闭更新及卸载 | 当前分发、安装和卸载流程可用 | `agent-deployment-final.log`、`agent-deployment.json` ND01–ND06；Linux amd64 实际 HTTPS/WSS 上报、v1.0.99 测试版本更新到 v1.2.0、配置及流量保留、卸载完成 | 通过 |

### 复验、产物与边界

- 浏览器首次保存编辑发现删除警告弹窗后仍有旧关闭回调残留，导致保存成功后显示前端错误；已清除该调用并重新构建，单台/批量保存及完整专项复验全部通过。初次失败证据保留为 `browser-initial-failure.json`。
- 候选镜像 `server-monitor:admin-ui-20260917`，ID `sha256:51e971435c205db74f8b684be9e5720e9879425d2e12413d0caa2cd7bd252919`；开发验收采用隔离环境，随后经用户要求上线到生产 `server-monitor:local`，部署及备份记录见上文。
- JWT 仅移除前端配置功能，主控自动生成、持久化及验证逻辑保持；没有清除现有 JWT 或 Node 1–4 数据。PING 精简范围为全局设置框，单台/批量节点参数与 Agent 协议仍兼容现有字段。
- 自动更新此次只移除前端警告，VPS 本地开关仍通过安装命令控制；勾选后台开关本身不会远程启用本地自动更新。
- 原生运行和 Docker 部署实测范围为 Linux amd64，使用容器后台进程模式；FreeBSD、ARM64 和真实 systemd 用户服务本轮未运行。四个发布目标已完整构建，FreeBSD 及专用用户命令已在浏览器检查与复制。
- 证据目录为 `output/test-results/admin-ui-20260917/`；`git diff --check` 通过。测试进程、容器和网络在完成后清理，测试数据库和日志不提交。

## 延迟、丢包柱统一固定 10px（2026-09-17）

**已完成并重新部署正式站点。** 延迟和丢包的所有柱子固定为 10px，悬停、不同颜色和实时数值变化都不改变高度；颜色、透明度、数字和提示沿用原逻辑。此改动只影响主控前端，Agent 仍为 v1.2.0，现有 VPS 无需升级即可看到新样式。

### 环境和验收

开发前使用 Node.js v24.21.0 / Go 1.26.8 执行 `npm ci`、`npm run geoip:download`、`npm run build`；修改后执行前端构建、`npm run test:all`、`npm run test:acceptance` 和 Docker 镜像构建。浏览器和主控验收使用提前准备的隔离数据库；生产数据副本预检容器使用 `--network none`。

| 编号 | 功能 / 操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| FH01 | 修改前通过正式 HTTPS 页面测量黄色柱 | 以现有黄色视觉高度确定固定值 | `yellow-before.json`：黄色柱约 9.406–10.766px，统一取 10px | 通过 |
| FH02 | 隔离主控预置绿/蓝/黄/红、缺测和超时，Chromium 打开 1440px/390px 条形与环形卡片 | 所有柱子等高，颜色和提示继续区分实际数据 | `browser-cards.json`：4 种组合共 240 对柱（480 根）实测全部 10px，左右基线差 0px；五种延迟颜色、丢包变化、100% 和缺测提示正确；`cards-*.png` | 通过 |
| FH03 | 四种布局分别悬停；通过 HTTP 上报将 306ms/0% 改为 65ms/25%，等待 WS 更新 | 高度保持 10px，颜色和提示更新 | `browser-cards.json`：全部 hoverKeepsFixedHeight=true；CARD-LIVE 两侧颜色实际改变、高度不变，无浏览器异常 | 通过 |
| FH04 | 执行完整回归与主控/原生验收 | 已有主控和 Agent 功能保持 | `test-all.log`：87/87、配置和 Go vet/test 通过；`controller-acceptance.json` 19/19，`native-acceptance.json` 6/6 | 通过 |
| FH05 | 新镜像以生产数据副本启动，检查页面、资产及归档 | 兼容原数据，前端来自测试构建，Agent 产物不变 | `candidate-smoke.json`：健康及页面/API 正常，8 个静态资源哈希匹配，v1.2.0 manifest 与原生产备份一致；隔离预检容器已清理 | 通过 |
| FH06 | 备份后重建现有 Compose 服务并比对数据 | 新容器健康，原环境/端口/卷/节点/设置/历史与 Agent 文件保留 | `deployment.json`、`persistence-final.json`：healthy、RestartCount=0，SQLite integrity=ok；2 节点与设置逐行一致，861 条旧历史全部保留，30 个 Agent 归档文件哈希不变 | 通过 |
| FH07 | 公网 HTTPS 访问和 Chromium 桌面/手机复验，等待真实 Agent 推送 | 已部署固定高度，实时更新和登录页面正常 | `production-smoke.json`：桌面/手机各 120 对柱实测全部 10px，最大高度差/基线差 0px；收到 WSS hello/subscribed 和 2 批新数据，无页面异常或请求失败；`production-homepage.png`、`production-mobile.png` 已检查 | 通过 |

### 部署和边界

- 最终镜像 `server-monitor:local`，ID `sha256:fd267309af971a17cc763297c711a5699207b624ccfa3bd3f7af904528be4c64`；容器 `cf0a7825e1ac`，部署时间 `2026-09-17T12:50:27.003397+08:00`。沿用 `/opt/1panel/apps/jan_monitor/.env`、`127.0.0.1:26129` 和原数据目录。
- 回滚镜像 `server-monitor:rollback-fixed-bars-20260917-124908`；备份 `/opt/1panel/apps/jan_monitor/backups/fixed-bars-20260917-124908/`，包含环境、SQLite 一致性快照、GeoIP 和原 Agent 归档；切换前再次备份数据库。切换期间 200ms 探针观察到 5 次失败，首末失败间隔 0.803 秒，非精确停机时长。
- 删除前端动态柱高计算、内联高度及悬停纵向缩放，仅由 `.three-net-bucket-fill` 设置固定高度；颜色判定、窗口采样、阈值和提示未改变。修改现有回归测试的颜色/数值断言，未新增重复实现的单元测试。
- 此轮没有 Agent 安装、更新或分发逻辑变更，未重复运行 Docker Agent 部署套件；v1.2.0 归档逐文件验证不变，完整原生验收仍已执行。
- 证据位于 `output/test-results/fixed-bars-20260917/`（Git 忽略）；未提交密钥、配置副本、构建产物或测试文件。`git diff --check` 通过。

## 柱图对齐、每日 Agent 更新和 jan-probe 服务（2026-09-17）

**已修复三个问题并部署至 `https://jm.zedy.cc`，主控分发 Agent `v1.2.0`。** 87/87 项 Node 回归、Agent 配置与 Go vet/test、19/19 项主控验收、6/6 项原生 Agent 验收、6/6 项隔离 Docker 部署验收通过；Chromium 验证桌面/手机、条形/环形卡片，以及公网 HTTPS/WSS。旧 `v1.1.1` 原生程序实际自动升级到 `v1.2.0`，安装后的程序改为 `jan-probe`，配置和流量保留。

### 环境与实现

- 使用 Node.js v24.21.0、Go 1.26.8，开发前完成 `npm ci`、`npm run geoip:download`、`npm run build`。修改后完整构建四个受支持目标，再完成最终前端及 Docker 构建；依赖、前端、Agent 和候选镜像均经过实际验证。
- 丢包图每个时间桶使用对应延迟桶的高度，颜色、数值及提示仍来自真实丢包数据；两侧标题行统一为 18px，消除混合字号带来的逐行偏移。
- 仅安装本地配置 `AUTO_UPDATE=1` 启动检查器：启动时检查，此后每 24 小时检查并安装较新版本；关闭时不创建任务，后台配置推送仍不能远程打开本地开关。周期相对 Agent 启动计算，不是固定每天零点。
- 服务、已安装程序、PID/日志改为 `jan-probe`；安装迁移停止旧服务并保留配置、流量，再移除旧程序和旧服务。旧版用户服务自替换后通过独立 oneshot 用户单元运行迁移，避免停止旧服务时杀死迁移本身。旧、新进程共用实例锁。
- 为兼容旧客户端自动下载及既有状态，发布文件名继续使用 `cf-probe-<os>-<arch>`，配置/流量继续在 `/etc/config/cf-probe` 或 `~/.cf-probe`。升级失败时安装器尝试恢复原配置及旧服务。

### 验收项

| 编号 | 功能 / 操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| JP01 | 准备工具链、依赖与地区库，构建并执行完整回归 | 四目标和前端构建成功，现有功能保持 | `npm-ci.log`、`geoip-download.log`、`build.log`、`build-frontend-final.log`、`test-all.log`；87/87，Agent 配置、Go vet/test 通过；`controller-acceptance.json` 19/19、`native-acceptance.json` 6/6 | 通过 |
| JP02 | 在隔离真实主控写入不同延迟、0/非零丢包、超时和空缺；Chromium 打开 1440px/390px 条形与环形卡片 | 每个丢包柱与延迟柱高度及基线对齐，原始语义保留 | `browser-cards.json`：4 种组合共 240 对柱，最大高度差/基线差均 0px；多种颜色、100% 和空缺提示断言通过；`cards-*.png` | 通过 |
| JP03 | 页面保持打开时上报延迟从 306ms 改为 65ms、丢包从 0% 改为 25% | 实时推送使两侧柱高一起改变，丢包颜色/提示独立更新 | `browser-cards.json` 的 CARD-LIVE，实际 HTTP → WS → Chromium；无页面异常 | 通过 |
| JP04 | 启动检查、推进虚拟时钟到 24h/48h、取消后继续推进；关闭开关推进 72h | 启动及每日检查，关闭与取消后零检查 | `update_schedule_test.go` 使用 Go `testing/synctest` 执行真实计时循环；三个测试通过，时间未实际等待数天 | 通过 |
| JP05 | 隔离 TLS 主控及 Linux amd64 容器安装保留的真实 v1.1.1，等待自动升级 | 新程序/上报版本为 v1.2.0，旧程序清除，状态保留 | `agent-deployment.json` ND01–ND03：约 60 秒完成自动升级，进程名 jan-probe、AUTO_UPDATE=1、配置和流量文件保留，启动日志声明 24h 周期 | 通过 |
| JP06 | 重建隔离主控；覆盖安装显式关闭更新，再从后台勾选并推送其他配置，最后卸载 | 重连、版本归档和数据保留；本地开关仍为 0；卸载清理新旧程序 | `agent-deployment.json` ND04–ND06 全部通过；远程 collect_interval 更新实际生效，本地 AUTO_UPDATE 保持 0，当前运行日志无更新任务；无存活探针进程 | 通过 |
| JP07 | 非 root 真实旧 Agent 自替换、重启、迁移和卸载；用户服务管理器由隔离进程组监督器模拟 | 单独迁移任务不随旧服务退出，新单元和程序生效，旧单元移除 | `user-service-fixture/deployment.json` 四项通过，约 63 秒完成迁移；真实 TLS 下载、SHA-256、Agent 进程及上报，模拟部分明确标记 SIMULATED；新旧 unit 内容另有 Go 测试 | 通过（用户管理器模拟） |
| JP08 | 最终候选镜像在 network=none 容器读取生产备份副本 | 原数据库可读，新前端与三代 Agent 目录可用 | `candidate-smoke.json`：页面/API 正常、节点数 1，8 个静态文件哈希与已测试本地构建一致；Agent manifest 与 ND 测试产物完全一致 | 通过 |
| JP09 | 备份后替换生产 Compose 容器，核对健康、环境及持久化 | 新镜像健康，端口/挂载/环境/原始数据和旧归档保留 | `deployment.json`、`persistence-final.json`：healthy，RestartCount=0；SQLite integrity=ok，1 节点和设置逐行一致，755 条旧历史全部保留；旧归档 24 个文件哈希不变，新增 v1.2.0 四程序 | 通过 |
| JP10 | 公网 HTTPS 页面、后台登录表单、静态资源、Agent 目录及 Chromium WSS | 新版本实际生效，实时样本持续到达，线上柱高对齐 | `production-smoke.json`：8 资源哈希匹配，latest=v1.2.0；WSS hello/subscribed 和 3 批新样本，无页面异常/失败请求；桌面/手机共 120 对柱差值均 0px；`production-homepage.png`、`production-mobile.png` | 通过 |

### 部署记录与验证边界

- 镜像：`server-monitor:local`，ID `sha256:c0ef348a70ef23c24cfe789cfc27d3f0413bbdc2763088952999c394ea6acbbc`；容器 `6e5753424fcb`，2026-09-17 12:07:29（Asia/Shanghai）部署完成。沿用 `/opt/1panel/apps/jan_monitor/.env`、`127.0.0.1:26129` 和原数据卷，未改动环境配置。
- 回滚镜像：`server-monitor:rollback-jan-probe-20260917-120512`。备份位于 `/opt/1panel/apps/jan_monitor/backups/jan-probe-20260917-120512/`，包含当前环境、数据库在线一致性快照、GeoIP 与完整旧 Agent 归档；目录 0700，环境文件 0600。切换前另做 `monitor-pre-switch.sqlite`。
- 200ms 健康探测观察到 5 次切换失败采样，首末失败间隔约 0.804 秒；这是采样观测范围，并非精确停机时长。
- 浏览器初测发现两侧标题行造成 0.5px 基线差，修复后重新构建并复测为 0px；没有放宽验收容差。前端实时值变化、0 丢包、超时和缺测均验证。
- ND 为真实 Linux amd64 容器、后台进程模式；非 root 迁移补充验收使用真实 Agent 和进程组，**不等同于真实 systemd 用户管理器验收**。本轮未在 FreeBSD、ARM64、OpenRC 等环境运行服务；四种发布产物均已交叉编译和验证分发。
- 24h/48h/72h 使用 Go 虚拟时钟验证；真实容器验证了启动检查与完整下载、安装、重启链路，没有实际等待一天。
- 生产复核时节点上报版本为 v1.1.1，未声称 VPS 已升级到 v1.2.0。已有开启更新的旧 Agent 按自身原周期发现新版；未开启的 Agent 仍需手动覆盖安装。新服务名和每日周期在 VPS 升级后生效。
- 日志、JSON 和截图位于 `output/test-results/jan-probe-20260917/`（Git 忽略）；隔离测试容器和网络已清理，未修改宿主或生产 VPS 的探针服务，也未提交密钥、二进制或测试产物。

## 生产镜像重建与重新部署（2026-09-17）

**已将当前工作区构建并部署至 `https://jm.zedy.cc`。最终容器 healthy，87/87 项 Node 回归、Agent 配置与 Go vet/test、19/19 项主控验收、6/6 项原生 Agent 验收、5/5 项 Docker 部署验收全部通过。** 公网 Chromium 实测 HTTPS 页面及 WSS 实时推送正常；原节点、设置、历史数据和 Agent 归档保留。

### 环境、构建与部署

- Linux amd64，使用 `/tmp/jan-monitor-tools/env.sh` 的 Node.js v24.21.0、Go 1.26.8；执行 `npm ci`、`npm run geoip:download`、`npm run build`，完整构建四个 Agent 程序及前端。依赖审计 0 vulnerabilities。
- 执行 `npm run test:all`、`npm run test:acceptance`；执行 `docker build --pull --progress=plain -t server-monitor:redeploy-20260917-111530 -t server-monitor:agent-native .` 后运行 `npm run test:agent-deployment`。测试使用隔离目录、容器和网络。
- 将候选镜像标记为 `server-monitor:local`，通过 `docker compose --env-file /opt/1panel/apps/jan_monitor/.env -p jan_monitor -f /opt/1panel/jan_monitor/compose.yaml up -d --no-build --force-recreate --wait --wait-timeout 120 monitor` 更新既有服务。
- 最终镜像 ID：`sha256:02a50cc38cf076c8f33d37e7ff733fc8496dfcbac504ec0d10c98c6d0934cc45`；容器 `8530f0492469`。保留 `127.0.0.1:26129 -> 8080`、原 bridge 网络和 `/opt/1panel/apps/jan_monitor/data` 挂载。
- 部署前保留回滚镜像 `server-monitor:rollback-20260917-111530`，并在 `/opt/1panel/apps/jan_monitor/backups/redeploy-20260917-111530/` 保存原 `.env`、SQLite 在线一致性快照、GeoIP 库和历史 Agent 归档。切换前再次创建 `monitor-pre-switch.sqlite`，完整性检查为 `ok`；备份目录权限 0700。

### 验收项

| 编号 | 功能 / 操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| RD01 | 安装依赖、下载地区库、完整构建、执行回归及主控/原生验收 | 构建成功，既有功能通过 | `npm-ci.log`、`geoip-download.log`、`build.log`、`test-all.log`、`acceptance.log`：87/87、19/19、6/6，Agent 配置与 Go vet/test 通过 | 通过 |
| RD02 | 隔离 Docker bridge 内实际安装、自动更新、主控重建和卸载 | HTTPS/WSS、配置、流量及归档保留 | `agent-deployment.json`：ND01–ND05 全部 PASS；测试容器和网络已清理 | 通过 |
| RD03 | 新镜像在 `--network none` 容器读取生产备份副本 | 兼容原数据及 v1.1.0 归档，提供新前端和 v1.1.1 | `candidate-smoke.json`：健康、首页、后台、服务器 API 均 200，节点数 1；全部 8 个 JS/CSS 的 SHA-256 与本地构建一致 | 通过 |
| RD04 | 替换生产容器并等待 Docker 健康检查 | 新镜像启动，沿用端口及数据挂载 | `deployment.json`、`compose-up.log`、`proxy-config-recreate.log`：最终 healthy、RestartCount=0；端口及挂载未变 | 通过 |
| RD05 | 比对切换前快照、最终数据库及历史 Agent 文件 | 节点、设置和原历史记录全部保留 | `persistence-final.json`：SQLite integrity=ok，servers/settings 逐行一致；原 671 条历史全部保留，检查时增至 679 条；v1.1.0 原 16 个程序 SHA-256 全部一致，并新增 v1.1.1 归档 | 通过 |
| RD06 | 通过回环地址和正式 HTTPS 域名访问页面、API、静态文件及 Agent 目录 | 响应成功且新构建完整生效 | `production-smoke.json`：首页、后台入口、健康检查均 200；本地及公网全部 8 个前端资源哈希匹配，Agent 最新版 v1.1.1，两代版本均公开四个受支持目标 | 通过 |
| RD07 | Chromium 访问正式站点，订阅 WSS 并等待真实节点上报 | 页面正常渲染，连接建立并持续收到新样本 | `production-smoke.json`、`production-homepage.png`：TLS 校验开启，首页和后台登录表单正常；单条 WSS 收到 hello/subscribed 及 2 批实时更新，样本时间晚于页面打开时间；无页面异常或请求失败 | 通过 |

### 部署中发现并修复

- 初次公网浏览器检查发现 WSS 握手返回 403；回环 WS 正常，公网省略 Origin 或使用 HTTP Origin 可连接。原 `.env` 的 `TRUSTED_PROXIES` 为空，导致应用忽略 HTTPS 转发头，浏览器的 HTTPS Origin 与应用判断的 HTTP Origin 不一致。
- 通过容器网络命名空间的实际连接确认代理来源为 `172.20.0.1`，仅将 `.env` 的 `TRUSTED_PROXIES` 设为 `172.20.0.1/32`，保持其余环境配置不变并重建容器。旧镜像与新镜像的 `src/server.js`、`src/runtime/http.js` 哈希一致，属于原部署配置缺失；未修改应用代码、反代配置或放宽 Origin 校验。
- 配置修复后重新执行全部生产页面、资源、WSS 和持久化检查通过。初次失败证据保留为 `production-smoke-initial.log`、`wss-diagnostic.json`、`browser-diagnostic.json`，不计作通过。

### 证据与范围

- 本轮日志、脚本、JSON 和截图位于 Git 忽略目录 `output/test-results/redeploy-20260917-111530/`；备份及凭证未纳入源码。生产检查只读取页面、订阅实时数据并核对存储，没有创建测试节点或修改生产数据库内容。
- 生产后台检查到登录表单；登录、管理操作、安装/更新/卸载等有写入的操作在隔离环境执行。没有在生产主机手动安装或升级 Agent，也未执行 FreeBSD/arm64 真机测试或长时间负载测试。
- 旧镜像及原数据备份保留用于回滚；此次没有执行破坏性数据恢复或 Git 提交。下文保留之前各次测试记录。

## 首页持续刷新、后台列表对齐与安装弹窗验收（2026-09-17）

**最终 87/87 项 Node 回归、Agent 配置测试、Go vet/test、19/19 项主控验收、6/6 项原生 Agent 验收、5/5 项 Docker 部署验收通过。** Chromium 151 实际验证隐藏标签页持续收数、切回、冻结/解冻、断网恢复、旧响应竞争及运行超过原连接时限；桌面/手机列表、命令选项和实际剪贴板复制通过。生产容器和生产数据库未改动。

### 环境与执行

- Linux amd64 / Debian 13，独立 Node.js v24.21.0、Go 1.26.8，Chromium 151.0.7922.34、Xvfb、Docker 29.7.2。Node 与 Go 官方归档校验 SHA-256 后解压到 `/tmp/jan-monitor-tools/`；未替换系统工具链。Playwright 仅安装到 `/tmp/jan-monitor-browser/`，不新增项目依赖。
- 开发前执行 `npm ci`、地区库下载和完整 `npm run build`。首次依赖安装使用系统 Node 26，出现 engine 警告；后续构建和测试全部使用 Node 24。受限环境中的 npm/Go/GeoIP 网络下载与回环监听失败后，通过已获批准的命令重试成功。基线构建生成四个 Agent 产物。
- 浏览器测试前准备独立临时 SQLite、测试节点、回环 HTTP 主控、自签名 HTTPS/WSS 反代及测试证书。测试数据为可控 HTTP 上报，未操作真实服务器、生产凭证或外部通知渠道。
- 最终执行 `npm run test:all`、`npm run test:acceptance`、`npm run build:frontend`、`docker build -t server-monitor:agent-native .`、`npm run test:agent-deployment`。最后的前端恢复补充再次构建镜像，并在 `--network none` 临时容器启动主控，确认健康接口和首页 200、全部 8 个 JS/CSS 资源 SHA-256 与浏览器验收的本地构建完全一致。
- 浏览器第一次尝试发现 Playwright 默认强制焦点导致页面始终可见，因此改用独立启动的 Chromium，经 `connectOverCDP` 的 `noDefaults` 接入，实际确认 `document.hidden === true`。旧响应竞争测试从同一隔离主控的回环 HTTP 获取真实响应并延迟交付，避免测试请求上下文拒绝自签名证书。上述测试环境问题已解决，以下只记录最终结果。

### 验收项

| 编号 | 功能 / 操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| BR01 | 首页切到另一标签页，隐藏期间上报 CPU 42，再快速切换五次并上报 55 | 后台更新，普通切换保持同一连接，继续按上报刷新 | `after.json`：hidden=true、后台 CPU=42.00%、WS 未关闭；返回仍只有一个 WS，后续 CPU=55.00% | 通过 |
| BR02 | 用 Chromium CDP 实际冻结后台页面，上报 73，再解冻并切回 | 恢复后获取最新完整状态并恢复实时连接 | `after.json`：CPU=73.00%；执行 `Page.setWebLifecycleState`，不是手动派发假的可见性事件 | 通过 |
| BR03 | 浏览器断网并关闭测试页面连接，上报 81 后恢复网络 | 自动重连并补取最新值 | `after.json`：CPU=81.00%；新增单元回归模拟 12 次失败仍持续重连，卸载后停止；API 失败返回 null 而非空列表 | 通过 |
| BR04 | 拦住旧 REST 响应，WS 先上报 94，再释放旧响应 | 较旧快照不覆盖新指标，历史仍可补齐 | `after.json`：释放响应后仍为 94.00%；4 项快照回归覆盖元数据刷新、持久历史、新样本和已清空历史 | 通过 |
| BR05 | 配置连接时限为 1 分钟，首页实际运行 65 秒后上报 37 | 首页持续更新，不出现自动暂停 | `after.json`：65,028ms、CPU=37.00%、无页面异常；原有详情页超时单元回归保留通过 | 通过 |
| BA01 | 查看含双 IP、长备注、多标签、在线/离线节点的服务器列表，缩至 390px | 字段垂直居中，长表在容器内横向滚动 | `layout.json`：双 IP 行 14 个单元格内容中心偏差均为 0px；手机页面无整体横向溢出，截图已人工查看 | 通过 |
| BA02 | 打开安装弹窗，选择 Linux/其他 Linux/FreeBSD 和专用用户，再实际点击复制 | 无下载源/版本输入；固定主控源和默认版本，复制内容正确 | `after.json` 的表单仅系统、安装用户和命令；校验命令无 `--install-version`；`layout.json`：实际剪贴板与显示命令完全相等 | 通过 |
| RG01 | 执行完整回归及主控、原生 Agent 验收 | 历史、协议、配置、数据持久化等既有功能保持 | `test-all.log`：87/87、Agent 配置、Go vet/test；`acceptance.log`：主控 19/19、原生 6/6 | 通过 |
| DP01 | 隔离 Docker bridge 中实际安装旧版、自动更新、重建主控和卸载 | HTTPS/WSS、配置和流量保留、历史归档与清理正常 | `agent-deployment.log`、`deployment.json`：ND01–ND05 全部 PASS；临时容器/网络由套件清理 | 通过 |
| DP02 | 启动最后重建的镜像，获取全部前端资源并比较 SHA-256 | 最终镜像提供的前端与已验收构建一致 | `docker-smoke.log`：health=200、homepage=200、finalAssetHashesMatch=true | 通过 |

### 证据与边界

- 本轮证据为 Git 忽略的 `output/test-results/dashboard-admin/`：`test-all.log`、`acceptance.log`、`frontend-build.log`、`docker-build.log`、`agent-deployment.log`、`docker-smoke.log`、`browser.log`、`after.json`、`layout.json`，以及修复前后列表、弹窗、手机和首页截图。主控、原生和部署详细结果另外保存在 `output/test-results/acceptance.json` 和 `output/test-results/agent-integration/`。
- 页面不再主动按可见性断连或按时限暂停。Chrome 自身的后台计时器调度、页面冻结及操作系统休眠不能由网页取消；本轮已验证真实隐藏和 CDP 冻结恢复，未声称在系统休眠时仍能运行脚本或经过数小时节流实测。
- 安装器、Agent 采集协议和版本未改动；此次原生执行平台为 Linux amd64，不将交叉编译或 UI 选项检查等同于 FreeBSD/arm64 真机验收。没有把生成的一键安装命令在宿主机执行。
- 测试凭证、证书、数据库、日志、截图、下载工具链和构建产物均未纳入源码。此前验收记录保留如下。

## Agent 四目标构建与分发验收（2026-09-17）

当前 Agent **v1.1.1** 仅构建和分发 **Linux amd64/arm64、FreeBSD amd64/arm64**，共 4 个目标。使用新版本号避免与已有 v1.1.0 十六目标归档冲突；旧磁盘归档保持原样，公开接口只提供受支持的四类程序。

**四目标完整构建、82/82 项 Node 回归、Agent 配置测试、Go vet/test、19/19 项主控验收通过。** 四个实际 ELF 文件均完成 HTTP 下载、系统/架构识别、SHA-256 和持久归档验证。**完整 `test:acceptance` 未通过：主控阶段通过后，原生阶段因本机是 macOS 而阻塞；Docker 镜像构建及部署验收也因没有 Docker 而阻塞。** 这些限制不计作通过。

### 环境与执行

- macOS 15.8 / amd64，Node.js v24.19.0、Go 1.26.8。开发前实际执行 `npm ci`、`npm run geoip:download`、`npm run build`，随后修改并再次完整构建。基线构建仍为 16 目标；修改后的 `build.log` 明确只有 4 个 v1.1.1 目标。
- 完整构建使用 `npm run build`；专项初测使用 `node --test test/agent-distribution.test.js test/agent-install-platforms.test.js`，3/3 通过。随后新增实际产物测试并执行 `npm run test:all`，最终 Node 总数为 82/82。
- 实际执行 `npm run test:acceptance`：主控 19 项通过；`test/agent-acceptance.js` 在创建临时环境之前检查运行平台，macOS 不受支持，明确报错并以退出码 1 结束。没有临时加入 macOS 发布产物来绕过限制。
- 实际尝试 `docker build -t server-monitor:agent-native .`，退出码 127（`docker: command not found`）；随后执行 `npm run test:agent-deployment`，退出码 1（`spawn docker ENOENT`），未进入安装/更新测试案例。
- 证据均在 Git 忽略的 `output/test-results/agent-targets/`：`npm-ci.log`、`geoip-download.log`、`baseline-build.log`、`build.log`、`targeted.log`、`regression.log`、`acceptance.log`、`controller-acceptance.json`、`docker-build.log`、`deployment.log`、`manifest.json`、`removed-targets.json`、`browser.json`、`install-options.png`。

### 验收项

| 编号 | 功能 / 操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| AT01 | 执行完整构建并检查发布目录 | 新版本只有四种程序，Windows 安装脚本不再打包 | `build.log`：v1.1.1 Linux amd64/arm64、FreeBSD amd64/arm64；manifest 恰好四个资产，`agent-dist/install.ps1` 不存在 | 通过 |
| AT02 | 启动隔离主控，逐个下载四个实际程序 | 文件长度、SHA-256、ELF 位数、系统和 CPU 均正确 | `agent-build-targets.test.js` 实际 HTTP 200、SHA-256 比较、64 位 ELF、Linux/FreeBSD ABI、amd64/arm64 machine 检查；实际产物复制至临时持久归档后重复归档成功 | 通过 |
| AT03 | 请求被移除的程序和安装器，包括旧归档 | 不再公开 macOS、Windows、32 位 ARM/x86、LoongArch | 当前版本 12 个旧目标及 `/agent/install.ps1` 全部 HTTP 404；旧混合平台归档的 releases/manifest/checksums 仅列保留平台，旧支持目标仍可下载 | 通过 |
| AT04 | 启动安装脚本，模拟四种支持目标和九种不支持环境 | 正确选择、下载并校验四个文件；不支持的环境在下载前退出 | `agent-install-platforms.test.js` 实际执行 shell，四条正常路径各发起三次下载，九条异常路径请求数为零；测试载荷是明示的 shell fixture，不是 Linux/FreeBSD 原生程序运行证明 | 通过 |
| AT05 | 用构建 CLI 显式请求全部 12 个已移除目标 | 不能绕过默认清单生成已移除平台的 Agent | `removed-targets.json`：12/12 次实际 `scripts/agent.js build -targets ...` 均报 `unsupported target` | 通过 |
| AT06 | 将旧混合归档和新版本同时保留，再次归档 | 不修改旧清单与文件，不产生同版本冲突，最新公开版本正确 | `agent-distribution.test.js` 比较归档 manifest 原始字节和全部旧文件，重复归档成功；只有不支持平台的更高版本不会被选为最新版本 | 通过 |
| AT07 | 浏览器登录后台，打开安装/卸载弹窗并选择 FreeBSD | 无 macOS/Windows 选项，支持范围可见，生成 POSIX 命令 | `browser.json`：Linux(systemd)、其他 Linux、FreeBSD 三种安装方式，提示仅 amd64/arm64，使用 `/agent/install.sh`，无 PowerShell 命令；已查看截图 | 通过 |
| AT08 | 完整本地回归和主控验收 | 已有主控、协议、缓存和页面行为保持 | Node 82/82、Agent 配置、Go vet/test、主控 19/19；`git diff --check` 通过 | 通过 |
| AT09 | 在受支持系统运行原生 Agent，并执行 Linux 安装/更新/卸载 | 原生六项及 Docker 部署五项应全部通过 | 本机 Darwin/amd64，发布目标为 ELF；没有 Docker/Colima，预检失败，未执行原生程序或容器案例 | 环境阻塞，未通过 |

### 验证边界

- 四个程序已经交叉编译并验证文件、下载和归档，但本轮没有在 Linux/FreeBSD 真机执行，不宣称服务安装、采集、自更新或 FreeBSD 运行验收通过。
- 本轮没有构建出 Docker 镜像、部署生产主控或触发远端 CI。具备 Docker 的 Linux 环境仍需构建 `server-monitor:agent-native` 后运行部署套件；完整原生验收需受支持的 Linux/FreeBSD amd64/arm64 主机。
- 保留上游其他平台源码和历史测试记录用于来源追踪、兼容性回归；它们不进入新版本的 Agent 构建清单。旧磁盘归档没有被自动删除。
- 隔离浏览器及主控测试进程已关闭，专项临时数据库与归档目录由测试清理。日志、截图、测试下载载荷、构建产物均未纳入源码。此前延迟图修复仍保留在工作区。

以下保留此前各次验收记录。

## 看板延迟图实时更新验收（2026-09-17）

修复前已在独立主控及实际浏览器中复现用户截图：HTTP 上报变为 306ms，卡片数字更新，但延迟图仍为首次加载的空缺，丢包图保留旧的 0%。原因是实时回放没有更新 `ping/loss` 历史数组、页面只在首次加载时取历史、历史缓存不随写入失效，并且所有有效柱子的高度固定。后续重连验证还发现移动的 REST 分桶边界会造成补取时跳格，最终改为统一的 6 分钟边界，包含当前未结束桶。

**最终 Node 回归 79/79、延迟专项 12/12、Agent 配置测试、Go vet/test、主控验收 19/19、原生 Agent 验收 6/6 全部通过。** 浏览器实际验证 HTTP/WS 数值和柱图同步、超时、条形/环形视图与每分钟补取历史。没有访问或部署生产 VPS。

### 环境与命令

- macOS 15.8 / x64，Node.js v24.19.0、Go 1.26.8；使用现有独立工具链，没有更换系统 Node。
- 开始先执行 `npm ci`、`npm run geoip:download`、`npm run build`，再创建独立临时 SQLite 数据目录、回环 HTTP/WS 主控和浏览器会话。安装审计 0 vulnerabilities，GeoIP 下载成功，完整构建生成 16 个 Agent 产物和前端。
- 最终执行 `node --test test/dashboard-latency-window.test.js test/frontend-latency-window.test.js`、`npm run test:all`、`npm run test:acceptance`。完整构建之后，最后的时间分格调整再次执行 `npm run build:frontend`，后端由 Node 直接运行。
- 命令与证据目录为 Git 忽略的 `output/test-results/latency-live/`：`npm-ci.log`、`geoip-download.log`、`baseline-build.log`、`build.log`、`frontend-build.log`、`targeted.log`、`regression.log`、`acceptance.log`、`controller-acceptance.json`、`native-acceptance.json`。
- `browser-fixture.mjs` 用真实主控和临时数据库，通过 `/update` HTTP/WS 注入确定的探测值；浏览器运行构建后的 Vue 页面。浏览器证据为 `browser.json`、`backfill-api.json`、`before.png`、`after-live.png`、`bar.png`、`ring.png`、`timeout.png`、`backfill.png`。注入的历史样本用于可控验证，不代表实际公网线路测量。

### 验收项

| 编号 | 功能 / 操作 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| L01 | 新建主控并上报 306ms → 65ms，再由 Agent WS 上报 180ms | 无需刷新页面，数字、当前桶数值、颜色和柱高随上报变化 | 实际浏览器：306ms 柱高 71%，65ms 柱高约 30.83%，180ms 柱高 50%；HTTP 200、WS `persisted:true`；A05 另外验证历史尚未再次落库时 65ms/10% 已进入前端窗口 | 通过 |
| L02 | 上报超时/100% 丢包；检查缺失值、禁用值及正常 0% | 不继续显示旧成功延迟，不将无样本伪造为 0% 或离线 | 浏览器显示“超时”，丢包柱高 100%；专项测试验证 null/false/0、秒时间戳、空值 `--` 和灰色“无样本” | 通过 |
| L03 | 推进多个桶和超过两小时，重复刷新 REST，再跨 6 分钟边界 | 20 桶滚动、保留中间空缺、旧点过期；刷新不改变桶边界，跨桶立即失效缓存 | `targeted.log`：12/12；时间边界和长时间条件用确定时间参数验证，没有实际等待两小时 | 通过 |
| L04 | 先缓存空历史再写入；改变点数、更换数据库、清空历史；重放较旧样本 | 首个点立即可取，缓存不会串实例或参数，旧回放不能覆盖新值，清空后不会恢复旧持久化桶 | SQLite + Vue/窗口函数实际执行；最新状态保留，前端只保留尚未持久化的新样本；没有用清缓存替代真实写入验证 | 通过 |
| L05 | 页面保持打开，写入分布在历史桶中的 17 个有效探测样本，等待定期补取 | 无需手动刷新，历史补齐且保留两处无样本 | 浏览器 17 个有效延迟桶、18 个有丢包值的桶，与同一时段真实 `/api/servers` 结果一致；`backfill-api.json`、`browser.json`、`backfill.png` | 通过 |
| L06 | 切换条形/环形卡片，关闭主控后以原临时目录重启并继续上报 | 两种卡片均显示实时图；历史保留，页面重连后继续更新 | 实际浏览器与主控重启；`bar.png`、`ring.png`、`browser.json`；主控 A15、原生 Agent NA05 同时覆盖持久化回归 | 通过 |
| L07 | 执行最终回归、构建与真实主控/原生程序验收 | 既有功能保持，构建与验收成功 | Node 79/79、专项 12/12、Agent 配置、Go vet/test、16 平台构建、主控 19/19、原生 Agent 6/6；`git diff --check` 通过 | 通过 |

### 验证边界与过程记录

- 本轮未修改 Docker、反代、Agent 安装/更新/分发逻辑。本机没有 Docker/Colima 可执行程序，因此未执行容器部署测试或 `test:agent-deployment`；本地主控进程验收不能替代生产 Docker 验收。
- 当前窗口是 20 个固定的 6 分钟桶，包含当前未结束桶；同一桶随新样本更新，满 6 分钟后整体向前移动。没有把每次上报都追加为新格子，7 天 SQLite 历史不受影响。
- 第一次扩展 A05 时测试按 `sample.data` 查找 WS 消息，实际协议字段是 `sample.payload`；修正测试后完整重跑通过，初始失败日志保留为 `acceptance-initial.log`。后续浏览器发现时间分格跳动后修复，并再次运行全部回归和验收，以上仅报告最终结果。
- 临时主控、Agent 进程和浏览器验证会话已清理；数据、日志、截图、构建产物均在临时目录或 Git 忽略目录，未纳入源码。

以下保留此前各次验收记录。

## IP 地区库每日自动更新验收（2026-09-16）

新增启动后台检查及每 24 小时检查、校验后原子保存并热切换、失败保留旧库、持久化与停机取消。**69/69 项 Node 回归（含 9 项新增更新测试）、Agent 配置测试、Go vet/test、19/19 项主控验收和 6/6 项原生 Agent 验收通过。** 直接连接 DB-IP 的真实下载、运行时自动更新及本地主控重启保留也通过。Docker 容器验收未执行，见下方边界。

### 环境与执行

- 本轮实际环境为 macOS 15.8 / x64，Node.js v24.19.0、Go 1.26.8。系统 Node v26 不用于项目测试；使用现有 Node 24 运行时，Go 官方归档校验 SHA-256 后解压到 Git 忽略的 `output/tools/`，未更换系统工具链。
- 开始时执行 `npm ci`、`npm run geoip:download`、`npm run build`，完整构建生成 16 个 Agent 目标和前端。日志为 `output/test-results/geoip-update/{npm-ci,baseline-download,baseline-build}.log`。
- 更新专项测试预建独立临时目录、本地 HTTP 下载服务、可解析的 MMDB 和真实主控。只将 DB-IP 下载 URL 转到本地故障服务；HTTP 传输、解压、MaxMind 解析、文件写入、SQLite 与 Agent HTTP 上报均实际执行。每日边界使用 Node 模拟时钟，未实际等待 24 小时。
- 执行 `npm run test:all`、`npm run test:acceptance`，日志为 `output/test-results/geoip-update/{regression,acceptance}.log`。新增用例包含在完整回归的 69 项内；前期 `targeted.log` 为增加超时用例前的 8 项专项运行，最终结果以完整回归为准。
- 修改后的 `geoip:download` 指向独立输出文件并实际下载，证据 `download-final.log`。另以临时数据目录启动真实主控，启用正常调度器，直接从 DB-IP 获取库，检查健康与地区查询，关闭后重新创建主控验证持久化；证据 `live-update.log`、`live-update.json`。

### 验收项

| 编号 | 功能 / 操作 | 预期结果 | 验证方式与实际证据 | 状态 |
| --- | --- | --- | --- | --- |
| GU01 | 下载新版，查询 IPv4/IPv6/同机地址，再以原目录离线重启 | 热切换成功、重启保留，24 小时内不重复下载，相同内容不重复写盘 | 本地 HTTP + MMDB + 文件逐字节比较：US → JP；提前 1ms 跳过，到期重新检查；文件 mtime 不变；503 后仍查询 JP | 通过 |
| GU02 | 返回 404/503、坏 gzip、坏 MMDB、无效国家代码 | 每次均保留内存与磁盘旧库，失败后不每分钟重试 | 5 类失败后查询及文件比较均不变，目录无残留临时文件 | 通过 |
| GU03 | 返回超限 Content-Length、超限分块响应、解压炸弹与无效月份 | 下载/解压受限，拒绝无效月份，当前库继续可用 | 16 MiB 压缩体、64 MiB 解压上限实际触发；失败后磁盘与 JP 查询保持 | 通过 |
| GU04 | 从 9 月推进到 10 月，首日 404、次日新版、随后返回旧版 | URL 随 UTC 月份切换，次日重试成功，拒绝版本回退 | 实际请求 `2026-10`；新版地区 DE，旧版被拒且保存文件不变 | 通过 |
| GU05 | 同时发起两次检查并挂起响应，随后关闭 | 共用一次下载，停机迅速取消，旧库保留 | 两次调用共用 Promise；关闭小于 2 秒；无后续下载，磁盘文件不变 | 通过 |
| GU06 | 损坏持久库、损坏内置库、更换较新内置库、两库均损坏 | 使用较新的有效库；能回退；两库都坏才拒绝启动 | 真实文件逐项替换，查询分别为 US、JP、DE；两库坏时创建失败 | 通过 |
| GU07 | 用目录阻挡目标文件，触发原子替换失败 | 不切换内存库，清理临时文件 | 真实 rename 报错；仍查询 US，目录只保留原阻挡项 | 通过 |
| GU08 | 启动完整主控并挂起下载，HTTP 上报后释放新版、推进一天、保存手动地区、重启 | 下载不阻塞健康/API；自动生效；每天调度；手动地区与下载库重启保留 | 健康 200；上报地区 US → JP，手动 DE 优先；到期新增一次请求；重启后查询 JP、SQLite 手动地区 DE | 通过 |
| GU09 | 挂起实际 HTTP 响应并缩短测试超时 | 生产配置为 120 秒，超时保留旧库且次日再试 | 断言配置 120000ms，测试用 50ms 超时实际取消 HTTP；文件和 JP 查询不变 | 通过 |
| GU10 | 直接访问真实 DB-IP，自动更新并重启主控 | 当月真实库可下载、解析、持久化和重新加载 | `live-update.json`：2026-09-16T15:00:26.822Z，8,340,464 字节，库构建时间 2026-09-01T01:32:45Z，health=true、country=US、restartRetained=true | 通过 |
| GU11 | 构建及完整回归 | 既有主控与 Agent 功能保持 | 16 目标构建；Node 69/69、Go vet/test、Agent 配置通过；`acceptance.json` 19/19、`agent-integration/native-acceptance.json` 6/6 | 通过 |
| GU12 | Docker 内非 root 更新与容器重建 | 数据卷权限正确并保留新库 | 本机未安装 Docker/Colima，无容器引擎；本轮仅完成真实本地主控进程与文件持久化验证，不能据此宣称容器验收通过 | 跳过 |

### 验证边界

- 未修改或部署生产环境，未实际等待一天；日周期与跨月通过模拟时钟触发，真实外部下载另行验证。
- 未执行 Docker 部署或多架构容器运行验证，也未触发远端 CI。原生 Agent 安装、更新及分发实现未改动，本轮未运行 Linux 安装/自更新部署套件。
- 临时主控、HTTP 故障服务和前台 Agent 已关闭；新测试自行清理临时 GeoIP 数据目录。构建产物、工具链和日志位于 Git 忽略目录，没有纳入源码。

以下保留此前各次验收记录。

## 原生 Agent 同仓库适配验收（2026-09-16）

本次纳入上游 **cfsm-agent v1.0.16**（提交 `10e4938e999d8b30b4d9296df4c686983bfdb762`），原生 Agent 独立版本 **v1.1.0**，主控 **3.0.0**。
安装、版本查询和自动更新改为主控分发，保留既有采集与协议。60/60 项 Node 回归、Go vet/test、Agent 配置测试、19/19 项主控验收、6/6 项原生 Agent 验收和 5/5 项 Linux 部署验收通过。16 个上游目标均已编译；arm64、amd64 主控镜像构建与实际启动通过。

### 环境与执行

- 开发环境为 macOS arm64、Node.js v24.11.1、Go 1.26.8；先完成 `npm ci`、GeoIP 下载、基线构建，再准备隔离测试主控和 Agent。
- 完整构建使用 `npm run build`；回归使用 `npm run test:all`；主控及真实原生程序验收使用 `npm run test:acceptance`。
- Docker Engine 29.5.2 / Colima Linux arm64。预先构建主控、Debian 安装环境、旧版测试程序 v1.0.99、证书、代理和独立数据卷后，再执行安装及更新案例。
- Linux Agent 位于隔离容器的 internal bridge，不能直接访问互联网；TLS 反代另外连接测试入口网络。所有安装、更新与上报通过测试主控完成。
- Agent 信任一次性测试 CA，实际执行 HTTPS/WSS 证书校验；仅浏览器测试会话允许本地自签名证书。未关闭产品证书验证。
- Docker 凭据助手在本机缺失，使用 `output/test-results/agent-integration/docker-cli/` 的临时空凭据配置调用 Colima；没有改动用户 Docker 配置。
- amd64 镜像与 Agent 运行使用仿真，不代表原生 x86 VPS 长期压测。

核心证据位于 `output/test-results/agent-integration/`；浏览器图片位于 `output/playwright/agent-native/`。

### 构建、协议与界面核对

| 编号 | 功能 / 操作 | 预期 | 实际验证与证据 | 状态 |
| --- | --- | --- | --- | --- |
| NI01 | 对照稳定 Release 源码与许可 | 保留现有 Agent 核心功能 | Release 重定向与 git tag 均确认 v1.0.16；`agent/UPSTREAM.md` 固定提交并保留 LICENSE。`source-parity.json`：14 个采集、探测、流量、平台及 WS 模块内容一致（仅归一化 ControllerURL 字段重命名） | 通过 |
| NI02 | 编译全部原有平台目标 | 16 个可分发程序及 SHA-256 manifest | `build-final.log`；`agent-dist/v1.1.0/manifest.json` 包含 Linux 7、FreeBSD 4、macOS 2、Windows 3 个目标，总体积约 111 MiB | 通过 |
| NI03 | 主控、配置与 Go 回归 | 全部通过 | `regression.log`：Node 60/60、Agent 配置通过、Go vet/test 通过 | 通过 |
| NI04 | 主控功能与 WS 时间校准协议 | 既有 19 项验收通过，WS 握手携带 Date | `acceptance.log`、`output/test-results/acceptance.json`；A05 新增 `handshakeDate:true`，HTTP/WS、SQLite、备份、通知、权限和 50 Agent/10 看板边界继续通过 | 通过 |
| NI05 | 历史版本归档、未知文件及错误产物 | 重建保留旧版本，拒绝覆盖、越界和损坏下载 | `distribution-tests.log`；实际文件/符号链接/HTTP 响应测试，Go `native_distribution_test.go` 验证本地主控更新、镜像 URL、ARM 变体和坏校验 | 通过 |
| NI06 | 后台复制安装命令 | Linux 命令可执行，Windows 命令保留镜像及版本参数 | Playwright 实际登录、打开弹窗、修改字段并点击复制；`browser-copied-install.log` 验证 Linux 安装并写入 AUTO_UPDATE=0。仅将测试公网入口替换为容器内同一 TLS 代理别名。`windows-command-check.txt`：windows/mirror/pinnedVersion=true、upstream=false | 通过 |
| NI07 | 桌面与手机安装弹窗 | 字段可读、按钮可达、无横向溢出 | 已查看 `desktop.png`、`mobile.png`、`mobile-bottom.png`；390px 页面宽度与 scrollWidth 均为 390，底部复制按钮可滚动到达；浏览器 Errors=0、Warnings=0 | 通过 |
| NI08 | arm64 / amd64 镜像与同源产物 | 启动可用，容器能读取全部程序，构建产物一致 | `docker-build.log`、`docker-amd64-build.log`、`amd64-smoke.json`：健康、16 个目标、实际执行 amd64 Agent version、WS Date 均通过；本地与 Docker 16 个产物的 SHA-256 一致 | 通过 |

### 真实原生程序及部署验收

| 编号 | 功能 | 操作 | 预期 | 验证方式 / 实际证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| NA01 | 原生程序下载 | 从主控运行一键下载脚本的 version 命令，查询版本目录 | 下载并校验本机程序，版本和主控一致 | native-acceptance.json：`{"version":"v1.1.0","asset":"cf-probe-darwin-arm64","bootstrap":true}` | 通过 |
| NA02 | 真实 Agent HTTP 上报和版本检查 | 使用旧 WORKER_URL 配置启动 Go 程序 | 读取旧配置、写入真实采集指标，从主控检查更新 | native-acceptance.json：`{"version":"v1.1.0","os":"macOS 26.6.2","cpuCores":8,"ramTotal":16384}` | 通过 |
| NA03 | HTTP 转 WebSocket 与看板推送 | 后台切换 auto，订阅看板 WebSocket | Agent 自动连接 WS，实时推送且确认 SQLite 写入 | native-acceptance.json：`{"connected":true,"persisted":true,"viewerMessages":4}` | 通过 |
| NA04 | 配置下发与 HTTP 回退模式 | 下发 4 个节点、流量重置日及 http 模式 | 本地配置正确更新并继续 HTTP 上报 | native-acceptance.json：`{"fourNodes":true,"http":true,"resetDay":0,"legacyAndNativeUrl":true}` | 通过 |
| NA05 | Agent 重启与数据保留 | 停止原生进程后使用原配置及流量文件重启 | 配置、流量文件和服务器历史保留，Agent 恢复上报 | native-acceptance.json：`{"trafficFileBytes":124,"configPreserved":true,"historyPreserved":true}` | 通过 |
| NA06 | 损坏下载与不存在的版本 | 从损坏镜像下载，以及指定未发布版本 | 脚本失败，不执行损坏文件，不退回上游仓库 | native-acceptance.json：`{"checksumRejected":true,"missingVersionRejected":true}` | 通过 |
| ND01 | Docker 启动和归档 | 在隔离 bridge 中启动主控和独立 TLS 反代 | 健康检查、TLS 登录、16 个产物及持久归档可用 | deployment.json：`{"tls":true,"secureCookie":true,"targets":16,"archived":true,"internalNetwork":true}` | 通过 |
| ND02 | 一键安装及 HTTPS/WSS 上报 | 在独立 Linux 环境从主控安装旧版测试程序并开启自动更新 | 原生服务启动，正确连接 TLS 主控，等待更新 | deployment.json：`{"installedVersion":"v1.0.99","tlsAgent":true,"wssConnected":true}` | 通过 |
| ND03 | 实际自动更新与配置保留 | 等待旧版从主控下载新版并由原生服务更新重启 | 安装文件和上报版本变为当前版本，配置及流量文件保留 | deployment.json：`{"from":"v1.0.99","to":"v1.1.0","configPreserved":true,"trafficPreserved":true}` | 通过 |
| ND04 | 主控重建持久化 | 删除测试主控容器并使用原数据卷重新创建 | 历史及两个 Agent 版本保留，探针恢复连接 | deployment.json：`{"dataRetained":true,"oldVersionRetained":true,"reconnected":true}` | 通过 |
| ND05 | 原生卸载 | 从主控下载临时卸载器并执行 uninstall | 已安装程序、配置和服务进程清除 | deployment.json：`{"binaryRemoved":true,"configRemoved":true}` | 通过 |

### 本轮发现并修复

- 多次下载时 POSIX 函数中的全局 `url` 被校验文件请求覆盖；改用位置参数，安装脚本重新实际执行通过。
- Go 临时构建目录默认 0700，导致 Docker 的 UID 1000 无法读取产物；发布与归档目录设置 0755，并重新完成非 root 启动、下载及部署验收。
- Node 的 ws 库直接写 Upgrade 响应，默认没有 Date；显式补齐标准 Date 头，验证仅走 WS 时也具备原 Agent 时间校准所需输入。
- Linux ARM 自更新匹配构建的 ARMv5/v6/v7 文件名，避免查找 release 中不存在的 linux-arm 文件。
- 验收脚本按真实看板订阅流程连接，并使用 `last_updated` 判断新上报；`timestamp` 是服务器记录字段，不能用来判断探针是否重新上报。最终结果均来自修正后的实际重跑。

### 验证边界

- Windows、FreeBSD、OpenWrt、Synology 及所有 CPU 变体未逐一真机安装；其编译产物已生成，原采集和平台逻辑保留。macOS 验证为真实前台进程，Linux 服务安装/更新/卸载验证使用隔离 Debian 后台进程环境，未对每种 init 系统逐一安装。
- Linux/macOS/Windows Go 测试矩阵已写入 GitHub Actions，本轮未推送或执行远端 CI。
- 未部署用户生产 VPS，未进行公网 IPv6、长时间运行或故障硬件验证。
- SQLite 备份不包含 Agent 二进制归档；历史产物随数据卷保留，需要时另行备份该目录。
- v1.0.99 只用于实际升级路径验收，不是本项目对外发布版本。

本轮测试容器、网络、原生前台进程和浏览器会话已清理，既有容器保持运行。构建产物、日志、截图、临时凭据和测试证书均在 Git 忽略目录中，没有纳入源码。

以下保留此前各次验收记录。

## 安全入口与双重验证验收（2026-09-16）

本次新增 `.env` 安全路径、匿名首页隐藏后台入口及 TOTP 双重验证。59/59 项 Node 回归、Agent 配置测试和 19/19 项真实 HTTP/WS/SQLite 验收通过；补充的安全测试 11/11 通过。浏览器实际完成绑定、六位码登录、恢复码登录与关闭，检查桌面、390px 和 320px 页面。Docker linux/arm64 镜像构建、Compose bridge 启动、重建持久化及独立 HTTPS/WSS 反代均通过。下方章节保留此前验收记录。

### 环境与证据

- 开始开发前运行 `npm ci`、`npm run geoip:download`、`npm run build`；Node.js v24.11.1，macOS arm64。新增 qrcode 运行依赖及 jsqr/pngjs 测试依赖，安装审计 0 vulnerabilities。
- 安全测试先创建独立临时 SQLite 主控，浏览器使用独立临时数据目录、生产构建和专用 Playwright 会话；Docker 使用 `monitor-security-entry` 项目、独立数据目录、随机回环端口，无生产数据。
- 最终执行 `npm run build`、`npm run test:all`、`npm run test:acceptance`、`node --test test/admin-security.test.js`、`git diff --check`。完整验收 JSON 记录 19/19 PASS，时间 2026-09-16T10:02:21.105Z。
- 命令日志：`output/test-results/security/{build,regression,acceptance,security}.log` 与 `acceptance.json`。浏览器操作、结果及截图：`output/playwright/security/`。均被 Git 忽略，不提交测试数据、测试密钥或产物。

### 验收项

| 编号 | 功能 | 实际操作 | 预期结果 | 验证方式及证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| S00 | 启动与验证码标准 | 缺失/短路径启动；执行 RFC 6238 SHA-1 向量和边界样本 | 无效路径在建库前拒绝；六位码保留前导 0，前后一步有效，重复及超窗口无效 | `admin-security.test.js`、`security.log`：6 组标准时间向量及 8–128 位边界通过 | 通过 |
| S01 | 安全入口与匿名保密 | HTTP 请求根路径、安全路径、尾斜线、旧 /admin 与错误路径；读取匿名配置 | 根路径和安全入口 200，旧入口及错误路径 404；匿名 HTML/配置无随机路径 | S01 断言；no-store/no-referrer 头正确 | 通过 |
| S02 | 绑定与二维码 | 以匿名/错误密码/正确密码发起绑定；独立解码 PNG；另一会话尝试确认 | 只有认证且密码正确时生成；二维码与手动密钥一致；确认前不启用，不能跨会话确认 | jsQR 实际解码 PNG，校验 otpauth/secret/SHA-1/6 位/30 秒；S02 | 通过 |
| S03 | 启用及会话撤销 | 保持管理员 WS，确认绑定；检查数据库和旧令牌 | 密钥加密、恢复码哈希；旧 REST 401，现有 WS 1008 关闭，旧令牌新 WS 无管理员权限 | S03、`security.log`；普通设置读取不含密码哈希或 2FA 密钥，save_settings 不能关闭 2FA | 通过 |
| S04 | 登录、防重放与恢复码竞争 | 正确密码但无验证码；错误码、正确码、重复码；并发提交同一恢复码 | 密码单独不签 token/Cookie；正确码成功，重复码失败；恢复码只有一次成功 | S04：200 challenge 无会话、有效码 200、重放 401、并发恢复码 [200,401] | 通过 |
| S05 | 重启与备份恢复 | 备份 SQLite、关闭主控、重启及停机恢复 | 2FA 保持启用，原会话可用，已消费恢复码仍无效 | S05：密码仍需第二因素，使用过的恢复码 401，剩余恢复码可登录 | 通过 |
| S06 | 关闭验证 | 分别用错密码、错码、正确密码加未使用恢复码关闭 | 错误输入拒绝；关闭后清空 2FA/恢复码并撤销旧令牌 | S06，关闭成功后密码可登录 | 通过 |
| S07 | 绑定过期与路径轮换 | 将绑定到期时间推进至过去；更换 ADMIN_PATH 重启 | 过期绑定不能启用，旧入口 404，原令牌失效 | S07 | 通过 |
| S08 | 防猜测限流 | 同 IP 连续登录、不同来源连续提交第二因素 | 超出 IP/第二因素限制后返回 429 | S08：Retry-After=60，全账户第二因素限制生效 | 通过 |
| S09 | 首页与齿轮 | 浏览器匿名访问、登录、返回首页、点击齿轮、退出；访问 /#/admin | 匿名无齿轮，登录后齿轮回原后台，退出隐藏，公开 hash 不能打开登录页 | `gear-result.txt` href 为配置入口；`anonymous-result.txt`：anonymousGear=0、hashLogin=0；`private-result.txt`：私人首页保留根路径且无齿轮/登录框；首页截图已查看 | 通过 |
| S10 | 浏览器绑定与窄屏 | 输入密码生成二维码、查看手动密钥，使用 WebCrypto 生成码提交，保存恢复码 | 完成启用，显示 10 个恢复码，手机无横向溢出 | `setup-desktop.png`、`setup-mobile.png`、`recovery-mobile.png` 已查看；390px 宽度/内容 390/382 | 通过 |
| S11 | 浏览器双因素登录 | 正确密码进入第二步、错误六位码、正确六位码，随后用恢复码登录 | 单独密码无 token，错误有明确提示，正确验证码及恢复码均可登录 | `login-result.txt`、`recovery-login-result.txt`；320px width/contentWidth=320/320；`login-320.png` 已查看 | 通过 |
| S12 | 浏览器关闭与国际化 | 当前密码加恢复码关闭；运行中英日词条完整性回归 | 关闭成功且提示；三种语言键集合完整 | `disable-result.txt` disabled=true；`frontend-i18n.test.js` 通过 | 通过 |
| S13 | Vite 开发入口 | 启动 Vite，请求随机入口、带斜线/查询入口、根路径及登录代理 | 仅正确入口注入 meta，根路径无路径值，API 正确代理 | `vite-check.log` 四项 true；修正 originalUrl 回退后实测 | 通过 |
| S14 | Docker 安装与持久化 | 构建 linux/arm64 镜像，Compose bridge 启动，创建节点/启用 2FA，强制重建容器 | healthy，旧入口 404，数据和 2FA 保留；恢复码单次有效 | `docker-build.log`、`docker-check.log`、`docker-restart-check.log`：1 台服务器保留，recoveryLogin=200、recoveryReplay=401 | 通过 |
| S15 | HTTPS/WSS 反代 | 独立 TLS 代理容器接入测试 bridge，只信任其实际 IP；HTTPS 双因素登录及私人看板/Agent WSS | Secure Cookie 生效，认证看板 WSS 建连，Agent 上报确认落库 | `tls-check.log`：httpsLogin=200、secureCookie/authenticatedPrivateViewerWss/agentWssPersisted=true | 通过 |
| S16 | 原功能回归 | 全部 Node/Agent 配置与真实验收 | 历史、备份、地区、通知、实时更新、权限等保持正常 | 59 项回归、Agent 配置、19 项验收全部通过 | 通过 |

初次测试修正了测试脚本引用 WS 集合和变量遮蔽的问题；浏览器发现匿名空列表残留半句后台提示，已改为“暂无数据”；Vite 入口初次检查暴露 SPA 回退把 path 改成 index.html 的问题，已改用 originalUrl 并复测。最终无未解决测试失败。错误验证码和匿名请求私人看板产生的 401 属于预期拒绝。

本次以标准向量、独立二维码解码器和浏览器 WebCrypto 验证 TOTP 互通，未使用实体手机上的 1Password/Google Authenticator 完成扫码。HTTPS 使用隔离环境的临时证书，Docker 实测 linux/arm64；未更改生产部署或创建生产 `.env`。启用实际账户的 2FA 仍由管理员在验证器中保存密钥并确认验证码。API_SECRET 用于解密持久化密钥，恢复必须保留原值。

---

## 全局日文验收（2026-09-16）

内置界面新增完整日文，含 500 个词条、8 种计费周期及 36 种货币名称。构建、48 项 Node 回归、Agent 配置测试和 19 项真实 HTTP/WS/SQLite 验收全部通过。浏览器实际验证首页、详情、登录、后台编辑/批量编辑、默认语言保存与优先级；桌面及 320/390px 手机截图已检查。下方其他章节为此前的验收记录。

### 环境与执行

- Node.js v24.11.1、macOS arm64；先完成 `npm ci`、`npm run geoip:download`、`npm run build`，安装审计 0 vulnerabilities。
- 修改后重新构建，预先启动独立临时 SQLite 主控和 Chromium 会话 `japanese`，使用两台测试服务器、日元月付与免费价格，定期真实上报。
- 执行 `node --test test/frontend-i18n.test.js`、`npm run test:all`、`npm run test:acceptance`、`git diff --check`。最终回归 48/48，Agent 配置通过；真实验收 19/19，完成时间 2026-09-16T09:25:03.891Z。
- 原始日志与验收 JSON：`output/test-results/japanese/`；浏览器操作脚本、结果、DOM 与截图：`output/playwright/japanese/`。均为 Git 忽略的本地测试产物。

### 验收项

| 编号 | 功能 | 实际操作 | 预期结果 | 验证方式及证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| J01 | 完整日文词库 | 运行词条与占位符回归 | 日文、中英文键集合一致，日文无空词条，动态占位符不丢失 | `frontend-i18n.test.js`，500 个词条；计费周期 8 种、货币名称 36 种 | 通过 |
| J02 | 切换与记忆 | 右上角选择日文并刷新，再按英→中→日切换 | 页面实时更新，localStorage 与 HTML lang 同步，刷新保留日文 | `dashboard-checks.txt`：lang=ja、stored=ja；languageSwitches=[en,zh,ja] | 通过 |
| J03 | 浏览器自动识别 | 使用无本地偏好的 ja-JP、en-US、zh-CN 浏览器上下文访问 | 自动选择对应语言，不写入手动偏好 | `auto-language.txt`：分别 ja/en/zh-CN，stored 均为 null；回归另覆盖 ja_JP、多语言优先级及未知语言回退 | 通过 |
| J04 | 首页、计费与手机布局 | 日文下切换三种视图，检查免费/月付、相对时间、宽度 | 日文标签与时间正确，数据和排序可用，无横向溢出 | `dashboard-checks.txt`：三种视图 contentWidth=390；`mobile-bar.png`、`mobile-ring.png` 已查看 | 通过 |
| J05 | 详情及图表 | 日文进入详情，展开图表后切为英文再切回，访问需登录的 7 日历史 | 时间范围、图表按钮/图例及登录提示随语言更新 | `detail-checks.txt` 全部 true；`detail.png` 已查看，图例显示メモリ、スワップ、ダウンロード、アップロード | 通过 |
| J06 | 登录及错误提示 | 输入错误密码，再使用正确测试凭据登录 | 错误提示为日文，成功后管理页签为日文 | `login-checks.txt`：日文错误提示；サーバー、設定、データベース管理、テーマストア | 通过 |
| J07 | 编辑与批量编辑 | 实际打开两个弹窗并查看计费和货币选项 | 字段、按钮和选项为日文 | `edit.yml`、`admin-checks.txt`：月払い、¥JPY 日本円，edit/batchEdit/billingJapanese=true | 通过 |
| J08 | 后台默认语言保存 | 在设置页面选日本語并保存，刷新后重新读取 | 界面、公共配置及后台读取均保留 ja，提示保存成功 | `admin-checks.txt`、`settings-saved.yml`：defaultLanguage=ja、saved=true；真实验收 A02b 返回 saved=200、两处语言 ja | 通过 |
| J09 | 默认值优先级及重启持久化 | 英文浏览器无偏好访问默认日文站点；手动选英文并刷新；重启主控 | 首次显示日文，手动偏好覆盖默认，主控重启保留日文配置 | `default-language-checks.txt`：无偏好时 ja，手动并刷新后 en；A15 defaultLanguage=ja | 通过 |
| J10 | 窄屏入口与运行异常 | 320px 英文浏览器访问默认日文站点，监听 pageerror | 三个语言按钮可用，无页面溢出和未处理 JS 异常 | `default-language-checks.txt`：width/contentWidth=320、pageErrors=[]；`default-ja-320.png` 已查看 | 通过 |
| J11 | 构建与核心回归 | 执行构建、全部回归和真实验收 | 无失败 | `build.log`、`regression.log`、`acceptance.log/json`：48 项回归、Agent 配置和 19 项验收通过 | 通过 |
| J12 | 设置刷新、数据库及内置主题说明 | 刷新后台后再打开设置、数据库和主题商店 | 默认日文仍被选中，备份按钮与 Mikus 说明为日文 | `remaining-panels.txt`：defaultAfterReload=ja，databaseJapanese/builtinThemeJapanese=true；`settings.png` 已查看；刷新后控制台 Errors=0、Warnings=0 | 通过 |

浏览器故意使用错误密码及未登录访问受限历史，产生的鉴权失败属于预期测试，不作为成功请求或正常运行错误统计。初次测试中修正了测试环境的 Vue DOM 模拟、既有价格小数位预期及浏览器脚本的定位/等待方式，最终结果见上述证据。

### 范围与限制

本次覆盖内置界面。服务器名、分组名、监测点自定义名称及用户提供的通知模板属于数据，不自动翻译。外部主题描述优先选择其提供的日文，缺少日文时保留回退逻辑；不保证第三方主题自身支持日文。本次无部署配置变更，未重跑 Docker 构建或生产部署。使用独立测试数据，验证后关闭专用浏览器及主控。

---

## 首页排序与分组筛选验收（2026-09-16）

本次将首页改为按后台保存顺序连续展示，并新增分组筛选按钮。构建、43 项 Node 回归、Agent 配置及 18 项 HTTP/WS/SQLite 验收全部通过；浏览器核心交互、排序持久化、明暗主题和手机布局均通过，桌面与手机截图已实际查看。下方界面精简和首版部署内容为此前的验收记录。

### 测试环境与命令

- 修改前完成 `npm ci`、`npm run geoip:download`、`npm run build`；Node.js v24.11.1，依赖审计 0 vulnerabilities。
- 修改后构建生产 dist，启动独立临时 SQLite 主控和 Playwright Chromium 会话 `group-filters`。预建 20 台服务器：19 台公开、1 台隐藏；两个交错分组分别 7/8 台，另有 Default、all、__proto__ 和长中文分组名，每 5 秒真实上报。
- 先验证启动与接口顺序，再进行正常筛选、特殊名称/无匹配结果、手机宽度、保存新排序并刷新；随后执行 `npm run test:all`、`npm run test:acceptance`、`git diff --check`，全部退出 0。
- 网络验收完成时间：2026-09-16T09:04:30.275Z。日志和原始 JSON 位于 `output/test-results/group-filters/`；浏览器操作脚本、结果、DOM 与截图位于 `output/playwright/group-filters/`，均被 Git 忽略。

### 验收项

| 编号 | 功能 | 实际操作 | 预期结果 | 验证方式及证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| G01 | 后台顺序连续展示 | 保存交错分组顺序，浏览器依次切换环形图、条形图、列表 | 三种视图的全部服务器顺序均与 API 的已保存顺序一致，无旧分块标题 | `checks.txt`：19 台，起始顺序 VPS 03、02、01；三种视图逐项比较通过，旧 group-section/header 数量为 0 | 通过 |
| G02 | 分组名称和数量 | 打开分组按钮、切换不同筛选 | 显示“分组1 7”“分组2 8”，数量稳定，隐藏组不泄露 | `checks.txt`：6 个公开分组，两个主分组数量 7/8，隐藏组不存在 | 通过 |
| G03 | 单选与再次点击取消 | 点击分组1，再切换分组2，重复点击选中分组 | 同时只选中一个分组，再次点击恢复全部；保留后台相对顺序 | `checks.txt`：选中状态 aria-pressed 正确，取消后恢复全部 19 台及原顺序 | 通过 |
| G04 | 与国旗筛选组合、跨视图保留 | 分组1+US、分组2+US；分别取消国家/分组；切换视图 | 取两种条件交集，单独取消只清除对应条件，切换视图不清空分组 | `checks.txt`：交集分别 3/2 台，清除 US 后保留分组2的 8 台；条形/环形切换保留 7 台 | 通过 |
| G05 | 默认、特殊名称及空交集 | 点击 Default、all、__proto__；Default 与 US 组合 | 默认组可筛选，特殊名字不与“全部”状态或对象属性冲突；无结果提示暂无数据 | `checks.txt`：三种特殊组均匹配 1 台，空交集 0 台且无“添加服务器”链接 | 通过 |
| G06 | 排序保存后的刷新 | 通过真实后台 save_order 接口反转顺序，刷新浏览器并切换三种视图 | 全部按新顺序展示，分组按钮也随首次出现顺序变化 | `reorder.txt`、`persistence.txt`、`reordered.yml`：从 VPS long 开始，19 台逐项匹配、三个 orderMatches=true | 通过 |
| G07 | 样式、手机布局及长名称 | 切换明暗主题，比较按钮样式；390×844 下点选长名称分组并取消 | 与国旗按钮样式一致，按钮换行，长名称省略但数量可见，卡片无横向溢出 | `layout.txt`：两种主题 stylesMatch=true，contentWidth=390，6 个按钮及数量均在边界内；长名 labelTruncated=true；`desktop.png`、`mobile.png` 已查看 | 通过 |
| G08 | 回归、运行错误和构建 | 运行全部测试与构建，读取浏览器控制台 | 无新增错误，既有核心功能可用 | `regression.log`：43/43、fail=0，Agent 配置通过；`acceptance.json`：18/18；build 377 modules；`console.txt`：Errors=0、Warnings=0 | 通过 |

手机首次检查发现环形卡片宽度 408px，在 390px 视口下造成页面横向溢出。将手机单列网格改为 `minmax(0, 1fr)` 后重新构建，复测页面宽度为 390px，卡片和按钮均完整显示。

本次未修改部署配置，未重跑 Docker 镜像构建或生产部署；未覆盖全部外部主题。测试使用独立临时数据与测试凭据，结束后关闭专用浏览器和主控。

---

## 界面精简验收（2026-09-16）

本次删除“捐赠支持”和“地图”展示功能。前端构建、43 项 Node 回归测试、Agent 配置测试和 18 项真实 HTTP/WS/SQLite 验收全部通过。浏览器实际验证了三个保留视图、旧地图偏好回退、地区筛选和后台页签。下方首版 Docker 部署记录为历史证据；本次未修改部署配置，未重跑镜像构建或生产部署。

### 环境和执行

- macOS arm64、Node.js v24.11.1；先执行 `npm ci`、`npm run geoip:download`、`npm run build`，依赖安装审计为 0 vulnerabilities。
- 修改后执行 `npm run build`、`npm run test:all`、`npm run test:acceptance`、`git diff --check`，均退出 0。网络验收完成时间：2026-09-16T08:47:04.650Z。
- 浏览器使用独立 Playwright Chromium 会话 `removal`、临时 SQLite 数据目录和回环地址主控，预先创建 US/JP 两台测试服务器并每 5 秒上报；不读取或修改正式数据库。
- 日志：`output/test-results/removal/{build,regression,acceptance}.log`；网络验收明细：`output/test-results/removal/acceptance.json`；浏览器操作、断言和 DOM 快照：`output/playwright/removal/`。这些均为被 Git 忽略的本地产物。

### 验收项

| 编号 | 功能 | 实际操作 | 预期结果 | 验证方式及证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| UI01 | 删除捐赠支持 | 浏览器登录后台，中英文切换并逐一点击保留页签 | 无捐赠入口和面板，其他页签正常 | `admin-checks.txt`：仅服务器、设置、数据库管理、主题商店；英文对应四项；`donationPanel=false`、`switchedTabs=4` | 通过 |
| UI02 | 删除地图展示 | 打开看板、切换中英文，检查 DOM 和资源请求 | 只保留条形图、环形图、列表；无地图容器或请求 | `legacy-map.txt`：按钮 3 个、`mapElements=0`、`removedResources=[]`；`dashboard-checks.txt` 完成两种语言断言 | 通过 |
| UI03 | 旧地图偏好兼容 | 将 `monitor_preferred_view` 设为 `map` 后刷新 | 显示站点默认视图并更新本地偏好 | `legacy-map.txt`：保存值和激活按钮均回退到 `ring`；另用 Node 实际断言 bar/ring/table 默认值及无效默认值均正确回退 | 通过 |
| UI04 | 保留视图及地区筛选 | 实际切换环形图、列表、条形图，点击 JP 再取消筛选 | 每种视图显示 2 台服务器；JP 筛选显示 1 台，取消恢复 2 台 | `dashboard-checks.txt` 的浏览器断言通过；`bar.txt`、`filter-state.yml`；US/JP 国旗正常出现 | 通过 |
| UI05 | 删除专用静态资源 | 重新构建，检查源文件、dist 和引用 | 不打包 Leaflet、世界地图数据、捐赠图片或相关代码 | 构建成功，377 个模块；dist 对应三个地图文件不存在；源文件/产物关键词检查无残留；`build.log` 无捐赠图片产物 | 通过 |
| UI06 | 后端及核心功能回归 | 执行全部回归、Agent 配置及真实网络验收 | 无失败，地区识别仍可用 | `regression.log`：43/43、fail=0；Agent 配置通过；`acceptance.json`：18/18，A06 自动 US、手动 JP | 通过 |
| UI07 | 浏览器运行错误 | 完成看板及后台操作后读取控制台 | 无页面错误或警告 | `console.txt`：Total messages=0、Errors=0、Warnings=0 | 通过 |
| UI08 | 手机宽度下的视图入口 | 将浏览器调整为 390×844，读取按钮和页面尺寸 | 三种视图入口均可见，无横向溢出或已删除资源请求 | `mobile-checks.txt`：三个按钮 visible=true，视口宽 390、内容宽 382、removedResources=[] | 通过 |

### 限制

浏览器截图命令在 8 秒内未完成，因此本次以实际点击、DOM、存储和网络验证为证据，不声称截图或像素级检查通过。临时浏览器检查脚本曾因 CLI 参数形式以及 Vue 更新尚未完成而中断；修正为正确回调参数并等待 DOM 更新后通过，无需改动产品代码。未测试全部第三方主题或生产环境。

验证结束后已关闭本次专用浏览器会话与临时主控。

---

# 首版部署验收记录（本次未重跑部署）

测试日期：2026-09-16（Asia/Shanghai）；版本：3.0.0。测试对象为当前工作区的 Docker / SQLite 二开实现。

## 结论

43 项 Node 回归测试全部通过，Agent 配置测试脚本通过，18 项真实 HTTP/WS/SQLite 验收全部通过。Linux arm64 和 amd64 镜像均构建并启动成功；原版 Go Agent v1.0.16 在主控所在 Linux 宿主环境上完成上报。浏览器完成添加服务器、保存设置、实时看板/详情和备份下载。未覆盖项单列在文末。

最终网络验收完成时间：2026-09-16T08:36:51.348Z。负载测试完成时间：2026-09-16T08:37:04.802Z。

## 预先准备的测试环境

- macOS arm64，Node.js v24.11.1；npm 依赖、前端 dist 和 2026-09 DB-IP 数据库均在验收前准备。
- Docker Client 29.5.3 / Engine 29.5.2，Colima Ubuntu 24.04.4 LTS，Linux 6.8.0-117-generic；容器 Node.js v24.21.0。
- 主控、负载、amd64 使用独立容器和持久目录，端口分别为 18090、18091、18092。amd64 通过仿真运行，并非原生 x86 VPS。
- 网络验收在临时目录预建 SQLite、主控和本地 Webhook；通知只发到本地测试接收器。
- TLS 验收预建本地 HTTPS 反代和一次性自签名证书。仅测试客户端跳过该测试证书验证；应用未关闭生产证书验证。
- 官方 Agent 原始二进制使用发布方 checksums 验证：Linux arm64 SHA256 `cfa01ea3443607673ba7708c6056154b75349dfd78b463b1379b2c32c89aeed5`。未安装系统 Agent 服务。

## 执行顺序及命令

基础安装/启动通过后依次执行正常流程、异常输入、容量边界、数据持久化、回归和构建部署复核；发现失败先修复，再重跑相关验收。没有把故障注入产生的预期错误当作正常请求成功。

```bash
npm ci
npm run geoip:download
npm run build
npm run test:all
npm run test:acceptance
docker buildx build --platform linux/arm64 --load -t server-monitor:local .
docker buildx build --platform linux/amd64 --load -t server-monitor:amd64 .
# 使用独立测试 .env / DATA_PATH
docker compose -p monitor-acceptance up -d --no-build --wait
TEST_BASE_URL=http://127.0.0.1:18091 TEST_API_SECRET="<测试密钥>" node test/load.js
```

本机 Docker 原配置引用了不存在的凭据助手，因此构建使用隔离的 `output/docker-config` 和 Colima socket，未改动用户全局凭据。首次 legacy builder 跨架构失败后改用 Buildx，两种平台的最终构建均通过。

## 功能验收项

以下项目通过 `npm run test:acceptance` 实际运行。验证手段统一为真实 HTTP 请求、真实 WS 客户端和 SQLite 查询；对应命令/详细断言在 `test/acceptance.js`，原始结果在 `output/test-results/acceptance.json`，日志在 `acceptance.log`。

| 编号 | 功能 | 实际操作 | 预期结果 | 状态 | 实际证据 |
| --- | --- | --- | --- | --- | --- |
| A01 | 安装与启动 | 全新目录启动主控，GET /healthz、/、/admin 和静态文件 | SQLite 自动初始化，页面和健康检查返回 200 | 通过 | `{"health":200,"home":200,"admin":200,"static":200,"schema":1}` |
| A02 | 管理员登录 | POST /admin/api login | 获得有效会话，可以读取设置 | 通过 | `{"login":200,"settings":200}` |
| A03 | 并发添加与数据隔离 | 同时添加 10 台服务器，并在同一毫秒分别上报 | 全部成功，数据按 UUID 隔离，无分区串台 | 通过 | `{"created":10,"uniqueIds":10,"correctlyIsolated":10}` |
| A03b | 服务器导入导出、编辑、删除 | 添加临时服务器，导出、删除后导入原记录，再清理 | 成功导入一条，重复 ID 跳过，删除级联清理历史 | 通过 | `{"imported":1,"skipped":2,"edit":true,"cascade":true}` |
| A04 | HTTP 配置协商 | 上报 schema 7，再带返回 MD5 重报同一包 | 返回配置及 204；重复包只保留一条历史 | 通过 | `{"configuration":200,"unchanged":204,"duplicateRows":1}` |
| A05 | WS 上报、面板推送与配置下发 | 实际连接 Agent WS 与浏览器 WS，发送指标并修改配置 | 收到落库确认、实时指标和配置推送 | 通过 | `{"persisted":true,"realtime":true,"configPush":true}` |
| A06 | 地区识别与手动覆盖 | 同机回环上报后指定 JP 地区 | 自动识别 US，手动值 JP 优先 | 通过 | `{"sameHostAuto":"US","manual":"JP"}` |
| A07 | 历史查询 | 请求 10 分钟、1 小时、24 小时、7 天历史 | 各范围均返回按时间排序的数据 | 通过 | `{"ranges":[0.167,1,24,168],"status":200}` |
| A08 | 手动备份 | POST /admin/backup，实际下载并打开 SQLite 文件 | 完整性通过，包含设置、服务器和历史 | 通过 | `{"integrity":"ok","servers":10,"downloaded":true}` |
| A09 | 通知失败补发 | 本地 Webhook 返回 503，执行离线检测和发送，再改为 200 重试 | 失败记录保留，重试成功后标记送达 | 通过 | `{"failedHttpAttempts":3,"successfulRetry":1,"duplicateEvents":0}` |
| A10 | 资源告警与流量、到期报告 | 通过 HTTP 上报高 CPU 样本，执行定时任务对应服务 | 资源告警和各报告进入持久队列，重复检查不重复入队 | 通过 | `{"queuedEvents":4,"duplicateReportEvents":0}` |
| A11 | 异常输入与权限 | 错误密码、密钥、JSON、时间范围；匿名备份；隐藏服务器 WS 订阅 | 返回 400/401/404；隐藏服务器不推送 | 通过 | `{"malformedJson":400,"badSecret":401,"anonymousBackup":401,"hiddenRest":404,"hiddenWsUpdates":0,"privateWs":401}` |
| A12 | 写入故障不能确认成功 | 用 SQLite 故障触发器阻止历史写入，分别 HTTP/WS 上报 | HTTP 500；WS 返回 error，不返回 persisted:true | 通过 | `{"http":500,"wsError":500,"falsePersistenceAck":0}` |
| A13 | 50 Agent / 10 面板边界 | 补齐 50 台，拒绝第 51 台，建立 50 条 Agent WS 和 10 条看板 WS | 全部正确确认与广播，主控保持健康 | 通过 | `{"agentConnections":50,"viewerConnections":10,"deliveredServerUpdates":500,"batchMs":37,"overCapacity":400}` |
| A14 | 历史边界与清理 | 写入近 7 天样本，模拟过期记录并执行清理 | 7 天内可查，过期历史删除，最新状态仍保留 | 通过 | `{"expiredHistory":0,"latestStates":50}` |
| A15 | 重启与通知持久化 | 关闭并重启主控，使用原会话读取服务器、历史、未发送通知 | 50 台服务器和待发送事件保留，原 JWT 仍有效 | 通过 | `{"servers":50,"persistedPendingEvents":3,"redelivered":true,"jwtStillValid":true,"privateStillEnforced":true}` |
| A16 | 手动恢复 | 停机后将 A08 备份复制到新的数据目录并启动 | 恢复到 10 台服务器，数据库完整性通过 | 通过 | `{"restoredServers":10,"integrity":"ok"}` |
| A17 | 清空历史保留配置与最新状态 | 上报指标后调用清空历史接口，再执行待写缓冲清理 | 历史为空，最新状态和服务器配置保留，停止不恢复旧历史 | 通过 | `{"historyRows":0,"servers":10,"latestRetained":true,"stalePendingRows":0}` |

## 浏览器、部署与回归验收

| 编号 | 功能 / 操作 | 预期 | 验证方式及实际证据 | 状态 |
| --- | --- | --- | --- | --- |
| B01 | 浏览器登录并添加 Browser acceptance 服务器 | 登录成功，列表出现新服务器 | Playwright CLI 实际填表和点击；列表 UUID `0a5300a7-35f7-41e2-94ee-cbd6457ded04`；后台共 2 台 | 通过 |
| B02 | 数据库管理点击下载备份，打开下载文件 | 获得有效 SQLite，包含数据 | `.playwright-cli/server-monitor-2026-09-16.sqlite`，`PRAGMA integrity_check=ok`，2 台服务器；`browser/backup-download.yml` | 通过 |
| B03 | 打开 Docker 看板和原版 Agent 详情 | 在线状态、CPU/RAM/网络及详情图表出现 | Chromium 实际导航、点击；`browser/agent-detail.yml`；详情页 console error=0 | 通过 |
| B04 | 修改站点标题并保存，刷新页面 | 成功提示且标题持久化 | 保存提示“设置保存成功”；GET /api/config 和刷新标题均为 Docker acceptance verified；`browser/settings-saved.yml`、`title-after-reload.yml` | 通过 |
| D01 | Compose bridge 启动、健康检查及非 root 运行 | 容器 healthy，主控为 UID 1000 | `compose.log`；`docker top` 确认主控与入口脚本 UID 1000，docker-init 是 root | 通过 |
| D02 | 更换镜像并重建 Compose 容器 | 原服务器、指标保留，Agent 能重连 | `deployment-and-browser.json`：originalAgentRetained=true；Linux Agent 日志含重建后 HTTP 204 | 通过 |
| D03 | 官方 Go Agent 同机 HTTP、WS、配置下发与模式切换 | 无需修改 Agent 即可上报和接收配置 | `official-agent-ws.log` 记录 auto→http 配置和 204；`official-agent-linux.log` 记录 Ubuntu 宿主机 WS 连接/ack、HTTP 204；版本 v1.0.16 | 通过 |
| D04 | HTTPS 反代登录与 WSS Upgrade | TLS 入口正常，Secure Cookie，WS hello | `node output/proxy/test.mjs`；`proxy-and-agent.json`：HTTPS health/login=200、secureCookie=true、wssUpgrade=true；可信/不可信代理分别有实际 HTTP 回归测试 | 通过 |
| D05 | arm64 镜像构建、启动及负载 | 服务健康，全部上报和广播成功 | `docker-build.log`、`images.txt`、`load.json` | 通过 |
| D06 | amd64 镜像构建、启动、登录、上报、备份 | 各 API 成功，备份可打开 | `docker-build-amd64.log`、`amd64-smoke.json`：health/login/report/backup=200、CPU=19、integrity=ok；仿真环境 | 通过 |
| R01 | Node 回归与 Agent 配置兼容 | 无失败 | `npm run test:all`，`regression.log`：tests=43、pass=43、fail=0；agent config tests passed | 通过 |
| R02 | 前端构建及差异检查 | 构建退出码 0、无空白错误 | `frontend-build.log`，`git diff --check` 退出码 0 | 通过 |
| R03 | AGENTS.md 字数、testing.md 原文和代码地图 | 符合文档要求 | AGENTS.md 共 470 个字符（含标点和路径）；testing.md 按用户原文保存；本地导入路径检查无缺失 | 通过 |

## 负载结果

- 实际运行 60.033 秒，50 条 Agent WS、10 条看板 WS，每 2 秒一轮。
- 收到 1500 次确认，广播 15000 个节点更新；错误数组为空。
- 本机该轮健康请求 P95 为 77.59 ms；结束前后单次资源采样约 72 MiB，见 docker-resources.txt（不是峰值内存）。
- 这是短时功能容量验证，不代表任意 VPS 的性能保证或 7 天持续运行验证。

## 测试中发现并修复

- Agent WS Upgrade 的版本信息未保存；增加真实 WS 版本持久化断言。
- 告警窗口快照 UPSERT 拼写错误；检查快照写入及重启恢复。
- 服务器导入占位符数量不匹配；增加导出→删除→导入与重复 ID 验收。
- 后台首次安装默认用户名为空导致设置保存受阻；修复有效用户名返回并实际浏览器保存、刷新。
- 清空历史误删最新状态且可能被待写聚合恢复；分离最新状态，清除待写旧历史，A17 验证。
- 原五项 P1 的修复和对应证据见 changelog.md。

## 未覆盖或跳过

| 编号 | 项目 | 状态与原因 / 验证方式 |
| --- | --- | --- |
| N01 | 实际公网域名、正式证书及用户 VPS | 未测试；本次使用本地 TLS 反代，未访问或部署用户生产服务器 |
| N02 | 外部 Telegram / 企业微信 / Bark 等真实渠道 | 未测试；无专用测试账号，仅本地 Webhook 覆盖通知生成、失败重试和重启补发 |
| N03 | IPv6 公网端到端上报 | 跳过；宿主环境没有可用 IPv6 公网路由；本地 GeoIP IPv6 查询通过 |
| N04 | 长时间运行、断电、磁盘真的写满、大历史库压测 | 未测试；写库失败使用 SQLite 触发器注入，7 天边界使用真实带时间戳记录验证 |
| N05 | 全部第三方主题、手机视觉布局 | 未测试；仅内置桌面页面完成实际操作 |
| N06 | 页面截图与像素级复核 | 跳过；Playwright screenshot 多次超时。DOM 快照、实际点击、下载和接口验证完成，未声称视觉检查通过 |
| N07 | GitHub Actions 远端执行 | 未测试；工作流已新增，本地执行相应测试及双架构构建，无推送/发布 |

## 证据保存与清理

原始日志、JSON、下载的备份、构建信息及浏览器 DOM 快照位于 `output/test-results/` 和 `.playwright-cli/`，为本地验收产物，不纳入 Git。报告记录了核心命令与实际返回，拉取仓库后可按 test/README.md 重新生成。TLS 反代检查脚本位于本次产物 `output/proxy/test.mjs`。测试使用虚构密钥和独立目录；结束后关闭本次 Agent、主控及测试容器，不改动其他容器。
