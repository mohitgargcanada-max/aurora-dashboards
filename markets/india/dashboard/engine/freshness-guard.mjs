import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { validateSeries } from "./cache-store.mjs";

export const INDIA_PROVIDER_ROUTE = "OFFICIAL_NSE_BSE_LOCAL_FIRST_YAHOO_SECOND_TAPETIDE_THIRD_EODHD_INDIA_EXPLICIT_OPT_IN";

async function loadJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function deriveExpectedCompletedSession({ refreshReportPath, explicitSession = null, stockCacheRoot = null } = {}) {
  const report = refreshReportPath ? await loadJsonIfExists(refreshReportPath) : null;
  if (report?.expected_completed_session) return report.expected_completed_session;
  if (report?.expected_session) return report.expected_session;
  if (explicitSession) return explicitSession;
  if (!stockCacheRoot) return null;

  const sessions = [];
  let files = [];
  try {
    files = await readdir(stockCacheRoot);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  for (const file of files.filter(x => x.endsWith(".json"))) {
    const record = await loadJsonIfExists(resolve(stockCacheRoot, file));
    if (!record?.data_as_of || !["NSE", "BSE"].includes(record.exchange)) continue;
    if (!String(record.provider || "").includes("OFFICIAL")) continue;
    sessions.push(record.data_as_of);
  }
  return sessions.sort().at(-1) || null;
}

export function auditIndexRecords(records, { expectedSession = null, expectedCount = 18, minimumBars = 252 } = {}) {
  const audited = records.map(({ text = "", record }) => {
    const structural = validateSeries(record.bars, { minimumBars });
    const stale = Boolean(expectedSession && (!record.data_as_of || record.data_as_of < expectedSession));
    return {
      record,
      stale,
      output: {
        symbol: record.symbol,
        name: record.name,
        provider: record.provider,
        fallback_label: record.fallback_label,
        adjustment_status: record.adjustment_status,
        rows: record.bars?.length || 0,
        first_date: record.bars?.[0]?.date || null,
        data_as_of: record.data_as_of,
        valid: structural.ok && !stale,
        stale,
        failure: stale ? "STALE_INDEX" : structural.ok ? null : structural.code,
        sha256_source: text
      }
    };
  });
  const staleIndices = audited
    .filter(x => x.stale)
    .map(x => ({
      symbol: x.record.symbol,
      provider: x.record.provider,
      data_as_of: x.record.data_as_of || null,
      expected_session: expectedSession
    }));
  const validCount = audited.filter(x => x.output.valid).length;
  const freshCount = audited.filter(x => !x.stale).length;
  return {
    records: audited.map(x => x.output),
    valid_indices: validCount,
    stale_indices: staleIndices,
    stale_count: staleIndices.length,
    coverage_pct: Number((100 * validCount / expectedCount).toFixed(2)),
    freshness_coverage_pct: Number((100 * freshCount / expectedCount).toFixed(2)),
    latest_index_data_as_of: audited.map(x => x.record.data_as_of).filter(Boolean).sort().at(-1) || null,
    blocking_reason: staleIndices.length ? "INDEX_DATA_STALE" : null
  };
}

export function rejectionReasonCounts(rejected) {
  const counts = rejected.reduce((map, item) => {
    const reason = item.reason || "UNKNOWN";
    map.set(reason, (map.get(reason) || 0) + 1);
    return map;
  }, new Map());
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
