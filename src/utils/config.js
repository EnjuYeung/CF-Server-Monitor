// 当前主控版本：/api/config 返回给前端与主题，用于页脚和升级提示。
export const CURRENT_VERSION = '3.0.0';

// 站点设置默认值与缓存策略。
export const DEFAULT_SITE_TITLE = 'Server Monitor';
export const SITE_SETTINGS_CACHE_TTL_MS = 120 * 1000;
export const JWT_SECRET_MIN_LENGTH = 32;

// 首页三网延迟/丢包小窗口：影响 /api/servers 的 servers[].ping/loss 抽样，并通过 /api/config 暴露给主题。
export const DASHBOARD_LATENCY_WINDOW_POINTS = 20;
export const DASHBOARD_LATENCY_WINDOW_HOURS = 2;
export const DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS = 5 * 60 * 1000;


// 单主控最新上报回放缓存的保留时长和容量。
export const LATEST_REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
export const LATEST_REPORT_CACHE_MAX_SERVERS = 1000;

export const UPDATE_MAX_BATCH_SAMPLES = 300;

// Agent WSS 上报策略：默认历史写入间隔、服务器配置缓存，以及无前端订阅时的最小上报间隔。
export const AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS = 60 * 1000;
export const AGENT_SERVER_DETAIL_TTL_MS = 120 * 1000;
export const AGENT_MIN_IDLE_WSS_REPORT_INTERVAL_MS = 60 * 1000;

// 通知发送与资源告警批处理：限制外部请求重试、单次规则评估规模和通知正文长度。
export const NOTIFICATION_MAX_RETRIES = 3;
export const NOTIFICATION_RETRY_DELAY_MS = 1000;
export const RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE = 20;
export const RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE = 500;
export const RESOURCE_ALERT_NOTIFICATION_SOFT_LIMIT = 3200;

// 远程主题资源缓存。
export const THEME_ASSET_CACHE_TTL_SECONDS = 3600;
export const THEME_COMMIT_CACHE_TTL_SECONDS = 86400;
export const THEME_PREVIEW_AUTH_TTL_SECONDS = 600;
