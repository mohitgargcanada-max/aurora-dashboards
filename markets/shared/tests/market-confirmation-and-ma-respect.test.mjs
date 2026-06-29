import assert from "node:assert/strict";
import {
  buildMarketConfirmationStack,
  buildMaRespectWatchlists,
  buildMyhApproachingRows
} from "../market-confirmation-and-ma-respect.mjs";

const FINAL_BUCKETS = new Set([
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

function row(symbol, overrides = {}) {
  return {
    symbol,
    final_bucket: "REPAIR_WATCH",
    rs_rating: 76,
    rs_trifecta: "FAIL",
    rs21_state: "RS21_HOLDING",
    rrg: { quadrant: "IMPROVING" },
    price: 100,
    ema10: 98,
    ema21: 96,
    sma50: 92,
    weekly_watchlist_score: 70,
    user_note: "strong RS leadership",
    ve2_distribution_label: "DISTRIBUTION_CLEAR",
    ...overrides
  };
}

const passContext = {
  oneil_style_market_label: "CONFIRMED_UPTREND",
  mc2_cycle_state: "MARKET_CYCLE_ON",
  final_market_permission: "TRADE_ALLOWED",
  benchmark_ma_stack: { above_ema21: true }
};

assert.equal(
  buildMarketConfirmationStack(passContext, { benchmark_rs21_state: "BENCHMARK_RS21_HOLDING", benchmark_weinstein_stage: "BENCHMARK_STAGE_2B" }).market_confirmation_state,
  "THREE_SYSTEM_CONFIRMATION"
);
assert.equal(
  buildMarketConfirmationStack(passContext, { benchmark_rs21_state: "BENCHMARK_RS21_HOLDING", benchmark_weinstein_stage: "BENCHMARK_STAGE_1_TO_2" }).market_confirmation_state,
  "THREE_SYSTEM_CONFIRMATION"
);
assert.equal(
  buildMarketConfirmationStack(passContext, { benchmark_rs21_state: "BENCHMARK_RS21_BELOW", benchmark_weinstein_stage: "BENCHMARK_STAGE_2B" }).market_confirmation_state,
  "MARKET_CONFIRMATION_CAUTION"
);
assert.equal(
  buildMarketConfirmationStack({ oneil_style_market_label: "MARKET_IN_CORRECTION", mc2_cycle_state: "MARKET_CYCLE_OFF", final_market_permission: "DEFENSE_MODE" }, { benchmark_rs21_state: "BENCHMARK_RS21_BELOW", benchmark_weinstein_stage: "BENCHMARK_STAGE_4" }).market_confirmation_state,
  "MARKET_CONFIRMATION_FAIL"
);
const missingStage = buildMarketConfirmationStack(passContext, { benchmark_rs21_state: "BENCHMARK_RS21_HOLDING" });
assert.equal(missingStage.market_confirmation_state, "TWO_OF_THREE_CONFIRMATION");
assert.ok(missingStage.warnings.includes("BENCHMARK_WEINSTEIN_STAGE_UNKNOWN"));

const beforeBucket = row("MOCKUS10").final_bucket;
buildMarketConfirmationStack(passContext, { benchmark_rs21_state: "BENCHMARK_RS21_HOLDING", benchmark_weinstein_stage: "BENCHMARK_STAGE_2A" });
assert.equal(row("MOCKUS10").final_bucket, beforeBucket);

const maRows = [
  row("MOCKUS10", { ma_character_primary: "10EMA", pbx_ma_touch_label: "PBX_REPEATED_10EMA_RESPECT", ma_respect_touch_count_42d: 3 }),
  row("MOCKUS21", { ma_character_primary: "21EMA", pbx_ma_touch_label: "PBX_REPEATED_21EMA_RESPECT", ma_respect_touch_count_42d: 2 }),
  row("MOCKUS50", { ma_character_primary: "50SMA", pbx_ma_touch_label: "PBX_FIRST_50SMA_TOUCH", weekly_context: "WEEKLY_RECOVERY" }),
  row("MOCKIN10", { rs_rating: 65, rs21_state: "RS21_BELOW_WARNING", rrg: { quadrant: "LAGGING" }, ma_character_primary: "10EMA" }),
  row("MOCKIN21", { rs_rating: 62, rs21_state: "RS21_ACCELERATING", ma_character_primary: "21EMA" }),
  row("MOCKIN50", { stage_label: "STAGE_4", ma_character_primary: "50SMA" }),
  row("MOCKCA10", { rs_rating: 92, rs_trifecta: "FAIL", ma_character_primary: "10EMA" }),
  row("MOCKCA21", { ve2_distribution_label: "DISTRIBUTION_CLUSTER", ma_character_primary: "21EMA" }),
  row("MOCKCA50", { ma_character_primary: "21EMA", price: 98, sma50: 96 })
];
const ma = buildMaRespectWatchlists(maRows);
assert.ok(ma.ema10_respect_rows.some(x => x.symbol === "MOCKUS10"));
assert.ok(ma.ema10_respect_rows.some(x => x.symbol === "MOCKCA10"));
assert.ok(ma.ema21_respect_rows.some(x => x.symbol === "MOCKUS21"));
assert.ok(ma.ema21_respect_rows.some(x => x.symbol === "MOCKIN21"));
assert.ok(ma.sma50_respect_rows.some(x => x.symbol === "MOCKUS50"));
assert.ok(!ma.ema10_respect_rows.some(x => x.symbol === "MOCKIN10"));
assert.ok(!ma.ema21_respect_rows.some(x => x.symbol === "MOCKCA21"));
assert.ok(!ma.sma50_respect_rows.some(x => x.symbol === "MOCKIN50"));
assert.ok(!ma.sma50_respect_rows.some(x => x.symbol === "MOCKCA50"));
for (const item of [...ma.ema10_respect_rows, ...ma.ema21_respect_rows, ...ma.sma50_respect_rows]) {
  assert.ok(item.scan_memberships.some(x => x.startsWith("MA")));
  assert.ok(FINAL_BUCKETS.has(item.final_bucket));
  assert.equal(item.execution_tier, undefined);
}

const myh = buildMyhApproachingRows([
  row("MOCKUS10", { myh_label: "MYH_52W", myh_level: 102, myh_gap_pct: 1.5 }),
  row("MOCKIN21", { myh_label: "MYH_3Y", myh_level: 105, myh_gap_pct: 4.5, rs_rating: 60, rs21_state: "RS21_RECLAIM_2D" }),
  row("MOCKCA50", { myh_label: "MYH_5Y", myh_level: 108, myh_gap_pct: 7.8, rs_rating: 60, rs21_state: "RS21_BELOW_WARNING", rrg: { quadrant: "LEADING" } }),
  row("MOCKIN50", { myh_label: "MYH_HISTORY_INSUFFICIENT", myh_state: "NOT_AVAILABLE", myh_gap_pct: null }),
  row("MOCKCA21", { myh_label: "MYH_2Y", myh_state: "MYH_BREAKOUT_FAILED", myh_gap_pct: 2, ve2_distribution_label: "DISTRIBUTION_CLUSTER" })
]);
assert.deepEqual(myh.myh_approaching_rows.map(x => x.symbol), ["MOCKUS10", "MOCKIN21", "MOCKCA50"]);
assert.ok(myh.warnings.some(x => x.includes("MYH_APPROACHING_DATA_REPAIR:MOCKIN50")));
for (const item of myh.myh_approaching_rows) {
  assert.ok(item.scan_memberships.includes("MYH_APPROACHING"));
  assert.ok(FINAL_BUCKETS.has(item.final_bucket));
  assert.equal(item.execution_tier, undefined);
}

const stageNote = buildMaRespectWatchlists([row("MOCKUS21", { weinstein_stage: "STAGE_2A", ma_character_primary: "21EMA" })]).ema21_respect_rows[0];
assert.match(stageNote.user_note, /Weinstein STAGE_2A/);
const noStage = buildMaRespectWatchlists([row("MOCKUS50", { ma_character_primary: "50SMA" })]).sma50_respect_rows[0];
assert.doesNotMatch(noStage.user_note, /STAGE_UNKNOWN/);

console.log("Market confirmation and MA respect helper tests passed");
