import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CACHE_SCHEMA_VERSION, DEFAULT_RETAIN_BARS, loadSymbol, mergeBars, normalizeBar, normalizeSymbol, saveSymbol, validateSeries } from "../engine/cache-store.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cacheDefault = resolve(root, "cache/us/ohlcv");
const reportDefault = resolve(root, "data/us-history-repair-report.json");
const timeoutDefault = 20_000;
const concurrencyDefault = 6;
const minBarsDefault = 252;

const ymd = d => d.toISOString().slice(0, 10);
const compact = d => String(d).replaceAll("-", "");
const stooqSymbol = s => `${normalizeSymbol(s).toLowerCase()}.us`;
const eodhdSymbol = s => `${normalizeSymbol(s)}.US`;
const eodhdEnvToken = () => process.env.EODHD_API_TOKEN || process.env.EODHD_API_KEY || "";
function addYears(date, years) { const copy = new Date(date); copy.setUTCFullYear(copy.getUTCFullYear() + years); return copy; }
function latestCompletedUsSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(now);
  const get = type => Number(parts.find(x => x.type === type)?.value);
  const d = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  if (get("hour") < 18) d.setUTCDate(d.getUTCDate() - 1);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() - 1);
  return ymd(d);
}
function nyDate(seconds) {
  if (!Number.isFinite(Number(seconds))) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Number(seconds) * 1000));
  const get = type => parts.find(x => x.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function timeoutSignal(ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, clear: () => clearTimeout(t) }; }
function parseArgs(argv) {
  const out = { staleOnly: true, strictCurrent: false, allowStale: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--symbols") out.symbols = argv[++i].split(",").map(normalizeSymbol).filter(Boolean);
    else if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--from") out.from = argv[++i];
    else if (argv[i] === "--to") out.to = argv[++i];
    else if (argv[i] === "--all") out.staleOnly = false;
    else if (argv[i] === "--strict-current") out.strictCurrent = true;
    else if (argv[i] === "--allow-stale") out.allowStale = true;
  }
  return out;
}
async function symbolsFromCache(cacheRoot) {
  const names = await readdir(cacheRoot);
  const symbols = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try { const row = JSON.parse(await readFile(resolve(cacheRoot, name), "utf8")); if (row?.symbol) symbols.push(normalizeSymbol(row.symbol)); } catch {}
  }
  return [...new Set(symbols)].sort();
}
function parseStooqCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(x => x.replace(/[<>]/g, "").trim().toUpperCase());
  return lines.slice(1).map(line => normalizeBar(Object.fromEntries(headers.map((h, i) => [h, line.split(",")[i]?.trim()])))).filter(Boolean);
}
function parseYahooChart(payload) {
  const result = payload?.chart?.result?.[0];
  const q = result?.indicators?.quote?.[0] || {};
  const adj = result?.indicators?.adjclose?.[0]?.adjclose || [];
  return (result?.timestamp || []).map((time, i) => normalizeBar({ date: nyDate(time), open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], adjusted_close: adj[i] ?? q.close?.[i], volume: q.volume?.[i] })).filter(Boolean);
}
function parseEodhdRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => normalizeBar({ date: row.date, open: row.open, high: row.high, low: row.low, close: row.close, adjusted_close: row.adjusted_close ?? row.adjustedClose ?? row.close, volume: row.volume })).filter(Boolean);
}
async function request(url, kind, fetcher, ms) {
  const { signal, clear } = timeoutSignal(ms);
  try {
    const res = await fetcher(url, { signal, headers: { accept: kind === "csv" ? "text/csv,text/plain,*/*" : "application/json", "user-agent": "Mozilla/5.0 AURORA/2.18.2" } });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return kind === "csv" ? await res.text() : await res.json();
  } finally { clear(); }
}
async function fetchYahoo(symbol, from, to, fetcher, ms) {
  const p1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const p2 = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000);
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalizeSymbol(symbol))}`;
  const payload = await request(`${endpoint}?period1=${p1}&period2=${p2}&interval=1d&events=history&includeAdjustedClose=true`, "json", fetcher, ms);
  if (payload?.chart?.error) throw new Error(`YAHOO_ERROR_${payload.chart.error.code || "UNKNOWN"}`);
  return { endpoint, bars: parseYahooChart(payload) };
}
async function fetchStooq(symbol, from, to, fetcher, ms) {
  const endpoint = "https://stooq.pl/q/d/l/";
  const text = await request(`${endpoint}?s=${stooqSymbol(symbol)}&d1=${compact(from)}&d2=${compact(to)}&i=d`, "csv", fetcher, ms);
  return { endpoint, bars: parseStooqCsv(text) };
}
async function fetchEodhd(symbol, from, to, token, fetcher, ms) {
  if (!token) throw new Error("EODHD_TOKEN_OR_CONNECTOR_MISSING");
  const endpoint = `https://eodhd.com/api/eod/${encodeURIComponent(eodhdSymbol(symbol))}`;
  const rows = await request(`${endpoint}?from=${from}&to=${to}&period=d&fmt=json&api_token=${encodeURIComponent(token)}`, "json", fetcher, ms);
  return { endpoint, bars: parseEodhdRows(rows) };
}
function checkHistory(rows, { minBars, expectedSession, previousAsOf, strictCurrent }) {
  const bars = mergeBars([], rows, DEFAULT_RETAIN_BARS).filter(x => x.date <= expectedSession);
  if (bars.length < minBars) return { ok: false, code: "INSUFFICIENT_HISTORY", bars };
  const valid = validateSeries(bars, { minimumBars: minBars });
  if (!valid.ok) return { ok: false, code: valid.code, bars };
  if (previousAsOf && bars.at(-1).date < previousAsOf) return { ok: false, code: "OLDER_THAN_EXISTING_CACHE", bars };
  if (strictCurrent && bars.at(-1).date !== expectedSession) return { ok: false, code: "STALE_AFTER_REPAIR", bars };
  return { ok: true, bars };
}
async function mapLimit(items, limit, worker) {
  const result = [];
  let index = 0;
  async function run() { while (index < items.length) { const i = index++; result[i] = await worker(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return result;
}
export async function repairUsHistory({ cacheRoot = cacheDefault, reportPath = reportDefault, from = null, to = null, lookbackYears = 5, minBars = minBarsDefault, staleOnly = true, strictCurrent = false, allowStale = false, symbols = null, limit = null, concurrency = concurrencyDefault, timeoutMs = timeoutDefault, eodhdToken = eodhdEnvToken(), fetcher = fetch, now = new Date() } = {}) {
  const expectedSession = to || latestCompletedUsSession(now);
  const start = from || ymd(addYears(`${expectedSession}T00:00:00Z`, -lookbackYears));
  let universe = symbols?.length ? symbols : await symbolsFromCache(cacheRoot);
  if (limit) universe = universe.slice(0, limit);
  const warnings = [];
  const providerCounts = {};
  let refreshed = 0, skippedCurrent = 0, failed = 0, latestDataAsOf = null;
  const rows = await mapLimit(universe, concurrency, async symbol => {
    const existing = await loadSymbol(cacheRoot, symbol);
    const previousAsOf = existing?.data_as_of || null;
    if (staleOnly && previousAsOf && previousAsOf >= expectedSession && (existing?.bars?.length || 0) >= DEFAULT_RETAIN_BARS * 0.75) return { symbol, status: "SKIPPED", data_as_of: previousAsOf, provider: existing.provider };
    const routes = [
      ["YAHOO_FINANCE", "YAHOO_FALLBACK", "PRIMARY_5Y_HISTORY_ROUTE", () => fetchYahoo(symbol, start, expectedSession, fetcher, timeoutMs)],
      ["STOOQ", "FREE_PRIMARY", "YAHOO_5Y_HISTORY_FAILED_OR_INCOMPLETE", () => fetchStooq(symbol, start, expectedSession, fetcher, timeoutMs)],
      ["EODHD", "EODHD_FALLBACK", "FREE_AND_YAHOO_5Y_HISTORY_FAILED_OR_INCOMPLETE", () => fetchEodhd(symbol, start, expectedSession, eodhdToken, fetcher, timeoutMs)]
    ];
    const localWarnings = [];
    for (const [provider, label, reason, call] of routes) {
      try {
        const fetched = await call();
        const checked = checkHistory(fetched.bars, { minBars, expectedSession, previousAsOf, strictCurrent });
        if (!checked.ok) { localWarnings.push({ symbol, provider, warning: checked.code, rows: checked.bars.length }); continue; }
        await saveSymbol(cacheRoot, { schema_version: CACHE_SCHEMA_VERSION, market: "US", symbol, currency: "USD", interval: "1d", provider, endpoint: fetched.endpoint, adjustment_status: provider === "STOOQ" ? "STOOQ_ADJUSTED_OHLC" : provider === "YAHOO_FINANCE" ? "YAHOO_ADJUSTED_CLOSE" : "EODHD_ADJUSTED_CLOSE", delayed_or_live: "EOD", retrieved_at: new Date().toISOString(), data_as_of: checked.bars.at(-1).date, fallback_label: label, fallback_reason: reason, warnings: provider === "EODHD" ? ["Full 5Y provider-consistent history repaired via EODHD fallback."] : [], bars: checked.bars });
        return { symbol, status: "REFRESHED", provider, data_as_of: checked.bars.at(-1).date, warnings: localWarnings };
      } catch (error) { localWarnings.push({ symbol, provider, warning: error.message }); }
    }
    return { symbol, status: "FAILED", previous_as_of: previousAsOf, warnings: localWarnings };
  });
  for (const row of rows) {
    warnings.push(...(row.warnings || []));
    if (row.status === "REFRESHED") { refreshed += 1; providerCounts[row.provider] = (providerCounts[row.provider] || 0) + 1; latestDataAsOf = !latestDataAsOf || row.data_as_of > latestDataAsOf ? row.data_as_of : latestDataAsOf; }
    else if (row.status === "SKIPPED") { skippedCurrent += 1; latestDataAsOf = !latestDataAsOf || row.data_as_of > latestDataAsOf ? row.data_asOf : latestDataAsOf; }
    else failed += 1;
  }
  const status = refreshed ? "UPDATED" : latestDataAsOf ? "ALREADY_CURRENT_OR_UNCHANGED" : "DATA_REFRESH_BLOCKED";
  const report = { status, route_order: ["YAHOO_FINANCE", "STOOQ", "EODHD"], retrieved_at: new Date().toISOString(), from: start, expected_completed_session: expectedSession, latest_data_as_of: latestDataAsOf, retain_bars: DEFAULT_RETAIN_BARS, symbols_requested: universe.length, refreshed, skipped_current: skippedCurrent, failed, provider_counts: providerCounts, fallback_label: providerCounts.EODHD ? "EODHD_FALLBACK" : providerCounts.YAHOO_FINANCE ? "YAHOO_FALLBACK" : providerCounts.STOOQ ? "FREE_PRIMARY" : "NOT_AVAILABLE", warnings: warnings.slice(0, 500) };
  await mkdir(resolve(reportPath, ".."), { recursive: true });
  await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2), "utf8");
  await rename(`${reportPath}.tmp`, reportPath);
  if (status === "DATA_REFRESH_BLOCKED" && !allowStale) { const error = new Error("US 5Y history repair did not load any usable provider-consistent histories"); error.report = report; throw error; }
  return report;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  repairUsHistory(args).then(report => console.log(JSON.stringify(report))).catch(error => { if (error.report) console.error(JSON.stringify(error.report)); throw error; });
}
