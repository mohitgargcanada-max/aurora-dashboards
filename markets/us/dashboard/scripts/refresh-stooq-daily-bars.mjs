import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

export function parseEodhdBulkRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    const symbol = normalizeSymbol(String(row.code || row.symbol || row.ticker || "").replace(/\.US$/i, ""));
    const bar = normalizeBar({
      DATE: row.date,
      OPEN: row.open,
      HIGH: row.high,
      LOW: row.low,
      CLOSE: row.close,
      adjusted_close: row.adjusted_close ?? row.adjustedClose ?? row.close,
      VOL: row.volume
    });
    return symbol && bar ? { symbol, bar } : null;
  }).filter(Boolean);
}

export function latestCompletedUsSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(now);
  const get = type => Number(parts.find(part => part.type === type)?.value);
  const date = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const hour = get("hour");
  if (hour < 18) date.setUTCDate(date.getUTCDate() - 1);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function cachedSymbols(cacheRoot) {
  const names = await readdir(cacheRoot);
  const symbols = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const record = JSON.parse(await readFile(resolve(cacheRoot, name), "utf8"));
      if (record?.symbol && record.provider === "STOOQ") symbols.push(record.symbol);
    } catch {
      // Ignore malformed cache records; scan/data repair will report them separately.
    }
  }
  return [...new Set(symbols)].sort();
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

async function fetchYahooQuotes(symbols, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const publicEndpoint = "https://query1.finance.yahoo.com/v7/finance/quote";
  const params = new URLSearchParams({
    symbols: symbols.map(yahooSymbol).join(","),
    fields: [
      "symbol",
      "regularMarketTime",
      "regularMarketOpen",
      "regularMarketDayHigh",
      "regularMarketDayLow",
      "regularMarketPrice",
      "regularMarketVolume",
      "currency",
      "quoteType",
      "exchange"
    ].join(",")
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
    return { rows: parseYahooQuoteRows(payload?.quoteResponse?.result), endpoint: publicEndpoint };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEodhdBulkLastDay(expectedSession, token, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!token) throw new Error("EODHD_TOKEN_MISSING");
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
  eodhdToken = process.env.EODHD_API_TOKEN,
  fetcher = fetch,
  now = new Date()
} = {}) {
  const expectedSession = latestCompletedUsSession(now);
  const symbols = await cachedSymbols(cacheRoot);
  const quoteMap = new Map();
  const warnings = [];
  let consecutiveFailures = 0;

  for (let offset = 0; offset < symbols.length; offset += chunkSize) {
    const chunk = symbols.slice(offset, offset + chunkSize);
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

  const yahooMissing = symbols.filter(symbol => !quoteMap.has(symbol));
  if (yahooMissing.length) {
    consecutiveFailures = 0;
    for (let offset = 0; offset < yahooMissing.length; offset += chunkSize) {
      const chunk = yahooMissing.slice(offset, offset + chunkSize);
      try {
        const fallback = await fetchYahooQuotes(chunk, fetcher, timeoutMs);
        for (const row of fallback.rows) {
          quoteMap.set(row.symbol, {
            bar: row.bar,
            provider: "YAHOO_FINANCE",
            endpoint: fallback.endpoint,
            fallback_label: "YAHOO_FALLBACK",
            fallback_reason: "FREE_PRIMARY_STOOQ_DAILY_BAR_MISSING_OR_FAILED"
          });
        }
        consecutiveFailures = 0;
      } catch (error) {
        warnings.push({ provider: "YAHOO_FINANCE", offset, symbols: chunk.length, warning: error.message });
        consecutiveFailures += 1;
        if (!quoteMap.size && consecutiveFailures >= maxConsecutiveFailures) break;
      }
    }
  }

  const eodhdMissing = symbols.filter(symbol => !quoteMap.has(symbol));
  if (eodhdMissing.length && eodhdToken) {
    try {
      const fallback = await fetchEodhdBulkLastDay(expectedSession, eodhdToken, fetcher, timeoutMs);
      for (const row of fallback.rows) {
        if (quoteMap.has(row.symbol)) continue;
        quoteMap.set(row.symbol, {
          bar: row.bar,
          provider: "EODHD",
          endpoint: fallback.endpoint,
          fallback_label: "EODHD_FALLBACK",
          fallback_reason: "FREE_AND_YAHOO_DAILY_BAR_REFRESH_FAILED"
        });
      }
      warnings.push({
        provider: "EODHD",
        warning: "USED_EODHD_BULK_LAST_DAY_FOR_SYMBOLS_STILL_MISSING_AFTER_STOOQ_AND_YAHOO"
      });
    } catch (error) {
      warnings.push({ provider: "EODHD", warning: error.message });
    }
  } else if (eodhdMissing.length) {
    warnings.push({
      provider: "EODHD",
      symbols: eodhdMissing.length,
      warning: "EODHD_TOKEN_MISSING"
    });
  }

  let inserted = 0;
  let corrected = 0;
  let unchanged = 0;
  let stale_quote = 0;
  let invalid = 0;
  let missing_quote = 0;
  let latestDataAsOf = null;
  const providerCounts = {};

  for (const symbol of symbols) {
    const record = await loadSymbol(cacheRoot, symbol);
    const quote = quoteMap.get(symbol);
    if (!record || !quote?.bar) { missing_quote += 1; continue; }
    const { bar, provider, endpoint, fallback_label: fallbackLabel, fallback_reason: fallbackReason } = quote;
    if (bar.date > expectedSession) { stale_quote += 1; continue; }
    if (bar.date < record.data_as_of) { stale_quote += 1; continue; }
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

  const status = inserted + corrected > 0
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
    symbols_requested: symbols.length,
    quotes_loaded: quoteMap.size,
    inserted,
    corrected,
    unchanged,
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
