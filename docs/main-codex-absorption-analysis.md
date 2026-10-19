# main → codex 改动吸收分析

日期：2026-10-19。状态：比较及用户确认的基础改进已完成，隔离验收通过，已推送 codex 并部署生产；备份及测试/发布产物已按要求清理。

用户最终决定：吸收 HTTP 请求超时、自定义到期提醒 1–365 天、根 LICENSE 和离线 2 分钟选项；自动续期保留提前 1 天顺延。**SMTP、GPU 增强、月流量阈值告警本次均不吸收，不新增对应支持。** 现有周期流量报告与原有采集/协议继续保留。

## 比较基准与结论

已执行 `git fetch --prune origin`。本仓库没有名为 `main` 或 `codex` 的本地短分支，本文按远端 main 与实施前的独立二开分支比较，固定快照如下：

| 标记 | 分支 / 基线 | 完整提交 |
| --- | --- | --- |
| M | origin/main | dfb9bf19c23479398c3835c5f96328364e194c85 |
| C | codex/self-hosted-native-agent，实施前的比较基准 | 30a7ba323c1c5bb8b67f1d1cb4741860da6a604e |
| B | 共同祖先 | e25e47b028c91871ebf40da2d60adfb8cc347d4a |

`git rev-list --left-right --count M...C` 得到 **18 / 26**。B→M 净改动 **51 文件、2723 行新增、1156 行删除**；M 与 C 的末端快照相差 **295 文件**，包含二开架构及同仓库 Agent，不能将这个数量解读为 main 新增了 295 个文件。

main 有值得吸收的功能，按用户确认逐项适配现有模块。本次仅落实请求超时、自定义到期提醒天数、根目录许可文件及离线表单一致性。后文保留其余候选的比较证据，但不代表支持承诺或待实施计划；不整批 merge 或 cherry-pick。

本文的 `M 路径:行号` 和 `C 路径:行号` 均指上述不可变快照，可用 `git show <完整提交>:<路径>` 复核。源码树入口：[main 固定快照](https://github.com/EnjuYeung/CF-Server-Monitor/tree/dfb9bf19c23479398c3835c5f96328364e194c85)、[codex 固定快照](https://github.com/EnjuYeung/CF-Server-Monitor/tree/30a7ba323c1c5bb8b67f1d1cb4741860da6a604e)。

## 必须保留的部署与运行边界

依据用户要求、AGENTS.md 和 architecture.md，吸收后继续满足：

- Vue 3 页面由 Node.js 24 单主控提供；使用本地 SQLite WAL 和现有持久数据目录。
- 主控运行于 Docker bridge，容器使用 HTTP/WS，外部反代终止 HTTPS/WSS；同机原生 Agent 仍可访问宿主映射端口。
- 保留最多 50 Agent、10 看板用户的目标、7 天历史、地区识别与一致性备份。
- 原生 Agent 保持 Linux amd64/arm64 两个目标，由本仓库构建、主控 `/agent` 与 `agent-releases` 归档分发；不改回上游镜像或 GitHub Release 下载。
- 保留 Agent 协议、节点实例寿命、认证接收时间、统一上报处理、通知 outbox 和前端取消/恢复机制。
- 不引回 Workers、D1、Durable Objects、Turnstile、周轮换历史表或外部数据库。

在现有 SQLite 中增量加字段、在现有 Node 进程中增加通知渠道、在现有 `gpu_info` 中使用可选字段，本身不需要改变部署拓扑。它们仍须验证旧安装、协议和备份兼容。

## 全部 18 个 main 独有提交

按 B→M 顺序列出；短 SHA 均可在本仓库唯一解析。

| 提交 | 实际改动与最终状态 | 对 codex 的建议 |
| --- | --- | --- |
| 428d2be | 报告调度槽位、250ms 看板批量推送及延迟展示调整 | 批量推送已覆盖；报告槽位后被主线删除，保留 codex 自己的调度 |
| 2951a88 | Mikus 樱花由 Canvas 改成 CSS 动画 | codex 已删除此装饰，不恢复 |
| 8e80872 | 到期提醒支持自定义 0–365 天 | 优先吸收，0 仍表示关闭；修正旧布尔配置兼容陷阱 |
| d76af45 | 流量报告基线、失败重试、错过周期处理 | 后被 e083e48 撤销；仅作历史参考，不整块移植 |
| 561b18c | Turnstile 服务端验证增加超时 | codex 没有 Turnstile，排除 |
| d6cf2ee | GitHub OAuth、流量基线按钮、持久通知任务、剪贴板函数等混合变更 | OAuth 单列可选；通知目的已有 outbox 覆盖；报告体系后被删除；剪贴板回退已覆盖 |
| 1cbc7ba | GPU 显存、SM 频率、功率图表 | 用户确认不吸收、不新增支持 |
| e083e48 | 删除流量报告、基线、通知任务体系及相关测试 | 不吸收这些删除，保留报告与 outbox |
| 0bd0378 | 新增 SMTP，依赖 cloudflare-smtp | 用户确认不吸收、不新增支持 |
| 84aefa1 | SMTP 配置校验、TLS 参数、失败原因、错误分类 | 随 SMTP 一并排除 |
| 1bc4eb2 | 通知表单布局、前端最小离线时间、主题商店同步、media-src | 布局按需取用；不修改 codex 离线范围；主题商店已删除；媒体来源扩展非必需 |
| b7cc47b | 提前 min(提醒天数,5) 天顺延日期、顺延通知、自动续期节点退出到期提醒 | 用户确认保留 codex 提前 1 天规则，不引入此行为变化 |
| f31dd18 | 月流量阈值告警、配置、存储和 HTTP/WS 接入 | 用户确认暂不吸收、不新增支持 |
| 19af7d1 | 修正阈值 null/0/正数三态，补齐列 | 随月流量阈值告警一并排除 |
| a5cff8d | 分区编码主键查询优化，删除旧索引/缺列回退 | 不移植其存储机制；codex 已有本地索引逐桶查询 |
| b63f341 | 可选 HTTP 超时、启动配置 15 秒超时、Turnstile 缓存处理 | 仅吸收超时能力，保留 codex 调用方取消信号 |
| 8b03d93 | 后台生成上游 Docker Agent 安装命令 | 不纳入默认范围；它不是主控 Docker 部署改进 |
| dfb9bf1 | 新增根 MIT LICENSE | 可独立补齐；保留原版权，考虑运行镜像中的许可文件交付 |

特别注意：`428d2be → d76af45 → d6cf2ee` 的报告与可靠投递演进被 `e083e48` 大量撤回。不能按提交标题将这些阶段累加为 main 最终功能。该删除提交说明涉及 Workers Cron/CPU 约束，codex 的本地调度没有直接跟随的理由。

## 优先考虑的小范围改动

### HTTP 请求超时

来源：b63f341。M `src/frontend/utils/http.js:120` 创建超时控制器，`:127` 将其交给 fetch；M `src/frontend/main.js:72` 为启动配置启用 15 秒。C `src/frontend/main.js:24` 的启动读取没有超时，确有改进空间。

不能直接替换 HTTP 工具：C `src/frontend/state/dashboardState.js:280` 创建快照控制器，`:314` 将 signal 传出，C `src/frontend/composables/useDashboardState.js:12` 交给 HTTP，C `src/frontend/utils/http.js:110` 传到 fetch。配置变化和停止分别在 C `dashboardState.js:263`、`:369` 取消。移植要组合调用方取消和超时，保留分来源 token、401 清理、随机后台路径及晚到响应隔离。

M 在响应头返回后就清理计时器，未覆盖后续 JSON 正文读取。若采用“完整请求超时”，正文读取也应计时。建议先为启动配置等明确的读取路径启用；历史、备份和写操作分别约定，不能一律套用 15 秒，也不能把客户端超时解释成后台操作已回滚。Turnstile 重试和缓存处理不吸收。

### 自定义到期提醒 1–365 天

来源：8e80872。M `src/utils/settings.js:17` 的上限为 365，C `src/shared/notificationConfig.js:5` 仍为 7。C `SettingsPanel.vue:707` 只提供 1–7 天。UI 可借鉴 main 的自定义输入状态，M `SettingsPanel.vue:935`、`:966` 避免输入过程中因中间值等于预设而折叠输入框。

核心陷阱是 C `notificationConfig.js:84` 将旧布尔 true 映射到“当前最大值”。只将 MAX 改成 365 会令原本的 7 天变成 365 天；M 也保留了这处问题。应将 **旧 true → 7** 与 **新输入上限 → 365** 分离，继续复用 codex 的共享读取/原始输入校验/部分更新。C `test/notification-config.test.js:18` 明确约定旧 true 为 7。

### 许可文件与离线表单一致性

M `LICENSE:1` 新增主控根 MIT 许可，C 根文件缺失；C `agent/LICENSE:1` 已有相同文本，C `Dockerfile:25` 目前只复制 Agent 许可。建议补主控根许可及其交付位置，不将其误认为 Agent 专有许可。

另发现 C `src/shared/notificationConfig.js:2` 允许最短 2 分钟离线告警，而 C `SettingsPanel.vue:695` 的选项从 3 分钟开始。可顺手补齐 2 分钟选项。此项是对照时发现的 codex 一致性问题，**不是直接移植 main 的最短 5 分钟行为**；M 后端 `src/utils/settings.js:14` 实际也仍允许 2 分钟。

## 未采纳候选：月流量阈值告警

用户已确认本次不吸收、不新增支持；以下仅保留比较结论。

来源：f31dd18 + 19af7d1。main 的最终三态约定有价值：节点阈值 **null/空 = 跟随全局，0 = 显式关闭，1–100 = 节点覆盖**。M `src/utils/traffic.js:9` 使用 1024³ 字节作界面 GB，`:34` 支持 total/dl/ul/max；M `src/database/schema.js:86` 增加阈值与告警状态。codex 已有月流量、限额及算法，但 C `schema.js:29`、`src/services/serverInput.js:55`、`src/shared/notificationConfig.js:335` 都没有阈值告警字段。

C `src/services/notifications/traffic.js:212` 是周期流量报告，不等价于阈值告警。建议两者并存，新告警默认关闭，先保持现有通知数量和行为。

建议接入边界：

1. 共用纯计算与三态规则；新输入遵守 codex 的严格校验，不能直接复制 main 的 parseInt/夹取逻辑。
2. 全局项进入共享 notificationConfig，节点项进入 serverInput，贯穿新增、编辑、批量编辑、导入导出和 SQLite 旧安装补列。
3. HTTP/WS 复用 AgentReports 的共同处理流程；使用按采样先后判定的有效最新月流量，避免延迟补报覆盖状态或误判重置。
4. 告警状态变化与 `enqueueNotification` 在同一个同步 SQLite 事务提交，由 outbox 异步投递；继续检查节点删除/重建寿命。

不能搬 M `src/services/notification.js:706` 的“先发远程通知、后 CAS 更新状态”。CAS 不能撤回已经发送的重复通知，也不能保证进程中断时事件和状态一致。C `src/services/outbox.js:4` 已有入队接口，`:23` 区分未配置/失败/送达，应该沿用。

还需决定账期重置语义。M `notification.js:690` 以“当前用量低于上次告警用量的 50%”推断重置，`:700` 用阈值和限额签名抑制重复，签名不包含流量算法。若上次 80 GB 告警，主控重启后新周期首次已是 45 GB，未低于 40 GB，之后可能继续被旧状态抑制。它不能直接被描述为严格的“每账期一次”。是否继续这种近似规则，或按明确账期标识/重置日实现，应在决定纳入该功能后继续讨论。

## 其他未采纳候选

### SMTP 邮件通知

用户已确认本次不吸收、不新增支持。

来源：0bd0378 + 84aefa1。可吸收 `smtp://` 目标约定、地址/凭据/TLS 校验、多收件人、测试错误提示；M `src/services/notification.js:633`、`:734`、`:785` 分别是识别、解析和错误分类。codex 的 C `src/services/notifications/delivery.js:198` 尚无 SMTP 分支。

**功能可在现有 Node 主控中完成，无需增加容器；main 的实现不能直接使用。** M `notification.js:817` 明确说明 cloudflare-smtp 依赖 cloudflare:sockets，M `package.json:39` 新增该依赖。应改用兼容 Node 的 SMTP TLS 传输，保留 465 隐式 TLS、587 STARTTLS 等约定，不沿用仅因 Workers 而禁止 25 端口的理由。

接口继续返回 C `delivery.js:388` 的 delivered/failed/unconfigured，由现有 outbox 决定投递状态。测试通知继续使用 C `src/handlers/admin.js:333` 的未保存草稿和共享校验，错误原因应脱敏。永久错误是否停止队列重试是另一项策略，不能随 SMTP 移植悄悄改变现有持续退避行为。

### GPU 图表与原生 Agent 采集

用户已确认本次不吸收、不新增上述增强支持。

来源：1cbc7ba。M `src/frontend/views/ServerDetail.vue:246`、`:262`、`:278` 新增显存、SM 频率和功率图表，依赖 `gpu_info` 的 mem_used/mem_total（MiB）、sm_clock（MHz）、power（W）等可选键。

codex 的主控已能保留这些扩展键：C `src/database/schema.js:299` 序列化整个 gpu_info，C `src/utils/metrics.js:208` 传出；不必为它更换数据库或增加服务。但 C `agent/internal/cfprobe/metrics_common.go:152` 仅查询 index/name/utilization.gpu，`:185` 仅上报 id/name/info。**只移植页面，当前自带 Linux Agent 用户不会因此获得新指标。**

完整吸收需补 Agent 可选采集，兼容不支持某项查询的驱动；并处理 C `ServerDetail.vue:1420` 将 gpu_info 列为静态字段、`:1622` 忽略实时合并的问题。新字段晚出现、多 GPU、GPU 移除、真实零值与缺失值必须正确区分。沿用可选字段和现有自托管版本链，保持旧 Agent 兼容；新增二进制发布还需对应的构建与隔离分发验收。

### 自动续期规则和通知

用户已确认继续保留 codex 当前提前 1 天规则，不引入主线的续期时机、通知及提醒范围变化。

来源：b7cc47b。M `src/services/notification.js:1317` 提前 min(提醒天数,5) 天推进日期，`:1329` 将所有自动续期节点排除到期提醒，`:1346` 有渠道时发送“自动续费成功”。C `src/services/notifications/expiry.js:30` 仍固定提前 1 天，且没有日期顺延通知。

这是业务行为变化：提醒设为 7/30 天会从提前 1 天变为 5 天；提醒关闭时会从提前 1 天变为到期当天，但仍可能收到顺延通知。建议第一批保持 codex 现有规则，单独讨论是否需要改变时间、排除提醒和新增通知。

两分支的续期辅助函数都只推进记录日期，C `src/shared/billing.js:226` 和 M `src/utils/serverBilling.js:227` 没有支付或服务商 API。若新增事件，建议称“到期日期已自动顺延”，把日期修改与事件入队放在同一事务，避免日期已推进却丢失通知。保留现有辅助函数的 UTC 日期约定和按配置时区发提醒的区别。

## 已覆盖或默认不吸收的部分

| 内容 | 核查证据与理由 |
| --- | --- |
| 250ms 看板批量推送 | C `src/realtime/RealtimeHub.js:35`、`:653`、`:663` 已有全列表合并和详情即时推送，不覆盖节点寿命与样本上限保护 |
| 长历史查询优化 | M `src/database/schema.js:198` 依赖双周表与 partitionId，`:247` 使用编码主键；C `schema.js:87` 的 (server_id,timestamp) 索引与 `:119` 的逐桶 seek 已实现同类目的。不能删除必要索引或恢复周分区 |
| 持久通知与重试 | C `src/services/outbox.js:9` 已实现，周期报告的 claim、基线与入队在 C `notifications/traffic.js:222` 原子提交；保留现有报告，不取 main 后续删除 |
| 离线与时间处理 | C `notifications/offline.js:45` 使用接收时间，serverPresence 保护上报周期；C `notifications/time.js:49` 支持错过整点后的检查，继续配合日期去重。不倒退成 main 的持久样本时间和严格整点匹配 |
| 剪贴板回退 | C `src/frontend/views/admin/index.vue:695` 已有 API/textarea 回退、执行结果判断和清理，模块提取不是新增用户能力 |
| Docker Agent 安装 | M `src/frontend/views/admin/index.vue:1999` 使用上游 GHCR 镜像，`:2001` 使用 host 网络；提交没有主控 Dockerfile。会绕开当前原生 Agent 构建与版本链，默认排除 |
| GitHub OAuth | 可在 Node 重实现，部署拓扑不必变；但 M `src/handlers/githubAuth.js:82` 固定回 /admin、`:217` 仅设置 cookie，与 C `src/middleware/auth.js:104` 的随机入口/会话版本和 `:127` 的 Bearer 认证不同，还需接 TOTP。默认本轮不纳入，不能直接抄回调 |
| Turnstile、Mikus、主题商店 | codex 已删除对应能力；相关优化不构成当前缺陷，不恢复这些组件 |
| CSP media-src | M `src/utils/csp.js:69` 允许媒体复用图片来源，是新增跨域媒体能力；C 已有 default-src self 回退。无对应需求时不作为必要修复 |

## 已确认的实施范围

用户已确认下表，无待决的功能范围问题；本次不产生新的架构 ADR：

| 范围 | 内容 | 用户决定 |
| --- | --- | --- |
| 本次实施 | HTTP 可选超时、自定义提醒天数、根许可文件；补齐离线 2 分钟 UI | 按推荐落实 |
| 不吸收 | 月流量阈值告警 | 暂不新增支持，现有流量报告保留 |
| 不吸收 | SMTP 邮件渠道 | 暂不新增支持 |
| 不吸收 | GPU 展示 + 原生 Agent 采集 + 实时更新 | 暂不新增上述增强支持 |
| 保持现状 | 自动顺延日期的时机及通知 | 继续提前 1 天，不增加主线通知/排除规则 |

实现细节按上述范围及现有模块职责处理。没有创建 ADR，因为没有新的架构取舍。GitHub Issues 仍为问题与规格入口，本轮未创建或修改远端事项。

## 实施与验收结果

本次按已确认范围实施；下表区分实际验证、保持原规则及用户排除项。完整证据、命令、环境和一次容器检查脚本修正见 TEST_REPORT.md。

| 编号 | 用户行为 / 操作 | 预期与验证方式 | 当前状态 |
| --- | --- | --- | --- |
| ABS01 | 配置请求无响应、只有响应头、慢正文；调用方取消与 401 | HT01–HT06 真实 HTTP；AS05/AS06 浏览器分别在 15692/15398ms 显示重试提示并保留认证；既有认证/实例浏览器回归 4/4 | 通过 |
| ABS02 | 保存 0/1/7/8/365，拒绝 366/小数/负数；读取旧 true；输入自定义 12 | NC13/NC14、AS01–AS03 真实表单、REST、SQLite 重启及本地投递；true 仍为 7，输入焦点保持，三语言回读 | 通过 |
| ABS03 | 月流量阈值告警候选 | 用户确认本次不吸收、不新增支持；现有周期报告仍参加完整回归 | 跳过（范围排除） |
| ABS04 | SMTP 候选 | 用户确认本次不吸收、不新增支持 | 跳过（范围排除） |
| ABS05 | GPU 新图表及采集候选 | 用户确认本次不吸收、不新增这些增强支持 | 跳过（范围排除） |
| ABS06 | 自动续期 | 不改主线新行为；NC14 实测提前 5 天不顺延、提前 1 天才顺延，仍只有原到期提醒事件 | 原规则回归通过 |
| ABS07 | 安装、核心流程、异常/边界、持久化、回归与构建 | npm ci、geoip:download、build、test:all、test:acceptance 均退出 0；191 项 Node、19 项主控、7 项原生 Agent；实际 Docker bridge 检查 AD01–AD05 | 通过 |
| ABS08 | Agent 安装、更新或分发专项 | 本次未修改原生 Agent、安装/更新/分发实现或版本；未运行 test:agent-deployment，保留 Linux 双目标并在 AD02 校验实际目录 | 不适用 |
| ABS09 | 离线 2 分钟、手机/明暗/键盘 | AS01/AS02 保存及刷新为 2，AS04 的 1440/375px 四组截图已查看，横屏无溢出，控件至少 44px | 通过 |
| ABS10 | 根 MIT 许可与运行镜像交付 | LICENSE 与原 Agent 许可完全一致；AD02 校验 /app/LICENSE SHA-256=89b8f89a15bf1eeea3292b91b832fc87afea696d4fba37b291cdff52dde7a572 | 通过 |

初轮仅作 Git/源码分析；用户确认后完成上述实现和隔离验证，随后按新授权将功能提交 b046f9f 推送 codex 并部署 https://jm.zedy.cc，生产镜像为 58c76d62665d。生产 .env 和业务数据保留，原始测试证据、生产副本及发布脚本/日志/截图均已按要求删除；实测结果及清理记录见 TEST_REPORT.md，可重跑的测试源码保留。
