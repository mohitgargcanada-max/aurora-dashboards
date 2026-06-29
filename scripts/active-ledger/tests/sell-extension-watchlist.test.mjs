import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertReviewReasonsAreNotFinalBuckets,
  loadSellExtensionWatchlistRows,
  normalizeSellExtensionRows,
  renderSellExtensionWatchlistHtml,
} from '../sell-extension-watchlist.mjs';

function ledger(market = 'us', entries = []) {
  return {
    schema_version: '1.0',
    market,
    created_at: null,
    updated_at: null,
    entries,
  };
}

function entry(overrides = {}) {
  return {
    symbol: 'MOCKUS',
    market: 'us',
    first_published_date: '2026-06-29',
    first_published_list: 'WEEKLY_FOCUS',
    theme: 'Synthetic test',
    initial_bucket: 'TRADE_READY',
    current_bucket: 'TRIGGER_READY',
    entry_reference: 100,
    entry_stop: 92,
    thesis_stop: null,
    highest_close_since_publish: 118,
    latest_close: 112,
    latest_axm21_label: 'AXM21_HOT',
    latest_axm50_label: 'AXM50_VERY_EXTENDED',
    latest_px_label: 'PX_NO_CHASE',
    latest_aurora_x_state: 'AURORA_X2_SELL_RISK_REVIEW',
    latest_market_fomo_label: 'FOMO_4_EUPHORIC',
    latest_market_fomo_score: 4,
    extension_status: 'EXTENDED_REVIEW',
    lifecycle_status: 'EXTENDED_REVIEW',
    last_review_date: '2026-06-29',
    exit_date: null,
    exit_reason: null,
    notes: ['VE2_CLIMAX_VOLUME_WARNING', 'synthetic fixture only'],
    ...overrides,
  };
}

async function tempLedgerFile(t, content) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aurora-sell-watchlist-test-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'ledger.json');
  await writeFile(file, JSON.stringify(content, null, 2));
  return file;
}

test('empty ledgers render empty state', () => {
  const rows = normalizeSellExtensionRows(ledger());
  const html = renderSellExtensionWatchlistHtml(rows);
  assert.equal(rows.length, 0);
  assert.match(html, /No entries yet/);
  assert.match(html, /Extension alone is not a sell signal/);
  assert.match(html, /Market FOMO \/ ATR Heat is context-only/);
});

test('synthetic US, India, and Canada entries render in the table', async (t) => {
  for (const [market, symbol] of [['us', 'MOCKUS'], ['india', 'MOCKIN'], ['canada', 'MOCKCA']]) {
    const file = await tempLedgerFile(t, ledger(market, [entry({ market, symbol })]));
    const rows = await loadSellExtensionWatchlistRows(file);
    const html = renderSellExtensionWatchlistHtml(rows);
    assert.equal(rows.length, 1);
    assert.match(html, new RegExp(symbol));
    assert.match(html, /FOMO context: FOMO_4_EUPHORIC/);
  }
});

test('ACTIVE plus NORMAL entries do not render, even with hot FOMO context', () => {
  const rows = normalizeSellExtensionRows(ledger('us', [
    entry({ lifecycle_status: 'ACTIVE', extension_status: 'NORMAL', latest_market_fomo_label: 'FOMO_5_CLIMAX_RISK' }),
  ]));
  assert.equal(rows.length, 0);
});

test('EXITED entries do not render', () => {
  const rows = normalizeSellExtensionRows(ledger('us', [
    entry({ lifecycle_status: 'EXITED', extension_status: 'SELL_RISK_REVIEW' }),
  ]));
  assert.equal(rows.length, 0);
});

test('review lifecycle statuses render', () => {
  for (const lifecycle_status of ['EXTENDED_REVIEW', 'PROTECT_PROFIT_REVIEW', 'SELL_RISK_REVIEW', 'DATA_REPAIR']) {
    const rows = normalizeSellExtensionRows(ledger('us', [entry({ lifecycle_status, extension_status: 'NORMAL' })]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lifecycleStatus, lifecycle_status);
  }
});

test('review extension statuses render', () => {
  for (const extension_status of ['EXTENDED_REVIEW', 'NO_CHASE_REVIEW', 'PROTECT_PROFIT_REVIEW', 'SELL_RISK_REVIEW', 'RESET_REQUIRED', 'DATA_REPAIR']) {
    const rows = normalizeSellExtensionRows(ledger('us', [entry({ lifecycle_status: 'ACTIVE', extension_status })]));
    assert.equal(rows.length, 1);
    assert.match(rows[0].sellExtensionReason, new RegExp(extension_status));
  }
});

test('review reasons and diagnostic labels are not accepted as final buckets', () => {
  assert.equal(assertReviewReasonsAreNotFinalBuckets(), true);
  assert.throws(
    () => normalizeSellExtensionRows(ledger('us', [entry({ current_bucket: 'PX_HARD_WARNING' })])),
    /diagnostic label as bucket/,
  );
});

test('committed ledgers remain empty and contain no real tracked symbols', async () => {
  for (const market of ['us', 'india', 'canada']) {
    const file = `markets/${market}/dashboard/state/active-tracking-ledger.json`;
    const content = await readFile(file, 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.entries.length, 0);
    assert.deepEqual(parsed.entries, []);
  }
});
