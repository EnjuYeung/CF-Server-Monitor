# Native Agent

本目录直接纳入上游 **cfsm-agent v1.0.16** 的 Go 源码和测试，原始提交与许可见
[UPSTREAM.md](UPSTREAM.md)、[LICENSE](LICENSE)。本项目 Agent 从 **v1.1.0** 开始独立版本管理。
`UPSTREAM_README.md` 只保留上游功能说明和来源，安装与更新请使用本文。

## 运行结构与功能

Agent 以 `cf-probe` 原生进程运行在被监控机器上；主控在 Docker 内运行 Node.js、Vue 和 SQLite。
二者通过主控的 `/update` HTTP/WebSocket 接口通信，同机时可使用 `http://127.0.0.1:8080/update`。
Agent 不需要 Go、Node.js、Docker、Workers 账号或 GitHub 访问权限；编译工具只用于构建阶段。

保留 v1.0.16 的 CPU、内存、Swap、磁盘容量/IO、GPU、负载、进程、连接数、网卡/网速、月流量、
公网 IP、TCP/ICMP 探测、丢包、四个运营商节点和四个自定义节点。采样、WS 实时上报、HTTP 回退、
时段协商、配置 schema 7/MD5、时间校准、流量校正与重置、服务安装/卸载及更新后的重启继续使用上游逻辑。
各操作系统能提供的指标与权限限制沿用上游；Linux user service、macOS LaunchAgent、systemd、OpenRC、
procd、Synology、FreeBSD、Windows 的安装方式和路径保持兼容。

原生适配只改变分发来源、版本构建与主控命名：

- `CONTROLLER_URL` 为新的配置名称，仍接受旧 `WORKER_URL`，写配置时同时保留两个名称。
- 主控在 WebSocket 握手中补充标准 `Date` 响应头，保留仅使用 WS 时的 Agent 时间校准能力。
- 自动更新默认关闭；启用后仍在启动时和每 6 小时检查，版本选择保留稳定版与 Snapshot 通道规则。
- 安装、版本检查、更新下载都访问主控 `/agent`，可配置具有相同目录/API 的下载镜像。
- 安装与自动更新均要求 SHA-256 校验通过；缺失或不匹配时不执行下载文件。
- Linux ARM 自动更新按实际构建的 ARMv5/v6/v7 选择文件，其他目标仍使用原 release 命名。
- 旧 `UPDATE_PROXY` / `--install-ghproxy` 仍可读取，但不再构造 GitHub 下载地址；下载镜像请使用 `--download-url`。

## 构建

使用 `go.mod` 要求的 Go 工具链（当前 1.26.8）。仓库根目录执行：

```sh
npm run build                  # 前端 + 全部 16 种 Agent 程序
npm run build:frontend         # 仅构建前端
npm run build:agent            # 仅构建 Agent
npm run build:agent -- -targets linux/amd64,linux/arm64,darwin/arm64
```

也可以在本目录执行 `go run ./tools/build -out=../agent-dist`。Go 模块及 checksum 按 `go.sum` 锁定，
使用 CGO_ENABLED=0、trimpath、固定版本信息构建。Docker 的独立 Go 阶段完成全部交叉编译，最终镜像仅携带
主控运行时、安装脚本和编译产物，不包含 Go 编译器。

| 系统 | 保留的上游 release 目标 |
| --- | --- |
| Linux | amd64、arm64、386、armv5、armv6、armv7、loong64 |
| FreeBSD | amd64、arm64、386、arm |
| macOS | amd64、arm64 |
| Windows | amd64、arm64、386 |

输出为 `agent-dist/<version>/`，含二进制、`manifest.json` 和 `checksums.txt`；安装脚本在
`agent-dist/` 根目录。产物被 Git 忽略，不提交二进制、配置或测试结果。

## 安装、指定版本与卸载

优先在后台添加服务器并复制命令，命令已经包含服务器 UUID、主控地址和认证密钥。
POSIX 系统的通用形式如下；示例中的值必须替换成后台实际参数：

```sh
curl -fsSL https://monitor.example.com/agent/install.sh | sh -s -- install \
  -id=SERVER_ID -secret='SECRET' -url=https://monitor.example.com/update
```

脚本自动识别 OS/CPU、下载并校验程序，再调用原生安装器。macOS 使用普通用户，不使用 sudo；
Linux 专用 cfsm 用户的准备步骤继续由后台生成，其他系统的权限要求沿用原版。
`--install-version=v1.1.0` 指定主控已提供的版本；留空选最新稳定版。
`--download-url=https://mirror.example.com/agent` 覆盖下载源并保存到本地 `DOWNLOAD_URL`，用于后续自动更新，
不会改变指标上报目的地。直接执行二进制 `cf-probe install ...` 也受支持。

Windows 管理员 PowerShell：

```powershell
$script = "$env:TEMP\install-cf-probe.ps1"
Invoke-WebRequest -Uri 'https://monitor.example.com/agent/install.ps1' -OutFile $script -UseBasicParsing
PowerShell -ExecutionPolicy Bypass -File $script install -id=SERVER_ID -secret=SECRET -url=https://monitor.example.com/update
```

卸载继续调用 `cf-probe uninstall`，后台也提供下载临时卸载器的命令：

```sh
curl -fsSL https://monitor.example.com/agent/install.sh | sh -s -- uninstall \
  --download-url=https://monitor.example.com/agent
```

已有上游 Go Agent 时，执行后台新命令覆盖安装一次即可切换到本项目的更新来源；既有配置和流量文件继续保留。
上游旧二进制中的自动更新地址不会因主控升级而自行改变。

## 更新和历史版本

修改 Agent 时更新 `agent/release.json` 的独立版本号及日期，重新构建、部署主控。
主控启动时校验并归档随镜像提供的版本到 `data/agent-releases/<version>/`，后续镜像替换会保留旧版本。
同版本号对应不同产物时拒绝覆盖归档，必须递增版本号。主控版本更新但 Agent 版本不变时不会强制更新 Agent。

启用 `AUTO_UPDATE=1` 的 Agent 从主控目录选择较新兼容版本，下载、校验并沿用原来的平台更新/重启机制。
默认 `AUTO_UPDATE=0` 保持手动更新。自动更新不会降级；需要回退时，重新运行安装命令指定已归档版本，
并根据需要关闭自动更新。覆盖安装保留配置和月流量，只有显式传入的配置字段被覆盖；平台服务定义继续由原安装器管理。

主控可通过 `AGENT_DIST_DIR` 指定构建产物目录，通过 `AGENT_ARCHIVE_DIR` 指定历史目录。
默认分别为 `agent-dist` 和 `<DATA_DIR>/agent-releases`；`AGENT_ARCHIVE_ENABLED=false` 关闭启动时自动归档。
归档空间随保留版本增长。删除不需要的历史版本目录即可回收空间；应在主控停止时维护文件。
后台 SQLite 备份仍包含主控数据，**不包含 Agent 二进制归档**；如需保留旧版安装能力，请另行备份该目录。

分发接口公开只读，不包含服务器密钥：

| 地址 | 内容 |
| --- | --- |
| `/agent/install.sh`、`/agent/install.ps1` | 当前安装脚本 |
| `/agent/latest` | 最新稳定版版本号 |
| `/agent/releases.json` | 当前及归档版本、平台文件、SHA-256 |
| `/agent/<version>/manifest.json`、`checksums.txt` | 指定版本元数据 |
| `/agent/<version>/cf-probe-<os>-<arch>[.exe]` | 对应程序 |

不提供运行时编译、上传或任意文件下载；不存在的版本返回 404，不回退到上游仓库。
GitHub Release 可以另外托管相同产物，但不是构建、安装或更新的必需环节。

## 验证

仓库根目录执行 `npm run test:all`（主控与 Go vet/test）和 `npm run test:acceptance`。
原生验收用隔离主控及实际编译程序验证下载校验、HTTP/WS、配置下发、旧配置读取和重启数据保留。
宿主机验收仅运行前台进程，使用临时配置和锁文件目录，不注册系统服务。安装、卸载和实际自更新在隔离 Linux
部署环境中验证。平台 CI 另运行 Linux、macOS、Windows 的 Go 测试；远端 CI 未执行时不将其记为通过。
