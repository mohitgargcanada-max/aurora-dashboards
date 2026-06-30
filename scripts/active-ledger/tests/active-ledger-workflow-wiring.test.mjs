import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const WORKFLOWS = Object.freeze({
  us: {
    file: '.github/workflows/us-dashboard.yml',
    label: 'US',
    ledger: 'markets/us/dashboard/state/active-tracking-ledger.json',
    scan: 'markets/us/dashboard/data/us-full-dashboard-scan.json',
  },
  india: {
    file: '.github/workflows/india-dashboard.yml',
    label: 'India',
    ledger: 'markets/india/dashboard/state/active-tracking-ledger.json',
    scan: 'markets/india/dashboard/data/india-full-dashboard-scan.json',
  },
  canada: {
    file: '.github/workflows/canada-dashboard.yml',
    label: 'Canada',
    ledger: 'markets/canada/dashboard/state/active-tracking-ledger.json',
    scan: 'markets/canada/dashboard/data/canada-full-dashboard-scan.json',
  },
});

async function workflowText(market) {
  return readFile(WORKFLOWS[market].file, 'utf8');
}

function assertInput(text) {
  assert.match(text, /active_ledger_mode:/);
  assert.match(text, /description: "Active tracking ledger population mode"/);
  assert.match(text, /default: "off"/);
  assert.match(text, /type: choice/);
  for (const option of ['off', 'dry-run', 'apply']) {
    assert.match(text, new RegExp(`- ${option}`));
  }
}

function assertPopulationStep(text, market) {
  const { label, ledger, scan } = WORKFLOWS[market];
  assert.match(text, new RegExp(`Populate ${label} active tracking ledger`));
  assert.match(text, /github\.event_name == 'workflow_dispatch'/);
  assert.match(text, /github\.event\.inputs\.active_ledger_mode \|\| 'off'/);
  assert.match(text, /Active ledger population disabled\./);
  assert.match(text, /populate-active-tracking-ledger\.mjs/);
  assert.match(text, new RegExp(`--market ${market}`));
  assert.match(text, new RegExp(`--ledger ${ledger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(text, new RegExp(`--scan-file ${scan.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(text, /--dry-run/);
  assert.match(text, /--apply/);
  assert.ok(text.indexOf('--apply') < text.indexOf('--dry-run'));
}

test('US, India, and Canada workflows expose default-off active ledger mode', async () => {
  for (const market of Object.keys(WORKFLOWS)) {
    assertInput(await workflowText(market));
  }
});

test('US, India, and Canada workflows call the population helper with market paths', async () => {
  for (const market of Object.keys(WORKFLOWS)) {
    assertPopulationStep(await workflowText(market), market);
  }
});

test('workflow wiring does not add forbidden commands or PR references', async () => {
  const combined = (await Promise.all(Object.keys(WORKFLOWS).map(workflowText))).join('\n');
  assert.doesNotMatch(combined, /gh workflow run/);
  assert.doesNotMatch(combined, /PR #30|pull\/30|verify-us-json-export-publish-path/);
  assert.doesNotMatch(combined, /india-dashboard-json-export|canada-dashboard-json-export/i);
});
