import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateActiveTrackingLedger, validateLedgerFile } from '../validate-active-tracking-ledger.mjs';

function emptyLedger(market = 'us') {
  return {
    schema_version: '1.0',
    market,
    created_at: null,
    updated_at: null,
    entries: [],
  };
}

function validEntry(overrides = {}) {
  return {
    symbol: 'ABC',
    market: 'us',
    first_published_date: '2026-06-29',
    first_published_list: 'WEEKLY_FOCUS',
    theme: 'Test theme',
    initial_bucket: 'TRADE_READY',
    current_bucket: 'TRIGGER_READY',
    entry_reference: 100,
    entry_stop: 92.5,
    thesis_stop: null,
    highest_close_since_publish: 110,
    latest_close: 108.25,
    latest_axm21_label: 'ABOVE',
    latest_axm50_label: 'ABOVE',
    latest_px_label: 'NORMAL',
    latest_aurora_x_state: 'CONFIRMED',
    latest_market_fomo_label: 'FOMO_1_NORMAL',
    latest_market_fomo_score: null,
    extension_status: 'NORMAL',
    lifecycle_status: 'ACTIVE',
    last_review_date: '2026-06-29',
    exit_date: null,
    exit_reason: null,
    notes: [],
    ...overrides,
  };
}

async function tempFile(t, content) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aurora-active-ledger-test-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'ledger.json');
  await writeFile(file, JSON.stringify(content, null, 2));
  return file;
}

test('empty US, India, and Canada ledgers validate', async (t) => {
  for (const market of ['us', 'india', 'canada']) {
    const fixture = await tempFile(t, emptyLedger(market));
    assert.equal(await validateLedgerFile(fixture), true);
    assert.equal(JSON.parse(await readFile(fixture, 'utf8')).entries.length, 0);
  }
});

test('unsupported market fails', () => {
  assert.throws(() => validateActiveTrackingLedger(emptyLedger('uk')), /Unsupported market: uk/);
});

test('invalid final bucket fails', () => {
  const ledger = emptyLedger();
  ledger.entries = [validEntry({ current_bucket: 'BUY_NOW' })];
  assert.throws(() => validateActiveTrackingLedger(ledger), /current_bucket invalid: BUY_NOW/);
});

test('diagnostic label as bucket fails', () => {
  const ledger = emptyLedger();
  ledger.entries = [validEntry({ initial_bucket: 'RSLE_TRIGGER_READY' })];
  assert.throws(() => validateActiveTrackingLedger(ledger), /diagnostic label as bucket: RSLE_TRIGGER_READY/);
});

test('invalid lifecycle status fails', () => {
  const ledger = emptyLedger();
  ledger.entries = [validEntry({ lifecycle_status: 'BUY' })];
  assert.throws(() => validateActiveTrackingLedger(ledger), /lifecycle_status invalid: BUY/);
});

test('invalid extension status fails', () => {
  const ledger = emptyLedger();
  ledger.entries = [validEntry({ extension_status: 'SELL' })];
  assert.throws(() => validateActiveTrackingLedger(ledger), /extension_status invalid: SELL/);
});

test('invalid FOMO label fails', () => {
  const ledger = emptyLedger();
  ledger.entries = [validEntry({ latest_market_fomo_label: 'FOMO_BUY' })];
  assert.throws(() => validateActiveTrackingLedger(ledger), /latest_market_fomo_label invalid: FOMO_BUY/);
});

test('entry market mismatch fails', () => {
  const ledger = emptyLedger('india');
  ledger.entries = [validEntry({ market: 'us' })];
  assert.throws(() => validateActiveTrackingLedger(ledger), /market must match top-level market/);
});

test('duplicate active symbol fails', () => {
  const ledger = emptyLedger();
  ledger.entries = [validEntry({ symbol: 'ABC' }), validEntry({ symbol: 'abc', lifecycle_status: 'WATCH_ONLY' })];
  assert.throws(() => validateActiveTrackingLedger(ledger), /Duplicate active symbol: ABC/);
});

test('duplicate symbol allowed when previous entry is EXITED', () => {
  const ledger = emptyLedger();
  ledger.entries = [validEntry({ symbol: 'ABC', lifecycle_status: 'EXITED' }), validEntry({ symbol: 'ABC' })];
  assert.equal(validateActiveTrackingLedger(ledger), true);
});

test('invalid date fails', () => {
  const ledger = emptyLedger();
  ledger.entries = [validEntry({ first_published_date: '06/29/2026' })];
  assert.throws(() => validateActiveTrackingLedger(ledger), /first_published_date must be YYYY-MM-DD/);
});

test('numeric fields must be number or null', () => {
  const ledger = emptyLedger();
  ledger.entries = [validEntry({ latest_close: '108.25' })];
  assert.throws(() => validateActiveTrackingLedger(ledger), /latest_close must be a number or null/);
});

test('notes must be array', () => {
  const ledger = emptyLedger();
  ledger.entries = [validEntry({ notes: 'reviewed' })];
  assert.throws(() => validateActiveTrackingLedger(ledger), /notes must be an array/);
});
