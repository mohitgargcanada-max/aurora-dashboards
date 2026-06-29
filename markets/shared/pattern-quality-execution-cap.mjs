export const PATTERN_QUALITY_EXECUTION_CAP = "PATTERN_QUALITY_EXECUTION_CAP";

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

const EXECUTION_BUCKETS = new Set(["TRADE_READY", "TRIGGER_READY"]);
const STRICTER_BUCKETS = new Set(["NO_CHASE", "AVOID_FRESH_LONG"]);
const WEAK_BASEPIVOTS = new Set(["BASEPIVOT_QUALITY_C", "BASEPIVOT_QUALITY_NONE"]);
const STRUCTURE_PATTERNS = new Set(["VCP_STYLE", "CUP_HANDLE_POSSIBLE", "BASE_ON_BASE_POSSIBLE", "DOUBLE_BOTTOM_POSSIBLE"]);
const WEAK_RRG = new Set(["WEAKENING", "LAGGING"]);

function text(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  if (value && typeof value === "object") return Object.values(value).filter(v => typeof v !== "object").join(" ");
  return String(value ?? "");
}

function hasAny(row, patterns) {
  const haystack = [
    row.pbx_label,
    row.pbx_quality,
    row.pbx_duration_label,
    row.pbx_depth_label,
    row.pbx_ma_defense,
    row.pbx_reversal,
    row.ve2_distribution_label,
    row.ve2_signature_label,
    row.ve2_label,
    row.ve2?.signature,
    row.ve2?.distributionLabel,
    row.basepivot_status,
    row.basepivot_state,
    row.basepivot_false_breakout_status,
    row.pattern_proxy,
    row.rrg?.quadrant,
    row.rrg_quadrant
  ].map(text).join(" ");
  return patterns.some(pattern => haystack.includes(pattern));
}

function isLateStage(row) {
  const count = row.base_stage_count;
  return count >= 4 || text(count).includes("BASE_4") || text(row.base_stage_risk).includes("BASE_4_LATE_STAGE_RISK");
}

function isStrongRs(row) {
  const rs = row.rs_rating ?? row.rs_score_pct ?? row.rs_short_rating;
  const rs21 = text(row.rs21_state || row.rs_ema21);
  const rrg = row.rrg?.quadrant || row.rrg_quadrant;
  return rs >= 85
    || ["RS21_RECLAIM_0D", "RS21_RECLAIM_1D", "RS21_RECLAIM_2D", "RS21_RECLAIM_3D", "RS21_RECLAIM_5D", "RS21_HOLDING", "RS21_ACCELERATING"].some(x => rs21.includes(x))
    || row.rsnh === true
    || row.rsnh63 === true
    || row.rsnh252 === true
    || row.rs63_prox >= 98
    || row.rs52_prox >= 98
    || row.rs_1w_pct >= 80
    || row.rs_1m_pct >= 80
    || row.rs_3m_pct >= 80
    || ["IMPROVING", "LEADING"].includes(rrg)
    || row.mansfield > 0;
}

function addText(existing, addition) {
  if (!addition) return existing ?? "";
  if (!existing || existing === "none from calculated technical fields") return addition;
  return text(existing).includes(addition) ? existing : `${existing}; ${addition}`;
}

function addBlockReason(existing) {
  if (Array.isArray(existing)) return existing.includes(PATTERN_QUALITY_EXECUTION_CAP) ? existing : [...existing, PATTERN_QUALITY_EXECUTION_CAP];
  if (!existing) return [PATTERN_QUALITY_EXECUTION_CAP];
  return text(existing).includes(PATTERN_QUALITY_EXECUTION_CAP) ? existing : `${existing}; ${PATTERN_QUALITY_EXECUTION_CAP}`;
}

function cappedBucket(row, strongRs) {
  const current = row.final_bucket || row.bucket;
  if (STRICTER_BUCKETS.has(current)) return current;
  if (current === "PULLBACK_WATCH") return "PULLBACK_WATCH";
  if (hasAny(row, ["DISTRIBUTION_CLUSTER", "BASEPIVOT_FAILED_PROBE", "BASEPIVOT_FALSE_BREAK_FILTERED"]) && !strongRs) return "REPAIR_WATCH";
  if (strongRs && (row.rsnh || row.rsnh63 || row.rsnh252 || row.rs63_prox >= 98 || row.rs52_prox >= 98)) return "RSNH_WATCH_ONLY";
  if (strongRs) return "EARLY_ENTRY_WATCH";
  return "REPAIR_WATCH";
}

function reasonsFor(row) {
  const reasons = [];
  const late = isLateStage(row);
  const weakBase = WEAK_BASEPIVOTS.has(row.basepivot_quality);
  const rrg = row.rrg?.quadrant || row.rrg_quadrant;
  const weakness = hasAny(row, [
    "PBX_STALE",
    "PBX_TOO_SHALLOW",
    "PBX_NO_MA_DEFENSE",
    "PBX_REVERSAL_UNCONFIRMED",
    "DISTRIBUTION_PRESENT",
    "DISTRIBUTION_CLUSTER",
    "BASEPIVOT_ACTIVE_AFTER_WEAK_BREAKOUT",
    "BASEPIVOT_FAILED_PROBE",
    "BASEPIVOT_FALSE_BREAK_FILTERED",
    "NO_CLEAR_BASE"
  ]) || WEAK_RRG.has(rrg);
  const weakBreakout = hasAny(row, ["WEAK_BREAKOUT", "FAILED_PROBE", "BASEPIVOT_FALSE_BREAK_FILTERED"]);
  const stalePbx = hasAny(row, ["PBX_STALE"]);
  const distributionNotClear = !hasAny(row, ["DISTRIBUTION_CLEAR"]) && hasAny(row, ["DISTRIBUTION_PRESENT", "DISTRIBUTION_CLUSTER"]);
  const nearTrigger = hasAny(row, ["NEAR_TRIGGER", "ABOVE_TRIGGER_CLOSE_ACCEPTED"]) || Math.abs(row.trigger_gap_pct ?? 99) <= 1.5 || row.entry_risk_pct <= 2;
  const structuralPattern = STRUCTURE_PATTERNS.has(row.pattern_proxy);
  const vcpUnconfirmed = row.pattern_proxy === "VCP_STYLE" && row.vcp_contraction_sequence_confirmed !== true && row.contraction_sequence_confirmed !== true;

  if (late && weakBase && (weakness || vcpUnconfirmed)) reasons.push("LATE_STAGE_WEAK_BASEPIVOT_STRUCTURE");
  if (late && stalePbx && distributionNotClear && nearTrigger) reasons.push("STALE_PULLBACK_DISTRIBUTION_NEAR_TRIGGER");
  if (structuralPattern && (weakBase || weakBreakout || distributionNotClear || stalePbx || vcpUnconfirmed)) reasons.push("UNCONFIRMED_PATTERN_STRUCTURE");
  return reasons;
}

export function applyPatternQualityExecutionCap(candidate, context = {}) {
  const row = candidate || {};
  const warnings = [];
  if (row.final_bucket && !FINAL_BUCKETS.has(row.final_bucket)) warnings.push(`UNKNOWN_FINAL_BUCKET:${row.final_bucket}`);
  const capReasons = reasonsFor(row);
  const strongRs = isStrongRs(row);
  const capApplied = capReasons.length > 0;

  row.pattern_quality_execution_cap = capApplied;
  row.pattern_quality_cap_reason = capReasons;
  row.pattern_quality_cap_level = capApplied ? "EXECUTION_BLOCK" : null;

  if (capApplied) {
    const next = "Needs clean close above BasePivot/RMVP with constructive VE2, distribution clear, and fresh non-stale structure.";
    const note = "Pattern-quality execution cap active: strong RS retained, but weak/late-stage structure blocks Trigger Ready / Daily Top until fresh confirmation.";
    row.promotion_block_reason = addBlockReason(row.promotion_block_reason);
    row.quality_notes = addText(row.quality_notes, note);
    row.caution = addText(row.caution, note);
    row.next_condition = addText(row.next_condition, next);
    row.execution_tier = row.execution_tier?.startsWith("DAILY_TOP") ? "WATCH_ONLY_PATTERN_QUALITY_CAP" : row.execution_tier;
    if (EXECUTION_BUCKETS.has(row.final_bucket) || EXECUTION_BUCKETS.has(row.bucket)) {
      const nextBucket = cappedBucket(row, strongRs);
      row.final_bucket = nextBucket;
      if ("bucket" in row) row.bucket = nextBucket;
      if (row.setup === "TRIGGER_READY") row.setup = nextBucket === "EARLY_ENTRY_WATCH" ? "EARLY_ENTRY" : nextBucket;
      if (row.setup_label === "TRIGGER_READY") row.setup_label = nextBucket;
    }
  }

  return {
    candidate: row,
    cap_applied: capApplied,
    cap_level: row.pattern_quality_cap_level,
    cap_reasons: capReasons,
    warnings
  };
}
