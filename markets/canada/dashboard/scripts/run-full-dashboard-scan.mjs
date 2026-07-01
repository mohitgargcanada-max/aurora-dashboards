import { access, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJson } from "../engine/cache-store.mjs";
import { auditIndexRecords, coverageGuard, rejectionReasonCounts } from "../engine/freshness-guard.mjs";
import { buildCanadaFeatureMatrix, buildDashboardModel, renderCanadaDashboard } from "../engine/scan-engine.mjs";
import { latestCompletedCanadaSession } from "../engine/trading-calendar.mjs";
import { parseScanArgs, resolveScanMode, scanRunMetadata } from "../../../shared/scan-orchestration.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ohlcvRoot = resolve(root, "cache/canada/ohlcv");
const indexRoot = resolve(root, "cache/canada/indices");
const dataRoot = resolve(root, "data");
const universePath = resolve(root, "config/canada-universe-seed.json");
const dashboardPath = resolve(root, "..", "AURORA_Canada_Unified_Dashboard.html");
const scanPath = resolve(dataRoot, "canada-full-dashboard-scan.json");
const weeklyContractPath = resolve(dataRoot, "canada-weekly-contract.json");
const cliOptions = parseScanArgs(process.argv.slice(2));
const scanMode = resolveScanMode({ mode: cliOptions.mode || "SUNDAY_FULL_REBUILD" });
const expectedSession = cliOptions.session || process.env.AURORA_TARGET_SESSION || latestCompletedCanadaSession();
const canadaRoute = "OFFICIAL_CANADA_LISTINGS -> YAHOO_FINANCE -> EODHD_FALLBACK";
const generatedAt = new Date().toISOString();

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function loadRecords(dir) {
  try {
    const files = await readdir(dir);
    return (await Promise.all(files.filter(f => f.endsWith(".json")).map(f => readJson(resolve(dir, f))))).filter(Boolean);
  } catch { return []; }
}

if (!(await exists(ohlcvRoot))) {
  console.error("Canada stock cache missing; running free-first stock bootstrap.");
  await import("./backfill-canada-history.mjs");
}
if (!(await exists(indexRoot))) {
  console.error("Canada index cache missing; running free-first index bootstrap.");
  await import("./refresh-canada-index-bars.mjs");
}

const universe = await readJson(universePath, []);
const stockRecords = await loadRecords(ohlcvRoot);
const indexRecords = await loadRecords(indexRoot);
const benchmarkRecord = indexRecords.find(x => x?.symbol === "^GSPTSE");
const indexAudit = auditIndexRecords(indexRecords, expectedSession);
const coverage = coverageGuard({ expectedSession, records: stockRecords });
const blocked = [];
if (indexAudit.status !== "INDEX_FRESHNESS_OK") blocked.push(indexAudit.status);
if (coverage.status !== "COVERAGE_OK") blocked.push(coverage.status);
if (!benchmarkRecord?.bars?.length) blocked.push("MISSING_BENCHMARK_BLOCKED");

await mkdir(dataRoot, { recursive: true });
await writeJson(resolve(dataRoot, "canada-index-cache-audit.json"), indexAudit);

if (blocked.length) {
  const report = {
    market: "CANADA",
    status: blocked[0],
    blocked_reasons: blocked,
    expected_completed_session: expectedSession,
    expected_session: expectedSession,
    latest_stock_data_as_of: stockRecords.map(x => x.data_as_of).sort().at(-1) || null,
    latest_index_data_as_of: indexRecords.map(x => x.data_as_of).sort().at(-1) || null,
    route: canadaRoute,
    stale_symbols: indexAudit.stale_symbols,
    blocking_stale_symbols: indexAudit.blocking_stale_symbols,
    optional_stale_symbols: indexAudit.optional_stale_symbols,
    coverage,
    index_audit: indexAudit,
    provider_route: indexAudit.provider_route,
    feature_matrix_count: 0,
    scanned_candidates: 0,
    rejected_count: 0,
    rejection_reason_counts: {},
    next_condition: "Refresh Canada Yahoo/EODHD caches for the expected completed session. Preserve last-good dashboard."
  };
  await writeJson(resolve(dataRoot, "canada-daily-refresh-report.json"), report);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const { rows, rejected } = buildCanadaFeatureMatrix({ universe, stockRecords, benchmarkRecord, expectedSession });
if (!rows.length) {
  const report = {
    market: "CANADA",
    status: "EMPTY_SCAN_BLOCKED",
    expected_completed_session: expectedSession,
    expected_session: expectedSession,
    latest_stock_data_as_of: stockRecords.map(x => x.data_as_of).sort().at(-1) || null,
    latest_index_data_as_of: indexRecords.map(x => x.data_as_of).sort().at(-1) || null,
    route: canadaRoute,
    stale_symbols: [],
    feature_matrix_count: 0,
    scanned_candidates: 0,
    rejected_count: rejected.length,
    rejection_reason_counts: rejectionReasonCounts(rejected),
    next_condition: "Repair Canada feature inputs until at least one benchmark-aligned EOD candidate is valid."
  };
  await writeJson(resolve(dataRoot, "canada-daily-refresh-report.json"), report);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
const previousWeeklyContract = await readJson(weeklyContractPath, null);
const model = buildDashboardModel({ rows, rejected, indexAudit, coverage, expectedSession, scanMode: scanMode.run_mode, previousWeeklyContract, generatedAt, benchmarkRecord });
const latestStockDataAsOf = stockRecords.map(x => x.data_as_of).sort().at(-1);
const metadata = scanRunMetadata({
  mode: scanMode.run_mode,
  reason: scanMode.run_mode_reason,
  market: "CANADA",
  dataAsOf: latestStockDataAsOf,
  completedSession: expectedSession,
  generatedAt,
  weeklyContract: model.weeklyContract,
  discovery: model.discovery,
  expectedSymbols: coverage.loaded_symbols,
  loadedSymbols: coverage.loaded_symbols,
  validLatestSymbols: coverage.current_symbols,
  calculatedSymbols: rows.length,
  warnings: model.cadenceWarnings
});
const scan = { market: "CANADA", ...metadata, expected_completed_session: expectedSession, latest_stock_data_as_of: latestStockDataAsOf, latest_index_data_as_of: indexRecords.map(x => x.data_as_of).sort().at(-1), route: canadaRoute, provider_route: indexAudit.provider_route, coverage, index_context_status: indexAudit.context_status, market_confirmation: model.marketConfirmation, feature_matrix_count: rows.length, scanned_candidates: rows.length, rejected_count: model.rejected.length, soft_rs_recovered_count: model.softRsRecoveredCount, rejection_reason_counts: rejectionReasonCounts(model.rejected), weekly_contract: model.weeklyContract, weekly_universe: model.weeklyUniverse, weekly_focus: model.weeklyFocus, daily_top_1_4: model.dailyTop, rsle_top_20: model.rsleTop20, developing_watchlist_next_20: model.developing, industry_group_rrg: model.industryGroupRrg, industry_rrg: model.industryRrg, sub_industry_rrg: model.subIndustryRrg, aurora_radar_universe: model.auroraRadarUniverse, strong_rs_retention: model.strongRsRetention, soft_rs_reject_recovered: model.softRsRecoveredRows, myh_approaching: model.myhApproachingRows, myh_breakout_retest: model.myhBreakoutRetests, ma10_respect: model.ma10Respect, ma21_respect: model.ma21Respect, ma50_respect: model.ma50Respect, rejected: model.rejected };
await writeJson(weeklyContractPath, model.weeklyContract);
await writeJson(scanPath, scan);
await writeJson(resolve(dataRoot, "canada-daily-refresh-report.json"), { market: "CANADA", status: "FULL_LOCAL_SCAN", ...metadata, expected_completed_session: expectedSession, latest_stock_data_as_of: scan.latest_stock_data_as_of, latest_index_data_as_of: scan.latest_index_data_as_of, route: canadaRoute, coverage, index_context_status: indexAudit.context_status, optional_stale_symbols: indexAudit.optional_stale_symbols, feature_matrix_count: rows.length, scanned_candidates: rows.length, rejected_count: model.rejected.length, soft_rs_recovered_count: model.softRsRecoveredCount, rejection_reason_counts: scan.rejection_reason_counts, provider_route: indexAudit.provider_route });
const html = renderCanadaDashboard(model);
const tmp = `${dashboardPath}.tmp`;
await writeFile(tmp, html);
await rename(tmp, dashboardPath);
console.log(JSON.stringify({ status: "FULL_LOCAL_SCAN", expected_completed_session: expectedSession, rows: rows.length, daily_top: model.dailyTop.length, index_context_status: indexAudit.context_status }, null, 2));
