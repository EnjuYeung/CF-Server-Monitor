import { normalizePrice, normalizeBillingCycle, detectBillingCycle, normalizeCurrency, detectCurrencySymbol, renewExpireDateIfNeeded } from '../../shared/billing.js';
import { PING_NODE_FIELDS, validatePingNode } from '../../shared/pingNode.js';

export const createServerForm = (server, connectionMode) => ({
    id: server.id,
    name: server.name || '',
    server_group: server.server_group || '',
    region: server.region_override ?? (server.region || ''),
    tags: server.tags || '',
    note: server.note || '',
    price: normalizePrice(server.price),
    billing_cycle: normalizeBillingCycle(detectBillingCycle(server.price) || server.billing_cycle),
    auto_renewal: server.auto_renewal === '1' || server.auto_renewal === 1 || server.auto_renewal === true,
    currency: normalizeCurrency(server.currency || detectCurrencySymbol(server.price) || '¥'),
    expire_date: server.expire_date || '',
    traffic_limit: server.traffic_limit || '',
    traffic_calc_type: server.traffic_calc_type || 'total',
    interface: server.interface || '',
    reset_day: server.reset_day ?? 1,
    collect_interval: server.collect_interval ?? 0,
    report_interval: server.report_interval || 60,
    wss_report_interval: server.wss_report_interval || 2,
    connection_mode: connectionMode,
    ping_mode: server.ping_mode === 'icmp' ? 'icmp' : 'tcp',
    custom_ct: server.custom_ct ?? '',
    custom_cu: server.custom_cu ?? '',
    custom_cm: server.custom_cm ?? '',
    custom_bd: server.custom_bd ?? '',
    node_1: server.node_1 ?? '', node_2: server.node_2 ?? '', node_3: server.node_3 ?? '', node_4: server.node_4 ?? '',
    rx_correction: server.rx_correction ?? '',
    tx_correction: server.tx_correction ?? '',
    auto_update: server.auto_update === '1' || server.auto_update === 1 || server.auto_update === true,
    is_hidden: server.is_hidden === '1',
    offline_notify_disabled: server.offline_notify_disabled === '1'
})

export const buildServerFormPayload = (form, connectionMode) => {
  const values = {};
  for (const field of PING_NODE_FIELDS) {
    const result = validatePingNode(form[field]);
    if (!result.valid) return { invalidField: field };
    values[field] = result.value;
  }

  const normalizedBillingCycle = normalizeBillingCycle(form.billing_cycle)
  const normalizedAutoRenewal = form.auto_renewal ? '1' : '0'
  const normalizedPrice = normalizePrice(form.price)
  const normalizedCurrency = normalizeCurrency(form.currency || detectCurrencySymbol(form.price) || '¥')
  const normalizedExpireDate = renewExpireDateIfNeeded(
    form.expire_date,
    normalizedBillingCycle,
    normalizedAutoRenewal
  ).expire_date

  return {
    payload: {
      action: 'edit',
      id: form.id,
      name: form.name,
      server_group: form.server_group,
      region: form.region,
      tags: form.tags,
      note: form.note,
      price: normalizedPrice,
      billing_cycle: normalizedBillingCycle,
      auto_renewal: normalizedAutoRenewal,
      currency: normalizedCurrency,
      expire_date: normalizedExpireDate,
      traffic_limit: form.traffic_limit,
      traffic_calc_type: form.traffic_calc_type,
      interface: form.interface,
      reset_day: form.reset_day,
      collect_interval: form.collect_interval,
      report_interval: form.report_interval,
      wss_report_interval: form.wss_report_interval,
      connection_mode: connectionMode,
      ping_mode: form.ping_mode === 'icmp' ? 'icmp' : 'tcp',
      custom_ct: values.custom_ct,
      custom_cu: values.custom_cu,
      custom_cm: values.custom_cm,
      custom_bd: values.custom_bd,
      node_1: values.node_1, node_2: values.node_2, node_3: values.node_3, node_4: values.node_4,
      rx_correction: form.rx_correction,
      tx_correction: form.tx_correction,
      auto_update: form.auto_update ? '1' : '0',
      is_hidden: form.is_hidden ? '1' : '0',
      offline_notify_disabled: form.offline_notify_disabled ? '1' : '0'
    },
    normalized: {
      price: normalizedPrice,
      currency: normalizedCurrency,
      billing_cycle: normalizedBillingCycle,
      expire_date: normalizedExpireDate
    }
  }
}
