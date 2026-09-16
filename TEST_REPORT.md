# 最近一次测试报告

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
