# Node.js、Go、PHP 近期漏洞对本项目的影响核验

修复进展（2026-10-22）：Node 24.22.1 / Go 1.26.10 / Agent v1.3.1 已构建、隔离验收并于北京时间12:23:37部署生产。15/16实际Agent已升级且运行程序哈希核实；Legend-SIN仍为v1.3.0、待可用SSH入口。详细部署、测试和清理状态见 TEST_REPORT.md。以下运行版本和“需要更新”判断保留为修复前调查快照。

调查日期：2026-10-22（Asia/Shanghai）。主要窗口：2026-07-24 至 2026-10-22；重点核对 10 月最新官方公告。源码基点：`6b754809e8bf3fb9394be6acd932356b16c1d7c9`。**Node 主控和 Go Agent 需要安全更新；PHP 不属于本项目，但同机 FreshRSS 确实运行未修复 PHP。** 这里区分版本和功能受影响、具体利用前提、已排除路径，不宣称成功利用或已被攻击。

已读取 `docs/agents/domain.md`、`GLOSSARY.md`、`architecture.md`、`code_map.md`、`testing.md`；仓库没有 `docs/adr/`。官方公告调查由 research 后台研究完成，主调查补充只读运行核对和正常 Brotli 响应验证。没有修改业务代码、安装包或运行配置，也没有部署或执行漏洞载荷。详细命令、实际结果与未测试范围见 `../TEST_REPORT.md` 的 VS01–VS07。

## 项目影响结论

| 对象 | 实测状态 | 判断和处置边界 |
| --- | --- | --- |
| Node 主控 | `jan-monitor` / 镜像 `58c76d62665d`；Node **24.22.0**，内置 Undici **7.29.1**、OpenSSL **3.5.8** | 本次安全更新适用，出站响应处理与 TLS 客户端路径存在。建议升级 **24.22.1 或同分支后续修复版**。[Node 安全发布](https://nodejs.org/en/blog/release/v24.22.1/) |
| 原生 Go Agent | 内置 v1.3.0 Linux amd64/arm64 均为 **Go 1.26.8**；本机正在运行的 Agent 构建信息和 SHA-256 与内置 amd64 一致 | TLS/WSS 和 HTTP/2 客户端涉及未修复标准库。使用 **Go 1.26.10 或同分支后续修复版**重新编译，再发布并替换节点上的程序。[Go 发布历史](https://go.dev/doc/devel/release#go1.26.10) |
| 本项目 PHP | Git 跟踪文件、依赖和 Dockerfile 无 PHP；主控容器无 php 命令 | PHP 漏洞不直接影响本项目的 Node/Go 实现。这个结论不覆盖同机其他应用。 |
| 同机独立 FreshRSS | `php8.4-cli`、`libapache2-mod-php8.4` 均为 **8.4.24-1~deb13u1**；Apache 正在运行，`apache2ctl -M` 确认 `php_module (shared)` | Debian 将此精确包版本列为本次两项 PHP RCE 的 **vulnerable**，应独立更新至 **8.4.27-1~deb13u1 或后续修复包**并重启 PHP worker。[109618](https://security-tracker.debian.org/tracker/CVE-2026-109618)、[109619](https://security-tracker.debian.org/tracker/CVE-2026-109619) |

主控当前 `healthy`、restart=0，启动时间仍为 `2026-10-19T08:50:56.626165185Z`。服务健康与安全补丁是否齐全是两个不同事实。四处用于追踪的源码与生产文件 SHA-256 相同：`src/server.js`、`src/services/notifications/delivery.js`、`src/services/geoipDatabase.js`、`src/handlers/frontend.js`。这不是全镜像逐文件校验。

## Node：具体路径与条件

**优先处理 Brotli RCE 和 Undici DoS。** 项目虽然没有在业务代码显式调用 Brotli 解码，但内置 fetch 会按 HTTP 响应的 Content-Encoding 自动解码；生产运行时的内置 Undici 源码可直接看到 `br → zlib.createBrotliDecompress`。已在临时独立进程用正常压缩文本验证：Node 24.22.0 / Undici 7.29.1 发出 `Accept-Encoding: gzip, deflate`，接收 `Content-Encoding: br` 后仍成功解码。仅调整 Accept-Encoding 请求头不能保证阻止恶意对端返回 br。[对应版本官方 fetch 源码](https://github.com/nodejs/node/blob/v24.22.0/deps/undici/src/lib/web/fetch/index.js)。

调用依据：

- `src/services/geoipDatabase.js:30`、`:36`：启动及每日地区库更新的 fetch/响应流读取；后续 gunzip 和 MMDB 校验发生在 HTTP 内容编码解码之后。
- `src/services/geolocation.js:37`：未指定 PUBLIC_IP 时访问 ipify 并读取响应文本。
- `src/services/notifications/delivery.js:8`、`:237`、`:243`：通知 fetch，OneBot 分支还读取响应 JSON；自定义 Webhook 的服务端地址来自管理员配置。
- `src/handlers/frontend.js:296`、`:324`：第三方主题代理 fetch，读取并缓存响应；`src/handlers/admin.js:134` 是主题地址验证。主题源限定 GitHub/raw.githubusercontent.com，不能把“能提交主题文件”直接等同于“能构造远端 HTTP 的 Brotli 编码流”。

| 漏洞或修复组 | 对本项目的适用性 | 必要前提与限制 |
| --- | --- | --- |
| CVE-2026-111497，Brotli 越界写/RCE | **受影响版本与正常解码路径均已核实，应更新** | 攻击者必须让主控收到其控制的恶意 Brotli 编码响应，例如恶意/失陷的已配置远端或满足证书信任条件的中间人。没有证明任意匿名看板请求可直接实现 RCE。[Node 公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) |
| CVE-2026-109869，Undici 未处理流错误导致进程退出 | **7.29.1 明确位于受影响区间，fetch 路径存在，应更新** | 恶意远端返回超长编码链并提前断连；应用的 try/catch 和重试不构成完整保护。未向生产发送此类响应。[Undici 公告](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c) |
| 问题 CA 中间证书信任更新 | **HTTPS 客户端相关** | Node 24.22.1 更新 CA 材料并阻止问题公钥；旧镜像不会因反代 HTTPS 而自动获得出站证书修复。利用仍需网络劫持及可接受的证书链。[Node 发布说明](https://nodejs.org/en/blog/release/v24.22.1/) |
| OpenSSL CVE-2026-35189，CRLDP 内存放大 | **3.5.8 命中版本，普通 TLS 客户端为候选影响面** | 恶意证书的扩展处理可发生于普通 TLS 握手；尚未复现本项目中的内存放大。它不是仅 DTLS/QUIC 的问题，随 Node 更新至 OpenSSL 3.5.9 一并处理。[OpenSSL 公告](https://openssl-library.org/news/secadv/20260929.txt) |
| CVE-2026-105483 / 106069 / 106072，特殊 IP 主机名校验绕过 | 版本属于官方受影响分支；**未确认具体特殊主机名能通过项目 URL 规范化后触发** | 出站 TLS 使用存在，但仅凭 fetch 不能宣布已满足绕过条件；固定正常域名和 URL 解析是需要保留的限制因素。 |
| CVE-2026-105482，dns.resolve NUL 截断 | 当前项目调用未触发 | 未发现 Node 侧使用 dns.resolve/resolveAny；不能把操作系统地址解析或 fetch 的普通域名访问直接当作 dns.resolve。 |
| CVE-2026-105481，核心 HTTP keep-alive 响应错位 | 未确认对应核心 HTTP 客户端调用 | 项目出站使用 Undici fetch，不能将它直接等同于此条涉及的 node:http Agent。入站 createServer 的 keep-alive 也不是该客户端路径。 |
| CVE-2026-106074，用户态快照/SEA 的随机缓存 | 当前交付流程不触发 | 虽使用 randomUUID，但未生成用户态启动快照/SEA；普通 node 启动不等于公告的快照打包场景。 |
| CVE-2026-106073，Permission Model realpathSync 绕过 | 当前交付不依赖该安全边界 | 入口正常启动 node，未见 Permission Model 沙箱配置；进程参数无 permission/snapshot 标志。进程环境 NODE_OPTIONS 未读到，故不声称已排除任意外部注入配置。 |
| CVE-2026-106070 / 106071 | Node 24 不在公告受影响分支 | 公告只列 Node 26。宿主开发 Node 为 26.7.0，若继续用于构建/工具执行，也应使用修复版 26.12.1 或项目要求的修复版 Node 24。 |
| 7 月 29 日安全发布 | 当前 Node 24.22.0 已包含该轮修复 | 该轮 Node 24 的修复版为 24.18.1；不能把 7 月各条重复算作当前缺失的补丁。 |

上述 Node 10 月核心 CVE 的分支和版本边界以[官方安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)及[24.22.1 变更](https://nodejs.org/en/blog/release/v24.22.1/)为准。当前 HTTP 入口将请求体作为原始字节构造 Request（`src/runtime/http.js:22`），没有 Brotli 请求体解码；WS 显式 `perMessageDeflate: false`（`src/server.js:100`）。这限制了直接入站压缩攻击路径，不能消除上述出站响应风险。

## Go Agent：具体路径与条件

`go version -m /proc/305141/exe` 直接读取本机运行程序，结果为 Go 1.26.8、Linux amd64、CGO_ENABLED=0；进程程序为 `/usr/local/bin/jan-probe`，哈希 `9d98e1278f418161be86ec6065d3240b5a5b30bfe874fcf0ff59892ddd7e97e8`，与镜像 v1.3.0 的 amd64 清单一致。arm64 内置程序同样含 Go 1.26.8 构建信息，但没有登录全部远程节点读取运行文件，不能据此证明每台 Agent 的实际编译器版本。

| 项目 | 判断 | 源码、条件和排除理由 |
| --- | --- | --- |
| CVE-2026-111943 / GO-2026-6809 | **受影响标准库版本；TLS 校验路径存在，利用取决于各宿主信任库** | WSS 在 `agent/internal/cfprobe/websocket_client.go:107` 调用 tls.Client，指定 ServerName 并正常校验证书；HTTPS 客户端也使用默认验证。1.26.8 没有 1.26.10 的问题中间证书拒绝列表。攻击者需能劫持网络并提供旧验证器/信任库仍接受的证书链；系统 CA 回补会降低部分暴露，未逐台核对信任库。[官方漏洞条目](https://pkg.go.dev/vuln/GO-2026-6809) |
| CVE-2026-78669 / GO-2026-6611 | **HTTP/2 客户端具备条件性影响** | `agent/internal/cfprobe/dnsresolve.go:118` 显式 ForceAttemptHTTP2，供上报/更新客户端使用。恶意 HTTP/2 对端可通过流与窗口设置产生 CPU 消耗；实际需协商 HTTP/2 并满足流负载条件，未做恶意对端压力复现。本机若只用回环 HTTP 上报，该连接没有 WSS/TLS 或 HTTP/2 暴露，但更新、外部 HTTPS 等连接应分别核对。[官方漏洞条目](https://pkg.go.dev/vuln/GO-2026-6611) |
| HTTP/2 / TLS 服务端、Range、multipart、html/template、Windows os.Root 各条 | 当前 Agent 运行面不适用 | Agent 主动上报、探测和下载，没有生产 HTTP/TLS 监听服务、文件服务、multipart 表单或 html/template；仅交付 Linux amd64/arm64。Node 主控不会加载 Go net/http 作为服务端。 |
| CVE-2026-78660，HTTP/2 转 HTTP/1 响应走私 | 未找到所需代理转换路径 | Agent 没有反向代理转发 HTTP/1 响应的功能；单纯接收 HTTP 响应不足以满足公告的走私链。 |
| CVE-2026-56866，带正文 CONNECT 后连接复用 | 未找到所需请求构造 | 业务请求为 GET/POST，没有带正文 CONNECT；配置 HTTP_PROXY/HTTPS_PROXY 不自动证明会产生本条所需的 CONNECT 正文。 |
| cmd/go 供应链两条 | 构建工具链需更新，区别于运行中 Agent | Go 编译器不随最终主控镜像交付；恶意项目/代理控制属于构建前提，不是 Agent 入站网络漏洞。未来构建应使用修复工具链。 |
| 独立 x/net v0.56.0 的 HTTP/2 公告 | **当前模块包路径未编入，不能只凭 go.mod 报独立模块可利用** | `go list -deps ./cmd/cf-probe` 显示 x/net 仅 bpf、icmp、ipv4/ipv6 及内部依赖；没有独立 x/net/http2。二进制里的 `vendor/golang.org/x/net/http2/hpack` 属于 Go 标准库，应通过更新 Go 重编译修复。 |
| 8 月 13 日旧标准库公告、x/crypto SSH 公告 | 当前已覆盖或组件未使用 | Go 1.26.8 高于该轮标准库修复 1.26.6；x/net 0.56.0 已达到 DNS/IDNA 两项独立模块修复边界；项目没有 x/crypto/ssh 依赖。 |

证书问题还关系 Agent 上报内容和更新下载的可信性：上报数据包含认证 Secret（`agent/internal/cfprobe/agent.go:678`），更新的程序和 checksums.txt 来自同一下载来源（`agent/internal/cfprobe/update.go:285`）。如果攻击者已满足中间人证书链前提，普通 SHA-256 对照不能独立对抗同时替换程序和校验清单。这是已有调用关系下的影响推导，不是本轮完成了中间人攻击或远程代码执行验证。

## 处置建议与升级约束

1. 主控采用 Node **24.22.1 或同分支后续修复版**，覆盖 Dockerfile 的构建和运行阶段，更新项目声明的最低安全版本。浮动 `node:24-bookworm-slim` 不会自动更新已运行镜像，重建时也应确认拉到了新基础镜像；只运行 npm audit 无法替换 Node 内置 Brotli、Undici、OpenSSL 和 CA 修复。
2. 将 Go 构建基线从 **1.26.8 升至 1.26.10 或同分支后续修复版**，同步 Dockerfile、agent/go.mod 及构建说明，以 Linux amd64/arm64 重编译。升级宿主机编译器或重启主控不会改变已分发的静态程序。
3. **给重编译的 Agent 分配新独立版本**，例如后续决定采用 v1.3.1。`src/services/agentDistribution.js:78` 明确拒绝同一版本的不同产物；若沿用 v1.3.0，持久归档与新产物冲突会导致启动归档报错，自动更新也不能可靠识别为新版本。保留原历史归档，部署后逐步替换实际节点程序，确认未启用自动更新或固定旧版本的节点也获得新程序。
4. FreshRSS 作为独立应用更新 PHP 镜像/发行商包至修复版本并重启 worker。它没有被纳入本项目的修复或部署；不能仅升级 FreshRSS 应用脚本而继续运行已确认 vulnerable 的 PHP 包。
5. 实施时先准备隔离环境，完成 `npm ci`、`npm run geoip:download`、`npm run build`、`npm run test:all`、`npm run test:acceptance`；涉及 Agent 新构建/分发还需先构建 `server-monitor:agent-native` 并执行 `npm run test:agent-deployment`。再核对实际新 Node/Agent 构建信息、旧归档兼容和节点上报，不能把本轮核验算作升级验收。

本次只完成调查和无害解码验证；未执行上述升级、全量回归或部署。以下保留逐批官方公告资料，用于复核版本边界。

## 当前修复版本

| 组件 | 最新核实的安全发布日 | 对应修复版本 | 官方证据 |
| --- | --- | --- | --- |
| Node.js | 2026-10-21 | 24.22.1；另有 22.23.4、26.12.1 | [官方漏洞目录](https://nodejs.org/en/blog/vulnerability/)、[24.22.1 发布说明](https://nodejs.org/en/blog/release/v24.22.1/) |
| Go | 2026-10-19 | 1.26.10、1.27.3 | [官方发布历史](https://go.dev/doc/devel/release)、[安全发布公告](https://groups.google.com/g/golang-announce/c/66pojueaQek) |
| PHP | 2026-10-21 | 8.2.35、8.3.36、8.4.27、8.5.12 | [PHP 官方公告](https://www.php.net/archive/2026.php#2026-10-21-1)、[PHP 官网](https://www.php.net/) |

Node 24.22.0、Go 1.26.8 均早于上述安全修复版。是否可利用仍取决于实际调用和攻击者能否控制输入。对于静态编译的 Go Agent，升级宿主机 Go 安装不会替换已编入二进制的标准库；需要使用修复版重新编译并分发。此处最后一句是 Go 二进制交付模型的工程判断，不是已完成的修复。

## Node.js：2026-10-21

以下是 Node 24 相关项。官网给出了受影响主版本及修复版，没有逐项给出最早引入补丁版本；因此“24.x 修复前版本”是维护分支内的处置边界，不声称每个历史 24.x 都包含每项缺陷。[安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)、[24.22.1 发布说明](https://nodejs.org/en/blog/release/v24.22.1/)。

| CVE | 官方等级 | 触发点 | 修复版本 |
| --- | --- | --- | --- |
| CVE-2026-111497 | High | 解码恶意 Brotli 数据，越界写，可导致 RCE | 24.22.1、22.23.4、26.12.1 |
| CVE-2026-105482 | High | `dns.resolve` 输入含 NUL，域名被截断 | 同上 |
| CVE-2026-105483 | High | 全角数字 IP 导致 TLS 主机名校验绕过 | 24.22.1、26.12.1；公告未列 22.x |
| CVE-2026-106069 | High | 非规范、可宽松解析为 IP 的主机名绕过 TLS 校验 | 24.22.1、22.23.4、26.12.1 |
| CVE-2026-106072 | Medium | 非规范 IPv4 被 DNS SAN 错误认证 | 同上 |
| CVE-2026-105481 | Medium | keep-alive 连接接受在请求发送前写入的响应 | 同上 |
| CVE-2026-106074 | Medium | 启动快照或 SEA 保存随机缓存，不同进程重复 UUID/随机整数 | 同上 |
| CVE-2026-106073 | Low | 使用 Permission Model 时，`fs.realpathSync` 绕过限制 | 同上 |

上述表按[漏洞公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)记录等级；24.22.1 发布说明将两个 IP 相关 CVE 合在 High 一项，不据此把 CVE-2026-106072 单独改为 High。另两项 CVE-2026-106070（ZIP 校验失败后返回前缀字节）、CVE-2026-106071（权限模型通配符路径）仅列 26.x，不将它们归入 Node 24。

24.22.1 同时更新 c-ares 1.34.9、OpenSSL 3.5.9、Undici 7.30.1，并更新 CA 信任材料及封禁问题公钥；SQLite 更新仅属于 22.x。Brotli 为回移补丁，不能仅凭 `process.versions.brotli` 的版本字符串判断是否已修复。[24.22.1 发布说明](https://nodejs.org/en/blog/release/v24.22.1/)、[22.23.4 发布说明](https://nodejs.org/en/blog/release/v22.23.4/)。

判定项目是否受影响时，优先查看出站请求的响应解压、TLS 校验、HTTP keep-alive；接收 HTTP/WS 的服务也可能有出站调用。以上是核查路径建议，不表示每条漏洞都已证实可达。不能用“容器里没有 HTTPS 服务端”排除所有 Node TLS 客户端问题。

## Node 内置依赖：Undici 与 OpenSSL

**Undici CVE-2026-109869 / GHSA-xjj6-f33q-929c**，2026-10-15，High / CVSS 3.1 7.5。受影响范围为 `>=6.23.0,<6.29.1`、`>=7.18.0,<7.30.1`、`>=8.0.0,<8.12.2`；修复版分别为 6.29.1、7.30.1、8.12.2。恶意服务器响应含超过 5 层 Content-Encoding，并在发送正文前关闭连接，会使 `fetch()` 创建的孤立内部流发生未处理错误、退出整个 Node 进程，应用捕获 fetch 拒绝也无法防止。官方没有通用 workaround。Node 24.22.1 升级内置 Undici 至 7.30.1；仅检查 `package-lock.json` 不足以判断 Node 内置实现。[Undici 官方安全公告](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c)、[Node 24.22.1 发布说明](https://nodejs.org/en/blog/release/v24.22.1/)。

**OpenSSL 2026-09-29 安全批次**，3.5 分支修复版为 3.5.9，由 Node 24.22.1 纳入。需要特别区分：[官方安全公告](https://openssl-library.org/news/secadv/20260929.txt)。

- CVE-2026-35189（Low）：恶意证书含大量相对 CRLDP 时内存放大，普通 TLS 客户端也可能受影响，不能统称为 DTLS/QUIC 专属。
- CVE-2026-84782（High）、75806（Low）涉及 DTLS；35191、42772、54873、75804、84784（均 Low）涉及 QUIC。
- CVE-2026-54872、54875、77696（均 Low）涉及特定 EC/SM2 私钥运算计时；54875 涉及 ARM64/RISC-V。
- CVE-2026-72897（Low）要求 TLS 服务端握手期间切换 SSL_CTX；75805（Low）要求 CMP 撤销客户端特定路径。
- CVE-2026-84783 的 X.509 并发 UAF 只影响 OpenSSL 4.0，官方明确排除 3.5。

以上省略年份前缀的编号均属于 `CVE-2026-*`。具体项目是否使用这些功能，应按调用与构建选项判断。

## Node.js：2026-07-29

该轮 Node 24 修复版为 **24.18.1**，另有 22.23.2、26.5.1。以下为 24.x 相关项；已安装更高维护版时应核对它是否继承这些修复。[7 月安全公告](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases)、[24.18.1 发布说明](https://nodejs.org/en/blog/release/v24.18.1/)。

| CVE | 等级 | 触发条件 |
| --- | --- | --- |
| CVE-2026-56846 | High | HTTP/2 头部保留绕过会话内存限制 |
| CVE-2026-56848 | High | HTTP/2 重入发送导致释放后使用 |
| CVE-2026-58043 | High | Permission Model 路径前缀越权 |
| CVE-2026-56850 | Medium | HTTPS Agent 使用不同 PFX 身份时连接池键冲突 |
| CVE-2026-58040 | Medium | HTTPS Agent 重用会话时漏做身份校验 |
| CVE-2026-58041 | Medium | `node:sqlite` SQLTagStore 重绑语句后的旧迭代器再次执行 |
| CVE-2026-58042 | Medium | `dns.resolveAny()` 收到超过 256 条 A 记录 |
| CVE-2026-58045 | Medium | zlib 同步接口收到伪造 TypedArray 长度 |
| CVE-2026-56847 | Low | Permission Model 下 trace_events 越界写日志 |
| CVE-2026-58039 | Low | Permission Model 下 process.report 越界写文件 |
| CVE-2026-58044 | Low | 转发代理遗漏被截断的头部，但仍传递原始请求体 |

该轮还更新 llhttp 9.4.3、Node 24 内置 Undici 7.29.0。[24.18.1 发布说明](https://nodejs.org/en/blog/release/v24.18.1/)。官方漏洞目录在本次窗口内列出 7 月 29 日、10 月 21 日两轮，不将普通月度发布误记为安全公告。

## Go：2026-10-19

**CVE-2026-111943 / GO-2026-6809**：`crypto/x509.Certificate.Verify` 新增问题中间证书拒绝列表。受影响边界为 `<1.26.10`，以及 `>=1.27.0-0,<1.27.3`；修复 1.26.10、1.27.3。恶意证书链仍可被旧验证器信任的场景需要关注；更新系统 CA 可降低部分风险，不能代替 Go 中的拒绝列表。Go 安全公告要求立即升级；OSV 条目公开日是 10 月 21 日，与补丁发布日期 10 月 19 日不同。[官方公告](https://groups.google.com/g/golang-announce/c/66pojueaQek)、[独立漏洞条目及版本边界](https://pkg.go.dev/vuln/GO-2026-6809)。

## Go：2026-10-08

该轮 **15 项**，修复版均为 **1.26.9、1.27.2**。以下“修复前”指 Go 官方 OSV 所列 `<1.26.9`、`>=1.27.0-0,<1.27.2`，不是把 Go 1.25 等停止维护分支视为安全。每条均已读取对应 `https://vuln.go.dev/ID/GO-2026-*.json` 的官方 OSV 数据，表中链接是同一数据库的可读页面。[官方发布历史](https://go.dev/doc/devel/release)、[完整官方公告](https://groups.google.com/g/golang-announce/c/U2fTuyDJznI)（亦可从 [golang-dev 镜像](https://groups.google.com/g/golang-dev/c/DaXYwdKVkRA)读取）。

| CVE | 包 / 触发条件 | 单项官方证据 |
| --- | --- | --- |
| CVE-2026-97032 | `net/http` HTTP/2 服务端：并发更改 HPACK 表大小时竞态崩溃 | [GO-2026-6617](https://pkg.go.dev/vuln/GO-2026-6617) |
| CVE-2026-78659 | HTTP/2 服务端：声明大量 Trailer 字段，绕过头部内存限制 | [GO-2026-6603](https://pkg.go.dev/vuln/GO-2026-6603) |
| CVE-2026-97031 | TLS 服务端：构造 ECH outer-extension 多重引用，引发内存放大 | [GO-2026-6607](https://pkg.go.dev/vuln/GO-2026-6607) |
| CVE-2026-94444 | `cmd/go`：恶意项目与恶意代理替换 `golang.org/fips140` | [GO-2026-6601](https://pkg.go.dev/vuln/GO-2026-6601) |
| CVE-2026-94447 | `cmd/go`：恶意项目和代理绕过 `golang.org/toolchain` 校验 | [GO-2026-6602](https://pkg.go.dev/vuln/GO-2026-6602) |
| CVE-2026-94448 | `html/template`：连续 JavaScript 模板表达式导致上下文追踪错误 | [GO-2026-6599](https://pkg.go.dev/vuln/GO-2026-6599) |
| CVE-2026-97030 | `html/template`：`yield` 后正则上下文识别错误 | [GO-2026-6600](https://pkg.go.dev/vuln/GO-2026-6600) |
| CVE-2026-94440 | `net/textproto` / `mime/multipart`：剩余限额小于 400 字节时长行突破限制 | [GO-2026-6608](https://pkg.go.dev/vuln/GO-2026-6608) |
| CVE-2026-56866 | HTTP/1 客户端：带正文 CONNECT 被拒后连接复用，导致响应错位 | [GO-2026-6605](https://pkg.go.dev/vuln/GO-2026-6605) |
| CVE-2026-94439 | HTTP/1 服务端：CONNECT 返回 2xx 后未接管连接，继续解析 HTTP | [GO-2026-6613](https://pkg.go.dev/vuln/GO-2026-6613) |
| CVE-2026-78669 | HTTP/2 客户端和服务端：大量流与初始窗口 SETTINGS 变更导致 CPU 放大 | [GO-2026-6611](https://pkg.go.dev/vuln/GO-2026-6611) |
| CVE-2026-78660 | HTTP/2 客户端：畸形 framing 头在转为 HTTP/1 响应时可能造成走私 | [GO-2026-6610](https://pkg.go.dev/vuln/GO-2026-6610) |
| CVE-2026-56857 | **仅 Windows**：`os.Root.Mkdir(All)` 跟随 junction 越出根目录 | [GO-2026-6604](https://pkg.go.dev/vuln/GO-2026-6604) |
| CVE-2026-78667 | HTTP 文件服务：大量小 Range 触发 CPU 放大；涉及 ServeContent / ServeFile / FileServer | [GO-2026-6609](https://pkg.go.dev/vuln/GO-2026-6609) |
| CVE-2026-78663 | HTTP/2 服务端：重置流后重复返还流控额度 | [GO-2026-6612](https://pkg.go.dev/vuln/GO-2026-6612) |

这些条件中，服务端专属漏洞不能直接套到仅发起连接的 Go Agent。CVE-2026-78669 明确同时涉及客户端；TLS/WSS 使用也应单独检查 10 月 19 日的证书信任问题。CVE-2026-56857 不涉及项目目标 Linux amd64/arm64，其余表项不能仅凭这两种 CPU 架构排除。

## Go：2026-08-13

该轮标准库/工具链修复版为 **1.26.6、1.25.13**，亦包含在 1.27rc3 及后续正式版。Go 1.26.8 已越过该轮标准库修复边界；独立 `golang.org/x/*` 模块仍需检查模块版本。[官方公告](https://groups.google.com/g/golang-announce/c/94pEornpRlI)、[发布历史](https://go.dev/doc/devel/release)。

| CVE | 触发条件 | 单项官方证据 |
| --- | --- | --- |
| CVE-2026-56865 | 恶意 GOPROXY 伪造透明日志 tile，绕过模块校验 | [GO-2026-6179](https://pkg.go.dev/vuln/GO-2026-6179) |
| CVE-2026-56864 | 恶意 GOPROXY 与 GOSUMDB 配合，用无关哈希替换模块内容 | [GO-2026-6180](https://pkg.go.dev/vuln/GO-2026-6180) |
| CVE-2026-56859 | XML DecodeElement 嵌套递归突破深度计数，栈耗尽 | [GO-2026-6088](https://pkg.go.dev/vuln/GO-2026-6088) |
| CVE-2026-56853 | 明文 HTTP/2 服务端识别前导数据时没有使用 ReadHeaderTimeout | [GO-2026-6089](https://pkg.go.dev/vuln/GO-2026-6089) |
| CVE-2026-56860 | URL 相对路径含大量 `..`，解析开销平方增长 | [GO-2026-6218](https://pkg.go.dev/vuln/GO-2026-6218) |
| CVE-2026-46600 | DNS SVCB / HTTPS 资源记录畸形长度导致 panic | [GO-2026-5942](https://pkg.go.dev/vuln/GO-2026-5942) |
| CVE-2026-56862 | TLS 服务端持续处理对端 KeyUpdate，产生 CPU DoS | [GO-2026-6090](https://pkg.go.dev/vuln/GO-2026-6090) |
| CVE-2026-56858 | HTML 模板中的 JavaScript 正则上下文转义错误，可能 XSS | [GO-2026-6091](https://pkg.go.dev/vuln/GO-2026-6091) |
| CVE-2026-39821 | IDNA 接受解码为纯 ASCII 的 Punycode，可能影响域名权限判断 | [GO-2026-5026](https://pkg.go.dev/vuln/GO-2026-5026) |
| CVE-2026-33818 | ASN.1 深度递归解码耗尽栈 | [GO-2026-5972](https://pkg.go.dev/vuln/GO-2026-5972) |

上述 CVE-2026-46600、CVE-2026-39821 是本轮 Go 内置副本修复；它们的独立模块公告早于本窗口，分别需要 `x/net >=0.56.0`、`x/net >=0.55.0`。两个模块校验漏洞需要 `x/mod >=0.40.0`；不要把编译器版本与独立模块版本混为一个判断。[GO-2026-5942](https://pkg.go.dev/vuln/GO-2026-5942)、[GO-2026-5026](https://pkg.go.dev/vuln/GO-2026-5026)、[GO-2026-6179](https://pkg.go.dev/vuln/GO-2026-6179)、[GO-2026-6180](https://pkg.go.dev/vuln/GO-2026-6180)。

## Go 独立模块补充

| 公布日 | 漏洞 | 受影响 / 修复 | 条件与证据 |
| --- | --- | --- | --- |
| 2026-08-28 | CVE-2026-56854 | `x/crypto <0.55.0` / 0.55.0 | SSH 非公钥认证回调未强制 source-address 选项；[GO-2026-6303](https://pkg.go.dev/vuln/GO-2026-6303) |
| 2026-09-02 | CVE-2026-56855 | `x/crypto <0.56.0` / 0.56.0 | 已建立 SSH channel 的恶意消息死锁；[官方公告](https://groups.google.com/g/golang-announce/c/1y3fb2np35U)、[GO-2026-6355](https://pkg.go.dev/vuln/GO-2026-6355) |
| 2026-09-02 | CVE-2026-78662 | `x/crypto <0.56.0` / 0.56.0 | 尚未接受的 SSH channel 被请求洪泛死锁；[GO-2026-6354](https://pkg.go.dev/vuln/GO-2026-6354) |
| 2026-10-08 | CVE-2026-97032、78659、78669、78660、78663 | `x/net <0.60.0` / 0.60.0 | 独立 `x/net/http2` 对应前文 HTTP/2 问题；[官方公告](https://groups.google.com/g/golang-announce/c/ZPwCyRUuGBs)、[golang-dev 镜像](https://groups.google.com/g/golang-dev/c/yWB4rz3eHjE)，单项 OSV 链接见前表 |

存在 `indirect` 依赖不等于漏洞包已编入程序或可达；需要以实际导入/构建依赖及调用判断。

## PHP：2026-10-21 严重远程代码执行

两项均为 **Critical / CVSS v4 9.2**，官方公布于 10 月 21 日。各维护分支修复版为 **8.2.35、8.3.36、8.4.27、8.5.12**；同分支更早补丁版需要更新。官方未为所有停止维护版本给出完整首次引入边界，不能据维护分支表宣布旧分支安全。8.1 及更早已结束正常维护；PHP 团队为本次两项漏洞额外提供了 7.4/8.0/8.1 最小源码回移补丁，这不等于恢复分支维护。使用旧分支需要核对发行商补丁或更换支持版本。[PHP 官方公告](https://www.php.net/archive/2026.php#2026-10-21-1)、[支持周期](https://www.php.net/supported-versions.php)。

| CVE | 机制与触发条件 | 官方来源 |
| --- | --- | --- |
| CVE-2026-109618 | OOM 的 `longjmp()` 使请求状态未完成初始化，随后清理操作处理无效内存，导致 RCE；mod_php 默认配置已验证请求在应用代码前触发。FPM 启动失败会退出 worker，但应用运行阶段仍可能可达 | [GHSA-w8hw-w9fx-j79w](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w) |
| CVE-2026-109619 | worker 保留指向已释放请求内存的全局状态，后续同 worker 请求在正常初始化前消费，导致 UAF/RCE；已验证 mod_php；FPM 路径依赖应用阶段生产者与后续上传进度等消费者 | [GHSA-6wmf-4rv5-p3rp](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp) |

这两项不是“仅 Windows php-cgi 漏洞”。官方明确要求所有提供 Web 请求的 PHP 部署评估，包含 FPM、mod_php、php-cgi、FrankenPHP、LiteSpeed；不同 SAPI 的已验证利用条件不同。修改内存限制、关闭错误显示或单一配置不能作为完整修复；官方要求升级并重启 worker。[PHP 官方公告](https://www.php.net/)、[109618 技术公告](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w)、[109619 技术公告](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp)。

日期差异：PHP 官网与 GHSA 公告为 10 月 21 日；[PHP ChangeLog](https://www.php.net/ChangeLog-8.php)的部分 10 月版本标题日期显示 10 月 22 日。本调查以安全公告公开日为准，不据此虚构另一次发布。PHP 8.6 测试版也有修复，但不作为生产升级目标。

## PHP：窗口内较早安全发布

| 安全修复批次 | 维护分支版本 | 公告所列主要问题 |
| --- | --- | --- |
| 2026-07-30 | 8.2.33、8.3.33、8.4.24、8.5.9 | CVE-2026-17543（PGSQL 转义相关 SQL 注入）、CVE-2026-7260（Phar 递归链接崩溃）、CVE-2026-9672（libgd）；8.4/8.5 还包括 CVE-2026-17544（BCMath 越界写） |
| 2026-09-24 | 8.2.34、8.3.35、8.4.26、8.5.11 | CVE-2026-91768（FPM IPv6 ACL）、91769（TLS 主机名回退）、91767（TLS 通配 CN 堆溢出）、91765（SOAP 递归）、91766（HTTP 重定向凭据）、92842/93682（越界读）、6103（Phar TAR 条目注入）、2025-1218/2025-14181（mysqlnd/SOAP）、17545（Windows 设备名） |

上述批次和 CVE 映射来自 [PHP 官方 ChangeLog](https://www.php.net/ChangeLog-8.php)及[官方新闻归档](https://www.php.net/archive/2026.php)。它们用于确认近期 PHP 更新不只有 10 月这两项；不是逐项验证某个 PHP 应用的可利用性。是否安装这些 PHP 扩展、是否存在 PHP 服务，应另行核实。

## 证据限制和后续核实边界

- “版本受影响”“漏洞函数被调用”“攻击者可以控制必要输入”“存在已验证利用”是不同结论，不能相互替代。
- Node 官方尚未给出本轮各 CVE 的完整首次引入补丁范围；尝试从 CVE 官方 API 获取这些新 Node CVE 时返回 404。本调查依赖 Node 官方已公开公告与发布说明，不能用 API 暂无条目否定其存在。
- 近期 Node/Go 的大多数问题没有 Linux amd64/arm64 排除条件；Windows junction、PHP Windows 设备名等必须按平台剔除。
- 独立模块、嵌入式第三方库、发行商回移补丁不能仅按系统包名或上游版本字符串一刀切判断。
- 即使仓库没有 PHP 代码，也只能支持“项目不直接依赖 PHP”的判断；不能据此证明宿主机、1Panel 同机站点、反向代理周边服务均未运行 PHP。
- 前面的项目结论包含主控版本、内置及本机 Agent 构建信息、关键文件一致性、静态调用关系和独立 PHP 包/模块证据；只运行了正常 Brotli 响应验证，没有运行漏洞载荷、全量漏洞扫描或修复验收。全部远程 Agent 的运行版本、信任库和外部部署条件仍是核验边界。
