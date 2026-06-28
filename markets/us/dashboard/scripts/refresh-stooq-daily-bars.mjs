import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveEodhdToken } from "./aurora-env.mjs";
import { latestCompletedNyseSession } from "./us-market-calendar.mjs";
import { buildProviderAliasMap, providerSymbolLookupKey, resolveProviderSymbol } from "./us-universe-reference.mjs";
import {
  CACHE_SCHEMA_VERSION,
  loadSymbol,
  mergeBars,
  normalizeBar,
  normalizeSymbol,
  saveSymbol,
  validateSeries
} from "../engine/cache-store.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_CACHE_ROOT = resolve(projectRoot, "cache/us/ohlcv");
const DEFAULT_REPORT_PATH = resolve(projectRoot, "data/us-daily-refresh-report.json");
const DEFAULT_UNIVERSE_REFERENCE_PATH = resolve(projectRoot, "cache/us/us-universe-reference.json");
const STOOQ_QUOTE_ENDPOINT = "https://stooq.pl/q/l/";
const STOOQ_HISTORY_ENDPOINT = "https://stooq.pl/q/d/l/";
const DEFAULT_CHUNK_SIZE = 75;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

export function stooqSymbol(symbol) {
  return `${normalizeSymbol(symbol).toLowerCase()}.us`;
}

export function yahooSymbol(symbol) {
  return normalizeSymbol(symbol);
}

function nyDateFromUnixSeconds(seconds) {
  if (!Number.isFinite(Number(seconds))) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(Number(seconds) * 1000));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function parseStooqQuoteCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(x => x.trim().toUpperCase());
  return lines.slice(1).map(line => {
    const values = line.split(",");
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim()]));
    const symbol = normalizeSymbol(String(row.SYMBOL || "").replace(/\.US$/i, ""));
    const bar = normalizeBar({
      DATE: row.DATE,
      OPEN: row.OPEN,
      HIGH: row.HIGH,
      LOW: row.LOW,
      CLOSE: row.CLOSE,
      VOL: row.VOLUME
    });
    return symbol && bar ? { symbol, bar } : null;
  }).filter(Boolean);
}

export function parseStooqDailyCsv(symbol, text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(x => x.replace(/[<>]/g, "").trim().toUpperCase());
  return lines.slice(1).map(line => {
    const values = line.split(",");
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim()]));
    const bar = normalizeBar(row);
    return bar ? { symbol: normalizeSymbol(symbol), bar } : null;
  }).filter(Boolean);
}

export function parseYahooQuoteRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    const symbol = normalizeSymbol(row.symbol);
    const bar = normalizeBar({
      DATE: nyDateFromUnixSeconds(row.regularMarketTime),
      OPEN: row.regularMarketOpen,
      HIGH: row.regularMarketDayHigh,
      LOW: row.regularMarketDayLow,
      CLOSE: row.regularMarketPrice,
      adjusted_close: row.regularMarketPrice,
      VOL: row.regularMarketVolume
    });
    return symbol && bar ? { symbol, bar } : null;
  }).filter(Boolean);
}

export function parseYahooChartRows(symbol, payload) {
  const result = payload?.chart?.result?.[0];
  const q = result?.indicators?.quote?.[0] || {};
  const adj = result?.indicators?.adjclose?.[0]?.adjclose || [];
  return (result?.timestamp || []).map((time, index) => {
    const bar = normalizeBar({
      date: nyDateFromUnixSeconds(time),
      open: q.open?.[index],
      high: q.high?.[index],
      low: q.low?.[index],
      close: q.close?.[index],
      adjusted_close: adj[index] ?? q.close?.[index],
      volume: q.volume?.[index]
    });
    return bar ? { symbol: normalizeSymbol(symbol), bar } : null;
  }).filter(Boolean);
}

export function parseEodhdBulkRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    const eodhd_symbol = String(row.code || row.symbol || row.ticker || "").trim().toUpperCase();
    const symbol = normalizeSymbol(eodhd_symbol.replace(/\.US$/i, ""));
    const bar = normalizeBar({
      DATE: row.date,
      OPEN: row.open,
      HIGH: row.high,
      LOW: row.low,
      CLOSE: row.close,
      adjusted_close: row.adjusted_close ?? row.adjustedClose ?? row.close,
      VOL: row.volume
    });
    return symbol && bar ? { symbol, eodhd_symbol, bar } : null;
  }).filter(Boolean);
}

export function latestCompletedUsSession(now = new Date()) {
  return latestCompletedNyseSession(now);
}

async function cachedRecords(cacheRoot) {
  const names = await readdir(cacheRoot);
  const records = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const record = JSON.parse(await readFile(resolve(cacheRoot, name), "utf8"));
      if (record?.symbol && record.provider) records.push({ symbol: normalizeSymbol(record.symbol), provider: record.provider, provider_symbols: record.provider_symbols, instrument_type: record.instrument_type });
    } catch {
      // Ignore malformed cache records; scan/data repair will report them separately.
    }
  }
  return [...new Map(records.map(record => [record.symbol, record])).values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function readUniverseReference(path = DEFAULT_UNIVERSE_REFERENCE_PATH) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

async function fetchStooqQuotes(symbols, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = `${STOOQ_QUOTE_ENDPOINT}?s=${symbols.map(stooqSymbol).join(",")}&f=sd2t2ohlcv&h&e=csv`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: {
        accept: "text/csv,text/plain,*/*",
        "user-agent": "Mozilla/5.0 AURORA/2.18.2"
      }
    });
    if (!response.ok) throw new Error(`STOOQ_HTTP_${response.status}`);
    return parseStooqQuoteCsv(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchStooqQuotesAdaptive(symbols, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  try {
    return { rows: await fetchStooqQuotes(symbols, fetcher, timeoutMs), warnings: [] };
  } catch (error) {
    if (error.message === "STOOQ_HTTP_404" && symbols.length > 1) {
      const midpoint = Math.ceil(symbols.length / 2);
      const left = await fetchStooqQuotesAdaptive(symbols.slice(0, midpoint), fetcher, timeoutMs);
      const right = await fetchStooqQuotesAdaptive(symbols.slice(midpoint), fetcher, timeoutMs);
      return {
        rows: [...left.rows, ...right.rows],
        warnings: [...left.warnings, ...right.warnings]
      };
    }
    return {
      rows: [],
      warnings: [{
        provider: "STOOQ",
        symbols: symbols.length,
        sample: symbols.slice(0, 5),
        warning: error.message
      }]
    };
  }
}

async function fetchStooqDailySymbol(symbol, expectedSession, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const date = expectedSession.replaceAll("-", "");
  const url = `${STOOQ_HISTORY_ENDPOINT}?s=${stooqSymbol(symbol)}&d1=${date}&d2=${date}&i=d`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: {
        accept: "text/csv,text/plain,*/*",
        "user-agent": "Mozilla/5.0 AURORA/2.18.2"
      }
    });
    if (!response.ok) throw new Error(`STOOQ_HISTORY_HTTP_${response.status}`);
    return parseStooqDailyCsv(symbol, await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchStooqDailyHistory(symbols, expectedSession, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const rows = [];
  const warnings = [];
  await Promise.all(symbols.map(async symbol => {
    try {
      rows.push(...await fetchStooqDailySymbol(symbol, expectedSession, fetcher, timeoutMs));
    } catch (error) {
      warnings.push({
        provider: "STOOQ_HISTORY",
        symbols: 1,
        sample: [symbol],
        warning: error.message
      });
    }
  }));
  return { rows, warnings };
}

async function fetchYahooDailyChart(symbol, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const publicEndpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}`;
  const params = new URLSearchParams({
    range: "5d",
    interval: "1d",
    events: "history",
    includeAdjustedClose: "true"
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${publicEndpoint}?${params}`, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 AURORA/2.18.2"
      }
    });
    if (!response.ok) throw new Error(`YAHOO_HTTP_${response.status}`);
    const payload = await response.json();
    if (payload?.chart?.error) throw new Error(`YAHOO_ERROR_${payload.chart.error.code || "UNKNOWN"}`);
    return { rows: parseYahooChartRows(symbol, payload), endpoint: publicEndpoint };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYahooDailyCharts(symbols, expectedSession, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const rows = [];
  const warnings = [];
  await Promise.all(symbols.map(async symbol => {
    try {
      const result = await fetchYahooDailyChart(symbol, fetcher, timeoutMs);
      const current = result.rows.filter(row => row.bar.date <= expectedSession).at(-1);
      if (current) rows.push({ ...current, endpoint: result.endpoint });
      else warnings.push({ provider: "YAHOO_FINANCE", symbols: 1, sample: [symbol], warning: "YAHOO_CHART_NO_USABLE_DAILY_BAR" });
    } catch (error) {
      warnings.push({ provider: "YAHOO_FINANCE", symbols: 1, sample: [symbol], warning: error.message });
    }
  }));
  return { rows, warnings };
}

async function fetchEodhdBulkLastDay(expectedSession, token, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!token) throw new Error("EODHD_TOKEN_OR_CONNECTOR_MISSING");
  const publicEndpoint = `https://eodhd.com/api/eod-bulk-last-day/US?date=${expectedSession}&fmt=json`;
  const url = `${publicEndpoint}&api_token=${encodeURIComponent(token)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 AURORA/2.18.2"
      }
    });
    if (!response.ok) throw new Error(`EODHD_HTTP_${response.status}`);
    return { rows: parseEodhdBulkRows(await response.json()), endpoint: publicEndpoint };
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshDailyBars({
  cacheRoot = DEFAULT_CACHE_ROOT,
  reportPath = DEFAULT_REPORT_PATH,
  chunkSize = DEFAULT_CHUNK_SIZE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxConsecutiveFailures = DEFAULT_MAX_CONSECUTIVE_FAILURES,
  allowStale = false,
  eodhdToken = resolveEodhdToken(),
  fetcher = fetch,
  now = new Date(),
  universeRef = null
} = {}) {
  const expectedSession = latestCompletedUsSession(now);
  const records = await cachedRecords(cacheRoot);
  const loadedUniverseRef = universeRef || await readUniverseReference();
  const referenceRows = [
    ...(Array.isArray(loadedUniverseRef) ? loadedUniverseRef : loadedUniverseRef?.symbols || []),
    ...records.map(record => ({ symbol: record.symbol, canonical_symbol: record.symbol, provider_symbols: record.provider_symbols, instrument_type: record.instrument_type || "COMMON_STOCK" }))
  ];
  const symbols = records.map(record => record.symbol);
  const quoteMap = new Map();
  const warnings = [];
  let consecutiveFailures = 0;
  const symbolsByProvider = provider => records.filter(record => record.provider === provider).map(record => record.symbol);

  const stooqSymbols = symbolsByProvider("STOOQ");
  for (let offset = 0; offset < stooqSymbols.length; offset += chunkSize) {
    const chunk = stooqSymbols.slice(offset, offset + chunkSize);
    const result = await fetchStooqQuotesAdaptive(chunk, fetcher, timeoutMs);
    let stooqRows = result.rows;
    let stooqWarnings = result.warnings;
    if (!stooqRows.length) {
      const history = await fetchStooqDailyHistory(chunk, expectedSession, fetcher, timeoutMs);
      stooqRows = history.rows;
      stooqWarnings = [...stooqWarnings, ...history.warnings];
    }
    warnings.push(...stooqWarnings.map(warning => ({ ...warning, offset })));
    for (const row of stooqRows) {
      quoteMap.set(row.symbol, {
        bar: row.bar,
        provider: "STOOQ",
        endpoint: result.rows.length ? STOOQ_QUOTE_ENDPOINT : STOOQ_HISTORY_ENDPOINT,
        fallback_label: "FREE_PRIMARY",
        fallback_reason: null
      });
    }
    if (stooqRows.length) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
      if (!quoteMap.size && consecutiveFailures >= maxConsecutiveFailures) break;
    }
  }

  const yahooSymbols = symbolsByProvider("YAHOO_FINANCE");
  if (yahooSymbols.length) {
    consecutiveFailures = 0;
    for (let offset = 0; offset < yahooSymbols.length; offset += chunkSize) {
      const chunk = yahooSymbols.slice(offset, offset + chunkSize);
      const fallback = await fetchYahooDailyCharts(chunk, expectedSession, fetcher, timeoutMs);
      for (const row of fallback.rows) {
        quoteMap.set(row.symbol, {
          bar: row.bar,
          provider: "YAHOO_FINANCE",
          endpoint: row.endpoint,
          fallback_label: "YAHOO_CHART_DAILY",
          fallback_reason: null
        });
      }
      warnings.push(...fallback.warnings.map(warning => ({ ...warning, offset })));
      if (fallback.rows.length) consecutiveFailures = 0;
      else if (++consecutiveFailures >= maxConsecutiveFailures) break;
    }
  }

  const eodhdSymbols = symbolsByProvider("EODHD");
  const eodhdEligible = new Map();
  for (const symbol of eodhdSymbols) {
    const resolved = resolveProviderSymbol(symbol, "EODHD", referenceRows);
    if (resolved.symbol) eodhdEligible.set(symbol, resolved);
    else warnings.push({ provider: "EODHD", symbol, warning: "EODHD_SYMBOL_UNMAPPED", eodhd_status: resolved.status });
  }
  if (eodhdEligible.size && eodhdToken) {
    try {
      const fallback = await fetchEodhdBulkLastDay(expectedSession, eodhdToken, fetcher, timeoutMs);
      const aliasMap = buildProviderAliasMap(referenceRows, "EODHD");
      for (const row of fallback.rows) {
        const alias = aliasMap.get(providerSymbolLookupKey(row.eodhd_symbol || row.symbol));
        const canonicalSymbol = alias?.canonical_symbol || normalizeSymbol(row.symbol);
        if (quoteMap.has(canonicalSymbol)) continue;
        if (!eodhdEligible.has(canonicalSymbol)) continue;
        quoteMap.set(canonicalSymbol, {
          bar: row.bar,
          provider: "EODHD",
          endpoint: fallback.endpoint,
          fallback_label: "EODHD_DAILY",
          fallback_reason: null
        });
      }
      warnings.push({
        provider: "EODHD",
        warning: "USED_EODHD_BULK_LAST_DAY_FOR_EODHD_PROVIDER_COHORT"
      });
    } catch (error) {
      warnings.push({ provider: "EODHD", warning: error.message });
    }
  } else if (eodhdSymbols.length && !eodhdToken) {
    warnings.push({
      provider: "EODHD",
      symbols: eodhdSymbols.length,
      warning: "EODHD_TOKEN_OR_CONNECTOR_MISSING"
    });
  }

  let inserted = 0;
  let corrected = 0;
  let unchanged = 0;
  let stale_quote = 0;
  let invalid = 0;
  let missing_quote = 0;
  let unchanged_current = 0;
  let unchanged_cache_better_than_provider = 0;
  let latestDataAsOf = null;
  const providerCounts = {};

  for (const symbol of symbols) {
    const record = await loadSymbol(cacheRoot, symbol);
    const quote = quoteMap.get(symbol);
    if (!record || !quote?.bar) {
      if (record?.data_as_of === expectedSession) {
        unchanged_current += 1;
        latestDataAsOf = !latestDataAsOf || record.data_as_of > latestDataAsOf ? record.data_as_of : latestDataAsOf;
      }
      else missing_quote += 1;
      continue;
    }
    const { bar, provider, endpoint, fallback_label: fallbackLabel, fallback_reason: fallbackReason } = quote;
    if (bar.date > expectedSession) { stale_quote += 1; continue; }
    if (bar.date < record.data_as_of) {
      unchanged_cache_better_than_provider += 1;
      latestDataAsOf = !latestDataAsOf || record.data_as_of > latestDataAsOf ? record.data_as_of : latestDataAsOf;
      warnings.push({ provider, symbol, warning: "UNCHANGED_CACHE_BETTER_THAN_PROVIDER", provider_bar_date: bar.date, cache_data_as_of: record.data_as_of });
      continue;
    }
    latestDataAsOf = !latestDataAsOf || bar.date > latestDataAsOf ? bar.date : latestDataAsOf;
    providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    const old = record.bars.find(x => x.date === bar.date);
    const bars = mergeBars(record.bars, [bar], 420);
    const validation = validateSeries(bars, { minimumBars: Math.min(252, bars.length) });
    if (!validation.ok) { invalid += 1; continue; }
    await saveSymbol(cacheRoot, {
      ...record,
      schema_version: CACHE_SCHEMA_VERSION,
      provider,
      endpoint,
      retrieved_at: new Date().toISOString(),
      data_as_of: bars.at(-1).date,
      fallback_label: fallbackLabel,
      fallback_reason: fallbackReason,
      warnings: fallbackLabel !== "FREE_PRIMARY"
        ? [...(record.warnings || []), `Latest bar appended from ${provider} after earlier route failed.`]
        : record.warnings || [],
      bars
    });
    if (!old) inserted += 1;
    else if (JSON.stringify(old) !== JSON.stringify(bar)) corrected += 1;
    else unchanged += 1;
  }

  const staleUnrepaired = missing_quote + stale_quote + invalid;
  const currentSessionComplete = staleUnrepaired === 0;
  const status = staleUnrepaired
    ? latestDataAsOf || unchanged_current || unchanged_cache_better_than_provider
      ? "PARTIAL_CURRENT_SESSION"
      : "DATA_REFRESH_BLOCKED"
    : inserted + corrected > 0
      ? "UPDATED"
      : latestDataAsOf
      ? "ALREADY_CURRENT_OR_UNCHANGED"
      : "DATA_REFRESH_BLOCKED";
  const report = {
    status,
    route_order: ["STOOQ", "YAHOO_FINANCE", "EODHD"],
    provider_counts: providerCounts,
    fallback_label: Object.keys(providerCounts).includes("EODHD")
      ? "EODHD_FALLBACK"
      : Object.keys(providerCounts).includes("YAHOO_FINANCE")
        ? "YAHOO_FALLBACK"
        : Object.keys(providerCounts).includes("STOOQ")
          ? "FREE_PRIMARY"
          : "NOT_AVAILABLE",
    retrieved_at: new Date().toISOString(),
    expected_completed_session: expectedSession,
    latest_data_as_of: latestDataAsOf,
    current_session_complete: currentSessionComplete,
    symbols_requested: symbols.length,
    quotes_loaded: quoteMap.size,
    inserted,
    corrected,
    unchanged,
    unchanged_current,
    unchanged_cache_better_than_provider,
    missing_quote,
    stale_quote,
    invalid,
    warnings
  };

  await mkdir(resolve(reportPath, ".."), { recursive: true });
  const temporary = `${reportPath}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2), "utf8");
  await rename(temporary, reportPath);

  if (status === "DATA_REFRESH_BLOCKED" && !allowStale) {
    const error = new Error("US daily refresh did not load any usable daily quotes");
    error.report = report;
    throw error;
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allowStale = process.argv.includes("--allow-stale") || process.env.AURORA_ALLOW_STALE_REFRESH === "1";
  try {
    const report = await refreshDailyBars({ allowStale });
    console.log(JSON.stringify(report));
  } catch (error) {
    if (error.report) console.error(JSON.stringify(error.report));
    throw error;
  }
}
