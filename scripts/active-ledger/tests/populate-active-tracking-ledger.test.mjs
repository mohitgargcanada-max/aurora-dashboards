import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  populateLedgerFromScan,
  runPopulateCli,
} from '../populate-active-tracking-ledger.mjs';

function emptyLedger(market = 'us') {
  return {
    schema_version: '1.0',
    market,
    created_at: null,
    updated_at: null,
    entries: [],
  };
}

function entry(overrides = {}) {
  return {
    symbol: 'MOCKUS',
    market: 'us',
    first_published_date: '2026-06-01',
    first_published_list: 'WEEKLY_UNIVERSE',
    theme: 'Synthetic theme',
    initial_bucket: 'TRIGGER_READY',
    current_bucket: 'TRIGGER_READY',
    entry_reference: 100,
    entry_stop: 92,
    thesis_stop: 85,
    highest_close_since_publish: 110,
    latest_close: 108,
    latest_axm21_label: '',
    latest_axm50_label: '',
    latest_px_label: '',
    latest_aurora_x_state: '',
    latest_market_fomo_label: 'UNKNOWN',
    latest_market_fomo_score: null,
    extension_status: 'NORMAL',
    lifecycle_status: 'ACTIVE',
    last_review_date: '2026-06-01',
    exit_date: null,
    exit_reason: null,
    notes: [],
    ...overrides,
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

async function tempJson(t, name, content) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aurora-ledger-populate-test-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, name);
  await writeFile(file, `${JSON.stringify(content, null, 2)}\n`);
  return file;
}

async function runSilenced(argv) {
  const original = console.log;
  console.log = () => {};
  try {
    return await runPopulateCli(argv);
  } finally {
    console.log = original;
  }
}

test('dry-run does not write ledger', async (t) => {
  const ledgerFile = await tempJson(t, 'ledger.json', emptyLedger());
  const scanFile = await tempJson(t, 'scan.json', { weekly_universe: [row()] });
  const before = await readFile(ledgerFile, 'utf8');
  const result = await runSilenced(['--market', 'us', '--ledger', ledgerFile, '--scan-file', scanFile, '--as-of', '2026-06-29']);
  assert.equal(result.report.mode, 'dry-run');
  assert.equal(result.report.added, 1);
  assert.equal(await readFile(ledgerFile, 'utf8'), before);
});

test('apply writes only the provided temp ledger path', async (t) => {
  const ledgerFile = await tempJson(t, 'ledger.json', emptyLedger());
  const untouchedFile = await tempJson(t, 'untouched-ledger.json', emptyLedger());
  const scanFile = await tempJson(t, 'scan.json', { weekly_universe: [row()] });
  const untouchedBefore = await readFile(untouchedFile, 'utf8');
  const result = await runSilenced(['--market', 'us', '--ledger', ledgerFile, '--scan-file', scanFile, '--as-of', '2026-06-29', '--apply']);
  assert.equal(result.report.mode, 'apply');
  assert.equal(JSON.parse(await readFile(ledgerFile, 'utf8')).entries.length, 1);
  assert.equal(await readFile(untouchedFile, 'utf8'), untouchedBefore);
});

test('new WEEKLY_UNIVERSE candidate is added as ACTIVE', () => {
  const result = populateLedgerFromScan({
    ledger: emptyLedger(),
    scan: { WEEKLY_UNIVERSE: [row('MOCKUS')] },
    market: 'us',
    asOf: '2026-06-29',
  });
  assert.equal(result.ledger.entries[0].first_published_list, 'WEEKLY_UNIVERSE');
  assert.equal(result.ledger.entries[0].lifecycle_status, 'ACTIVE');
});

test('DAILY_TOP_1_4 candidate is added and then updates as ACTIVE', () => {
  const added = populateLedgerFromScan({
    ledger: emptyLedger(),
    scan: { dailyTop14: [row('MOCKX1', { close: 101 })] },
    market: 'us',
    asOf: '2026-06-29',
  }).ledger;
  const updated = populateLedgerFromScan({
    ledger: added,
    scan: { daily_top_1_4: [row('MOCKX1', { close: 106, final_bucket: 'PULLBACK_WATCH' })] },
    market: 'us',
    asOf: '2026-06-30',
  }).ledger.entries[0];
  assert.equal(updated.first_published_list, 'DAILY_TOP_1_4');
  assert.equal(updated.lifecycle_status, 'ACTIVE');
  assert.equal(updated.current_bucket, 'PULLBACK_WATCH');
  assert.equal(updated.latest_close, 106);
});

test('RSLE_DEVELOPING_21_40 candidate becomes WATCH_ONLY unless execution bucket qualifies', () => {
  const watch = populateLedgerFromScan({
    ledger: emptyLedger(),
    scan: { developing_watchlist: [row('MOCKX1', { final_bucket: 'RSNH_WATCH_ONLY' })] },
    market: 'us',
    asOf: '2026-06-29',
  }).ledger.entries[0];
  const active = populateLedgerFromScan({
    ledger: emptyLedger(),
    scan: { developingWatchlist: [row('MOCKX2', { final_bucket: 'EARLY_ENTRY_WATCH' })] },
    market: 'us',
    asOf: '2026-06-29',
  }).ledger.entries[0];
  assert.equal(watch.lifecycle_status, 'WATCH_ONLY');
  assert.equal(active.lifecycle_status, 'ACTIVE');
});

test('existing active symbol updates latest fields without changing first publish fields', () => {
  const ledger = emptyLedger();
  ledger.entries = [entry({ first_published_date: '2026-06-01', first_published_list: 'WEEKLY_FOCUS', initial_bucket: 'TRADE_READY' })];
  const updated = populateLedgerFromScan({
    ledger,
    scan: { weekly_universe: [row('MOCKUS', { final_bucket: 'NO_CHASE', close: 120 })] },
    market: 'us',
    asOf: '2026-06-29',
  }).ledger.entries[0];
  assert.equal(updated.first_published_date, '2026-06-01');
  assert.equal(updated.first_published_list, 'WEEKLY_FOCUS');
  assert.equal(updated.initial_bucket, 'TRADE_READY');
  assert.equal(updated.current_bucket, 'NO_CHASE');
  assert.equal(updated.last_review_date, '2026-06-29');
});

test('highest_close_since_publish increases only when latest_close is higher', () => {
  const ledger = emptyLedger();
  ledger.entries = [entry({ highest_close_since_publish: 110 })];
  const lower = populateLedgerFromScan({
    ledger,
    scan: { weekly_universe: [row('MOCKUS', { close: 100 })] },
    market: 'us',
    asOf: '2026-06-29',
  }).ledger.entries[0];
  const higher = populateLedgerFromScan({
    ledger,
    scan: { weekly_universe: [row('MOCKUS', { close: 125 })] },
    market: 'us',
    asOf: '2026-06-29',
  }).ledger.entries[0];
  assert.equal(lower.highest_close_since_publish, 110);
  assert.equal(higher.highest_close_since_publish, 125);
});

test('EXITED old symbol can be followed by a new active entry', () => {
  const ledger = emptyLedger();
  ledger.entries = [entry({ symbol: 'MOCKX1', lifecycle_status: 'EXITED', exit_date: '2026-06-10', exit_reason: 'synthetic exit' })];
  const result = populateLedgerFromScan({
    ledger,
    scan: { weekly_universe: [row('MOCKX1')] },
    market: 'us',
    asOf: '2026-06-29',
  }).ledger;
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[1].lifecycle_status, 'ACTIVE');
});

test('invalid diagnostic bucket is skipped and reported', () => {
  const result = populateLedgerFromScan({
    ledger: emptyLedger(),
    scan: { weekly_universe: [row('MOCKUS', { final_bucket: 'RSLE_TRIGGER_READY' })] },
    market: 'us',
    asOf: '2026-06-29',
  });
  assert.equal(result.ledger.entries.length, 0);
  assert.equal(result.report.skipped_reasons.SKIPPED_INVALID_BUCKET, 1);
});

test('ACTIVE plus NO_CHASE maps extension_status to NO_CHASE_REVIEW', () => {
  const ledger = emptyLedger();
  ledger.entries = [entry()];
  const updated = populateLedgerFromScan({
    ledger,
    scan: { weekly_universe: [row('MOCKUS', { final_bucket: 'NO_CHASE' })] },
    market: 'us',
    asOf: '2026-06-29',
  }).ledger.entries[0];
  assert.equal(updated.lifecycle_status, 'ACTIVE');
  assert.equal(updated.extension_status, 'NO_CHASE_REVIEW');
});

test('PROTECT_PROFIT_REVIEW maps extension_status and lifecycle appropriately', () => {
  const added = populateLedgerFromScan({
    ledger: emptyLedger(),
    scan: { weekly_universe: [row('MOCKUS', { final_bucket: 'PROTECT_PROFIT_REVIEW' })] },
    market: 'us',
    asOf: '2026-06-29',
  }).ledger.entries[0];
  assert.equal(added.lifecycle_status, 'PROTECT_PROFIT_REVIEW');
  assert.equal(added.extension_status, 'PROTECT_PROFIT_REVIEW');
});

test('FOMO labels are stored as context only and do not change lifecycle or bucket', () => {
  const added = populateLedgerFromScan({
    ledger: emptyLedger(),
    scan: { weekly_universe: [row('MOCKUS', { latest_market_fomo_label: 'FOMO_5_CLIMAX_RISK', latest_market_fomo_score: 5 })] },
    market: 'us',
    asOf: '2026-06-29',
  }).ledger.entries[0];
  assert.equal(added.latest_market_fomo_label, 'FOMO_5_CLIMAX_RISK');
  assert.equal(added.latest_market_fomo_score, 5);
  assert.equal(added.current_bucket, 'TRIGGER_READY');
  assert.equal(added.lifecycle_status, 'ACTIVE');
});

test('unsupported market fails', () => {
  assert.throws(
    () => populateLedgerFromScan({ ledger: emptyLedger(), scan: {}, market: 'uk', asOf: '2026-06-29' }),
    /Unsupported market: uk/,
  );
});

test('missing candidate lists produces NO_CANDIDATES_FOUND but no failure', () => {
  const result = populateLedgerFromScan({
    ledger: emptyLedger(),
    scan: { status: 'synthetic empty scan' },
    market: 'us',
    asOf: '2026-06-29',
  });
  assert.equal(result.report.status, 'NO_CANDIDATES_FOUND');
  assert.equal(result.ledger.entries.length, 0);
});

test('committed US, India, and Canada ledgers remain empty', async () => {
  for (const market of ['us', 'india', 'canada']) {
    const file = `markets/${market}/dashboard/state/active-tracking-ledger.json`;
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(parsed.entries.length, 0);
  }
});
