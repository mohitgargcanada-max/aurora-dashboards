import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORTED_MARKETS = Object.freeze(['us', 'india', 'canada']);

export const LEDGER_FILES = Object.freeze({
  us: 'markets/us/dashboard/state/active-tracking-ledger.json',
  india: 'markets/india/dashboard/state/active-tracking-ledger.json',
  canada: 'markets/canada/dashboard/state/active-tracking-ledger.json',
});

export const FINAL_BUCKETS = Object.freeze([
  'TRADE_READY',
  'TRIGGER_READY',
  'EARLY_ENTRY_WATCH',
  'PULLBACK_WATCH',
  'RSNH_WATCH_ONLY',
  'NO_CHASE',
  'PROTECT_PROFIT_REVIEW',
  'REPAIR_WATCH',
  'AVOID_FRESH_LONG',
]);

export const DIAGNOSTIC_BUCKET_LABELS = Object.freeze([
  'RSLE_TRIGGER_READY',
  'STANDARD_ENTRY',
  'VOLATILITY_ADJUSTED_STARTER',
  'THESIS_RISK_WIDE',
  'RS_DATA_REPAIR',
  'RSLE_TOP_20_TACTICAL',
  'LIQUIDITY_FAIL',
  'WATCHLIST_ONLY',
  'STAGE_4_DAMAGED',
  'AURORA_X_HARD_BLOCK',
  'PX_HARD_WARNING',
  'MARKET_CORRECTION_WATCHLIST_ONLY',
]);

export const LIFECYCLE_STATUSES = Object.freeze([
  'ACTIVE',
  'WATCH_ONLY',
  'EXTENDED_REVIEW',
  'PROTECT_PROFIT_REVIEW',
  'SELL_RISK_REVIEW',
  'EXITED',
  'DATA_REPAIR',
]);

export const EXTENSION_STATUSES = Object.freeze([
  'NORMAL',
  'EXTENDED_REVIEW',
  'NO_CHASE_REVIEW',
  'PROTECT_PROFIT_REVIEW',
  'SELL_RISK_REVIEW',
  'RESET_REQUIRED',
  'DATA_REPAIR',
]);

export const PUBLISHED_LISTS = Object.freeze([
  'WEEKLY_UNIVERSE',
  'WEEKLY_FOCUS',
  'DAILY_TOP_1_4',
  'RSLE_TOP_20',
  'RSLE_DEVELOPING_21_40',
  'MANUAL_REVIEW',
]);

export const FOMO_LABELS = Object.freeze([
  'FOMO_0_COOL',
  'FOMO_1_NORMAL',
  'FOMO_2_WARM',
  'FOMO_3_HOT',
  'FOMO_4_EUPHORIC',
  'FOMO_5_CLIMAX_RISK',
  'UNKNOWN',
]);

const REQUIRED_TOP_LEVEL_FIELDS = Object.freeze(['schema_version', 'market', 'created_at', 'updated_at', 'entries']);

const REQUIRED_ENTRY_FIELDS = Object.freeze([
  'symbol',
  'market',
  'first_published_date',
  'first_published_list',
  'theme',
  'initial_bucket',
  'current_bucket',
  'entry_reference',
  'entry_stop',
  'thesis_stop',
  'highest_close_since_publish',
  'latest_close',
  'latest_axm21_label',
  'latest_axm50_label',
  'latest_px_label',
  'latest_aurora_x_state',
  'latest_market_fomo_label',
  'latest_market_fomo_score',
  'extension_status',
  'lifecycle_status',
  'last_review_date',
  'exit_date',
  'exit_reason',
  'notes',
]);

const DATE_FIELDS = Object.freeze(['first_published_date', 'last_review_date', 'exit_date']);
const NUMERIC_FIELDS = Object.freeze([
  'entry_reference',
  'entry_stop',
  'thesis_stop',
  'highest_close_since_publish',
  'latest_close',
  'latest_market_fomo_score',
]);

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDateLike(value) {
  return value === null || value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateBucket(errors, entry, field, index) {
  if (DIAGNOSTIC_BUCKET_LABELS.includes(entry[field])) {
    errors.push(`entries[${index}].${field} uses diagnostic label as bucket: ${entry[field]}`);
  } else if (!FINAL_BUCKETS.includes(entry[field])) {
    errors.push(`entries[${index}].${field} invalid: ${entry[field]}`);
  }
}

function validateEntry(errors, entry, ledgerMarket, index) {
  if (!isPlainObject(entry)) {
    errors.push(`entries[${index}] must be an object`);
    return;
  }

  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (!hasOwn(entry, field)) errors.push(`entries[${index}] missing required field: ${field}`);
  }

  if (!SUPPORTED_MARKETS.includes(entry.market)) errors.push(`entries[${index}].market unsupported: ${entry.market}`);
  if (entry.market !== ledgerMarket) errors.push(`entries[${index}].market must match top-level market`);

  if (typeof entry.symbol !== 'string' || entry.symbol.trim() === '') {
    errors.push(`entries[${index}].symbol must be a non-empty string`);
  }

  if (!PUBLISHED_LISTS.includes(entry.first_published_list)) {
    errors.push(`entries[${index}].first_published_list invalid: ${entry.first_published_list}`);
  }

  validateBucket(errors, entry, 'initial_bucket', index);
  validateBucket(errors, entry, 'current_bucket', index);

  if (!LIFECYCLE_STATUSES.includes(entry.lifecycle_status)) {
    errors.push(`entries[${index}].lifecycle_status invalid: ${entry.lifecycle_status}`);
  }
  if (!EXTENSION_STATUSES.includes(entry.extension_status)) {
    errors.push(`entries[${index}].extension_status invalid: ${entry.extension_status}`);
  }
  if (!FOMO_LABELS.includes(entry.latest_market_fomo_label)) {
    errors.push(`entries[${index}].latest_market_fomo_label invalid: ${entry.latest_market_fomo_label}`);
  }

  for (const field of DATE_FIELDS) {
    if (hasOwn(entry, field) && !isDateLike(entry[field])) {
      errors.push(`entries[${index}].${field} must be YYYY-MM-DD, null, or empty`);
    }
  }

  for (const field of NUMERIC_FIELDS) {
    if (hasOwn(entry, field) && entry[field] !== null && (typeof entry[field] !== 'number' || !Number.isFinite(entry[field]))) {
      errors.push(`entries[${index}].${field} must be a number or null`);
    }
  }

  if (!Array.isArray(entry.notes)) errors.push(`entries[${index}].notes must be an array`);
}

function validateDuplicateActiveSymbols(errors, entries) {
  const bySymbol = new Map();
  entries.forEach((entry, index) => {
    if (!isPlainObject(entry) || typeof entry.symbol !== 'string' || entry.symbol.trim() === '') return;
    const symbol = entry.symbol.trim().toUpperCase();
    const group = bySymbol.get(symbol) ?? [];
    group.push({ entry, index });
    bySymbol.set(symbol, group);
  });

  for (const [symbol, group] of bySymbol) {
    const active = group.filter(({ entry }) => entry.lifecycle_status !== 'EXITED');
    if (active.length > 1) {
      errors.push(`Duplicate active symbol: ${symbol}`);
    }
  }
}

export function validateActiveTrackingLedger(ledger) {
  const errors = [];

  if (!isPlainObject(ledger)) {
    throw new Error('Ledger must be a JSON object');
  }

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!hasOwn(ledger, field)) errors.push(`Missing required field: ${field}`);
  }

  if (ledger.schema_version !== '1.0') errors.push('Unsupported schema_version');
  if (!SUPPORTED_MARKETS.includes(ledger.market)) errors.push(`Unsupported market: ${ledger.market}`);
  if (!isDateLike(ledger.created_at)) errors.push('created_at must be YYYY-MM-DD or null');
  if (!isDateLike(ledger.updated_at)) errors.push('updated_at must be YYYY-MM-DD or null');
  if (!Array.isArray(ledger.entries)) errors.push('entries must be an array');

  if (Array.isArray(ledger.entries)) {
    ledger.entries.forEach((entry, index) => validateEntry(errors, entry, ledger.market, index));
    validateDuplicateActiveSymbols(errors, ledger.entries);
  }

  if (errors.length > 0) {
    const error = new Error(`Active tracking ledger validation failed:\n${errors.join('\n')}`);
    error.errors = errors;
    throw error;
  }

  return true;
}

export async function loadLedger(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function validateLedgerFile(filePath) {
  return validateActiveTrackingLedger(await loadLedger(filePath));
}

export async function validateAllLedgers(repoRoot = process.cwd()) {
  for (const ledgerFile of Object.values(LEDGER_FILES)) {
    await validateLedgerFile(path.join(repoRoot, ledgerFile));
  }
  return true;
}

function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') {
      args.all = true;
    } else if (arg === '--file') {
      args.file = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    if (args.all === Boolean(args.file)) {
      throw new Error('Usage: node scripts/active-ledger/validate-active-tracking-ledger.mjs --file <ledger-json> | --all');
    }
    if (args.all) {
      await validateAllLedgers();
      console.log('ACTIVE_TRACKING_LEDGERS_VALID');
    } else {
      await validateLedgerFile(args.file);
      console.log('ACTIVE_TRACKING_LEDGER_VALID');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
