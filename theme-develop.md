# 第三方主题开发约定

主控已改为 Docker / Node.js / SQLite，公开看板数据与 WS 的主要格式继续保留；当前接口以 API.md 和 src/index.js 为准。

## 页面与运行时配置

默认使用同源主控地址，HTTP 页面连 WS，HTTPS 页面连 WSS。独立主题可通过 HTML `<meta name="apiBase" content="https://monitor.example.com">` 指定后端；跨域时同时配置主控 CORS_ALLOWED_ORIGINS。第三方主题不依赖 Workers、Pages 或 Turnstile。

管理页面始终使用内置前端，入口由 `.env` 的 `ADMIN_PATH` 决定。匿名主题不得提供后台链接；通过 `/api/config` 确認 authorization=true 后才可使用返回的 admin_path 生成设置入口。主题入口为 index.html，静态资源使用相对路径（通常 assets/）；主题商店、后台商店面板和 `/theme` 清单接口已移除，已有 `theme_url` 的加载及管理 API 仍保留。站点标题、背景、CSP 扩展和 theme_options 由后台设置注入。自建主题自行构建，不再提供本项目旧的 GitHub Pages 构建或部署脚本。

## 数据与认证

- GET /api/config：站点公开状态、版本、显示配置、采样配置等；不再返回 Turnstile 或 Cloudflare 用量。
- GET /api/servers：服务器列表及最近上报样本，按 UUID 合并。
- GET /api/server?id=UUID：详情。
- GET /api/history/all?id=UUID&hours=24：历史数组；管理员最多 168 小时，匿名最多 24 小时。
- WS /api/ws：hello、subscribe、subscribed、batchUpdate；参考 src/frontend/utils/api.js。
- POST /api/theme_options：管理员保存主题选项。

REST 管理认证使用 Bearer JWT。WS 支持登录 Cookie 或 token 参数；隐藏节点不会匿名推送。不要把长期 token 写进源码或固定静态文件，不要在日志中保留 token 参数。按 API origin 隔离本地凭据。

响应 401 时转到登录，服务器删除或不可见时处理 404。连接关闭时使用单一可取消重连定时器，页面卸载时清理连接与计时器。历史空值代表缺失，布尔 false 可表示探测禁用，不能全部改为零。

## 上线验证

先完成 testing.md 的实际验收：公共/私人看板、隐藏节点、实时更新、断线重连、24 小时及 7 天曲线、手机布局、管理员入口、CSP 和跨域。第三方主题来自外部仓库，默认主题验收不代表所有第三方主题已通过。
