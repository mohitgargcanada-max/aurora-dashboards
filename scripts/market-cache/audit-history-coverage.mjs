import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from './config.mjs';

export const HISTORY_THRESHOLDS = Object.freeze({
  preferred: 1500,
  fiveYear: 1260,
  threeYear: 756,
  twoYear: 504,
});

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const MARKET_CONFIG = Object.freeze({
  us: {
    cacheRoot: 'markets/us/dashboard/cache/us/ohlcv',
    scanPath: 'markets/us/dashboard/data/us-full-dashboard-scan.json',
    reports: [
      'markets/us/dashboard/data/us-daily-refresh-report.json',
      'markets/us/dashboard/data/us-history-repair-report.json',
      'markets/us/dashboard/data/us-refresh-or-repair-report.json',
      'markets/us/dashboard/data/us-dashboard-state.json',
    ],
    lists: {
      weekly_universe: ['weekly_universe'],
      rsle: ['rsle_top_20'],
      developing_watchlist: ['developing_watchlist', 'developing_watchlist_next_20'],
    },
    myhMode: 'HISTORY_OK_52W_ONLY',
    myhEvidence: 'scan-universe.mjs uses price52Prox/S01_52W_HIGH; shared MYH approaching falls back to MYH_52W.',
  },
  india: {
    cacheRoot: 'markets/india/dashboard/cache/india/ohlcv',
    scanPath: 'markets/india/dashboard/data/india-full-dashboard-scan.json',
    reports: [
      'markets/india/dashboard/data/india-daily-refresh-report.json',
      'markets/india/dashboard/data/india-history-backfill-report.json',
      'markets/india/dashboard/data/india-dashboard-state.json',
    ],
    lists: {
      weekly_universe: ['weekly_universe'],
      rsle: ['rsle_top20', 'rsle_top_20'],
      developing_watchlist: ['developing_watchlist_20', 'developing_watchlist', 'developing_watchlist_next_20'],
    },
    myhMode: 'TRUE_2Y_3Y_5Y',
    myhEvidence: 'run-full-dashboard-scan.mjs defines MYH_5Y=1260, MYH_3Y=756, MYH_2Y=504 and reports MYH_HISTORY_INSUFFICIENT below 504.',
  },
  canada: {
    cacheRoot: 'markets/canada/dashboard/cache/canada/ohlcv',
    scanPath: 'markets/canada/dashboard/data/canada-full-dashboard-scan.json',
    reports: [
      'markets/canada/dashboard/data/canada-daily-refresh-report.json',
      'markets/canada/dashboard/data/canada-dashboard-state.json',
    ],
    lists: {
      weekly_universe: ['weekly_universe'],
      rsle: ['rsle_top_20'],
      developing_watchlist: ['developing_watchlist_next_20', 'developing_watchlist'],
    },
    myhMode: 'HISTORY_OK_52W_ONLY',
    myhEvidence: 'scan-engine.mjs sets myh_label=MYH_52W and myh_lookback_sessions=252.',
  },
});

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function cacheSymbolFromPath(relativePath) {
  return path.posix.basename(relativePath, '.json').replace(/^(NSE|BSE)__/, '');
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number);
}

function usableBar(bar) {
  if (!bar || typeof bar !== 'object') return false;
  const date = String(bar.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const open = bar.adjusted_open ?? bar.open;
  const high = bar.adjusted_high ?? bar.high;
  const low = bar.adjusted_low ?? bar.low;
  const close = bar.adjusted_close ?? bar.close;
  const volume = bar.adjusted_volume ?? bar.volume ?? 0;
  return [open, high, low, close, volume].every(finite);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function walkJsonFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkJsonFiles(root, fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push({
        fullPath,
        relativePath: path.relative(root, fullPath).replaceAll('\\', '/'),
      });
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function thresholdCounts(counts) {
  return {
    ge_1500: counts.filter((count) => count >= HISTORY_THRESHOLDS.preferred).length,
    ge_1260: counts.filter((count) => count >= HISTORY_THRESHOLDS.fiveYear).length,
    ge_756: counts.filter((count) => count >= HISTORY_THRESHOLDS.threeYear).length,
    ge_504: counts.filter((count) => count >= HISTORY_THRESHOLDS.twoYear).length,
    lt_504: counts.filter((count) => count > 0 && count < HISTORY_THRESHOLDS.twoYear).length,
    no_history: counts.filter((count) => count === 0).length,
  };
}

function inspectRecord(record, relativePath) {
  const bars = Array.isArray(record?.bars) ? record.bars.filter(usableBar) : [];
  const dates = bars.map((bar) => bar.date).sort();
  const symbol = normalizeSymbol(record?.symbol || cacheSymbolFromPath(relativePath));
  const exchange = normalizeSymbol(record?.exchange || relativePath.split('__')[0]);
  const provider = record?.provider || null;
  return {
    relative_path: relativePath,
    exchange,
    symbol,
    lookup_keys: [...new Set([symbol, `${exchange}|${symbol}`, `${exchange}__${symbol}`].filter(Boolean))],
    provider,
    first_date: dates[0] || null,
    last_date: dates.at(-1) || record?.data_as_of || null,
    usable_bars: bars.length,
  };
}

function summarizeRecords(records) {
  const counts = records.map((record) => record.usable_bars);
  const dates = records.flatMap((record) => [record.first_date, record.last_date]).filter(Boolean).sort();
  return {
    symbols: records.length,
    earliest_date: dates[0] || null,
    latest_date: dates.at(-1) || null,
    min_bars: counts.length ? Math.min(...counts) : null,
    median_bars: median(counts),
    max_bars: counts.length ? Math.max(...counts) : null,
    ...thresholdCounts(counts),
  };
}

function symbolFromRow(row) {
  return normalizeSymbol(row?.symbol || row?.ticker || row?.security || row?.name);
}

function pickScanList(scan, candidates) {
  for (const key of candidates) {
    if (Array.isArray(scan?.[key])) return { key, rows: scan[key] };
  }
  return { key: null, rows: [] };
}

function listCoverage(scan, config, records) {
  const bySymbol = new Map();
  for (const record of records) {
    const current = bySymbol.get(record.symbol);
    if (!current || record.usable_bars > current.usable_bars) bySymbol.set(record.symbol, record);
  }
  const result = {};
  for (const [label, keys] of Object.entries(config.lists)) {
    const { key, rows } = pickScanList(scan, keys);
    const matched = rows
      .map(symbolFromRow)
      .filter(Boolean)
      .map((symbol) => bySymbol.get(symbol))
      .filter(Boolean);
    result[label] = {
      scan_key: key,
      symbols: rows.length,
      cache_matches: matched.length,
      ...thresholdCounts(matched.map((record) => record.usable_bars)),
      missing_symbols: rows.map(symbolFromRow).filter(Boolean).filter((symbol) => !bySymbol.has(symbol)).slice(0, 20),
    };
  }
  return result;
}

async function reportStatus(relativePath) {
  const fullPath = path.resolve(repoRoot, relativePath);
  if (!await exists(fullPath)) return { path: relativePath, exists: false };
  const fileStat = await stat(fullPath);
  const json = await readJsonMaybe(fullPath);
  return {
    path: relativePath,
    exists: true,
    modified_at: fileStat.mtime.toISOString(),
    status: json?.status || json?.final_status || json?.run_status || null,
    generated_at: json?.generated_at || null,
    retrieved_at: json?.retrieved_at || null,
    expected_completed_session: json?.expected_completed_session || json?.completed_session || null,
    latest_data_as_of: json?.latest_data_as_of || json?.latest_stock_data_as_of || json?.data_as_of || null,
  };
}

export async function auditMarketHistoryCoverage(market, options = {}) {
  const config = MARKET_CONFIG[market];
  if (!config) throw new Error(`Unsupported market: ${market}`);
  const root = path.resolve(repoRoot, options.root || config.cacheRoot);
  const rootExists = await exists(root);
  const files = await walkJsonFiles(root);
  const records = [];
  for (const file of files) {
    const record = await readJsonMaybe(file.fullPath);
    if (record) records.push(inspectRecord(record, file.relativePath));
  }
  const scan = await readJsonMaybe(path.resolve(repoRoot, config.scanPath));
  return {
    market,
    capability_active_cache_root: config.cacheRoot,
    active_cache_root: root.replaceAll('\\', '/'),
    active_cache_root_exists: rootExists,
    scan_path: config.scanPath,
    scan_exists: Boolean(scan),
    myh_mode: config.myhMode,
    myh_evidence: config.myhEvidence,
    coverage: summarizeRecords(records),
    list_coverage: scan ? listCoverage(scan, config, records) : {},
    reports: await Promise.all(config.reports.map(reportStatus)),
    records,
  };
}

export async function auditHistoryCoverage({ market = 'all', root = null } = {}) {
  const markets = market === 'all' ? Object.keys(MARKET_CONFIG) : [market];
  if (root && markets.length !== 1) throw new Error('--root can only be used with a single --market');
  const results = {};
  for (const item of markets) {
    results[item] = await auditMarketHistoryCoverage(item, { root });
  }
  return results;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const result = await auditHistoryCoverage({
    market: args.market || 'all',
    root: args.root || null,
  });
  const output = args['include-records']
    ? result
    : Object.fromEntries(Object.entries(result).map(([market, item]) => [market, {
      market: item.market,
      active_cache_root: item.active_cache_root,
      active_cache_root_exists: item.active_cache_root_exists,
      scan_path: item.scan_path,
      scan_exists: item.scan_exists,
      myh_mode: item.myh_mode,
      myh_evidence: item.myh_evidence,
      coverage: item.coverage,
      list_coverage: item.list_coverage,
      reports: item.reports,
    }]));
  console.log(JSON.stringify(output, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
