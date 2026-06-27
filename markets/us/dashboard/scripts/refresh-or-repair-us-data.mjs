import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { latestCompletedUsSession, refreshDailyBars } from "./refresh-stooq-daily-bars.mjs";
import { repairUsHistory } from "./repair-us-history-5y.mjs";
import { nyseCalendarSummary } from "./us-market-calendar.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const summaryPath = resolve(projectRoot, "data/us-refresh-or-repair-report.json");
const cacheRoot = resolve(projectRoot, "cache/us/ohlcv");

function isCurrent(report) {
  return Boolean(report?.expected_completed_session && report?.latest_data_as_of === report.expected_completed_session);
}

export function isAlreadyCurrentSummary(report, expectedSession) {
  return Boolean(report?.latest_data_as_of === expectedSession);
}

export async function cacheCurrentStatus(expectedSession, root = cacheRoot) {
  let names;
  try {
    names = await readdir(root);
  } catch {
    return { ok: false, total: 0, current: 0, stale: 0, expected_session: expectedSession, stale_samples: ["CACHE_MISSING"] };
  }
  const files = names.filter(name => name.endsWith(".json"));
  const status = { ok: false, total: files.length, current: 0, stale: 0, expected_session: expectedSession, stale_samples: [] };
  for (const file of files) {
    try {
      const record = JSON.parse(await readFile(resolve(root, file), "utf8"));
      if (record?.bars?.at(-1)?.date === expectedSession) status.current += 1;
      else {
        status.stale += 1;
        if (status.stale_samples.length < 5) status.stale_samples.push(`${record?.symbol || file}:${record?.bars?.at(-1)?.date || "NO_DATE"}`);
      }
    } catch {
      status.stale += 1;
      if (status.stale_samples.length < 5) status.stale_samples.push(`${file}:READ_FAILED`);
    }
  }
  status.ok = status.total > 0 && status.stale === 0;
  return status;
}

export async function isCacheCurrent(expectedSession, root = cacheRoot) {
  return (await cacheCurrentStatus(expectedSession, root)).ok;
}

export function chooseDataSource(daily, history) {
  return isCurrent(daily) ? { label: "daily_refresh", report: daily } : { label: "history_repair", report: history };
}

export function markNonFatalDailyFallback(result) {
  if (result?.daily_refresh?.status !== "DATA_REFRESH_BLOCKED" || !isCurrent(result.history_repair)) return result;
  return {
    ...result,
    daily_refresh: {
      ...result.daily_refresh,
      effective_status: "FALLBACK_HISTORY_REPAIR_CURRENT",
      non_fatal: true
    }
  };
}

function buildSkippedResult(previous, expectedSession, skipReason, generatedAt = new Date().toISOString(), extra = {}) {
  const fallbackReport = {
    status: previous?.status || previous?.final_status || "UPDATED",
    expected_completed_session: previous?.expected_completed_session || expectedSession,
    latest_data_as_of: previous?.latest_data_as_of || null,
    provider_counts: previous?.provider_counts || {},
    fallback_label: previous?.fallback_label || "NOT_AVAILABLE"
  };
  return {
    generated_at: generatedAt,
    skipped: true,
    skip_reason: skipReason,
    previous_generated_at: previous?.generated_at || null,
    daily_refresh: previous?.daily_refresh || null,
    history_repair: previous?.history_repair || fallbackReport,
    final_status: "UPDATED",
    ...extra
  };
}

export function buildAlreadyCurrentResult(previous, expectedSession, generatedAt = new Date().toISOString(), cacheStatus = null) {
  return buildSkippedResult(previous, expectedSession, "LOCAL_DATA_ALREADY_CURRENT", generatedAt, {
    calculation_source: "CACHE_ONLY",
    cache_date_status: cacheStatus
  });
}

export function buildCacheCurrentResult(previous, expectedSession, generatedAt = new Date().toISOString(), cacheStatus = null) {
  const cacheReport = {
    status: "UPDATED",
    expected_completed_session: expectedSession,
    latest_data_as_of: expectedSession,
    provider_counts: { CACHE: cacheStatus?.current || 0 },
    fallback_label: "CACHE_ONLY"
  };
  return {
    generated_at: generatedAt,
    skipped: true,
    skip_reason: "EOD_CACHE_ALREADY_CURRENT",
    calculation_source: "CACHE_ONLY",
    cache_date_status: cacheStatus,
    previous_generated_at: previous?.generated_at || null,
    daily_refresh: null,
    history_repair: cacheReport,
    final_status: "UPDATED"
  };
}

export function buildMarketHolidayResult(previous, expectedSession, calendar, generatedAt = new Date().toISOString(), cacheStatus = null) {
  return buildSkippedResult(previous, expectedSession, "NYSE_MARKET_HOLIDAY", generatedAt, {
    calculation_source: "CACHE_ONLY",
    cache_date_status: cacheStatus,
    market_calendar: calendar,
    market_holiday: calendar?.today_holiday || null
  });
}

export function summarizeRefreshOrRepairResult(result) {
  const annotated = markNonFatalDailyFallback(result);
  const source = chooseDataSource(annotated.daily_refresh, annotated.history_repair);
  return {
    ...annotated,
    status: annotated.final_status,
    data_source: source.label,
    expected_completed_session: source.report?.expected_completed_session || annotated.daily_refresh?.expected_completed_session || annotated.history_repair?.expected_completed_session || null,
    latest_data_as_of: source.report?.latest_data_as_of || null,
    provider_counts: source.report?.provider_counts || {},
    fallback_label: source.report?.fallback_label || "NOT_AVAILABLE"
  };
}

async function persist(result) {
  await mkdir(resolve(summaryPath, ".."), { recursive: true });
  await writeFile(summaryPath, JSON.stringify(summarizeRefreshOrRepairResult(result), null, 2), "utf8");
}

async function readPreviousSummary() {
  try {
    return JSON.parse(await readFile(summaryPath, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const allowStale = process.argv.includes("--allow-stale") || process.env.AURORA_ALLOW_STALE_REFRESH === "1";
  const forceRefresh = process.argv.includes("--force-refresh") || process.env.AURORA_FORCE_REFRESH === "1";
  const expectedSession = latestCompletedUsSession();
  const calendar = nyseCalendarSummary();
  if (!forceRefresh) {
    const previous = await readPreviousSummary();
    const cacheStatus = await cacheCurrentStatus(expectedSession);
    if (isAlreadyCurrentSummary(previous, expectedSession) && cacheStatus.ok) {
      const skipped = calendar.is_market_holiday
        ? buildMarketHolidayResult(previous, expectedSession, calendar, undefined, cacheStatus)
        : buildAlreadyCurrentResult(previous, expectedSession, undefined, cacheStatus);
      await persist(skipped);
      console.log(JSON.stringify(summarizeRefreshOrRepairResult(skipped)));
      return;
    }
    if (cacheStatus.ok) {
      const skipped = buildCacheCurrentResult(previous, expectedSession, undefined, cacheStatus);
      await persist(skipped);
      console.log(JSON.stringify(summarizeRefreshOrRepairResult(skipped)));
      return;
    }
  }
  const strictCurrent = !allowStale;
  const result = { generated_at: new Date().toISOString(), daily_refresh: null, history_repair: null, final_status: null };
  try {
    const daily = await refreshDailyBars({ allowStale: false });
    result.daily_refresh = daily;
    result.final_status = daily.status;
    if (!isCurrent(daily) && !allowStale) throw new Error("US daily refresh completed but latest bar is not the expected completed session");
    try {
      result.history_repair = await repairUsHistory({ staleOnly: true, strictCurrent: false, allowStale: true });
    } catch (repairAfterDailyError) {
      result.history_repair = repairAfterDailyError.report || { status: "FAILED_AFTER_DAILY_REFRESH", warning: repairAfterDailyError.message };
    }
  } catch (error) {
    result.daily_refresh = error.report || { status: "FAILED", warning: error.message };
    try {
      const repair = await repairUsHistory({ staleOnly: true, strictCurrent, allowStale });
      result.history_repair = repair;
      result.final_status = repair.status;
      if (!isCurrent(repair) && !allowStale) {
        const staleError = new Error("US 5Y history repair finished but did not reach the expected completed session");
        staleError.report = result;
        throw staleError;
      }
    } catch (repairError) {
      result.history_repair = repairError.report || { status: "FAILED", warning: repairError.message };
      result.final_status = "DATA_REFRESH_BLOCKED";
      await persist(result);
      if (!allowStale) {
        const finalError = new Error("US data refresh and current-session 5Y repair both failed");
        finalError.report = result;
        throw finalError;
      }
    }
  }
  await persist(result);
  console.log(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    if (error.report) console.error(JSON.stringify(error.report));
    throw error;
  });
}
