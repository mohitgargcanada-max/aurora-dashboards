import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeBhavcopyRow, parseCsv } from "../engine/bhavcopy-parser.mjs";
import { CACHE_SCHEMA_VERSION, loadSymbol, mergeBars, normalizeBar, normalizeDate, normalizeSymbol, saveSymbol, validateSeries } from "../engine/cache-store.mjs";
import { compactSession, latestCompletedIndiaSession } from "../engine/trading-calendar.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_CACHE_ROOT = resolve(projectRoot, "cache/india/ohlcv");
const DEFAULT_RAW_ROOT = resolve(projectRoot, "cache/india/raw");
const DEFAULT_REPORT_PATH = resolve(projectRoot, "data/india-daily-refresh-report.json");
const DEFAULT_LAST_GOOD_SCAN_PATH = resolve(projectRoot, "data/india-full-dashboard-scan.json");
const DEFAULT_MIN_CURRENT_COVERAGE = 0.25;
const DEFAULT_TIMEOUT_MS = 15_000;

const OFFICIAL_PROVIDER_FAMILY = new Set(["NSE_OFFICIAL_BHAVCOPY", "BSE_OFFICIAL_BHAVCOPY"]);
const NSE_EQUITY_SERIES = new Set(["EQ", "BE", "SM", "ST", "BZ"]);
const BSE_EQUITY_SERIES = new Set(["A", "B", "T", "TS", "X", "XT", "Z", "ZP", "M", "MT", "MS", "EQ"]);
const HIGH_PRIORITY_SCAN_LISTS = ["daily_top_1_4", "focus_list", "weekly_universe", "rsle_top20", "developing_watchlist_20"];
const PROVIDER_ENDPOINTS = {
  OFFICIAL_LOCAL: "local official incoming/raw bhavcopy",
  NSE_OFFICIAL_FETCH: "scripts/fetch-nse-session.sh",
  TAPETIDE: "TAPETIDE_DAILY_BAR_URL_TEMPLATE",
  YAHOO: "https://query1.finance.yahoo.com/v8/finance/chart/",
  EODHD: "https://eodhd.com/api/eod/"
};

function providerFamily(provider) {
  const text = String(provider || "").toUpperCase();
  if (OFFICIAL_PROVIDER_FAMILY.has(text)) return "OFFICIAL";
  if (text.includes("TAPETIDE")) return "TAPETIDE";
  if (text.includes("YAHOO")) return "YAHOO";
  if (text.includes("EODHD")) return "EODHD";
  return "UNKNOWN";
}

function fallbackLabel(provider) {
  if (provider === "TAPETIDE") return "FREE_PRIMARY";
  if (provider === "YAHOO") return "YAHOO_FALLBACK";
  if (provider === "EODHD") return "EODHD_FALLBACK";
  return "OFFICIAL_VERIFIED";
}

function exchangeSuffix(record, provider) {
  const exchange = String(record.exchange || "NSE").toUpperCase();
  if (provider === "YAHOO") return exchange === "BSE" ? ".BO" : ".NS";
  if (provider === "EODHD") return exchange === "BSE" ? ".BSE" : ".NSE";
  return "";
}

function isEquityRecord(record) {
  const exchange = String(record.exchange || "").toUpperCase();
  const series = String(record.series || record.group || "").toUpperCase();
  if (exchange === "NSE") return NSE_EQUITY_SERIES.has(series);
  if (exchange === "BSE") return BSE_EQUITY_SERIES.has(series);
  return false;
}

function averageTurnover(record, days = 20) {
  const bars = Array.isArray(record.bars) ? record.bars.slice(-days) : [];
  const values = bars
    .map(bar => Number(bar.turnover) || (Number(bar.close) * Number(bar.volume)))
    .filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sessionToUnix(session) {
  const start = Math.floor(new Date(`${session}T00:00:00+05:30`).valueOf() / 1000);
  return { start, end: start + 86400 };
}

async function exists(path) {
  try { await stat(path); return true; }
  catch { return false; }
}

async function walk(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) output.push(...await walk(child));
    else if ([".csv", ".zip"].includes(extname(entry.name).toLowerCase())) output.push(child);
  }
  return output;
}

function archiveCsv(path) {
  const names = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split(/\r?\n/).filter(x => /\.csv$/i.test(x));
  return names.map(name => ({ name: `${basename(path)}::${name}`, text: execFileSync("unzip", ["-p", path, name], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 }) }));
}

export async function appendOfficialSource({
  sourceRoot,
  expectedSession,
  cacheRoot = DEFAULT_CACHE_ROOT,
  rawRoot = DEFAULT_RAW_ROOT,
  retrievedAt = new Date().toISOString()
} = {}) {
  const files = await walk(sourceRoot);
  const grouped = new Map();
  const sourceFiles = [];
  let rejectedRows = 0;
  for (const path of files) {
    const buffer = await readFile(path);
    const inputs = extname(path).toLowerCase() === ".zip" ? archiveCsv(path) : [{ name: basename(path), text: buffer.toString("utf8") }];
    let accepted = 0;
    for (const input of inputs) {
      for (const raw of parseCsv(input.text)) {
        const item = normalizeBhavcopyRow(raw, input.name);
        if (!item || item.bar.date !== expectedSession) { rejectedRows += 1; continue; }
        const key = `${item.exchange}__${item.symbol}`;
        if (!grouped.has(key)) grouped.set(key, { ...item, bars: [] });
        grouped.get(key).bars.push(item.bar);
        accepted += 1;
      }
    }
    if (accepted > 0) {
      await mkdir(resolve(rawRoot, expectedSession), { recursive: true });
      const destination = resolve(rawRoot, expectedSession, basename(path));
      if (resolve(path) !== destination) await copyFile(path, destination);
    }
    sourceFiles.push({
      file: basename(path),
      sha256: createHash("sha256").update(buffer).digest("hex"),
      bytes: buffer.length,
      accepted_rows: accepted
    });
  }

  let inserted = 0;
  let corrected = 0;
  let unchanged = 0;
  let invalid = 0;
  for (const item of grouped.values()) {
    const existing = await loadSymbol(cacheRoot, item.exchange, item.symbol);
    const old = existing?.bars?.find(bar => bar.date === expectedSession);
    const bars = mergeBars(existing?.bars || [], item.bars, 420);
    const validation = validateSeries(bars, { minimumBars: Math.min(252, bars.length), expectedSession });
    if (!validation.ok) { invalid += 1; continue; }
    const provider = item.exchange === "NSE" ? "NSE_OFFICIAL_BHAVCOPY" : "BSE_OFFICIAL_BHAVCOPY";
    await saveSymbol(cacheRoot, {
      ...existing,
      schema_version: CACHE_SCHEMA_VERSION,
      market: "INDIA",
      exchange: item.exchange,
      symbol: item.symbol,
      security_code: item.security_code || existing?.security_code || null,
      isin: item.isin || existing?.isin || null,
      series: item.series || existing?.series || null,
      currency: "INR",
      interval: "1d",
      provider,
      endpoint: sourceFiles.map(x => x.file),
      retrieved_at: retrievedAt,
      data_as_of: expectedSession,
      adjustment_status: existing?.adjustment_status || "UNADJUSTED_RAW_CORPORATE_ACTION_REVIEW_REQUIRED",
      delayed_or_live: "EOD",
      fallback_label: "OFFICIAL_VERIFIED",
      fallback_reason: "LATEST_COMPLETED_SESSION_OFFICIAL_APPEND",
      warnings: existing?.warnings || [],
      bars
    });
    if (!old) inserted += 1;
    else if (JSON.stringify(old) !== JSON.stringify(item.bars.at(-1))) corrected += 1;
    else unchanged += 1;
  }
  return {
    provider: "OFFICIAL_LOCAL",
    endpoint: PROVIDER_ENDPOINTS.OFFICIAL_LOCAL,
    source_files: sourceFiles,
    inserted,
    corrected,
    unchanged,
    invalid,
    rejected_rows: rejectedRows,
    symbols_touched: grouped.size
  };
}

async function cacheCoverage(cacheRoot, expectedSession) {
  const files = (await readdir(cacheRoot).catch(() => [])).filter(x => x.endsWith(".json"));
  let current = 0;
  let valid = 0;
  for (const file of files) {
    try {
      const record = JSON.parse(await readFile(resolve(cacheRoot, file), "utf8"));
      if (record.data_as_of === expectedSession) current += 1;
      if (validateSeries(record.bars, { minimumBars: Math.min(252, record.bars?.length || 0), expectedSession }).ok) valid += 1;
    } catch {
      // Audit separately reports malformed records.
    }
  }
  return {
    total_records: files.length,
    current_records: current,
    valid_current_records: valid,
    current_coverage_pct: files.length ? Number((100 * current / files.length).toFixed(2)) : 0
  };
}

async function cachedRecords(cacheRoot) {
  const names = (await readdir(cacheRoot).catch(() => [])).filter(x => x.endsWith(".json"));
  const records = [];
  for (const name of names) {
    try { records.push(JSON.parse(await readFile(resolve(cacheRoot, name), "utf8"))); }
    catch { /* ignore malformed cache records */ }
  }
  return records;
}

async function prioritySymbols(scanPath = DEFAULT_LAST_GOOD_SCAN_PATH) {
  try {
    const scan = JSON.parse(await readFile(scanPath, "utf8"));
    const symbols = new Set();
    for (const list of HIGH_PRIORITY_SCAN_LISTS) {
      for (const item of scan[list] || []) {
        if (item?.symbol) symbols.add(normalizeSymbol(item.symbol));
      }
    }
    return symbols;
  } catch {
    return new Set();
  }
}

function parseTapetideBar(payload, expectedSession) {
  const row = payload?.data?.bar || payload?.data || payload?.bar || payload;
  return normalizeBar({
    date: row.date || row.trading_date || row.TradDt || expectedSession,
    open: row.open ?? row.open_price,
    high: row.high ?? row.high_price,
    low: row.low ?? row.low_price,
    close: row.close ?? row.price ?? row.ltp,
    volume: row.volume ?? row.traded_volume,
    turnover: row.turnover ?? row.value
  });
}

function parseYahooBar(payload, expectedSession) {
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp || [];
  if (!quote || !timestamps.length) return null;
  for (let i = timestamps.length - 1; i >= 0; i -= 1) {
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    if (date !== expectedSession) continue;
    return normalizeBar({
      date,
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      close: quote.close?.[i],
      volume: quote.volume?.[i]
    });
  }
  return null;
}

function parseEodhdBar(payload, expectedSession) {
  const rows = Array.isArray(payload) ? payload : payload?.data;
  const row = rows?.find(item => normalizeDate(item.date) === expectedSession) || rows?.[0];
  if (!row) return null;
  return normalizeBar({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    adjusted_close: row.adjusted_close || row.adjustedClose || row.close,
    volume: row.volume
  });
}

async function fetchJson(url, fetcher, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 AURORA/2.18.2"
      }
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackUrl(provider, record, expectedSession) {
  const symbol = normalizeSymbol(record.symbol);
  if (provider === "TAPETIDE") {
    const template = process.env.TAPETIDE_DAILY_BAR_URL_TEMPLATE;
    if (!template) return null;
    return template
      .replaceAll("{symbol}", encodeURIComponent(symbol))
      .replaceAll("{exchange}", encodeURIComponent(record.exchange || "NSE"))
      .replaceAll("{session}", encodeURIComponent(expectedSession));
  }
  if (provider === "YAHOO") {
    const { start, end } = sessionToUnix(expectedSession);
    return `${PROVIDER_ENDPOINTS.YAHOO}${encodeURIComponent(symbol + exchangeSuffix(record, provider))}?period1=${start}&period2=${end}&interval=1d&events=history`;
  }
  if (provider === "EODHD") {
    const token = process.env.EODHD_API_TOKEN;
    if (!token) return null;
    return `${PROVIDER_ENDPOINTS.EODHD}${encodeURIComponent(symbol + exchangeSuffix(record, provider))}?from=${expectedSession}&to=${expectedSession}&period=d&fmt=json&api_token=${encodeURIComponent(token)}`;
  }
  return null;
}

async function fetchFallbackBar(provider, record, expectedSession, fetcher, timeoutMs) {
  const url = fallbackUrl(provider, record, expectedSession);
  if (!url) return { bar: null, warning: `${provider}_NOT_CONFIGURED` };
  const payload = await fetchJson(url, fetcher, timeoutMs);
  const bar = provider === "TAPETIDE"
    ? parseTapetideBar(payload, expectedSession)
    : provider === "YAHOO"
      ? parseYahooBar(payload, expectedSession)
      : parseEodhdBar(payload, expectedSession);
  if (!bar || bar.date !== expectedSession) return { bar: null, warning: `${provider}_NO_COMPLETED_BAR` };
  return { bar, endpoint: url.replace(/api_token=[^&]+/i, "api_token=***") };
}

export async function appendProviderConsistentFallback({
  provider,
  expectedSession,
  cacheRoot = DEFAULT_CACHE_ROOT,
  lastGoodScanPath = DEFAULT_LAST_GOOD_SCAN_PATH,
  fetcher = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxSymbols = Number(process.env.AURORA_DAILY_FALLBACK_SYMBOL_LIMIT || 250),
  allowProviderRepair = process.env.AURORA_ALLOW_DATA_REPAIR_FALLBACK !== "0"
} = {}) {
  const retrievedAt = new Date().toISOString();
  const priorities = await prioritySymbols(lastGoodScanPath);
  const records = (await cachedRecords(cacheRoot))
    .filter(record => record.data_as_of !== expectedSession && isEquityRecord(record))
    .sort((a, b) => {
      const aPriority = priorities.has(normalizeSymbol(a.symbol)) ? 1 : 0;
      const bPriority = priorities.has(normalizeSymbol(b.symbol)) ? 1 : 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return averageTurnover(b) - averageTurnover(a);
    });
  const report = {
    provider,
    endpoint: PROVIDER_ENDPOINTS[provider],
    requested: 0,
    inserted: 0,
    corrected: 0,
    unchanged: 0,
    invalid: 0,
    skipped_no_blend: 0,
    missing_bar: 0,
    warnings: []
  };
  for (const record of records) {
    if (report.requested >= maxSymbols) break;
    const existingFamily = providerFamily(record.provider);
    if (existingFamily !== provider && !(allowProviderRepair && existingFamily !== "UNKNOWN")) {
      report.skipped_no_blend += 1;
      continue;
    }
    report.requested += 1;
    try {
      const { bar, endpoint, warning } = await fetchFallbackBar(provider, record, expectedSession, fetcher, timeoutMs);
      if (warning) report.warnings.push({ symbol: record.symbol, warning });
      if (!bar) { report.missing_bar += 1; continue; }
      const old = record.bars.find(row => row.date === expectedSession);
      const bars = mergeBars(record.bars, [bar], 420);
      const validation = validateSeries(bars, { minimumBars: Math.min(252, bars.length), expectedSession });
      if (!validation.ok) { report.invalid += 1; continue; }
      await saveSymbol(cacheRoot, {
        ...record,
        schema_version: CACHE_SCHEMA_VERSION,
        provider: existingFamily === provider ? record.provider : `${provider}_DATA_REPAIR`,
        endpoint: endpoint || PROVIDER_ENDPOINTS[provider],
        retrieved_at: retrievedAt,
        data_as_of: expectedSession,
        fallback_label: fallbackLabel(provider),
        fallback_reason: existingFamily === provider ? "PROVIDER_CONSISTENT_DAILY_APPEND" : "DATA_REPAIR_PROVIDER_FALLBACK_MARKED",
        warnings: [
          ...(record.warnings || []),
          ...(existingFamily === provider ? [] : [`DATA_REPAIR_FALLBACK_FROM_${existingFamily}_TO_${provider}`])
        ],
        bars
      });
      if (!old) report.inserted += 1;
      else if (JSON.stringify(old) !== JSON.stringify(bar)) report.corrected += 1;
      else report.unchanged += 1;
    } catch (error) {
      report.warnings.push({ symbol: record.symbol, warning: error.message });
    }
  }
  return report;
}

async function officialFetch(session, destination) {
  await mkdir(destination, { recursive: true });
  const yyyymmdd = compactSession(session);
  const ddmmyyyy = `${session.slice(8, 10)}${session.slice(5, 7)}${session.slice(0, 4)}`;
  const ddmmyy = `${session.slice(8, 10)}${session.slice(5, 7)}${session.slice(2, 4)}`;
  const urls = [
    `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${yyyymmdd}_F_0000.csv.zip`,
    `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy}.csv`,
    `https://www.bseindia.com/download/BhavCopy/Equity/EQ_ISINCODE_${ddmmyy}.zip`
  ];
  const downloaded = [];
  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 AURORA/2.18.2",
          referer: url.includes("bseindia.com") ? "https://www.bseindia.com/" : "https://www.nseindia.com/"
        }
      });
      if (!response.ok) continue;
      const filename = basename(new URL(url).pathname);
      const output = resolve(destination, filename);
      await writeFile(output, Buffer.from(await response.arrayBuffer()));
      downloaded.push(output);
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!downloaded.length) throw new Error(`OFFICIAL_FETCH_BLOCKED: download the NSE/BSE session bhavcopy in a browser and place it in ${destination}`);
  return downloaded;
}

async function writeReport(reportPath, report) {
  await mkdir(resolve(reportPath, ".."), { recursive: true });
  const temporary = `${reportPath}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2), "utf8");
  await rename(temporary, reportPath);
}

function compactCandidate(item) {
  if (!item) return null;
  return {
    symbol: item.symbol,
    exchange: item.exchange,
    sector: item.aurora_theme || item.gics_sector || item.sector || null,
    price: item.price,
    setup_label: item.setup_label || item.final_bucket || null,
    execution_permission: item.execution_permission || item.entry_permission || null,
    trigger: item.trigger,
    entry_stop: item.entry_stop,
    entry_risk_pct: item.entry_risk_pct,
    thesis_stop: item.thesis_stop,
    thesis_risk_pct: item.thesis_risk_pct,
    rs_rating: item.rs_rating,
    rs21_state: item.rs21_state,
    basepivot_status: item.basepivot_status,
    rmvp_status: item.rmvp_status,
    pbx_score: item.pbx_score,
    ve2_signature_label: item.ve2_signature_label,
    base_stage_count: item.base_stage_count,
    user_note: item.user_note || item.next_condition || null
  };
}

async function buildFallbackDecisionPack({
  scanPath = DEFAULT_LAST_GOOD_SCAN_PATH,
  expectedSession
} = {}) {
  try {
    const scan = JSON.parse(await readFile(scanPath, "utf8"));
    return {
      status: "LAST_GOOD_DECISION_PACK",
      warning: "DATA_REFRESH_BLOCKED: this pack is from the last-good scan and must not be treated as current data.",
      blocked_session: expectedSession,
      source_scan_data_as_of: scan.data_as_of || null,
      source_scan_generated_at: scan.generated_at || null,
      market_context: scan.market_context || null,
      weekly_universe: (scan.weekly_universe || []).slice(0, 20).map(compactCandidate).filter(Boolean),
      daily_top_1_4: (scan.daily_top_1_4 || []).slice(0, 4).map(compactCandidate).filter(Boolean),
      rsle_top20: (scan.rsle_top20 || []).slice(0, 20).map(compactCandidate).filter(Boolean),
      developing_watchlist_20: (scan.developing_watchlist_20 || []).slice(0, 20).map(compactCandidate).filter(Boolean),
      sector_leadership: (scan.sector_rrg || []).slice(0, 10)
    };
  } catch (error) {
    return {
      status: "LAST_GOOD_DECISION_PACK_NOT_AVAILABLE",
      warning: error.message,
      blocked_session: expectedSession
    };
  }
}

export async function refreshIndiaDailyBars({
  cacheRoot = DEFAULT_CACHE_ROOT,
  rawRoot = DEFAULT_RAW_ROOT,
  reportPath = DEFAULT_REPORT_PATH,
  lastGoodScanPath = DEFAULT_LAST_GOOD_SCAN_PATH,
  expectedSession = latestCompletedIndiaSession(),
  minCurrentCoverage = DEFAULT_MIN_CURRENT_COVERAGE,
  localSources = [
    resolve(projectRoot, "data/incoming", compactSession(expectedSession)),
    resolve(projectRoot, "data/incoming", expectedSession),
    resolve(rawRoot, expectedSession)
  ],
  tryOfficialFetch = true,
  providerOrder = ["TAPETIDE", "YAHOO", "EODHD"],
  fetcher = fetch,
  now = new Date()
} = {}) {
  const retrievedAt = new Date().toISOString();
  const attempts = [];
  const warnings = [];
  const acceptable = async () => {
    const coverage = await cacheCoverage(cacheRoot, expectedSession);
    return { coverage, ok: coverage.valid_current_records > 0 && (coverage.current_records / Math.max(1, coverage.total_records)) >= minCurrentCoverage };
  };

  let state = await acceptable();
  if (state.ok) {
    const report = {
      status: "ALREADY_CURRENT_OR_UNCHANGED",
      provider: "CACHE",
      endpoint: "cache/india/ohlcv",
      retrieved_at: retrievedAt,
      expected_completed_session: expectedSession,
      latest_data_as_of: expectedSession,
      fallback_label: "OFFICIAL_VERIFIED",
      fallback_reason: "CACHE_ALREADY_HAS_EXPECTED_COMPLETED_SESSION",
      coverage: state.coverage,
      attempts,
      warnings
    };
    await writeReport(reportPath, report);
    return report;
  }

  for (const source of localSources) {
    if (!await exists(source)) continue;
    try {
      const attempt = await appendOfficialSource({ sourceRoot: source, expectedSession, cacheRoot, rawRoot, retrievedAt });
      attempts.push(attempt);
      state = await acceptable();
      if (state.ok) {
        const report = {
          status: "UPDATED",
          provider: "OFFICIAL_LOCAL",
          endpoint: source,
          retrieved_at: retrievedAt,
          expected_completed_session: expectedSession,
          latest_data_as_of: expectedSession,
          fallback_label: "OFFICIAL_VERIFIED",
          fallback_reason: "LOCAL_OFFICIAL_DAILY_APPEND",
          coverage: state.coverage,
          attempts,
          warnings
        };
        await writeReport(reportPath, report);
        return report;
      }
    } catch (error) {
      warnings.push({ provider: "OFFICIAL_LOCAL", source, warning: error.message });
    }
  }

  if (tryOfficialFetch) {
    const destination = resolve(rawRoot, expectedSession);
    try {
      await officialFetch(expectedSession, destination);
      const attempt = await appendOfficialSource({ sourceRoot: destination, expectedSession, cacheRoot, rawRoot, retrievedAt });
      attempts.push({ ...attempt, provider: "NSE_OFFICIAL_FETCH", endpoint: PROVIDER_ENDPOINTS.NSE_OFFICIAL_FETCH });
      state = await acceptable();
      if (state.ok) {
        const report = {
          status: "UPDATED",
          provider: "NSE_OFFICIAL_FETCH",
          endpoint: PROVIDER_ENDPOINTS.NSE_OFFICIAL_FETCH,
          retrieved_at: retrievedAt,
          expected_completed_session: expectedSession,
          latest_data_as_of: expectedSession,
          fallback_label: "OFFICIAL_VERIFIED",
          fallback_reason: "OFFICIAL_NSE_FETCH_DAILY_APPEND",
          coverage: state.coverage,
          attempts,
          warnings
        };
        await writeReport(reportPath, report);
        return report;
      }
    } catch (error) {
      warnings.push({ provider: "NSE_OFFICIAL_FETCH", warning: error.message });
    }
  }

  for (const provider of providerOrder) {
    const attempt = await appendProviderConsistentFallback({ provider, expectedSession, cacheRoot, fetcher });
    attempts.push(attempt);
    state = await acceptable();
    if (state.ok) {
      const report = {
        status: "UPDATED",
        provider,
        endpoint: PROVIDER_ENDPOINTS[provider],
        retrieved_at: retrievedAt,
        expected_completed_session: expectedSession,
        latest_data_as_of: expectedSession,
        fallback_label: fallbackLabel(provider),
        fallback_reason: "PROVIDER_CONSISTENT_DAILY_APPEND",
        coverage: state.coverage,
        attempts,
        warnings
      };
      await writeReport(reportPath, report);
      return report;
    }
  }

  const fallbackDecisionPack = await buildFallbackDecisionPack({ scanPath: lastGoodScanPath, expectedSession });
  const report = {
    status: "DATA_REFRESH_BLOCKED",
    provider: "NONE",
    endpoint: null,
    retrieved_at: retrievedAt,
    expected_completed_session: expectedSession,
    latest_data_as_of: null,
    fallback_label: "NOT_AVAILABLE",
    fallback_reason: "NO_PROVIDER_REFRESHED_EXPECTED_COMPLETED_SESSION_WITH_VALID_PROVIDER_CONSISTENCY",
    coverage: state.coverage,
    attempts,
    warnings,
    fallback_decision_pack: fallbackDecisionPack
  };
  await writeReport(reportPath, report);
  const error = new Error("DATA_REFRESH_BLOCKED");
  error.report = report;
  throw error;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const expectedSession = process.argv.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg)) || process.env.AURORA_TARGET_SESSION || latestCompletedIndiaSession();
  try {
    const report = await refreshIndiaDailyBars({ expectedSession });
    console.log(JSON.stringify(report));
  } catch (error) {
    if (error.report) console.error(JSON.stringify(error.report));
    throw error;
  }
}
