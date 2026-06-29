import assert from "node:assert/strict";
import { applyPatternQualityExecutionCap } from "../pattern-quality-execution-cap.mjs";

function row(overrides = {}) {
  return {
    symbol: "MOCK",
    final_bucket: "TRIGGER_READY",
    rs_trifecta: "FAIL",
    rs_rating: 99,
    rs21_state: "RS21_RECLAIM_0D",
    rrg: { quadrant: "IMPROVING" },
    base_stage_risk: "BASE_4_LATE_STAGE_RISK",
    basepivot_quality: "BASEPIVOT_QUALITY_C",
    basepivot_status: "BASEPIVOT_ACTIVE_AFTER_WEAK_BREAKOUT",
    pattern_proxy: "BASE_ON_BASE_POSSIBLE",
    pbx_duration_label: "PBX_STALE",
    ve2_distribution_label: "DISTRIBUTION_PRESENT",
    entry_risk_pct: 1.1,
    ...overrides
  };
}

const clean = applyPatternQualityExecutionCap(row({
  final_bucket: "TRIGGER_READY",
  rs_trifecta: "PASS",
  base_stage_risk: "BASE_1_EARLY",
  base_stage_count: 1,
  basepivot_quality: "BASEPIVOT_QUALITY_A",
  basepivot_status: "BASEPIVOT_ACTIVE",
  pattern_proxy: "FLAT_BASE_SHELF",
  pbx_duration_label: "PBX_NORMAL",
  ve2_distribution_label: "DISTRIBUTION_CLEAR"
}));
assert.equal(clean.cap_applied, false);
assert.equal(clean.candidate.final_bucket, "TRIGGER_READY");

const stale = applyPatternQualityExecutionCap(row());
assert.equal(stale.cap_applied, true);
assert.equal(stale.candidate.final_bucket, "EARLY_ENTRY_WATCH");
assert.ok(stale.candidate.promotion_block_reason.includes("PATTERN_QUALITY_EXECUTION_CAP"));

const weakBreakout = applyPatternQualityExecutionCap(row({
  pattern_proxy: "VCP_STYLE",
  basepivot_status: "BASEPIVOT_ACTIVE_AFTER_WEAK_BREAKOUT",
  ve2_distribution_label: "DISTRIBUTION_PRESENT",
  vcp_contraction_sequence_confirmed: false
}));
assert.ok(weakBreakout.cap_reasons.includes("UNCONFIRMED_PATTERN_STRUCTURE"));

const noPassRequired = applyPatternQualityExecutionCap(row({ rs_trifecta: "FAIL", rs_rating: 91, rs21_state: "RS21_RECLAIM_1D" }));
assert.equal(noPassRequired.cap_applied, true);
assert.equal(noPassRequired.candidate.final_bucket, "EARLY_ENTRY_WATCH");

const strictNoChase = applyPatternQualityExecutionCap(row({ final_bucket: "NO_CHASE" }));
assert.equal(strictNoChase.candidate.final_bucket, "NO_CHASE");

const strictAvoid = applyPatternQualityExecutionCap(row({ final_bucket: "AVOID_FRESH_LONG" }));
assert.equal(strictAvoid.candidate.final_bucket, "AVOID_FRESH_LONG");

const dailyTopCandidate = applyPatternQualityExecutionCap(row({ execution_tier: "DAILY_TOP1" })).candidate;
assert.equal(dailyTopCandidate.execution_tier, "WATCH_ONLY_PATTERN_QUALITY_CAP");
assert.equal(dailyTopCandidate.pattern_quality_execution_cap, true);

const allCandidates = [dailyTopCandidate];
assert.equal(allCandidates.length, 1);

const locked = new Set([
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
assert.ok(locked.has(dailyTopCandidate.final_bucket));
assert.ok(!locked.has("PATTERN_QUALITY_EXECUTION_CAP"));

console.log("Pattern quality execution cap tests passed");
