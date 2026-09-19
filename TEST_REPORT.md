# 最近一次测试报告

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
