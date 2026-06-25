import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE_SCHEMA_VERSION, loadSymbol, mergeBars, normalizeBar, normalizeSymbol, saveSymbol, validateSeries } from "../engine/cache-store.mjs";
import { latestCompletedIndiaSession } from "../engine/trading-calendar.mjs";
import { buildWeekdayPrioritySymbols } from "./refresh-india-daily-bars.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cacheRoot = resolve(projectRoot, "cache/india/ohlcv");
const reportPath = resolve(projectRoot, "data/india-history-backfill-report.json");
const expectedSession = process.argv.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg)) || process.env.AURORA_TARGET_SESSION || latestCompletedIndiaSession();
const targetBars = Number(process.env.AURORA_HISTORY_TARGET_BARS || 1260);
const maxSymbols = Number(process.env.AURORA_HISTORY_BACKFILL_SYMBOL_LIMIT || 250);
const providerOrder = (process.env.AURORA_HISTORY_PROVIDER_ORDER || "YAHOO,TAPETIDE,EODHD").split(",").map(x => x.trim().toUpperCase()).filter(Boolean);

const PROVIDER_ENDPOINTS = {
  YAHOO: "https://query1.finance.yahoo.com/v8/finance/chart/",
  TAPETIDE: "https://mcp.tapetide.com/mcp",
  EODHD: "https://eodhd.com/api/eod/"
};

function sessionToUnix(session, daysBack) {
  const endDate = new Date(`${session}T00:00:00+05:30`);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - daysBack);
  return {
    start: Math.floor(startDate.valueOf() / 1000),
    end: Math.floor(endDate.valueOf() / 1000) + 86400
  };
}

function exchangeSuffix(record, provider) {
  const exchange = String(record.exchange || "NSE").toUpperCase();
  if (provider === "YAHOO") return exchange === "BSE" ? ".BO" : ".NS";
  if (provider === "EODHD") return exchange === "BSE" ? ".BSE" : ".NSE";
  return "";
}

function parseYahooBars(payload) {
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp || [];
  if (!quote || !timestamps.length) return [];
  return timestamps.map((timestamp, i) => normalizeBar({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: quote.open?.[i],
    high: quote.high?.[i],
    low: quote.low?.[i],
    close: quote.close?.[i],
    volume: quote.volume?.[i]
  })).filter(Boolean);
}

function parseEodhdBars(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.data || [];
  return rows.map(row => normalizeBar({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    adjusted_close: row.adjusted_close || row.adjustedClose || row.close,
    volume: row.volume
  })).filter(Boolean);
}

function mcpTextPayload(payload) {
  const content = payload?.result?.content || payload?.content || [];
  const text = content.find(item => item?.type === "text" && item.text)?.text;
  if (!text) return payload;
  try { return JSON.parse(text); }
  catch { return { data: text }; }
}

function parseTapetideBars(payload) {
  const parsed = mcpTextPayload(payload);
  const data = parsed?.result?.structuredContent || parsed?.structuredContent || parsed?.data || parsed;
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.bars)
      ? data.bars
      : Array.isArray(data?.history)
        ? data.history
        : Array.isArray(data?.data)
          ? data.data
          : [];
  return rows.map(row => normalizeBar({
    date: row.date || row.trading_date || row.TradDt,
    open: row.open ?? row.open_price,
    high: row.high ?? row.high_price,
    low: row.low ?? row.low_price,
    close: row.close ?? row.price ?? row.ltp,
    volume: row.volume ?? row.traded_volume,
    turnover: row.turnover ?? row.value
  })).filter(Boolean);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": "Mozilla/5.0 AURORA/2.18.2",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

async function fetchProviderHistory(provider, record) {
  const symbol = normalizeSymbol(record.symbol);
  if (provider === "YAHOO") {
    const { start, end } = sessionToUnix(expectedSession, Math.ceil(targetBars * 1.7));
    const url = `${PROVIDER_ENDPOINTS.YAHOO}${encodeURIComponent(symbol + exchangeSuffix(record, provider))}?period1=${start}&period2=${end}&interval=1d&events=history`;
    return { bars: parseYahooBars(await fetchJson(url)), endpoint: url };
  }
  if (provider === "TAPETIDE") {
    const token = process.env.TAPETIDE_TOKEN;
    if (!token) return { bars: [], endpoint: PROVIDER_ENDPOINTS.TAPETIDE, warning: "TAPETIDE_NOT_CONFIGURED" };
    const response = await fetch(PROVIDER_ENDPOINTS.TAPETIDE, {
      method: "POST",
      headers: {
        accept: "application/json,text/event-stream",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "Mozilla/5.0 AURORA/2.18.2"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `aurora-history-${symbol}-${expectedSession}`,
        method: "tools/call",
        params: {
          name: process.env.TAPETIDE_PRICE_HISTORY_TOOL || "get_price_history",
          arguments: { symbol, exchange: record.exchange || "NSE", interval: "daily", days: targetBars + 80 }
        }
      })
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const text = await response.text();
    const payload = (response.headers.get("content-type") || "").includes("text/event-stream")
      ? JSON.parse(text.split(/\r?\n/).find(line => line.startsWith("data:"))?.slice(5).trim() || "{}")
      : JSON.parse(text);
    return { bars: parseTapetideBars(payload), endpoint: PROVIDER_ENDPOINTS.TAPETIDE };
  }
  if (provider === "EODHD") {
    const token = process.env.EODHD_API_TOKEN;
    if (!token) return { bars: [], endpoint: PROVIDER_ENDPOINTS.EODHD, warning: "EODHD_NOT_CONFIGURED" };
    const from = new Date(`${expectedSession}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - Math.ceil(targetBars * 1.7));
    const url = `${PROVIDER_ENDPOINTS.EODHD}${encodeURIComponent(symbol + exchangeSuffix(record, provider))}?from=${from.toISOString().slice(0, 10)}&to=${expectedSession}&period=d&fmt=json&api_token=${encodeURIComponent(token)}`;
    return { bars: parseEodhdBars(await fetchJson(url)), endpoint: url.replace(/api_token=[^&]+/i, "api_token=***") };
  }
  return { bars: [], endpoint: null, warning: `UNKNOWN_PROVIDER_${provider}` };
}

async function cachedRecords() {
  const records = [];
  for (const file of (await readdir(cacheRoot)).filter(x => x.endsWith(".json"))) {
    try { records.push(JSON.parse(await readFile(resolve(cacheRoot, file), "utf8"))); }
    catch { /* ignore malformed cache records */ }
  }
  return records;
}

const prioritySymbols = await buildWeekdayPrioritySymbols({ cacheRoot });
const records = (await cachedRecords())
  .filter(record => prioritySymbols.has(normalizeSymbol(record.symbol)))
  .sort((a, b) => normalizeSymbol(a.symbol).localeCompare(normalizeSymbol(b.symbol)))
  .slice(0, maxSymbols);

const report = {
  generated_at: new Date().toISOString(),
  expected_session: expectedSession,
  target_bars: targetBars,
  provider_order: providerOrder,
  requested_symbols: records.length,
  updated: 0,
  unchanged: 0,
  failed: 0,
  symbols: []
};

for (const record of records) {
  const beforeRows = record.bars?.length || 0;
  const item = { exchange: record.exchange, symbol: record.symbol, before_rows: beforeRows, provider_attempts: [] };
  for (const provider of providerOrder) {
    try {
      const { bars, endpoint, warning } = await fetchProviderHistory(provider, record);
      item.provider_attempts.push({ provider, endpoint, bars: bars.length, warning });
      if (warning || bars.length < Math.min(252, targetBars)) continue;
      const merged = mergeBars(record.bars || [], bars, targetBars);
      const validation = validateSeries(merged, { minimumBars: Math.min(252, merged.length) });
      if (!validation.ok) {
        item.provider_attempts.at(-1).warning = validation.code;
        continue;
      }
      await saveSymbol(cacheRoot, {
        ...record,
        schema_version: CACHE_SCHEMA_VERSION,
        provider: `${provider}_HISTORICAL_BACKFILL`,
        endpoint,
        retrieved_at: report.generated_at,
        data_as_of: merged.at(-1)?.date || record.data_as_of,
        fallback_label: provider === "YAHOO" ? "YAHOO_FALLBACK" : provider === "EODHD" ? "EODHD_FALLBACK" : "FREE_PRIMARY",
        fallback_reason: "MYH_HISTORY_BACKFILL",
        warnings: [...(record.warnings || []), `HISTORICAL_BACKFILL_FROM_${provider}`],
        bars: merged
      });
      item.after_rows = merged.length;
      item.provider = provider;
      if (merged.length > beforeRows) report.updated += 1;
      else report.unchanged += 1;
      break;
    } catch (error) {
      item.provider_attempts.push({
        provider,
        warning: error.message,
        cause: error.cause?.code || error.cause?.message || null
      });
    }
  }
  if (!item.provider) {
    item.after_rows = beforeRows;
    report.failed += 1;
  }
  report.symbols.push(item);
}

await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2));
await rename(`${reportPath}.tmp`, reportPath);
console.log(JSON.stringify({ report: reportPath, requested_symbols: report.requested_symbols, updated: report.updated, unchanged: report.unchanged, failed: report.failed }, null, 2));
