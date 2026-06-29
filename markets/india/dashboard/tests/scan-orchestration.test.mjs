import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatternQualityExecutionCap } from "../../../shared/pattern-quality-execution-cap.mjs";
import {
  buildWeeklyUniverseForMode,
  FINAL_BUCKETS,
  runLightweightFullUniverseDiscovery,
  scanRunMetadata,
  SCAN_MODES
} from "../../../shared/scan-orchestration.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataPlane = JSON.parse(await readFile(resolve(root, "config/india_data_plane.json"), "utf8"));
assert.equal(dataPlane.market, "INDIA");
assert.equal(dataPlane.benchmarks.broad, "NIFTY500.INDX");
assert.equal(dataPlane.discovery_policy.liquidity_is_discovery_gate, false);

function row(symbol, overrides = {}) {
  return {
    symbol,
    exchange: "NSE",
    source_lane: "NSE_CORE",
    final_bucket: "TRIGGER_READY",
    weekly_tier: "WEEKLY_FOCUS",
    weekly_watchlist_score: 80,
    leadership_score: 75,
    total_score: 70,
    addv20_inr: 100_000_000,
    entry_risk_pct: 4,
    trigger: 100,
    entry_stop: 96,
    market_permission: "TRADE_ALLOWED",
    aurora_theme: "Defence",
    ...overrides
  };
}

const ranked = [row("NEW"), row("AAA"), row("BBB")];
const full = buildWeeklyUniverseForMode({
  mode: SCAN_MODES.SUNDAY_FULL_REBUILD,
  rankedCandidates: ranked.slice(0, 2),
  featureMatrix: ranked,
  session: "2026-06-29",
  generatedAt: "2026-06-29T22:00:00.000Z",
  market: "INDIA"
});
assert.deepEqual(full.weeklyContract.weekly_universe_symbols, ["NEW", "AAA"]);
assert.equal(full.weeklyContract.market, "INDIA");

const previousContract = {
  market: "INDIA",
  weekly_contract_id: "INDIA-2026-W27-2026-06-29",
  weekly_list_created_asof: "2026-06-29",
  weekly_universe_symbols: ["AAA", "BBB"],
  daily_status: {},
  removal_flag: {},
  removal_reason: {}
};
const weekday = buildWeeklyUniverseForMode({
  mode: SCAN_MODES.WEEKDAY_EOD_UPDATE,
  previousContract,
  rankedCandidates: ranked,
  featureMatrix: [
    row("NEW"),
    row("AAA", { trigger_gap_pct: 0.5, entry_risk_pct: 6, caution: "temporary pullback", next_condition: "TRIGGER_ACCEPTANCE" }),
    row("BBB", { thesis_risk_pct: 24, axm21_label: "AXM21_EXTENDED", caution: "wide thesis risk context" })
  ],
  session: "2026-06-30",
  generatedAt: "2026-06-30T22:00:00.000Z",
  market: "INDIA"
});
assert.deepEqual(weekday.weeklyContract.weekly_universe_symbols, ["AAA", "BBB"]);
assert.equal(weekday.weeklyUniverse.some(item => item.symbol === "NEW"), false);
assert.equal(weekday.weeklyUniverse.find(item => item.symbol === "AAA").entry_risk_pct, 6);
assert.equal(weekday.weeklyUniverse.find(item => item.symbol === "AAA").next_condition, "TRIGGER_ACCEPTANCE");
assert.equal(weekday.weeklyUniverse.find(item => item.symbol === "BBB").removal_flag, false);

const hardRemoved = buildWeeklyUniverseForMode({
  mode: SCAN_MODES.WEEKDAY_EOD_UPDATE,
  previousContract,
  rankedCandidates: ranked,
  featureMatrix: [row("AAA"), row("BBB", { final_bucket: "AVOID_FRESH_LONG", stage_label: "STAGE_4" }), row("NEW")],
  session: "2026-06-30",
  generatedAt: "2026-06-30T22:00:00.000Z",
  market: "INDIA"
});
assert.deepEqual(hardRemoved.weeklyContract.weekly_universe_symbols, ["AAA"]);
assert.equal(hardRemoved.weeklyContract.removal_flag.BBB, true);

const discovery = runLightweightFullUniverseDiscovery({ market: "INDIA", session: "2026-06-30", cache: { featureMatrix: ranked } });
assert.equal(discovery.calculated_symbols, 3);
assert.equal(discovery.ohlcv_fetch_calls, 0);

const weeklyFocus = weekday.weeklyUniverse.filter(item => item.weekly_tier === "WEEKLY_FOCUS");
const dailyTop = weeklyFocus.filter(item => item.final_bucket === "TRIGGER_READY").slice(0, 4);
assert.ok(dailyTop.every(item => ["AAA", "BBB"].includes(item.symbol)));
assert.ok(dailyTop.length <= 4);
const rsleTop20 = [row("NEW", { rank: 1 }), row("AAA", { rank: 2 })];
assert.ok(rsleTop20.some(item => item.symbol === "NEW"));
assert.equal(weekday.weeklyContract.weekly_universe_symbols.includes("NEW"), false);
assert.ok(rsleTop20.length <= 20);

const mockIn = applyPatternQualityExecutionCap(row("MOCKIN", {
  rs_trifecta_label: "FAIL",
  rs_rating: 99,
  rs21_state: "RS21_RECLAIM_0D",
  rrg: { quadrant: "IMPROVING" },
  base_stage_risk: "BASE_4_LATE_STAGE_RISK",
  basepivot_quality: "BASEPIVOT_QUALITY_C",
  basepivot_status: "BASEPIVOT_ACTIVE_AFTER_WEAK_BREAKOUT",
  pattern_proxy: "BASE_ON_BASE_POSSIBLE",
  pbx_duration_label: "PBX_STALE",
  ve2_distribution_label: "DISTRIBUTION_PRESENT",
  entry_risk_pct: 1.1
})).candidate;
assert.equal(mockIn.pattern_quality_execution_cap, true);
assert.notEqual(mockIn.final_bucket, "TRIGGER_READY");
assert.equal([mockIn].filter(item => !item.pattern_quality_execution_cap && item.final_bucket === "TRIGGER_READY").length, 0);
assert.ok(mockIn.promotion_block_reason.includes("PATTERN_QUALITY_EXECUTION_CAP"));
assert.ok(["EARLY_ENTRY_WATCH", "RSNH_WATCH_ONLY"].includes(mockIn.final_bucket));
assert.equal(mockIn.rs_trifecta_label, "FAIL");

const metadata = scanRunMetadata({
  mode: SCAN_MODES.WEEKDAY_EOD_UPDATE,
  reason: "CLI_MODE_EXPLICIT",
  market: "INDIA",
  dataAsOf: "2026-06-30",
  completedSession: "2026-06-30",
  generatedAt: "2026-06-30T22:00:00.000Z",
  weeklyContract: weekday.weeklyContract,
  discovery,
  expectedSymbols: 4,
  loadedSymbols: 4,
  validLatestSymbols: 3,
  calculatedSymbols: 3
});
assert.equal(metadata.coverage_pct, 75);
assert.equal(metadata.market, "INDIA");
assert.deepEqual(FINAL_BUCKETS, [
  "TRADE_READY",
  "TRIGGER_READY",
  "EARLY_ENTRY_WATCH",
  "PULLBACK_WATCH",
  "RSNH_WATCH_ONLY",
  "NO_CHASE",
  "PROTECT_PROFIT_REVIEW",
  "REPAIR_WATCH",
  "AVOID_FRESH_LONG"
]);
assert.equal(ranked[0].weekly_watchlist_score, 80);

console.log("India scan orchestration cadence tests passed");
