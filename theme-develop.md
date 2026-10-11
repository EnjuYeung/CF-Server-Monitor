# 主题开发规范

这是内置界面修改与第三方主题开发的统一入口，按当前 Node.js 24 / Vue 3 / SQLite 实现编写，主题契约核对日期为 2026-10-11。术语见 [GLOSSARY.md](GLOSSARY.md)，接口见 [API.md](API.md)，执行标准见 [testing.md](testing.md)。

“必须”表示兼容、权限或交付要求；“建议”是主题作者约定，不代表服务端已实现校验。文档和示例不能代替实际验收。

| 对象 | 范围 | 起点 |
| --- | --- | --- |
| 内置前端 | 看板、详情与管理页面，沿用当前终端视觉基线 | `src/frontend/`，第 1 节 |
| 第三方主题 | 自定义看板布局、字体、配色与交互，管理页面仍使用内置前端 | `index.html` 与 `assets/`，第 2 节 |

第三方主题可选择自己的框架与视觉体系，不要求复用内置 CSS。共同约束是数据语义与权限。当前没有主题商店、后台主题操作面板、本地文件主题 URL 或服务端字段 schema。

## 1. 修改内置界面

### 样式、组件与视觉基线

- `main.js` 先导入 `styles/main.css`，后导入 `styles/light.css`。深色变量在 `:root`；浅色由 `body.light` 覆盖，深色不依赖 `body.dark`。
- 共用布局、按钮、表单和弹窗规则放在现有全局样式中；组件独有样式可以 `scoped`，例如 `TwoFactorPanel.vue`。不要为单组件无意修改所有页面。
- 复用 `TerminalHeader`、`ServerBarCard`、`ServerRingCard`、`ServerTags`、`ServerLatencyPanel`、`HelpTooltip`；卡片计算用 `useServerCardData`，首页实时状态用 `useDashboardState`。
- 保持原版终端风格、原有弹窗和三种看板视图。内置前端不加载 Hallmark 变量、Tailwind、shadcn-vue、Mikus 或樱花/星空装饰；旧 `theme_options.mikus` 不再激活这些功能。

| 类别 | 变量 / 当前基础值 | 使用约定 |
| --- | --- | --- |
| 背景 | `--bg-primary/secondary/card/hover` | 页面、容器、卡片、悬停分别复用对应变量 |
| 边框 | `--border-color/active` | 同时检查明暗与激活状态 |
| 文字 | `--text-primary/secondary/muted` | 区分主次；状态不能只靠颜色 |
| 强调色 | `--accent-green/blue/purple/pink/yellow/red/cyan` | 服务器标签有独立色表，不随主题变量改写 |
| 表单 | `--input-bg/border` | 检查输入、禁用、错误和焦点 |
| 字体 | `--terminal-font`，本地 JetBrains Mono，400–700 | WOFF2 随构建发布，不内联成 CSP 拒绝的 `data:` |
| 排版 | 正文 13px、行高 1.5；容器最大 1600px、内边距 16px | 是当前基线，不要求所有文字同尺寸 |
| 响应式 | 全局 1200px、768px；手机容器内边距 8px | 检查单列卡片、长名称、表单、弹窗，不能只验桌面 |

共用颜色引用 CSS 变量。局部图形、渐变、固定数据集色可按用途定义，但要同时检查两种模式。详细职责见 [code_map.md](code_map.md) 与 [architecture.md](architecture.md)。

### 明暗偏好与图表

有效本地 `theme_preference` 优先于 `/api/config.preferred_theme`，均缺失/无效时回退 `auto`。auto 跟随系统，按钮循环 `dark → light → auto`。复用 `composables/useTheme.js`，不要在各组件重复系统监听和偏好存储。

详情 Chart.js 从 body 读取主题变量，切换后更新坐标、网格、图例与 Tooltip；部分曲线色仍由数据集固定定义。改 CSS 不能自动替换所有曲线，必须实际检查画布。`onThemeChange` 当前没有注销接口，不是完整插件生命周期 API。

### 开发与交付

首次开发先运行：

```bash
npm ci
npm run geoip:download
npm run build
```

要求 Node.js 24.x（至少 24.11）、Go 1.26.8；Docker 自带构建工具链。启动隔离主控，再另开终端运行 `npm run dev:frontend`。Vite 默认 5173，代理后端 `http://localhost:8080`；其他测试端口用进程环境 `VITE_DEV_PROXY_TARGET`。

只重建前端可用 `npm run build:frontend`；完整交付仍用 `npm run build`。两者重建 dist，内置入口最终为 `dashboard.html`，资源为 `/static/`。Vite 预览不能代替主控注入配置和 CSP 后的验收。

## 2. 第三方主题产物与加载

### 运行方式

| 方式 | 页面由谁提供 | 运行时要求 |
| --- | --- | --- |
| 主控加载主题 | 从公开 GitHub 目录取主题，再由主控 origin 响应 | 默认同源；主控处理标题、图标、背景、自定义 head/script、CSP |
| 独立部署 | 主题自己的静态宿主 | 自己设置 apiBase、页面 CSP；主控允许主题 origin 的 CORS；不共享内置前端 localStorage |

不依赖 Workers、Pages 或 Turnstile。管理页面始终使用 `.env` 的安全 `ADMIN_PATH` 和内置前端。匿名主题不得生成后台地址链接；只有已鉴权 `/api/config` 返回 `admin_path` 后才可生成入口。

### 地址与目录

`theme_url` 必须为：

```text
https://github.com/<owner>/<repo>/tree/<ref>[/<产物目录>]
```

不支持 Pages、Release、raw URL、私有仓库认证、其他域名、query、hash 或 URL 用户信息。owner/repo/ref 只接受字母、数字、点、下划线、连字符；含 `/` 的分支名不适用，可改用提交 SHA。路径不能有百分号编码、反斜杠、`.` 或 `..` 段。

该目录必须能匿名读取，至少包含：

```text
index.html
assets/
  app-<内容hash>.js
  style-<内容hash>.css
  fonts/、images/ 或其他被引用资源
```

`/assets/` 是第三方资源代理入口，不是“通常使用”。HTML 的 `assets/`、`./assets/`、`/assets/` 引用会转为 `/assets/`；CSS/JS 内部路径不重写，字体、动态 chunk、图片也须放入 assets，并使用正确相对路径。不要套用内置 Vite 的 `/static/` 产物。

主控只提供 `/` 和安全管理入口的 HTML。详情应使用 hash 路由，后台节点链接形如 `/#/server/<UUID>`，可能带 apiIndex。最小示例用历史节点选择器，完整主题自行实现详情路由。

### 缓存与更新

| ref | 主控入口/资源内存缓存 | 浏览器资源缓存 |
| --- | --- | --- |
| 分支或 tag | 3600 秒 | 3600 秒 |
| 40 位十六进制 commit SHA | 86400 秒 | 一年，immutable |

页面响应 no-store，但主控取入口仍可能命中内存缓存。重启清缓存，没有专用清理 API。资源 query 不进入 raw 地址或主控缓存键，`?v=2` 不能保证刷新。

建议固定提交 SHA，资源文件名带内容 hash；只换 SHA 而复用 `/assets/app.js` 仍可能命中浏览器旧缓存。入口读取失败返回 502，不自动回退内置看板；安全后台仍可恢复默认。

## 3. 可运行最小示例

源码见 [examples/theme-minimal/](examples/theme-minimal/)，使用 HTML、原生 JS 和 CSS，演示公开/私人、密码与双重验证、实时列表、重连补取、24 小时/7 天历史表、明暗切换和选项读取。连接一个 API origin；多个 apiBase 时采用第一个。不是多主控聚合或完整图表实现。

按 [README.md](README.md) 准备并启动隔离主控后，在项目根目录运行：

```bash
node examples/theme-minimal/serve.mjs http://127.0.0.1:18080
```

打开程序显示的本地地址。开发服务只监听 127.0.0.1，代理 REST/WS；它不是生产加载方式，也不证明 GitHub 拉取或生产跨域通过。

```bash
node examples/theme-minimal/build.mjs
```

生成 `output/theme-minimal/`，引用内容 hash 资源。将产物目录内容发布到自己的公开 GitHub 目录，再按第 6 节启用。不要上传凭据、.env、日志、数据库或测试工具链。

## 4. 运行时与配置契约

### API 地址、CSP、CORS

默认当前 origin；HTTP 配 WS，HTTPS 配 WSS。独立主题可以设置：

```html
<meta name="apiBase" content="https://monitor.example.com">
```

主题 JS 必须自行读取 meta。接口位于根路径，使用 origin；内置客户端支持逗号分隔多个 origin，多来源按「API origin + UUID」隔离节点与凭据。

| 配置 | 位置 | 意义 |
| --- | --- | --- |
| apiBase / API_BASE | 主题 HTML / 主控环境 | 客户端主控地址；环境值覆盖或插入 meta |
| csp_api / csp_static | 后台外观管理 API | 分别允许 fetch/WS，或脚本/样式/图片/字体来源；逗号分隔 HTTPS origin |
| CORS_ALLOWED_ORIGINS | 主控环境 | 允许的主题页面 origin，精确匹配；REST 添加允许读取的 CORS 头，WS 对未允许跨源握手返回 403 |

主控移除主题 CSP meta，以响应头为准。环境 API_BASE 同时进入 connect-src 并补 WSS；HTML 原有 meta 不会自动进入 CSP，须另设 csp_api。csp_static 不扩展 fetch/WS；当前策略不允许字体 data:、脚本 eval 或 iframe。

Compose 当前未映射 API_BASE，仅写 .env 不会自动传给容器，须显式加 environment。独立宿主配置自己的 CSP。CORS 不共享 localStorage，也不保证跨站 Cookie。公网使用实际 HTTPS/WSS，本地 HTTP 同源与生产 CSP 跨域分别验收。

### 外观与主题选项

标题、图标、背景、自定义 head/script、CSP 是主控外观设置。display_mode、preferred_theme、default_language、theme_options 从 `/api/config` 读取；**theme_options 不直接注入 HTML**。私人站点也公开返回配置与选项，不可存密码、JWT、API_SECRET 或其他秘密。

```js
const config = await (await fetch(`${apiOrigin}/api/config`, {
  headers: token ? { Authorization: `Bearer ${token}` } : {}
})).json();
const allOptions = config.theme_options || {};
```

服务端只要求顶层非 null 对象且非数组，默认 `{}`；没有字段 schema、命名空间、版本迁移或默认值补齐。新主题建议按稳定 ID 分组、组内声明版本，例如：

```json
{"minimal":{"schemaVersion":1,"accent":"green","density":"comfortable"}}
```

这是客户端推荐格式，旧主题不必迁移。示例只读 minimal：schemaVersion=1，accent 接受 green/blue，density 接受 comfortable/compact。缺失、错误类型/枚举按项回退默认，未知版本整组回退；不保存回退结果。主题须说明自己的字段、默认值和升级方式。

管理员用专用端点保存，先保留其他主题的选项：

```js
const nextOptions = {
  ...allOptions,
  minimal: { schemaVersion: 1, accent: 'blue', density: 'compact' }
};
const response = await fetch(`${apiOrigin}/api/theme_options`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ theme_options: nextOptions })
});
if (!response.ok) throw new Error(`保存失败：${response.status}`);
```

保存**整体替换**对象，不是 deep merge，其他外观保留。读后合并不是并发事务，没有版本锁。管理动作 save_theme_options 也可用；save_settings 的顶层 settings.theme_options 不写入它。示例只读选项，不提供保存面板。

## 5. 数据、权限与实时生命周期

### 接口与数据语义

| 接口 | 使用方式 |
| --- | --- |
| GET /api/config | 始终公开；authorization/admin_path 按 Bearer 鉴权变化 |
| GET /api/servers | 节点集合、顺序、资料、持久状态与 latestReportUpdates；私人需管理员 |
| GET /api/server?id=UUID | 公开站点匿名查隐藏/不存在节点返回 404；私人站点匿名先返回 401 |
| GET /api/history/all?id=UUID&hours=24 | 直接数组；匿名最多 24 小时、管理员最多 168 小时 |
| WS /api/ws | 可见节点订阅，列表与订阅 ID 同步 |

无 `{data:...}` 包装，字段摘录见 [API.md](API.md#主题数据契约)。CPU/丢包是 0–100 百分数；内存/swap/磁盘容量为 **MiB**，网络速率 **B/s**，累计/月流量 **B**，延迟 ms。

采样时间决定先后，接收时间决定在线，节点创建时间不能当样本时间。WS payload.last_updated 是采样时间，接收取 update.reportTs 或消息 ts。内置看板在线显示为有效接收距当前小于 300000ms，不等同于告警阈值。

历史 null/缺失与探测禁用 false、有效零值分别展示，不能全转零。hours 仅接受 `0.167,0.5,1,6,12,24,48,96,168`；数组升序，每桶最后记录，不保证所有桶有值。

### 认证、双重验证与退出

管理与受限 REST 使用 Bearer JWT，公开 REST 无需认证；登录 Cookie 不能替代 Bearer。WS 支持 Cookie 或临时 JWT 参数，本地 JWT 按 API origin 隔离，内置约定为 `jwt_token:<API origin>`。不将 token 编入源码/固定 HTML，不记录 token query。

匿名配置无 admin_path，不能发现/自动跳转到安全后台。私人页面显示未公开/需要登录；示例由管理员显式输入已知安全路径，再提交用户名/密码。2FA 的 HTTP 200 requiresTwoFactor=true 仅是挑战，不是登录成功；下一次带原凭据及六位字符串 otp（保留前导零）或 recoveryCode，仅收到 token 后授予管理员状态。

同源可复用内置 token 存储；独立 origin 自行实现与验收登录。已认证后才用返回路径生成后台链接。失效时清 JWT、私有列表/历史、旧连接与待执行任务；公开站点可重取匿名快照。

退出发送 logout 管理动作清登录与预览认证 Cookie，并清当前 API origin 本地 JWT、私有数据与连接。该动作不吊销已复制 JWT，不称作服务端撤销令牌。

### 快照与订阅

先取列表，再发送全部可见 ID：

```js
socket.send(JSON.stringify({
  type: 'subscribe', scope: 'all', ids: snapshot.servers.map(server => server.id)
}));
```

仅 `/api/ws?subscribe=all` 的 hello 不保证已订阅节点，空 ids 不推送。REST 最近上报 sample 使用 data，WS 使用 payload；可兼容 `sample.data || sample.payload || sample.metrics`。

1. 快照决定成员、顺序、资料，WS 只更新已知节点；多源按来源 + UUID 隔离。
2. 合并 REST 最近上报，按采样时间处理重复/乱序；旧样本不倒退指标，有效接收仍可推进。
3. 首次、每分钟、WS 重连及页面/网络恢复补取；没有单独的节点增删事件。成员变化后更新订阅。
4. 删除清旧数据；按 instance_id 区分节点实例，同 UUID 重建也清旧指标、时间、回放、历史和订阅寿命，拒绝实例不符的 WS/replay。旧连接/请求不复活节点，晚到快照不覆盖更近 WS 指标。创建时间不是采样时间。
5. 单一可取消重连计时器，间隔有上限；失败保留有效展示并提示；补取共用一个进行中的请求。
6. 页面退出关闭 WS、清计时器/监听器、中止请求；bfcache 恢复重启。首页隐藏继续连接，恢复补取；详情可有独立策略。

## 6. 预览、启用、更新与恢复

当前后台没有主题操作面板，使用管理 API。adminEndpoint 是已知安全路径的 /api，token 来自运行时登录。示例可在自己的受控管理工具执行，不放入分发主题。

```js
async function manage(body) {
  const response = await fetch(adminEndpoint, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`管理失败：${response.status}`);
  return response.json();
}
const themeUrl = 'https://github.com/example/my-theme/tree/<提交SHA>/dist';
const preview = await manage({ action: 'start_theme_preview', theme_url: themeUrl });
// 同一浏览器、主控 origin 打开 preview.preview_url。
await manage({ action: 'save_settings', settings: { theme_url: themeUrl } });
// 更新：换新 SHA 和内容 hash 资源，重新 save_settings。
// 恢复内置看板并退出预览：
await manage({ action: 'save_settings', settings: { theme_url: '' } });
await manage({ action: 'clear_theme_preview_auth' });
```

预览不改保存主题；认证 Cookie 10 分钟，资源选择 Cookie 1 小时。无认证直接拼 `/?theme_url=...` 返回 401。访问无预览 query 的主控 / 使用保存主题或内置看板，并清选择 Cookie。独立宿主的跨站 Cookie 不保证这一预览流程。

保存/预览仅检查入口可读取，不证明资源、数据、登录或功能可用。操作时地址非法或入口不可读取返回 400 invalidThemeUrl；已配置/预览的主题在页面加载时入口不可用返回 502。使用已知安全后台恢复，不能依赖自动回退。

## 7. 验收清单与证据

先准备隔离主控、数据目录、主题产物与浏览器，再按 testing.md 顺序执行。每项记录编号、操作、预期、方式、状态、证据；结果写 TEST_REPORT.md，改动写 changelog.md。

| 编号 | 实际操作 | 预期/方式 |
| --- | --- | --- |
| TH01 | 全新目录启动、构建主题、请求入口/所有资源 | HTTP 200、MIME/hash 正确、浏览器无加载错误 |
| TH02 | 匿名读取公开/私人配置与节点 | 配置公开无后台路径；私人节点拒绝，页面提示准确 |
| TH03 | 正确/错误/过期认证、2FA/恢复码、退出 | origin 隔离；挑战无权限；退出清 Cookie、JWT 和私有数据 |
| TH04 | 匿名/管理员查询与订阅隐藏节点 | 匿名 REST 404、WS 不推送，管理员可见 |
| TH05 | 真实上报后观察列表、WS、最近上报 | 单位正确，采样/接收分离，旧样本不倒退 |
| TH06 | 新增、改名、排序、删除、同 UUID 重建后补取 | 集合/资料/订阅更新，旧任务不复活节点 |
| TH07 | 断网/恢复、隐藏/切回、刷新与退出 | 实际重连/补取，单一重试；退出无连接/请求残留 |
| TH08 | 24/168 小时、非法小时、空历史、null/false/0 | 权限/允许值正确，缺失与禁用不变零 |
| TH09 | 缺失/合法/错误版本选项、保存、查 SQLite/重启 | 客户端正确回退，整体替换与其他外观保留，无秘密 |
| TH10 | 预览/启用/更新/坏入口/恢复及缓存 | 操作时坏地址/入口 400；已配置入口加载失败 502，后台可恢复；预览不改配置，缓存正确 |
| TH11 | 主控 CSP、独立 origin 经 HTTPS/WSS 访问 | 实际允许/拒绝 CORS、Bearer/Cookie、Upgrade，无 CSP 错误 |
| TH12 | 桌面/手机、明暗/系统、长名、键盘与历史表 | 无页面横向溢出、文字可读、控件有名称/焦点，状态不只靠颜色 |

```bash
npm run build
npm run test:all
npm run test:acceptance
npm run test:theme
```

浏览器验收需要 Playwright/Chromium，可用 THEME_PLAYWRIGHT_MODULE（模块名或绝对路径）与 THEME_CHROMIUM_EXECUTABLE 指定现成工具，不随主题分发。方式见 [test/README.md](test/README.md)。

区分真实 REST/WS/SQLite、浏览器、主题代理夹具、真实 GitHub 拉取、公网部署。夹具替代上游文件，不等于发布后的远端验收；自签 TLS 不等于公网证书/生产部署。未执行明确记为未测试/平台限制，不继承默认主题结果。Agent 安装、更新、分发或部署有改动时，另遵守项目的 Agent 部署验收要求。
