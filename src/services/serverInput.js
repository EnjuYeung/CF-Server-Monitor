import { validateAgentConfigInput, validatePingNode, validateNetworkInterfaces, isValidTrafficCorrection } from '../utils/agentConfig.js';
import { isWssReportConfigured } from '../utils/settings.js';
import { detectBillingCycle, detectCurrencySymbol, normalizeBillingCycle, normalizeCurrency, normalizePrice, renewExpireDateIfNeeded } from '../shared/billing.js';

import { PING_NODE_FIELDS } from '../shared/pingNode.js';
import { normalizeServerTags } from '../shared/serverTags.js';
export { PING_NODE_FIELDS } from '../shared/pingNode.js';
export const isValidUUID = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const flag = value => value === true || value === 1 || value === '1' || value === 'true' ? '1' : '0';

export function normalizePingNodeFields(source) {
  const values = {};
  for (const field of PING_NODE_FIELDS) {
    if (source[field] === undefined) continue;
    const result = validatePingNode(source[field]);
    if (!result.valid) return { valid: false, field };
    values[field] = source[field] === 0 || source[field] === '0' ? '0' : result.value;
  }
  return { valid: true, values };
}

// All database entry points share these rules; transport/UI conversion stays at its own boundary.
export function normalizeServerInput(input, settings) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalidServerData');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('invalidServerName');
  const agent = validateAgentConfigInput({
    collect_interval: input.collect_interval ?? 0,
    report_interval: input.report_interval ?? 60,
    wss_report_interval: input.wss_report_interval ?? 2,
    reset_day: input.reset_day ?? 1,
    connection_mode: input.connection_mode ?? 'auto',
    ping_mode: input.ping_mode ?? 'tcp'
  });
  if (!agent.valid) throw new Error(agent.error);
  const { schema_version, ...config } = agent.config;
  if (!isWssReportConfigured(settings)) config.connection_mode = 'http';
  const probes = normalizePingNodeFields(input);
  if (!probes.valid) throw new Error(`invalidPingNodeFormat: ${probes.field}`);
  const interfaces = validateNetworkInterfaces(input.interface);
  if (!interfaces.valid) throw new Error('invalidNetworkInterface');
  const correction = value => {
    if (value === null || value === undefined || value === '') return null;
    if (!isValidTrafficCorrection(value)) throw new Error('invalidTrafficCorrection');
    return Number(value);
  };
  const cycle = normalizeBillingCycle(input.billing_cycle || detectBillingCycle(input.price));
  const renewal = flag(input.auto_renewal);
  return {
    name: input.name.trim(), server_group: String(input.server_group || 'Default'),
    region: String(input.region || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16),
    tags: normalizeServerTags(input.tags),
    note: String(input.note || '').trim().slice(0, 500),
    price: normalizePrice(input.price), billing_cycle: cycle, auto_renewal: renewal,
    currency: normalizeCurrency(input.currency || detectCurrencySymbol(input.price) || '¥'),
    expire_date: renewExpireDateIfNeeded(input.expire_date || '', cycle, renewal).expire_date,
    traffic_limit: String(input.traffic_limit || ''), traffic_calc_type: ['total', 'max', 'dl', 'ul'].includes(input.traffic_calc_type) ? input.traffic_calc_type : 'total',
    interface: interfaces.value, ...config,
    ...Object.fromEntries(PING_NODE_FIELDS.map(field => [field, probes.values[field] ?? ''])),
    rx_correction: correction(input.rx_correction), tx_correction: correction(input.tx_correction),
    auto_update: flag(input.auto_update), offline_notify_disabled: flag(input.offline_notify_disabled), is_hidden: flag(input.is_hidden)
  };
}
