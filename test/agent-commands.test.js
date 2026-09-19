import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { buildAgentInstallCommand, buildAgentUninstallCommand } from '../src/frontend/utils/agentCommands.js';
import * as shared from '../src/shared/billing.js';
import * as frontend from '../src/frontend/utils/server.js';
import { createServerForm, buildServerFormPayload } from '../src/frontend/utils/serverForm.js';
import { validatePingNode } from '../src/shared/pingNode.js';
import { validatePingNode as agentValidatePingNode } from '../src/utils/agentConfig.js';

test('native commands remain shell-safe for all supported install modes', () => {
  for (const targetOs of ['linux', 'unix', 'freebsd']) for (const installMode of ['current-user', 'cfsm-user']) {
    const command = buildAgentInstallCommand({ selectedApiBase: 'https://monitor.example', copyServerId: 'fixture-id', apiSecret: "fixture'\"$` secret", targetOs, installMode, collectInterval: 2, reportInterval: 180, connectionMode: 'auto', pingMode: 'icmp', resetDay: 1, autoUpdate: true, customCt: '', node1: '[2001:db8::1]:443', explicitEmptyNodes: { custom_ct: true }, rxCorrection: 0, txCorrection: 10 }, {});
    assert.equal(spawnSync('sh', ['-n'], { input: command, encoding: 'utf8' }).status, 0);
    assert.match(command, /\/agent\/install\.sh/);
    assert.match(command, /-ct=/);
    assert.match(command, /-node_1=\[2001:db8::1\]:443/);
    assert.match(command, /-rx_correction=0/);
    assert.doesNotMatch(command, /cf-probe|cf-server-monitor|install-mac\.sh/);
    const uninstall = buildAgentUninstallCommand('https://monitor.example', targetOs, installMode, {});
    assert.equal(spawnSync('sh', ['-n'], { input: uninstall, encoding: 'utf8' }).status, 0);
    assert.match(uninstall, /\/agent\/install\.sh/);
  }
});

test('frontend billing rules are the same implementation as the server rules', () => {
  for (const name of ['normalizePrice', 'normalizeCurrency', 'detectCurrencySymbol', 'detectBillingCycle', 'normalizeBillingCycle', 'renewExpireDateIfNeeded']) assert.equal(frontend[name], shared[name]);
  assert.equal(frontend.formatBillingPrice({ price: '$12/year' }, 'ja'), '$12.00/年');
  assert.equal(shared.renewExpireDateIfNeeded('2024-01-31', 'month', '1', Date.UTC(2024, 1, 1)).expire_date, '2024-02-29');
});

test('single and batch forms use one payload builder with shared probe validation', () => {
  assert.equal(validatePingNode, agentValidatePingNode);
  const form = createServerForm({ id: 'fixture', name: 'Node', region: 'US', region_override: 'JP', price: '$12/year', custom_ct: '0', node_1: '[2001:db8::1]:443', auto_renewal: '1', auto_update: '1' }, 'http');
  assert.equal(form.region, 'JP'); assert.equal(form.connection_mode, 'http');
  const result = buildServerFormPayload(form, 'http');
  assert.equal(result.payload.custom_ct, '0');
  assert.equal(result.payload.node_1, '[2001:db8::1]:443');
  assert.equal(result.payload.billing_cycle, 'year');
  assert.equal(result.payload.auto_update, '1');
  assert.equal(result.normalized.price, '12.00');
  assert.equal(buildServerFormPayload({ ...form, node_1: 'https://invalid.example/path' }, 'auto').invalidField, 'node_1');
});
