import assert from "node:assert/strict";
import {rangeRmvProxy, rmvTightLabel, selectRmvLookback, riskFields, marketDimmer, weeklyWatchlistScore, weeklyTier, selectWeeklyUniverse, selectDailyTop} from "../engine/aurora.mjs";

assert.equal(rmvTightLabel(5), "RMV_ZERO");
assert.equal(rmvTightLabel(10), "RMV_VERY_TIGHT");
assert.equal(rmvTightLabel(15), "RMV_TIGHT");
assert.equal(rmvTightLabel(25), "RMV_NORMAL");
assert.equal(rmvTightLabel(25.01), "RMV_EXPANDING");
assert.equal(rangeRmvProxy([10,11,12], [9,10,11], [9.5,10.5,11.5], 3), 3 / 10.5 * 100);
assert.deepEqual(selectRmvLookback({event_gap_age_days: 10}), [5, "RECENT_GAP"]);
assert.deepEqual(selectRmvLookback({base_duration_days: 110}), [50, "POSITION_BASE"]);
assert.equal(riskFields(100, 96).risk_bucket, "RISK_IDEAL");
assert.equal(riskFields(100, 96).level_3r, 112);
assert.equal(marketDimmer({index_above_21:true,ema21_rising:true,index_above_50:true,sma50_rising:true,index_above_10:true,ema10_rising:true,leadership_breadth_state:"LEADERSHIP_CLUSTER_CONFIRMED",trade_feedback_state:"TRADE_FEEDBACK_POSITIVE",risk_on_proxy_state:"RISK_ON_CONFIRMING",reference_basket_state:"REFERENCE_BASKET_CONFIRMING",failed_breakout_count_10d:0,distribution_churn_count_10d:0,market_cycle_age_days:20}), 5);

const base = {technical_strength_score:75,rs_score_pct:90,final_bucket:"TRIGGER_READY",rmv_tight_label:"RMV_VERY_TIGHT",rmv_pivot_quality:"RMV_PIVOT_QUALITY_A",theme_score_pct:90,risk_bucket:"RISK_IDEAL",avg_dollar_volume_20_usd_equiv:100_000_000,show_of_power_label:"SHOW_OF_POWER_VALID",market_dimmer:4,watchlist_action:"WATCHLIST_KEEP",trigger_price:100,initial_stop:96,risk_pct:4,weekly_context_label:"WEEKLY_CONTEXT_STRONG",stage_label:"STAGE_2",liquidity_label:"LIQUIDITY_PASS",theme_primary:"Semis"};
const score = weeklyWatchlistScore(base);
assert(score >= 75 && score <= 100);
assert.equal(weeklyTier({...base, weekly_watchlist_score:score}), "WEEKLY_FOCUS");
assert.equal(selectWeeklyUniverse(Array.from({length:6},(_,i)=>({...base,ticker:`T${i}`}))).weekly_universe.length, 4);

const daily = selectDailyTop([{...base,ticker:"ONE",price:99,rs_score_pct:95,rmv_tightness_score_pct:95,compression_score_pct:90,market_permission:"TRADE_ALLOWED"}]);
assert.equal(daily.length, 1);
assert.equal(daily[0].execution_tier, "DAILY_TOP1");
console.log("AURORA engine contract tests passed");
