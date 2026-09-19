import { enqueueNotification } from '../outbox.js';
import { getAllServers } from '../../utils/cache.js';
import { getResourceAlertConfig, getResourceAlertRuleThresholds, loadSiteSettings } from '../../utils/settings.js';
import { RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE, RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE, RESOURCE_ALERT_NOTIFICATION_SOFT_LIMIT } from '../../utils/config.js';
import { formatNotificationTime } from './time.js';
import { hasNotificationTarget } from './delivery.js';

const RESOURCE_ALERT_STATE_ACTIVE = 'active';
const RESOURCE_ALERT_STATE_RECOVERED = 'recovered';
const RESOURCE_ALERT_STATE_KEY = 'resource_alert_state';

function formatMegabitsPerSecond(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '0 Mbps';
  const mbps = number * 8 / 1000 / 1000;
  return `${mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)} Mbps`;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return `${number.toFixed(number >= 10 ? 1 : 2)}%`;
}

function formatResourceMetric(metric) {
  const metricLabels = {
    cpu: 'CPU',
    ram: 'RAM',
    disk: 'DISK',
    netIn: '下行网速',
    netOut: '上行网速',
    netTotal: '总网速'
  };
  const label = metricLabels[metric.metric] || metric.metric;
  const valueLabel = metric.mode === 'average' ? '平均' : '当前';
  const value = metric.triggerValue ?? metric.current;
  if (metric.metric === 'cpu' || metric.metric === 'ram' || metric.metric === 'disk') {
    return `${label} ${valueLabel} ${formatPercent(value)} > ${formatPercent(metric.threshold)}`;
  }
  return `${label} ${valueLabel} ${formatMegabitsPerSecond(value)} > ${formatMegabitsPerSecond(metric.threshold)}`;
}

function getResourceMetricLabel(metric) {
  const metricLabels = {
    cpu: 'CPU',
    ram: 'RAM',
    disk: 'DISK',
    netIn: '下行网速',
    netOut: '上行网速',
    netTotal: '总网速'
  };
  return metricLabels[metric?.metric] || metric?.metric || '';
}

function formatResourceMetricValue(metric, value) {
  if (metric?.metric === 'cpu' || metric?.metric === 'ram' || metric?.metric === 'disk') {
    return formatPercent(value);
  }
  return formatMegabitsPerSecond(value);
}

function formatRecoveredResourceMetric(metric) {
  if (!metric || typeof metric !== 'object') return '';
  const label = getResourceMetricLabel(metric);
  const value = metric.current;
  const valueText = formatResourceMetricValue(metric, value);
  const thresholdText = formatResourceMetricValue(metric, metric.threshold);

  return `${label} 当前 ${valueText} < ${thresholdText}`;
}

function parseResourceAlertState(row) {
  if (!row || !row.value) return { signature: '', servers: {} };
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && parsed.servers && typeof parsed.servers === 'object') {
      return {
        signature: String(parsed.signature || ''),
        servers: parsed.servers
      };
    }
  } catch (_) {}
  return { signature: '', servers: {} };
}

function hasResourceAlertStateEntries(alertState) {
  return alertState && typeof alertState === 'object' && Object.keys(alertState).length > 0;
}

function getChanges(result) {
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isFinite(changes) && changes > 0 ? changes : 0;
}

export function clearResourceAlertState(db) {
  if (!db) return false;
  const result = db.prepare(
    `DELETE FROM settings WHERE key = ?`
  ).bind(RESOURCE_ALERT_STATE_KEY).run();
  return getChanges(result) > 0;
}

function saveResourceAlertState(db, configSignature, alertState, hadStoredState) {
  if (hasResourceAlertStateEntries(alertState)) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(RESOURCE_ALERT_STATE_KEY, JSON.stringify({ signature: configSignature, servers: alertState })).run();
    return;
  }

  if (hadStoredState) {
    db.prepare('DELETE FROM settings WHERE key = ?').bind(RESOURCE_ALERT_STATE_KEY).run();
  }
}

function getResourceAlertStateStatus(state) {
  if (!state || typeof state !== 'object') return RESOURCE_ALERT_STATE_ACTIVE;
  return state.status === RESOURCE_ALERT_STATE_RECOVERED
    ? RESOURCE_ALERT_STATE_RECOVERED
    : RESOURCE_ALERT_STATE_ACTIVE;
}

function getResourceAlertStateTimestamp(state, key) {
  if (!state || typeof state !== 'object') return 0;
  const timestamp = Number(state[key] || 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function getStoredResourceAlertMetrics(alert) {
  return (alert?.metrics || []).map(m => ({
    metric: m.metric,
    mode: m.mode,
    threshold: m.threshold,
    triggerValue: m.triggerValue ?? m.current
  }));
}

function canRecoverResourceAlert(evaluation) {
  const metrics = Array.isArray(evaluation?.metrics) ? evaluation.metrics : [];
  return metrics.length > 0 && metrics.every(metric => {
    const current = Number(metric?.current);
    const threshold = Number(metric?.threshold);
    return Number.isFinite(current) && Number.isFinite(threshold) && current < threshold;
  });
}

function getResourceAlertRuleIntervalMs(rule) {
  const minutes = Number(rule?.intervalMinutes);
  const normalizedMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
  return Math.max(5, normalizedMinutes) * 60 * 1000;
}

function formatCurrentTime(settings = {}) {
  return formatNotificationTime(Date.now(), settings);
}

function getResourceAlertRuleStateKey(rule, serverId) {
  return `${rule.id}:${serverId}`;
}

function getResourceAlertRuleName(rule) {
  return String(rule?.name || '资源负载告警').trim() || '资源负载告警';
}

function getResourceAlertRuleServerIds(rule, servers) {
  const allServerIds = servers.map(server => String(server.id)).filter(Boolean);
  if (!Array.isArray(rule.servers) || rule.servers.length === 0) {
    return allServerIds;
  }

  const allowed = new Set(allServerIds);
  const seen = new Set();
  const ids = [];
  for (const serverId of rule.servers) {
    const id = String(serverId || '').trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function formatConciseResourceMetric(metric, valueKey = 'triggerValue') {
  const label = getResourceMetricLabel(metric);
  const value = metric?.[valueKey] ?? metric?.current;
  return `${label} ${formatResourceMetricValue(metric, value)}`;
}

function buildGroupedResourceAlertEntries(nodes, valueKey = 'triggerValue') {
  const groups = new Map();

  for (const item of Array.isArray(nodes) ? nodes : []) {
    const serverName = String(item?.server?.name || '').trim();
    if (!serverName) continue;

    const sourceMetrics = item.alert?.metrics || item.metrics || [];
    if (!Array.isArray(sourceMetrics) || sourceMetrics.length === 0) continue;

    let group = groups.get(serverName);
    if (!group) {
      group = { serverName, metrics: [], seen: new Set() };
      groups.set(serverName, group);
    }

    for (const metric of sourceMetrics) {
      const text = formatConciseResourceMetric(metric, valueKey);
      if (!text || group.seen.has(text)) continue;
      group.seen.add(text);
      group.metrics.push(text);
    }
  }

  return Array.from(groups.values())
    .filter(group => group.metrics.length > 0)
    .map(group => ({
      serverName: group.serverName,
      text: `${group.serverName}  ${group.metrics.join('  ')}`
    }));
}

function appendResourceAlertNotificationChunks(payloads, entries, options) {
  if (!Array.isArray(entries) || entries.length === 0) return;

  let chunkEntries = [];
  let chunkClients = [];
  const flush = () => {
    if (chunkEntries.length === 0) return;

    const nodeList = chunkEntries.map(entry => entry.text).join('\n');
    payloads.push({
      msg: nodeList,
      context: {
        event: options.event,
        emoji: options.emoji,
        clients: chunkClients,
        count: new Set(chunkClients).size || chunkEntries.length,
        message: nodeList
      }
    });
    chunkEntries = [];
    chunkClients = [];
  };

  for (const entry of entries) {
    const candidateEntries = [...chunkEntries, entry];
    const candidateNodeList = candidateEntries.map(item => item.text).join('\n');
    const candidate = candidateNodeList;
    if (chunkEntries.length > 0 && candidate.length > RESOURCE_ALERT_NOTIFICATION_SOFT_LIMIT) {
      flush();
    }
    chunkEntries.push(entry);
    if (entry.serverName) chunkClients.push(entry.serverName);
  }

  flush();
}

export function buildResourceAlertNotificationPayloads(alertNodes, recoveredNodes) {
  const payloads = [];
  appendResourceAlertNotificationChunks(
    payloads,
    buildGroupedResourceAlertEntries(alertNodes, 'triggerValue'),
    {
      event: '资源负载告警',
      emoji: '❌'
    }
  );
  appendResourceAlertNotificationChunks(
    payloads,
    buildGroupedResourceAlertEntries(recoveredNodes, 'current'),
    {
      event: '资源负载恢复',
      emoji: '✅'
    }
  );
  return payloads;
}

async function evaluateResourceAlertRules(stub, ruleRequests) {
  const resultMap = new Map();
  const requests = [];

  for (const item of Array.isArray(ruleRequests) ? ruleRequests : []) {
    const serverIds = Array.isArray(item?.serverIds) ? item.serverIds : [];
    for (let offset = 0; offset < serverIds.length; offset += RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE) {
      requests.push({
        rule: item.rule,
        serverIds: serverIds.slice(offset, offset + RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE)
      });
    }
  }

  for (let offset = 0; offset < requests.length; offset += RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE) {
    const batch = requests.slice(offset, offset + RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE);
    if (batch.length === 0) continue;

    try {
      const result = await stub.resourceAlerts.evaluateRules(batch.map(({ rule, serverIds }) => ({
        ruleId: rule.id, serverIds, mode: rule.mode,
        windowMinutes: Number(rule.intervalMinutes), thresholds: getResourceAlertRuleThresholds(rule)
      })));
      for (const item of Array.isArray(result?.results) ? result.results : []) {
        const ruleId = String(item?.ruleId || '').trim();
        if (!ruleId) continue;
        const existing = resultMap.get(ruleId) || {
          alerts: [],
          evaluatedServerIds: [],
          evaluations: []
        };
        existing.alerts.push(...(Array.isArray(item.alerts) ? item.alerts : []));
        existing.evaluatedServerIds.push(...(
          Array.isArray(item.evaluatedServerIds)
            ? item.evaluatedServerIds.map(id => String(id)).filter(Boolean)
            : []
        ));
        existing.evaluations.push(...(
          Array.isArray(item.evaluations)
            ? item.evaluations.filter(evaluation => evaluation && evaluation.serverId)
            : []
        ));
        resultMap.set(ruleId, existing);
      }
    } catch (e) {
      console.warn('[ResourceAlert] resource evaluation failed:', e?.message || e);
    }
  }

  return resultMap;
}

export async function checkResourceAlerts(env) {
  if (!env?.DB || !env?.REALTIME_HUB) return;

  const db = env.DB;
  const siteSettings = await loadSiteSettings(db, { forceRefresh: true });
  if (!hasNotificationTarget(siteSettings)) return;

  const resourceConfig = getResourceAlertConfig(siteSettings);

  if (!resourceConfig.enabled || !resourceConfig.hasRules) {
    await clearResourceAlertState(db);
    return;
  }

  try {
    const allServers = await getAllServers(db);
    if (allServers.length === 0) {
      await clearResourceAlertState(db);
      return;
    }

    const serverMap = new Map(allServers.map(server => [String(server.id), server]));
    const stub = env.REALTIME_HUB;
    const activeMap = new Map();
    const evaluationMap = new Map();
    const configuredRules = [];
    const configuredRuleServers = [];
    const evaluatedRuleServers = [];

    const configSignature = JSON.stringify({
      rules: resourceConfig.rules.map(rule => ({
        id: rule.id,
        name: rule.name,
        metric: rule.metric,
        threshold: rule.threshold,
        servers: rule.servers,
        intervalMinutes: rule.intervalMinutes,
        mode: rule.mode
      }))
    });

    for (const rule of resourceConfig.rules) {
      const serverIds = getResourceAlertRuleServerIds(rule, allServers);
      if (serverIds.length === 0) continue;

      const ruleServers = [];
      for (const serverId of serverIds) {
        const server = serverMap.get(String(serverId));
        if (!server) continue;
        ruleServers.push({
          key: getResourceAlertRuleStateKey(rule, serverId),
          rule,
          server,
          serverId: String(serverId)
        });
      }
      if (ruleServers.length === 0) continue;
      configuredRuleServers.push(...ruleServers);
      configuredRules.push({ rule, serverIds, ruleServers });
    }

    if (configuredRuleServers.length === 0) {
      await clearResourceAlertState(db);
      return;
    }

    const evaluationResults = await evaluateResourceAlertRules(stub, configuredRules);
    for (const { rule, ruleServers } of configuredRules) {
      const result = evaluationResults.get(String(rule.id));
      if (!result) continue;
      const evaluatedServerIdSet = new Set(result.evaluatedServerIds);
      evaluatedRuleServers.push(...ruleServers.filter(item => evaluatedServerIdSet.has(item.serverId)));
      for (const alert of result.alerts) {
        activeMap.set(getResourceAlertRuleStateKey(rule, alert.serverId), { rule, alert });
      }
      for (const evaluation of result.evaluations || []) {
        evaluationMap.set(getResourceAlertRuleStateKey(rule, evaluation.serverId), evaluation);
      }
    }

    const stateRow = await db.prepare(
      `SELECT value FROM settings WHERE key = ?`
    ).bind(RESOURCE_ALERT_STATE_KEY).first();
    const hadStoredState = !!stateRow;
    const parsedState = parseResourceAlertState(stateRow);
    let alertState = parsedState.servers || {};

    const now = Date.now();
    const alertNodes = [];
    const recoveredNodes = [];
    const validStateKeys = new Set(configuredRuleServers.map(item => item.key));
    let stateChanged = hadStoredState && parsedState.signature !== configSignature;

    for (const key of Object.keys(alertState)) {
      if (!validStateKeys.has(key)) {
        delete alertState[key];
        stateChanged = true;
      }
    }

    for (const { key, rule, server } of evaluatedRuleServers) {
      const active = activeMap.get(key);
      const alert = active?.alert;
      const evaluation = evaluationMap.get(key);
      const currentState = alertState[key];
      const currentStatus = currentState
        ? getResourceAlertStateStatus(currentState)
        : '';
      const ruleIntervalMs = getResourceAlertRuleIntervalMs(rule);

      if (alert) {
        const isActiveAlert = currentStatus === RESOURCE_ALERT_STATE_ACTIVE;
        const recoveredAt = currentStatus === RESOURCE_ALERT_STATE_RECOVERED
          ? getResourceAlertStateTimestamp(currentState, 'recoveredAt')
          : 0;
        if (recoveredAt > 0 && now - recoveredAt < ruleIntervalMs) {
          continue;
        }

        if (!isActiveAlert) {
          alertNodes.push({ rule, server, alert });
          alertState[key] = {
            status: RESOURCE_ALERT_STATE_ACTIVE,
            alertAt: now,
            lastTriggeredAt: now,
            metrics: getStoredResourceAlertMetrics(alert)
          };
          stateChanged = true;
        } else {
          const lastTriggeredAt = getResourceAlertStateTimestamp(currentState, 'lastTriggeredAt');
          if (lastTriggeredAt === 0 || now - lastTriggeredAt >= ruleIntervalMs) {
            alertState[key] = {
              ...currentState,
              status: RESOURCE_ALERT_STATE_ACTIVE,
              alertAt: getResourceAlertStateTimestamp(currentState, 'alertAt') || now,
              lastTriggeredAt: now,
              metrics: getStoredResourceAlertMetrics(alert)
            };
            stateChanged = true;
          }
        }
      } else if (currentState) {
        if (currentStatus === RESOURCE_ALERT_STATE_ACTIVE) {
          if (!canRecoverResourceAlert(evaluation)) {
            continue;
          }

          recoveredNodes.push({ rule, server, metrics: evaluation?.metrics || [] });
          alertState[key] = {
            ...currentState,
            status: RESOURCE_ALERT_STATE_RECOVERED,
            recoveredAt: now,
            metrics: evaluation?.metrics || currentState.metrics
          };
          stateChanged = true;
        } else {
          const recoveredAt = getResourceAlertStateTimestamp(currentState, 'recoveredAt');
          if (recoveredAt === 0 || now - recoveredAt >= ruleIntervalMs) {
            delete alertState[key];
            stateChanged = true;
          }
        }
      }
    }

    db.transaction(() => {
      if (stateChanged) saveResourceAlertState(db, configSignature, alertState, hadStoredState);
      for (const payload of buildResourceAlertNotificationPayloads(alertNodes, recoveredNodes)) {
        enqueueNotification(db, payload.msg, payload.context);
      }
    });
  } catch (e) {
    console.error('资源负载告警检测失败:', e);
  }
}
