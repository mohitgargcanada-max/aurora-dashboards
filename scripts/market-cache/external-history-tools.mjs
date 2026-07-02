import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { currentSourceCommit } from './build-manifest.mjs';
import {
  assertMarket,
  assertSafeRelativePath,
  assertSnapshot,
  manifestPath,
  shouldIncludeCacheFile,
  snapshotRoot,
} from './config.mjs';
import { hashFile } from './hash-file.mjs';
import { validateManifest } from './validate-manifest.mjs';
import { validateBackupRoot } from '../market-data-backup/validate-backup-paths.mjs';

export const DEFAULT_HISTORY_SEED_ROOT = 'C:\\Users\\mohit\\Downloads\\aurora-history-seed';
export const DEFAULT_HISTORY_CACHE_REPO = 'C:\\Users\\mohit\\Downloads\\aurora-market-cache';
export const DEFAULT_HISTORY_START = '2019-07-01';
export const DEFAULT_HISTORY_END = '2026-07-01';
export const DEFAULT_SAMPLE_SIZE = 10;
export const HISTORY_MARKETS = Object.freeze(['us', 'india', 'canada']);

const REQUIRED_PROVENANCE_FIELDS = [
  'schema_version',
  'market',
  'symbol',
  'provider',
  'fallback_label',
  'fallback_reason',
  'endpoint_or_source',
  'retrieved_at',
  'data_as_of',
  'currency',
  'adjustment_status',
  'delayed_or_live',
  'warnings',
  'bars',
];

const MARKET_META = Object.freeze({
  us: {
    currency: 'USD',
    fallback: [
      'YAHOO_FINANCE_PRIMARY',
      'EODHD_FALLBACK_ONLY_FOR_MISSING_STALE_INCOMPLETE_UNSUPPORTED_FAILED',
    ],
    sample: [
      { exchange: 'NASDAQ', symbol: 'AAPL' },
      { exchange: 'NASDAQ', symbol: 'MSFT' },
      { exchange: 'NASDAQ', symbol: 'NVDA' },
      { exchange: 'NASDAQ', symbol: 'AMZN' },
      { exchange: 'NASDAQ', symbol: 'GOOGL' },
      { exchange: 'NYSE', symbol: 'BRK-B' },
      { exchange: 'NYSE', symbol: 'JPM' },
      { exchange: 'NYSE', symbol: 'V' },
      { exchange: 'NYSE', symbol: 'LLY' },
      { exchange: 'NYSE', symbol: 'XOM' },
    ],
  },
  india: {
    currency: 'INR',
    fallback: [
      'NSE_BSE_OFFICIAL_PRIMARY',
      'TAPETIDE_IF_OFFICIAL_INCOMPLETE_OR_BLOCKED',
      'YAHOO_NS_BO_FALLBACK',
      'EODHD_LAST_SUPPORTED_LISTINGS_ONLY',
    ],
    sample: [
      { exchange: 'NSE', symbol: 'RELIANCE' },
      { exchange: 'NSE', symbol: 'TCS' },
      { exchange: 'NSE', symbol: 'HDFCBANK' },
      { exchange: 'NSE', symbol: 'INFY' },
      { exchange: 'NSE', symbol: 'ICICIBANK' },
      { exchange: 'NSE', symbol: 'SBIN' },
      { exchange: 'NSE', symbol: 'BHARTIARTL' },
      { exchange: 'NSE', symbol: 'ITC' },
      { exchange: 'NSE', symbol: 'LT' },
      { exchange: 'NSE', symbol: 'AXISBANK' },
    ],
  },
  canada: {
    currency: 'CAD',
    fallback: [
      'YAHOO_TO_V_PRIMARY',
      'EODHD_FALLBACK_ONLY_FOR_MISSING_STALE_INCOMPLETE_UNSUPPORTED_FAILED',
    ],
    sample: [
      { exchange: 'TSX', symbol: 'RY', provider_symbol: 'RY.TO' },
      { exchange: 'TSX', symbol: 'SHOP', provider_symbol: 'SHOP.TO' },
      { exchange: 'TSX', symbol: 'TD', provider_symbol: 'TD.TO' },
      { exchange: 'TSX', symbol: 'BNS', provider_symbol: 'BNS.TO' },
      { exchange: 'TSX', symbol: 'ENB', provider_symbol: 'ENB.TO' },
      { exchange: 'TSX', symbol: 'CNQ', provider_symbol: 'CNQ.TO' },
      { exchange: 'TSX', symbol: 'CNR', provider_symbol: 'CNR.TO' },
      { exchange: 'TSX', symbol: 'CP', provider_symbol: 'CP.TO' },
      { exchange: 'TSX', symbol: 'BAM', provider_symbol: 'BAM.TO' },
      { exchange: 'TSX', symbol: 'WCN', provider_symbol: 'WCN.TO' },
    ],
  },
});

function isInsidePath(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new Error(`${label} must be YYYY-MM-DD`);
  return value;
}

export function marketsFromOption(market) {
  if (market === 'all') return [...HISTORY_MARKETS];
  return [assertMarket(market)];
}

export function marketHistoryRoot(root, market) {
  const resolved = path.resolve(root || DEFAULT_HISTORY_SEED_ROOT);
  return path.basename(resolved).toLowerCase() === 'ohlcv'
    ? resolved
    : path.join(resolved, market, 'ohlcv');
}

export function assertExternalRoot(candidateRoot, label, sourceRoot = process.cwd()) {
  const resolved = path.resolve(candidateRoot);
  if (!path.isAbsolute(resolved)) throw new Error(`${label} must be absolute`);
  if (isInsidePath(resolved, sourceRoot)) throw new Error(`${label} must be outside the source repository`);
  return resolved;
}

function assertNotPullRequestCi(env = process.env) {
  if (String(env.GITHUB_EVENT_NAME || '').toLowerCase() === 'pull_request') {
    throw new Error('External history fetch/package tooling is disabled on pull_request CI');
  }
}

function providerSymbolFor(item, market, provider) {
  const symbol = String(item.provider_symbol || item.symbol || '').trim();
  const exchange = String(item.exchange || '').toUpperCase();
  if (market === 'india') {
    if (provider === 'EODHD') return `${symbol}.${exchange === 'BSE' ? 'BSE' : 'NSE'}`;
    if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return symbol;
    return `${symbol}${exchange === 'BSE' ? '.BO' : '.NS'}`;
  }
  if (market === 'canada') {
    if (symbol.endsWith('.TO') || symbol.endsWith('.V')) return symbol;
    return `${symbol}${exchange === 'TSXV' ? '.V' : '.TO'}`;
  }
  if (provider === 'EODHD') return `${symbol.replace('-', '.')}.US`;
  return symbol;
}

function normalizedSymbol(raw, market) {
  let symbol = String(raw || '').trim().toUpperCase();
  if (market === 'india') symbol = symbol.replace(/\.(NS|BO)$/i, '');
  if (market === 'canada') symbol = symbol.replace(/\.(TO|V)$/i, '');
  return symbol.replace(/[^A-Z0-9._-]/g, '_');
}

function normalizedFileName(record) {
  const exchange = String(record.exchange || record.market || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  const symbol = normalizedSymbol(record.symbol, record.market);
  return `${exchange}__${symbol}.json`;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeBar(row, provider = null) {
  const date = String(row?.date || '').slice(0, 10);
  const open = finiteNumber(row?.open);
  const high = finiteNumber(row?.high);
  const low = finiteNumber(row?.low);
  const close = finiteNumber(row?.close ?? row?.adjusted_close ?? row?.adjustedClose);
  const volume = finiteNumber(row?.volume) ?? 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (![open, high, low, close, volume].every(Number.isFinite)) return null;
  return {
    date,
    open,
    high,
    low,
    close,
    volume,
    ...(provider ? { provider } : {}),
  };
}

function parseYahooChart(payload, provider) {
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  const adjclose = result?.indicators?.adjclose?.[0]?.adjclose || [];
  return (result?.timestamp || [])
    .map((time, index) => normalizeBar({
      date: new Date(Number(time) * 1000).toISOString().slice(0, 10),
      open: quote.open?.[index],
      high: quote.high?.[index],
      low: quote.low?.[index],
      close: adjclose[index] ?? quote.close?.[index],
      volume: quote.volume?.[index],
    }, provider))
    .filter(Boolean);
}

function parseEodhdRows(rows, provider) {
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeBar({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.adjusted_close ?? row.adjustedClose ?? row.close,
    volume: row.volume,
  }, provider)).filter(Boolean);
}

function uniqueSortedBars(bars) {
  const byDate = new Map();
  for (const bar of bars.sort((a, b) => a.date.localeCompare(b.date))) byDate.set(bar.date, bar);
  return [...byDate.values()];
}

async function requestJson(url, fetcher, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 AURORA/7Y-seed' },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function tokenFromEnv(env, names) {
  for (const name of names) {
    if (env[name]) return String(env[name]);
  }
  return '';
}

function eodhdToken(env = process.env) {
  return tokenFromEnv(env, ['EODHD_API_TOKEN', 'EODHD_API_KEY', 'EODHD_TOKEN', 'EOD_API_KEY']);
}

function tapetideTemplate(env = process.env) {
  return env.TAPETIDE_HISTORY_URL_TEMPLATE || env.AURORA_TAPETIDE_HISTORY_URL_TEMPLATE || '';
}

function templateUrl(template, params) {
  let output = template;
  for (const [key, value] of Object.entries(params)) {
    output = output.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
  }
  return output;
}

async function fetchYahoo(item, market, { start, end, fetcher, timeoutMs }) {
  const providerSymbol = providerSymbolFor(item, market, 'YAHOO_FINANCE');
  const period1 = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000);
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(providerSymbol)}`;
  const payload = await requestJson(`${endpoint}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`, fetcher, timeoutMs);
  if (payload?.chart?.error) throw new Error(`YAHOO_ERROR_${payload.chart.error.code || 'UNKNOWN'}`);
  return {
    provider: 'YAHOO_FINANCE',
    provider_symbol: providerSymbol,
    endpoint_or_source: endpoint,
    fallback_label: market === 'us' ? 'YAHOO_PRIMARY' : 'YAHOO_FALLBACK',
    fallback_reason: market === 'us' || market === 'canada' ? 'FREE_PRIMARY' : 'OFFICIAL_OR_TAPETIDE_INCOMPLETE_OR_UNAVAILABLE',
    adjustment_status: 'ADJUSTED_CLOSE_USED_WHEN_AVAILABLE',
    bars: uniqueSortedBars(parseYahooChart(payload, 'YAHOO_FINANCE')).filter((bar) => bar.date >= start && bar.date <= end),
  };
}

async function fetchEodhd(item, market, { start, end, env, fetcher, timeoutMs, warnings = [] }) {
  const token = eodhdToken(env);
  if (!token) throw new Error('EODHD_TOKEN_MISSING');
  const providerSymbol = providerSymbolFor(item, market, 'EODHD');
  const endpoint = `https://eodhd.com/api/eod/${encodeURIComponent(providerSymbol)}`;
  const url = `${endpoint}?from=${start}&to=${end}&period=d&fmt=json&api_token=${encodeURIComponent(token)}`;
  const payload = await requestJson(url, fetcher, timeoutMs);
  return {
    provider: 'EODHD',
    provider_symbol: providerSymbol,
    endpoint_or_source: endpoint,
    fallback_label: 'EODHD_FALLBACK',
    fallback_reason: 'FREE_OR_TAPETIDE_OR_YAHOO_MISSING_STALE_INCOMPLETE_UNSUPPORTED_OR_FAILED',
    adjustment_status: 'ADJUSTED_CLOSE_USED_WHEN_AVAILABLE',
    warnings,
    bars: uniqueSortedBars(parseEodhdRows(payload, 'EODHD')).filter((bar) => bar.date >= start && bar.date <= end),
  };
}

async function fetchTapetide(item, market, { start, end, env, fetcher, timeoutMs }) {
  if (market !== 'india') throw new Error('TAPETIDE_ONLY_SUPPORTED_FOR_INDIA');
  const template = tapetideTemplate(env);
  if (!template) throw new Error('TAPETIDE_HISTORY_URL_TEMPLATE_MISSING');
  const providerSymbol = providerSymbolFor(item, market, 'TAPETIDE');
  const url = templateUrl(template, {
    symbol: providerSymbol,
    canonical_symbol: item.symbol,
    exchange: item.exchange || 'NSE',
    start,
    end,
  });
  const payload = await requestJson(url, fetcher, timeoutMs);
  const bars = Array.isArray(payload) ? payload : payload?.bars || payload?.data || [];
  return {
    provider: 'TAPETIDE',
    provider_symbol: providerSymbol,
    endpoint_or_source: 'TAPETIDE_HISTORY_URL_TEMPLATE',
    fallback_label: 'TAPETIDE_FALLBACK',
    fallback_reason: 'OFFICIAL_HISTORY_INCOMPLETE_OR_BLOCKED',
    adjustment_status: 'TAPETIDE_ADJUSTMENT_STATUS_FROM_PROVIDER',
    bars: uniqueSortedBars(bars.map((row) => normalizeBar(row, 'TAPETIDE')).filter(Boolean)).filter((bar) => bar.date >= start && bar.date <= end),
  };
}

async function fetchOfficialIndia(item, { start, end, env }) {
  const root = env.AURORA_INDIA_OFFICIAL_HISTORY_ROOT || '';
  if (!root) throw new Error('AURORA_INDIA_OFFICIAL_HISTORY_ROOT_MISSING');
  const candidate = path.join(root, normalizedFileName({ market: 'india', exchange: item.exchange || 'NSE', symbol: item.symbol }));
  const record = JSON.parse(await readFile(candidate, 'utf8'));
  return {
    provider: 'NSE_BSE_OFFICIAL',
    provider_symbol: item.symbol,
    endpoint_or_source: candidate.replaceAll('\\', '/'),
    fallback_label: 'OFFICIAL_VERIFIED',
    fallback_reason: 'OFFICIAL_PRIMARY',
    adjustment_status: record.adjustment_status || 'UNADJUSTED_OR_ADJUSTED_EXPLICIT',
    bars: uniqueSortedBars((record.bars || []).map((row) => normalizeBar(row, 'NSE_BSE_OFFICIAL')).filter(Boolean)).filter((bar) => bar.date >= start && bar.date <= end),
  };
}

function viableBars(candidate, end) {
  if (!candidate?.bars?.length) return { ok: false, reason: 'NO_USABLE_BARS' };
  if (candidate.bars.at(-1).date < end) return { ok: false, reason: 'STALE_COMPLETED_SESSION' };
  return { ok: true, reason: 'OK' };
}

async function fetchHistoryForItem(item, market, options) {
  const attempts = [];
  const routes = market === 'india'
    ? [
        ['NSE_BSE_OFFICIAL', () => fetchOfficialIndia(item, options)],
        ['TAPETIDE', () => fetchTapetide(item, market, options)],
        ['YAHOO_FINANCE', () => fetchYahoo(item, market, options)],
        ['EODHD', () => fetchEodhd(item, market, { ...options, warnings: attempts.map((attempt) => `${attempt.provider}:${attempt.status}:${attempt.reason || attempt.warning || ''}`) })],
      ]
    : [
        ['YAHOO_FINANCE', () => fetchYahoo(item, market, options)],
        ['EODHD', () => fetchEodhd(item, market, { ...options, warnings: attempts.map((attempt) => `${attempt.provider}:${attempt.status}:${attempt.reason || attempt.warning || ''}`) })],
      ];

  for (const [provider, call] of routes) {
    try {
      const candidate = await call();
      const usable = viableBars(candidate, options.end);
      attempts.push({ provider, status: usable.ok ? 'OK' : 'UNUSABLE', bars: candidate.bars.length, data_as_of: candidate.bars.at(-1)?.date || null, reason: usable.reason });
      if (!usable.ok) continue;
      return normalizedHistoryRecord(item, market, candidate, attempts);
    } catch (error) {
      attempts.push({ provider, status: 'FAILED', warning: error.message });
    }
  }
  throw new Error(`${market}:${item.symbol}: no provider returned usable history; attempts=${JSON.stringify(attempts.slice(0, 8))}`);
}

function normalizedHistoryRecord(item, market, candidate, attempts) {
  const exchange = String(item.exchange || (market === 'us' ? 'US' : market)).toUpperCase();
  const symbol = normalizedSymbol(item.symbol, market);
  return {
    schema_version: 'aurora_history_v1',
    market,
    exchange,
    symbol,
    provider: candidate.provider,
    provider_symbol: candidate.provider_symbol || item.provider_symbol || item.symbol,
    provider_route: attempts.map((attempt) => attempt.provider),
    fallback_label: candidate.fallback_label,
    fallback_reason: candidate.fallback_reason,
    endpoint_or_source: candidate.endpoint_or_source,
    retrieved_at: new Date().toISOString(),
    data_as_of: candidate.bars.at(-1)?.date || null,
    currency: MARKET_META[market].currency,
    adjustment_status: candidate.adjustment_status,
    delayed_or_live: 'EOD',
    warnings: [...(candidate.warnings || []), ...attempts.filter((attempt) => attempt.status !== 'OK').map((attempt) => `${attempt.provider}:${attempt.warning || attempt.reason}`)],
    bars: candidate.bars,
  };
}

async function walkJsonFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkJsonFiles(root, fullPath));
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      const relativePath = path.relative(root, fullPath).replaceAll('\\', '/');
      if (shouldIncludeCacheFile(relativePath)) files.push({ fullPath, relativePath });
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function readUniverseFromActiveCache(market, sourceRoot) {
  const roots = {
    us: path.join(sourceRoot, 'markets/us/dashboard/cache/us/ohlcv'),
    india: path.join(sourceRoot, 'markets/india/dashboard/cache/india/ohlcv'),
    canada: path.join(sourceRoot, 'markets/canada/dashboard/config/canada-universe-seed.json'),
  };
  if (market === 'canada') {
    try {
      const rows = JSON.parse(await readFile(roots.canada, 'utf8'));
      return rows.map((row) => ({ exchange: row.exchange || 'TSX', symbol: normalizedSymbol(row.symbol, 'canada'), provider_symbol: row.symbol }));
    } catch {
      return MARKET_META.canada.sample;
    }
  }
  const files = await walkJsonFiles(roots[market]);
  if (!files.length) return MARKET_META[market].sample;
  return files.map((file) => {
    const base = path.basename(file.relativePath, '.json');
    const [prefix, ...rest] = base.includes('__') ? base.split('__') : ['', base];
    const symbol = rest.join('__') || base;
    return {
      exchange: prefix || (market === 'us' ? 'US' : 'NSE'),
      symbol: normalizedSymbol(symbol, market),
    };
  });
}

function outputPlanForMarket({ market, root, universe, selected, start, end, full, apply }) {
  return {
    market,
    mode: apply ? 'apply' : 'dry-run',
    full,
    output_root: root.replaceAll('\\', '/'),
    date_range: { start, end },
    selected_symbols: selected.length,
    universe_symbols: universe.length,
    route_order: MARKET_META[market].fallback,
    sample: selected.slice(0, 10).map((item) => `${item.exchange || market}:${item.symbol}`),
  };
}

export async function planFetch7yHistoryExternal(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || process.cwd());
  const markets = marketsFromOption(options.market || 'all');
  const rootBase = path.resolve(options.root || DEFAULT_HISTORY_SEED_ROOT);
  const start = assertDate(options.start || DEFAULT_HISTORY_START, '--start');
  const end = assertDate(options.end || DEFAULT_HISTORY_END, '--end');
  if (start > end) throw new Error('--start must be on or before --end');
  const full = options.full === true;
  const apply = options.apply === true;
  if (full && !apply) throw new Error('Full external history fetch requires --full --apply');
  if (apply) assertNotPullRequestCi(options.env || process.env);
  const sampleSize = Number(options.sampleSize || DEFAULT_SAMPLE_SIZE);
  if (!full && (!Number.isInteger(sampleSize) || sampleSize < 1)) throw new Error('--sample-size must be a positive integer');

  const marketPlans = [];
  for (const market of markets) {
    const outputRoot = assertExternalRoot(marketHistoryRoot(rootBase, market), `${market} output root`, sourceRoot);
    const universe = await readUniverseFromActiveCache(market, sourceRoot);
    const selected = full ? universe : MARKET_META[market].sample.slice(0, sampleSize);
    marketPlans.push(outputPlanForMarket({ market, root: outputRoot, universe, selected, start, end, full, apply }));
  }
  return { mode: apply ? 'apply' : 'dry-run', applied: false, market: options.market || 'all', markets: marketPlans };
}

export async function fetch7yHistoryExternal(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || process.cwd());
  const env = options.env || process.env;
  const plan = await planFetch7yHistoryExternal({ ...options, sourceRoot, env });
  if (plan.mode !== 'apply') return plan;

  const start = options.start || DEFAULT_HISTORY_START;
  const end = options.end || DEFAULT_HISTORY_END;
  const fetcher = options.fetcher || fetch;
  const timeoutMs = Number(options.timeoutMs || 30_000);
  const summaries = [];
  for (const marketPlan of plan.markets) {
    const market = marketPlan.market;
    const outputRoot = marketPlan.output_root;
    await mkdir(outputRoot, { recursive: true });
    const universe = await readUniverseFromActiveCache(market, sourceRoot);
    const selected = marketPlan.full ? universe : MARKET_META[market].sample.slice(0, marketPlan.selected_symbols);
    const rows = [];
    const warnings = [];
    for (const item of selected) {
      try {
        const record = await fetchHistoryForItem(item, market, { start, end, env, fetcher, timeoutMs });
        const outputFile = path.join(outputRoot, normalizedFileName(record));
        await mkdir(path.dirname(outputFile), { recursive: true });
        await writeFile(outputFile, `${JSON.stringify(record, null, 2)}\n`);
        rows.push({ symbol: record.symbol, provider: record.provider, data_as_of: record.data_as_of, output: outputFile.replaceAll('\\', '/') });
      } catch (error) {
        warnings.push({ symbol: item.symbol, warning: error.message });
      }
    }
    summaries.push({ market, requested: selected.length, written: rows.length, failed: warnings.length, provider_counts: countBy(rows, 'provider'), warnings: warnings.slice(0, 50), rows: rows.slice(0, 20) });
  }
  return { ...plan, applied: true, summaries };
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = row?.[key] || 'UNKNOWN';
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function validBar(row) {
  const open = finiteNumber(row?.open);
  const high = finiteNumber(row?.high);
  const low = finiteNumber(row?.low);
  const close = finiteNumber(row?.close);
  const volume = finiteNumber(row?.volume);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || ''))) return false;
  if (![open, high, low, close, volume].every(Number.isFinite)) return false;
  return high >= Math.max(open, close, low) && low <= Math.min(open, close, high) && volume >= 0;
}

export async function analyzeHistoryFile(file, { expectedSession = null } = {}) {
  const record = JSON.parse(await readFile(file.fullPath, 'utf8'));
  const errors = [];
  for (const field of REQUIRED_PROVENANCE_FIELDS) {
    if (!(field in record)) errors.push(`${file.relativePath}:MISSING_${field}`);
  }
  const bars = Array.isArray(record.bars) ? record.bars : [];
  const providers = new Set(record.provider ? [String(record.provider)] : []);
  const seenDates = new Set();
  let previousDate = null;
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const date = String(bar?.date || '');
    const barProvider = bar?.provider || bar?.source_provider;
    if (barProvider) providers.add(String(barProvider));
    if (!validBar(bar)) errors.push(`${file.relativePath}:bar[${index}]:INVALID_OHLCV`);
    if (seenDates.has(date)) errors.push(`${file.relativePath}:bar[${index}]:DUPLICATE_DATE`);
    if (previousDate && date < previousDate) errors.push(`${file.relativePath}:bar[${index}]:UNSORTED_DATE`);
    seenDates.add(date);
    previousDate = date;
  }
  if (providers.size > 1) errors.push(`${file.relativePath}:MIXED_PROVIDER_SERIES`);
  if (!bars.length) errors.push(`${file.relativePath}:NO_USABLE_HISTORY`);
  if (expectedSession && bars.at(-1)?.date !== expectedSession) errors.push(`${file.relativePath}:LATEST_SESSION_MISMATCH`);

  return {
    relative_path: file.relativePath,
    market: record.market || null,
    exchange: record.exchange || null,
    symbol: record.symbol || null,
    provider: record.provider || null,
    fallback_label: record.fallback_label || null,
    fallback_reason: record.fallback_reason || null,
    first_date: bars[0]?.date || null,
    last_date: bars.at(-1)?.date || null,
    row_count: bars.length,
    sha256: await hashFile(file.fullPath),
    bytes: (await stat(file.fullPath)).size,
    errors,
  };
}

function summarizeValidation(records) {
  const counts = records.map((record) => record.row_count).sort((a, b) => a - b);
  const dates = records.flatMap((record) => [record.first_date, record.last_date]).filter(Boolean).sort();
  return {
    symbols: records.length,
    earliest: dates[0] || null,
    latest: dates.at(-1) || null,
    median: counts.length ? counts[Math.floor(counts.length / 2)] : null,
    max: counts.length ? counts.at(-1) : null,
    ge_1500: records.filter((record) => record.row_count >= 1500).length,
    ge_1260: records.filter((record) => record.row_count >= 1260).length,
    ge_756: records.filter((record) => record.row_count >= 756).length,
    ge_504: records.filter((record) => record.row_count >= 504).length,
    lt_504: records.filter((record) => record.row_count < 504).length,
    provider_counts: countBy(records, 'provider'),
    fallback_counts: countBy(records, 'fallback_label'),
    top_missing_short_symbols: [...records].sort((a, b) => a.row_count - b.row_count).slice(0, 20).map((record) => ({ symbol: record.symbol, rows: record.row_count, last_date: record.last_date })),
  };
}

export async function validateHistoryPackage(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || process.cwd());
  const markets = marketsFromOption(options.market || 'all');
  const rootBase = path.resolve(options.root || DEFAULT_HISTORY_SEED_ROOT);
  const result = { ok: true, market: options.market || 'all', markets: {}, errors: [] };
  for (const market of markets) {
    const root = assertExternalRoot(marketHistoryRoot(rootBase, market), `${market} history root`, sourceRoot);
    const files = await walkJsonFiles(root);
    const records = [];
    for (const file of files) records.push(await analyzeHistoryFile(file, { expectedSession: options.expectedSession || null }));
    const errors = records.flatMap((record) => record.errors);
    if (!records.length) errors.push(`${market}:NO_HISTORY_FILES`);
    result.markets[market] = {
      root: root.replaceAll('\\', '/'),
      ok: errors.length === 0,
      coverage: summarizeValidation(records),
      files: records,
      errors,
    };
    result.errors.push(...errors);
  }
  result.ok = result.errors.length === 0;
  return result;
}

function packagePlan({ validation, market, cacheRepo, snapshot, snapshotId, sourceCommit }) {
  const root = validation.root;
  const files = validation.files.map((file) => ({ path: file.relative_path, bytes: file.bytes, sha256: file.sha256 }));
  const manifest = {
    schema_version: '1.0',
    market,
    snapshot_type: snapshot,
    snapshot_id: snapshotId,
    created_at: new Date().toISOString(),
    source_repo: 'aurora-dashboards',
    source_commit: sourceCommit,
    data_as_of: validation.coverage.latest,
    source_cache_path: root,
    coverage: validation.coverage,
    file_count: files.length,
    total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    warnings: [],
  };
  const snapshotPath = snapshotRoot(cacheRepo, market, snapshot, snapshotId);
  const manifestFile = manifestPath(cacheRepo, market);
  return {
    manifest,
    plan: [
      ...files.map((file) => ({ op: 'copy', from: path.join(root, file.path), to: path.join(snapshotPath, file.path) })),
      { op: 'write-manifest', to: manifestFile },
    ],
    snapshotPath,
    manifestFile,
  };
}

export async function packageHistorySnapshot(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || process.cwd());
  const markets = marketsFromOption(options.market || 'all');
  const cacheRepo = path.resolve(options.cacheRepo || DEFAULT_HISTORY_CACHE_REPO);
  const backupRootValidation = validateBackupRoot(cacheRepo, { sourceRoot });
  if (!backupRootValidation.ok) throw new Error(`Invalid cache repo root: ${backupRootValidation.reason}`);
  const snapshot = options.snapshot || 'latest';
  const snapshotId = options.snapshotId || (snapshot === 'latest' ? 'latest' : undefined);
  assertSnapshot(snapshot, snapshotId);
  if (options.apply) assertNotPullRequestCi(options.env || process.env);

  const validation = await validateHistoryPackage({ market: options.market || 'all', root: options.root, sourceRoot, expectedSession: options.expectedSession });
  if (!validation.ok) throw new Error(`History package validation failed: ${validation.errors.slice(0, 8).join('; ')}`);

  const sourceCommit = options.sourceCommit || currentSourceCommit(sourceRoot);
  const marketResults = {};
  for (const market of markets) {
    marketResults[market] = packagePlan({ validation: validation.markets[market], market, cacheRepo, snapshot, snapshotId, sourceCommit });
  }
  const plan = Object.fromEntries(Object.entries(marketResults).map(([market, value]) => [market, value.plan]));
  if (!options.apply) return { mode: 'dry-run', applied: false, validation, plan, manifests: Object.fromEntries(Object.entries(marketResults).map(([market, value]) => [market, value.manifest])) };

  for (const value of Object.values(marketResults)) {
    for (const step of value.plan.filter((item) => item.op === 'copy')) {
      const relativePath = assertSafeRelativePath(path.relative(value.snapshotPath, step.to).replaceAll('\\', '/'));
      await mkdir(path.dirname(path.join(value.snapshotPath, relativePath)), { recursive: true });
      await copyFile(step.from, path.join(value.snapshotPath, relativePath));
    }
    await mkdir(path.dirname(value.manifestFile), { recursive: true });
    await writeFile(value.manifestFile, `${JSON.stringify(value.manifest, null, 2)}\n`);
    await validateManifest(value.manifest, value.snapshotPath);
  }
  return { mode: 'apply', applied: true, validation, plan, manifests: Object.fromEntries(Object.entries(marketResults).map(([market, value]) => [market, value.manifestFile.replaceAll('\\', '/')])) };
}
