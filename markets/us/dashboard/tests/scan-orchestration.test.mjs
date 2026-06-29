import assert from "node:assert/strict";
import { selectDailyTop, selectWeeklyUniverse } from "../engine/aurora.mjs";
import {
  buildWeeklyUniverseForMode,
  FINAL_BUCKETS,
  runLightweightFullUniverseDiscovery,
  scanRunMetadata,
  SCAN_MODES
} from "../../../shared/scan-orchestration.mjs";

function candidate(ticker, overrides = {}) {
  return {
    ticker,
    final_bucket: "TRIGGER_READY",
    bucket: "TRIGGER_READY",
    weekly_focus_state: "WEEKLY_FOCUS",
    weekly_watchlist_score: 80,
    technical_strength_score: 75,
    rs_score_pct: 85,
    rmv_tight_label: "RMV_VERY_TIGHT",
    rmv_pivot_quality: "RMV_PIVOT_QUALITY_A",
    theme_score_pct: 80,
    risk_bucket: "RISK_IDEAL",
    avg_dollar_volume_20_usd_equiv: 100_000_000,
    liquidity_label: "LIQUIDITY_PASS",
    show_of_power_label: "SHOW_OF_POWER_VALID",
    market_dimmer: 4,
    market_permission: "TRADE_ALLOWED",
    watchlist_action: "WATCHLIST_KEEP",
    trigger_price: 100,
    initial_stop: 96,
    risk_pct: 4,
    price: 100,
    rmv_tightness_score_pct: 90,
    compression_score_pct: 85,
    theme_primary: "Semis",
    stage: "STAGE_2",
    stage_label: "STAGE_2",
    ...overrides
  };
}

const ranked = [
  candidate("NEW", { weekly_watchlist_score: 99 }),
  candidate("AAA", { weekly_watchlist_score: 80 }),
  candidate("BBB", { weekly_watchlist_score: 70 })
];

const full = buildWeeklyUniverseForMode({
  mode: SCAN_MODES.SUNDAY_FULL_REBUILD,
  rankedCandidates: ranked,
  featureMatrix: ranked,
  session: "2026-06-26",
  generatedAt: "2026-06-28T00:00:00.000Z",
  targetMax: 2
});
assert.deepEqual(full.weeklyContract.weekly_universe_symbols, ["NEW", "AAA"]);
assert.equal(full.weeklyContract.weekly_list_source, "AURORA_WEEKLY_DISCOVERY");

const previousContract = {
  weekly_contract_id: "US-2026-W26-2026-06-26",
  week_id: "2026-W26",
  weekly_list_created_asof: "2026-06-26",
  weekly_list_source: "AURORA_WEEKLY_DISCOVERY",
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
    candidate("NEW", { weekly_watchlist_score: 99 }),
    candidate("AAA", { trigger_price: 111, entry_risk_pct: 6, caution: "temporary pullback", next_promotion_condition: "TRIGGER_ACCEPTANCE" }),
    candidate("BBB", { thesis_risk_pct: 24, axm_atr: 3.2, caution: "wide thesis risk context" })
  ],
  session: "2026-06-29",
  generatedAt: "2026-06-29T22:00:00.000Z",
  targetMax: 2
});
assert.deepEqual(weekday.weeklyContract.weekly_universe_symbols, ["AAA", "BBB"]);
assert.equal(weekday.weeklyContract.carry_forward_count, 2);
assert.equal(weekday.weeklyUniverse.some(row => row.ticker === "NEW"), false);
assert.equal(weekday.weeklyUniverse.find(row => row.ticker === "AAA").trigger_price, 111);
assert.equal(weekday.weeklyUniverse.find(row => row.ticker === "AAA").entry_risk_pct, 6);
assert.equal(weekday.weeklyUniverse.find(row => row.ticker === "AAA").next_promotion_condition, "TRIGGER_ACCEPTANCE");
assert.equal(weekday.weeklyUniverse.find(row => row.ticker === "BBB").removal_flag, false);

const hardRemoved = buildWeeklyUniverseForMode({
  mode: SCAN_MODES.WEEKDAY_EOD_UPDATE,
  previousContract,
  rankedCandidates: ranked,
  featureMatrix: [candidate("AAA"), candidate("BBB", { stage: "STAGE_4", bucket: "AVOID_FRESH_LONG", final_bucket: "AVOID_FRESH_LONG" }), candidate("NEW")],
  session: "2026-06-29",
  generatedAt: "2026-06-29T22:00:00.000Z",
  targetMax: 2
});
assert.deepEqual(hardRemoved.weeklyContract.weekly_universe_symbols, ["AAA"]);
assert.equal(hardRemoved.weeklyContract.removal_flag.BBB, true);

const discovery = runLightweightFullUniverseDiscovery({
  market: "us",
  session: "2026-06-29",
  cache: { featureMatrix: [candidate("AAA"), candidate("NEW")] }
});
assert.equal(discovery.calculated_symbols, 2);
assert.equal(discovery.ohlcv_fetch_calls, 0);
assert.ok(discovery.deep_enrichment_scope.includes("WEEKLY_UNIVERSE"));

const weeklyFocus = weekday.weeklyUniverse.filter(row => row.weekly_focus_state === "WEEKLY_FOCUS");
const dailyTop = selectDailyTop(weeklyFocus);
assert.ok(dailyTop.every(row => ["AAA", "BBB"].includes(row.ticker)));
assert.equal(dailyTop.some(row => row.ticker === "NEW"), false);
assert.ok(dailyTop.length <= 4);

const rsleTop20 = [candidate("NEW", { rsle_rank: 1 }), candidate("AAA", { rsle_rank: 2 })];
assert.ok(rsleTop20.some(row => row.ticker === "NEW"));
assert.equal(weekday.weeklyContract.weekly_universe_symbols.includes("NEW"), false);

const metadata = scanRunMetadata({
  mode: SCAN_MODES.WEEKDAY_EOD_UPDATE,
  reason: "CLI_MODE_EXPLICIT",
  dataAsOf: "2026-06-29",
  completedSession: "2026-06-29",
  generatedAt: "2026-06-29T22:00:00.000Z",
  weeklyContract: weekday.weeklyContract,
  discovery,
  expectedSymbols: 4,
  loadedSymbols: 3,
  validLatestSymbols: 2,
  calculatedSymbols: 2
});
assert.equal(metadata.coverage_pct, 50);
assert.equal(metadata.weekly_contract_id, "US-2026-W26-2026-06-26");
assert.equal(metadata.stale_dashboard_flag, false);

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

const capped = selectWeeklyUniverse(Array.from({ length: 6 }, (_, index) => candidate(`T${index}`, { theme_primary: "Same Theme" })));
assert.equal(capped.weekly_universe.length, 4);

console.log("Scan orchestration cadence tests passed");
