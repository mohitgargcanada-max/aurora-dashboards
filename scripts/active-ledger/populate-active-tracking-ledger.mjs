import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FINAL_BUCKETS,
  FOMO_LABELS,
  SUPPORTED_MARKETS,
  validateActiveTrackingLedger,
} from './validate-active-tracking-ledger.mjs';

const LIST_ALIASES = Object.freeze({
  WEEKLY_UNIVERSE: ['weeklyuniverse'],
  WEEKLY_FOCUS: ['weeklyfocus'],
  DAILY_TOP_1_4: ['dailytop14', 'dailytop'],
  RSLE_TOP_20: ['rsletop20', 'rsletop', 'top20tactical', 'top20'],
  RSLE_DEVELOPING_21_40: ['rsledeveloping2140', 'developingwatchlist', 'developingwatchlist20', 'developingwatchlistnext20', 'developing2140', 'developing'],
});

const EXECUTION_BUCKETS = new Set(['TRADE_READY', 'TRIGGER_READY', 'EARLY_ENTRY_WATCH', 'PULLBACK_WATCH']);
const FINAL_BUCKET_SET = new Set(FINAL_BUCKETS);
const FOMO_LABEL_SET = new Set(FOMO_LABELS);
const DATA_REPAIR_PATTERN = /DATA_REPAIR|MISSING|INSUFFICIENT|NOT_CALCULATED|NOT_AVAILABLE/i;
const REVIEW_TEXT_FIELDS = Object.freeze([
  'latest_axm21_label',
  'latest_axm50_label',
  'latest_px_label',
  'latest_aurora_x_state',
  've2_label',
  've2_signature_label',
]);

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hasPathTraversal(filePath) {
  return String(filePath).split(/[\\/]+/).includes('..') || String(filePath).includes('\0');
}

function readField(row, names) {
  for (const name of names) {
    const value = name.split('.').reduce((current, key) => current?.[key], row);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function textField(row, names, fallback = '') {
  const value = readField(row, names);
  return value === null ? fallback : String(value);
}

function numberField(row, names) {
  const value = readField(row, names);
  if (value === null) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function upperField(row, names) {
  const value = readField(row, names);
  return value === null ? null : String(value).trim().toUpperCase();
}

export function extractLifecycleCandidates(scan) {
  const buckets = new Map(Object.keys(LIST_ALIASES).map(list => [list, []]));
  const aliases = new Map(Object.entries(LIST_ALIASES).flatMap(([list, keys]) => keys.map(key => [key, list])));

  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const list = aliases.get(normalizeKey(key));
      if (list && Array.isArray(child)) {
        buckets.get(list).push(...child);
      } else {
        visit(child);
      }
    }
  }

  visit(scan);
  return [...buckets.entries()].flatMap(([sourceList, rows]) => rows.map(row => ({ sourceList, row })));
}

function candidateBucket(row) {
  return upperField(row, ['final_bucket', 'current_bucket', 'bucket', 'aurora_bucket']);
}

function candidateSymbol(row) {
  return upperField(row, ['symbol', 'ticker']);
}

function hasDataIssue(row) {
  const haystack = [
    readField(row, ['caution']),
    readField(row, ['rejection_reason']),
    readField(row, ['data_status']),
    readField(row, ['next_condition']),
    ...(Array.isArray(row.failed_gates) ? row.failed_gates : []),
  ].filter(Boolean).join(' ');
  return DATA_REPAIR_PATTERN.test(haystack);
}

function lifecycleFor({ bucket, sourceList, row, existing }) {
  if (existing && existing.lifecycle_status !== 'EXITED') return existing.lifecycle_status;
  if (sourceList === 'RSLE_DEVELOPING_21_40' && !EXECUTION_BUCKETS.has(bucket)) return 'WATCH_ONLY';
  if (EXECUTION_BUCKETS.has(bucket)) return 'ACTIVE';
  if (bucket === 'RSNH_WATCH_ONLY') return 'WATCH_ONLY';
  if (bucket === 'NO_CHASE') return 'EXTENDED_REVIEW';
  if (bucket === 'PROTECT_PROFIT_REVIEW') return 'PROTECT_PROFIT_REVIEW';
  if (bucket === 'REPAIR_WATCH') return hasDataIssue(row) ? 'DATA_REPAIR' : 'WATCH_ONLY';
  if (bucket === 'AVOID_FRESH_LONG') return existing ? 'SELL_RISK_REVIEW' : 'WATCH_ONLY';
  return 'WATCH_ONLY';
}

function extensionFor(row, bucket) {
  const labels = REVIEW_TEXT_FIELDS.map(field => textField(row, [field, field.replace(/^latest_/, '')])).join(' ');
  if (bucket === 'PROTECT_PROFIT_REVIEW') return 'PROTECT_PROFIT_REVIEW';
  if (bucket === 'NO_CHASE' || /PX_NO_CHASE|PX_HARD_WARNING|AXM21_HOT|AXM21_EXTREME|AXM50_VERY_EXTENDED|AXM50_EXTREME|VE2_CLIMAX_VOLUME_WARNING/.test(labels)) return 'NO_CHASE_REVIEW';
  if (/AURORA_X2_SELL_RISK_REVIEW|AURORA_X3_HARD_BLOCK|21EMA_BREAK_WARNING|50SMA_SERIOUS_WARNING|FAILED_BREAKOUT|THESIS_STOP_BREACH/.test(labels)) return 'SELL_RISK_REVIEW';
  if (hasDataIssue(row)) return 'DATA_REPAIR';
  return 'NORMAL';
}

function fomoLabel(row) {
  const label = upperField(row, ['latest_market_fomo_label', 'market_fomo_label', 'fomo_label']);
  return FOMO_LABEL_SET.has(label) ? label : 'UNKNOWN';
}

function fomoScore(row) {
  return numberField(row, ['latest_market_fomo_score', 'market_fomo_score', 'fomo_score']);
}

function baseEntry({ market, sourceList, row, asOf, bucket, existing = null }) {
  const latestClose = numberField(row, ['latest_close', 'close', 'price']);
  const existingHigh = existing?.highest_close_since_publish;
  const highest = Number.isFinite(existingHigh) && Number.isFinite(latestClose)
    ? Math.max(existingHigh, latestClose)
    : Number.isFinite(existingHigh) ? existingHigh : latestClose;

  return {
    symbol: candidateSymbol(row),
    market,
    first_published_date: existing?.first_published_date ?? asOf,
    first_published_list: existing?.first_published_list ?? sourceList,
    theme: textField(row, ['theme', 'aurora_theme', 'theme_cluster', 'sector', 'gics_sector'], existing?.theme ?? ''),
    initial_bucket: existing?.initial_bucket ?? bucket,
    current_bucket: bucket,
    entry_reference: numberField(row, ['entry_reference', 'trigger', 'trigger_price', 'entry_price', 'close', 'price']) ?? existing?.entry_reference ?? null,
    entry_stop: numberField(row, ['entry_stop', 'stop', 'tactical_stop']) ?? existing?.entry_stop ?? null,
    thesis_stop: numberField(row, ['thesis_stop', 'structural_stop']) ?? existing?.thesis_stop ?? null,
    highest_close_since_publish: highest,
    latest_close: latestClose,
    latest_axm21_label: textField(row, ['latest_axm21_label', 'axm21_label', 'axm.axm21_label'], existing?.latest_axm21_label ?? ''),
    latest_axm50_label: textField(row, ['latest_axm50_label', 'axm50_label', 'axm.axm50_label'], existing?.latest_axm50_label ?? ''),
    latest_px_label: textField(row, ['latest_px_label', 'px_label', 'pbx_label'], existing?.latest_px_label ?? ''),
    latest_aurora_x_state: textField(row, ['latest_aurora_x_state', 'aurora_x_state'], existing?.latest_aurora_x_state ?? ''),
    latest_market_fomo_label: fomoLabel(row),
    latest_market_fomo_score: fomoScore(row),
    extension_status: extensionFor(row, bucket),
    lifecycle_status: lifecycleFor({ bucket, sourceList, row, existing }),
    last_review_date: asOf,
    exit_date: existing?.exit_date ?? null,
    exit_reason: existing?.exit_reason ?? null,
    notes: Array.isArray(existing?.notes) ? existing.notes : [],
  };
}

export function populateLedgerFromScan({ ledger, scan, market, asOf }) {
  validateActiveTrackingLedger(ledger);
  if (!SUPPORTED_MARKETS.includes(market)) throw new Error(`Unsupported market: ${market}`);
  if (ledger.market !== market) throw new Error(`Ledger market mismatch: ${ledger.market} !== ${market}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('--as-of must be YYYY-MM-DD');

  const report = { status: 'OK', added: 0, updated: 0, skipped: 0, skipped_reasons: {}, candidates: 0 };
  const next = { ...ledger, updated_at: asOf, entries: ledger.entries.map(entry => ({ ...entry, notes: [...entry.notes] })) };
  const candidates = extractLifecycleCandidates(scan);
  report.candidates = candidates.length;
  if (!candidates.length) report.status = 'NO_CANDIDATES_FOUND';

  const activeBySymbol = new Map();
  next.entries.forEach((entry, index) => {
    if (entry.lifecycle_status !== 'EXITED') activeBySymbol.set(entry.symbol.toUpperCase(), { entry, index });
  });

  for (const { sourceList, row } of candidates) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const symbol = candidateSymbol(row);
    const bucket = candidateBucket(row);
    if (!symbol) {
      report.skipped += 1;
      report.skipped_reasons.SKIPPED_MISSING_SYMBOL = (report.skipped_reasons.SKIPPED_MISSING_SYMBOL ?? 0) + 1;
      continue;
    }
    if (!FINAL_BUCKET_SET.has(bucket)) {
      report.skipped += 1;
      report.skipped_reasons.SKIPPED_INVALID_BUCKET = (report.skipped_reasons.SKIPPED_INVALID_BUCKET ?? 0) + 1;
      continue;
    }

    const active = activeBySymbol.get(symbol);
    const entry = baseEntry({ market, sourceList, row: { ...row, symbol }, asOf, bucket, existing: active?.entry });
    if (active) {
      next.entries[active.index] = entry;
      report.updated += 1;
    } else {
      next.entries.push(entry);
      activeBySymbol.set(symbol, { entry, index: next.entries.length - 1 });
      report.added += 1;
    }
  }

  validateActiveTrackingLedger(next);
  return { ledger: next, report };
}

function parseArgs(argv) {
  const args = { dryRun: true, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (['--market', '--ledger', '--scan-file', '--as-of'].includes(arg)) {
      args[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return args;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

export async function runPopulateCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.market || !args.ledger || !args.scanFile || !args.asOf) {
    throw new Error('Usage: node scripts/active-ledger/populate-active-tracking-ledger.mjs --market <us|india|canada> --ledger <ledger-json> --scan-file <scan-json> --as-of YYYY-MM-DD [--dry-run|--apply]');
  }
  if (!SUPPORTED_MARKETS.includes(args.market)) throw new Error(`Unsupported market: ${args.market}`);
  if (hasPathTraversal(args.ledger) || hasPathTraversal(args.scanFile)) throw new Error('Path traversal is not allowed');

  const ledgerPath = path.resolve(args.ledger);
  const scanPath = path.resolve(args.scanFile);
  const ledger = await readJson(ledgerPath, 'ledger JSON');
  const scan = await readJson(scanPath, 'scan JSON');
  const result = populateLedgerFromScan({ ledger, scan, market: args.market, asOf: args.asOf });

  if (args.apply) {
    validateActiveTrackingLedger(result.ledger);
    await writeFile(ledgerPath, `${JSON.stringify(result.ledger, null, 2)}\n`);
    validateActiveTrackingLedger(await readJson(ledgerPath, 'written ledger JSON'));
    result.report.mode = 'apply';
  } else {
    result.report.mode = 'dry-run';
  }

  console.log(JSON.stringify(result.report, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runPopulateCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
