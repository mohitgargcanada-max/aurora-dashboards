import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDryRunReportCli } from '../run-active-ledger-dry-run-report.mjs';

function emptyLedger(market = 'us') {
  return {
    schema_version: '1.0',
    market,
    created_at: null,
    updated_at: null,
    entries: [],
  };
}

function row(symbol = 'MOCKUS', overrides = {}) {
  return {
    symbol,
    final_bucket: 'TRIGGER_READY',
    theme: 'Synthetic theme',
    close: 101,
    entry_reference: 100,
    entry_stop: 93,
    thesis_stop: 88,
    ...overrides,
  };
}

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aurora-ledger-report-test-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function tempJson(dir, name, content) {
  const file = path.join(dir, name);
  await writeFile(file, `${JSON.stringify(content, null, 2)}\n`);
  return file;
}

async function runSilenced(argv) {
  const original = console.log;
  console.log = () => {};
  try {
    return await runDryRunReportCli(argv);
  } finally {
    console.log = original;
  }
}

test('dry-run report does not write ledger and reports DRY_RUN_ONLY', async (t) => {
  const dir = await tempDir(t);
  const ledgerFile = await tempJson(dir, 'ledger.json', emptyLedger());
  const scanFile = await tempJson(dir, 'scan.json', { weekly_universe: [row()] });
  const before = await readFile(ledgerFile, 'utf8');
  const report = await runSilenced(['--market', 'us', '--ledger', ledgerFile, '--scan-file', scanFile, '--as-of', '2026-06-30']);

  assert.equal(report.mode, 'DRY_RUN_ONLY');
  assert.equal(report.markets[0].mode, 'DRY_RUN_ONLY');
  assert.equal(report.markets[0].added, 1);
  assert.equal(report.markets[0].confirmations.ledger_files_written, false);
  assert.equal(await readFile(ledgerFile, 'utf8'), before);
});

test('missing scan file reports SCAN_FILE_MISSING and strict mode fails', async (t) => {
  const dir = await tempDir(t);
  const ledgerFile = await tempJson(dir, 'ledger.json', emptyLedger());
  const missingScan = path.join(dir, 'missing-scan.json');
  const report = await runSilenced(['--market', 'us', '--ledger', ledgerFile, '--scan-file', missingScan, '--as-of', '2026-06-30']);

  assert.equal(report.markets[0].status, 'SCAN_FILE_MISSING');
  await assert.rejects(
    () => runSilenced(['--market', 'us', '--ledger', ledgerFile, '--scan-file', missingScan, '--as-of', '2026-06-30', '--strict']),
    /missing or invalid inputs/,
  );
});

test('safe --out writes only the requested report path', async (t) => {
  const dir = await tempDir(t);
  const ledgerFile = await tempJson(dir, 'ledger.json', emptyLedger());
  const scanFile = await tempJson(dir, 'scan.json', { weekly_universe: [row()] });
  const outFile = path.join(dir, 'reports', 'dry-run-report.json');

  const report = await runSilenced(['--market', 'us', '--ledger', ledgerFile, '--scan-file', scanFile, '--as-of', '2026-06-30', '--out', outFile]);
  const written = JSON.parse(await readFile(outFile, 'utf8'));
  assert.equal(written.markets[0].added, report.markets[0].added);
});

test('generated artifact output paths are rejected', async (t) => {
  const dir = await tempDir(t);
  const ledgerFile = await tempJson(dir, 'ledger.json', emptyLedger());
  const scanFile = await tempJson(dir, 'scan.json', { weekly_universe: [row()] });
  for (const outFile of [
    'markets/us/dashboard/data/report.json',
    'markets/us/dashboard/cache/report.json',
    'markets/us/AURORA_US_Dashboard.html',
    'markets/india/AURORA_India_Unified_Dashboard.html',
  ]) {
    await assert.rejects(
      () => runSilenced(['--market', 'us', '--ledger', ledgerFile, '--scan-file', scanFile, '--as-of', '2026-06-30', '--out', outFile]),
      /must not target cache, dashboard\/data, or dashboard HTML artifacts/,
    );
  }
});

test('unsupported market and path traversal are rejected', async (t) => {
  const dir = await tempDir(t);
  const ledgerFile = await tempJson(dir, 'ledger.json', emptyLedger());
  const scanFile = await tempJson(dir, 'scan.json', { weekly_universe: [row()] });
  await assert.rejects(() => runSilenced(['--market', 'uk', '--ledger', ledgerFile, '--scan-file', scanFile]), /Unsupported market: uk/);
  await assert.rejects(() => runSilenced(['--market', 'us', '--ledger', '../ledger.json', '--scan-file', scanFile]), /Path traversal/);
});

test('diagnostic labels are skipped and FOMO remains context-only', async (t) => {
  const dir = await tempDir(t);
  const ledgerFile = await tempJson(dir, 'ledger.json', emptyLedger());
  const scanFile = await tempJson(dir, 'scan.json', {
    weekly_universe: [
      row('MOCKR1', { latest_market_fomo_label: 'FOMO_5_CLIMAX_RISK', latest_market_fomo_score: 5 }),
      row('MOCKR2', { final_bucket: 'RSLE_TRIGGER_READY' }),
    ],
  });

  const report = await runSilenced(['--market', 'us', '--ledger', ledgerFile, '--scan-file', scanFile, '--as-of', '2026-06-30']);
  assert.equal(report.markets[0].added, 1);
  assert.equal(report.markets[0].skipped_reasons.SKIPPED_INVALID_BUCKET, 1);
  assert.equal(report.markets[0].confirmations.diagnostic_labels_converted_to_final_buckets, false);
  assert.equal(report.markets[0].confirmations.mfh_fomo_atr_context_only, true);
});

test('committed US, India, and Canada ledgers remain empty', async () => {
  for (const market of ['us', 'india', 'canada']) {
    const file = `markets/${market}/dashboard/state/active-tracking-ledger.json`;
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(parsed.entries.length, 0);
  }
});
