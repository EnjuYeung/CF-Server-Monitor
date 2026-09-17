# Native Agent

本目录直接纳入上游 **cfsm-agent v1.0.16** 的 Go 源码和测试，原始提交与许可见
[UPSTREAM.md](UPSTREAM.md)、[LICENSE](LICENSE)。本项目 Agent 从 **v1.1.0** 开始独立版本管理，当前为 **v1.2.0**。
`UPSTREAM_README.md` 只保留上游功能说明和来源，安装与更新请使用本文。

## 运行结构与功能

Agent 以 `jan-probe` 原生进程和服务运行在被监控机器上；主控在 Docker 内运行 Node.js、Vue 和 SQLite。
二者通过主控的 `/update` HTTP/WebSocket 接口通信，同机时可使用 `http://127.0.0.1:8080/update`。
Agent 不需要 Go、Node.js、Docker、Workers 账号或 GitHub 访问权限；编译工具只用于构建阶段。

保留 v1.0.16 的 CPU、内存、Swap、磁盘容量/IO、GPU、负载、进程、连接数、网卡/网速、月流量、
公网 IP、TCP/ICMP 探测、丢包、四个运营商节点和四个自定义节点。采样、WS 实时上报、HTTP 回退、
时段协商、配置 schema 7/MD5、时间校准、流量校正与重置、服务安装/卸载及更新后的重启继续使用上游逻辑。
当前仅发布 Linux 和 FreeBSD 的 amd64/arm64 程序；Linux user service、systemd、OpenRC、procd、
Synology、FreeBSD 的安装方式和路径保持兼容。上游其他平台源码保留用于来源追踪和兼容性测试，不作为发布目标。

独立版本的主要调整：

- `CONTROLLER_URL` 为新的配置名称，仍接受旧 `WORKER_URL`，写配置时同时保留两个名称。
- 主控在 WebSocket 握手中补充标准 `Date` 响应头，保留仅使用 WS 时的 Agent 时间校准能力。
- 自动更新默认关闭；安装时启用 `AUTO_UPDATE=1` 后，在启动时和每 24 小时检查并安装较新版本，版本选择保留稳定版与 Snapshot 通道规则。未启用时不启动更新任务，仍使用手动安装/更新；后台勾选不会远程改变本地开关。
- 安装、版本检查、更新下载都访问主控 `/agent`，可配置具有相同目录/API 的下载镜像。
- 安装与自动更新均要求 SHA-256 校验通过；缺失或不匹配时不执行下载文件。
- 旧 `UPDATE_PROXY` / `--install-ghproxy` 仍可读取，但不再构造 GitHub 下载地址；下载镜像请使用 `--download-url`。

## 构建

使用 `go.mod` 要求的 Go 工具链（当前 1.26.8）。仓库根目录执行：

```sh
npm run build                  # 前端 + 全部 4 种 Agent 程序
npm run build:frontend         # 仅构建前端
npm run build:agent            # 仅构建 Agent
npm run build:agent -- -targets linux/amd64,linux/arm64
```

也可以在本目录执行 `go run ./tools/build -out=../agent-dist`。Go 模块及 checksum 按 `go.sum` 锁定，
使用 CGO_ENABLED=0、trimpath、固定版本信息构建。Docker 的独立 Go 阶段完成全部交叉编译，最终镜像仅携带
主控运行时、安装脚本和编译产物，不包含 Go 编译器。

| 系统 | 发布目标 |
| --- | --- |
| Linux | amd64、arm64 |
| FreeBSD | amd64、arm64 |

不构建或分发 macOS、Windows、32 位 x86/ARM、LoongArch 程序；通过 `-targets` 显式指定这些目标也会报错。

输出为 `agent-dist/<version>/`，含二进制、`manifest.json` 和 `checksums.txt`；安装脚本在
`agent-dist/` 根目录。产物被 Git 忽略，不提交二进制、配置或测试结果。

## 安装、指定版本与卸载

优先在后台添加服务器并复制命令，命令已经包含服务器 UUID、主控地址和认证密钥。
POSIX 系统的通用形式如下；示例中的值必须替换成后台实际参数：

```sh
curl -fsSL https://monitor.example.com/agent/install.sh | sh -s -- install \
  -id=SERVER_ID -secret='SECRET' -url=https://monitor.example.com/update
```

脚本自动识别 OS/CPU，确认属于上述四个目标后才下载并校验程序，再调用原生安装器。
Linux 专用 cfsm 用户的准备步骤继续由后台生成，其他受支持系统的权限要求沿用原版。
`--install-version=v1.2.0` 指定主控已提供的版本；留空选最新稳定版。
`--download-url=https://mirror.example.com/agent` 覆盖下载源并保存到本地 `DOWNLOAD_URL`，用于后续自动更新，
不会改变指标上报目的地。直接执行二进制 `jan-probe install ...` 也受支持。

卸载调用 `jan-probe uninstall`，同时清理当前账户的新旧服务；后台也提供下载临时卸载器的命令：

```sh
curl -fsSL https://monitor.example.com/agent/install.sh | sh -s -- uninstall \
  --download-url=https://monitor.example.com/agent
```

已有上游 Go Agent 时，执行后台新命令覆盖安装一次即可切换到本项目的更新来源；既有配置和流量文件继续保留。
上游旧二进制中的自动更新地址不会因主控升级而自行改变。

## 更新和历史版本

v1.2.0 将服务名、安装后的程序名、PID 和日志名改为 `jan-probe`。系统安装可用 `systemctl restart jan-probe`，用户安装由安装用户执行 `systemctl --user restart jan-probe`；其他服务管理器沿用安装输出中的命令。
升级安装会停止旧 `cf-probe` 服务，使用原配置及月流量启动新服务，再删除旧程序和旧服务定义。旧版用户服务自替换程序后，由新版通过独立的 systemd 用户单次任务完成改名，避免迁移进程被旧服务停止操作终止。
为保留兼容，配置/流量目录继续使用 `/etc/config/cf-probe`（系统安装）或 `~/.cf-probe`（用户安装），下载文件名仍为 `cf-probe-<os>-<arch>`，旧 Agent 可继续发现并校验新版；不需要重新添加节点。

修改 Agent 时更新 `agent/release.json` 的独立版本号及日期，重新构建、部署主控。
主控启动时校验并归档随镜像提供的版本到 `data/agent-releases/<version>/`，后续镜像替换会保留旧版本。
同版本号对应不同产物时拒绝覆盖归档，必须递增版本号。主控版本更新但 Agent 版本不变时不会强制更新 Agent。

v1.1.1 缩减构建平台，使用新版本号避免与已有的 v1.1.0 十六目标归档冲突。已有归档的 manifest 和文件保持原样，
公开版本目录与下载接口仅提供 Linux/FreeBSD 的 amd64/arm64；不支持的平台即使存在旧归档也返回 404。

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
| `/agent/install.sh` | 当前 POSIX 安装脚本 |
| `/agent/latest` | 最新稳定版版本号 |
| `/agent/releases.json` | 当前及归档版本、平台文件、SHA-256 |
| `/agent/<version>/manifest.json`、`checksums.txt` | 指定版本元数据 |
| `/agent/<version>/cf-probe-<os>-<arch>` | 支持的 Linux/FreeBSD amd64/arm64 程序 |

不提供运行时编译、上传或任意文件下载；不存在的版本返回 404，不回退到上游仓库。
GitHub Release 可以另外托管相同产物，但不是构建、安装或更新的必需环节。

## 验证

仓库根目录执行 `npm run test:all`（主控与 Go vet/test）和 `npm run test:acceptance`。
原生验收需在 Linux/FreeBSD amd64/arm64 上运行，用隔离主控及实际编译程序验证下载校验、HTTP/WS、配置下发、旧配置读取和重启数据保留。
宿主机验收仅运行前台进程，使用临时配置和锁文件目录，不注册系统服务。安装、卸载和实际自更新在隔离 Linux
部署环境中验证。macOS/Windows 开发机可执行 Go 单元测试和四目标交叉编译、文件/下载验证，但不能执行这些 ELF 程序；原生验收会明确报错，不作为通过处理。平台 CI 的兼容性单元测试不生成额外发布产物；远端 CI 未执行时不将其记为通过。
