const clamp = (value, low = 0, high = 100) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

export function rangeRmvProxy(highs, lows, closes, n) {
  if (highs.length < n || lows.length < n || closes.length < n) return null;
  return (Math.max(...highs.slice(-n)) - Math.min(...lows.slice(-n))) / mean(closes.slice(-n)) * 100;
}

export function rmvTightLabel(value) {
  if (value == null) return "RMV_UNKNOWN";
  if (value <= 5) return "RMV_ZERO";
  if (value <= 10) return "RMV_VERY_TIGHT";
  if (value <= 15) return "RMV_TIGHT";
  if (value <= 25) return "RMV_NORMAL";
  return "RMV_EXPANDING";
}

export function selectRmvLookback(candidate) {
  if (candidate.event_gap_age_days != null && candidate.event_gap_age_days <= 15) return [5, "RECENT_GAP"];
  if (candidate.ipo_age_days != null && candidate.ipo_age_days < 20) return [5, "IPO_INSUFFICIENT_BARS"];
  if (candidate.gap_range_pctile != null && candidate.gap_range_pctile >= 95) return [5, "EXTREME_EVENT_RANGE"];
  if (candidate.hve_hv1_inside_last_15_bars) return [5, "HVE_HV1_INSIDE_RMV15"];
  if (candidate.position_trade_mode || candidate.base_duration_days >= 50) return [candidate.base_duration_days < 100 ? 25 : 50, "POSITION_BASE"];
  return [15, "NORMAL_SWING"];
}

export function riskFields(trigger, stop) {
  if (!(trigger > 0) || stop == null) return {risk_pct: null, risk_bucket: "RISK_UNKNOWN", level_2r: null, level_3r: null};
  const risk = trigger - stop;
  const riskPct = risk / trigger * 100;
  const bucket = riskPct < 2 ? "RISK_TIGHT" : riskPct <= 4 ? "RISK_IDEAL" : riskPct <= 7 ? "RISK_WIDE" : "RISK_TOO_WIDE";
  return {risk_pct: riskPct, risk_bucket: bucket, level_2r: trigger + 2 * risk, level_3r: trigger + 3 * risk};
}

export function marketDimmer(input) {
  let indexScore = 0;
  if (input.index_above_21 && input.ema21_rising) indexScore += 1;
  if (input.index_above_50 && input.sma50_rising) indexScore += 1;
  if (input.index_above_10 && input.ema10_rising) indexScore += 0.5;
  indexScore = Math.min(indexScore, 2.5);
  const breadth = {LEADERSHIP_ABSENT:0, LEADERSHIP_ISOLATED:.25, LEADERSHIP_EMERGING:.5, LEADERSHIP_BREADTH_CONFIRMING:.85, LEADERSHIP_CLUSTER_CONFIRMED:1}[input.leadership_breadth_state] ?? .25;
  const feedback = {TRADE_FEEDBACK_POSITIVE:1, TRADE_FEEDBACK_MIXED:.5, TRADE_FEEDBACK_NEGATIVE:0}[input.trade_feedback_state] ?? .25;
  const risk = {RISK_ON_CONFIRMING:1, RISK_ON_MIXED:.5, RISK_OFF:0, UNKNOWN:.25}[input.risk_on_proxy_state] ?? .25;
  const basket = {REFERENCE_BASKET_CONFIRMING:1, REFERENCE_BASKET_MIXED:.5, REFERENCE_BASKET_SQUATTING:.25, REFERENCE_BASKET_BREAKING_SUPPORT:0}[input.reference_basket_state] ?? .25;
  let penalty = input.failed_breakout_count_10d >= 5 ? .5 : 0;
  if (input.distribution_churn_count_10d >= 3) penalty += .5;
  if (input.market_cycle_age_days > 60 && input.distribution_churn_count_10d >= 2) penalty += .5;
  return Math.round(clamp(indexScore + breadth + feedback + risk + basket - penalty, 0, 5));
}

const setupScores = {TRADE_READY:100, TRIGGER_READY:92, EARLY_ENTRY_WATCH:84, PULLBACK_WATCH:78, RSNH_WATCH_ONLY:64, REPAIR_WATCH:48, NO_CHASE:35, PROTECT_PROFIT_REVIEW:20, AVOID_FRESH_LONG:0};
const rmvScores = {RMV_ZERO:100, RMV_VERY_TIGHT:90, RMV_TIGHT:75, RMV_NORMAL:50, RMV_EXPANDING:20, RMV_UNKNOWN:40};
const pivotScores = {RMV_PIVOT_QUALITY_A:100, RMV_PIVOT_QUALITY_B:80, RMV_PIVOT_QUALITY_C:55, RMV_PIVOT_QUALITY_NONE:30};
const themeScores = {THEME_CONFIRMED:90, SLEEPER_THEME_EMERGING:82, RANK_CHANGE_LEADER:78, THEME_NEUTRAL:55, THEME_FADING:20, THEME_UNKNOWN:45};
const riskScores = {RISK_IDEAL:100, RISK_TIGHT:80, RISK_WIDE:45, RISK_TOO_WIDE:0, RISK_UNKNOWN:35};
const powerScores = {SHOW_OF_POWER_STRONG:100, SHOW_OF_POWER_VALID:85, SHOW_OF_POWER_THIN:55, NO_SHOW_OF_POWER:25, SHOW_OF_POWER_UNKNOWN:45};
const persistenceScores = {SQUAT_INTACT_SECOND_CHANCE:80, SQUAT_RETEST_WATCH:85, SQUAT_FAILED_AURORA_X2:10, WATCHLIST_KEEP:65, WATCHLIST_DOWNGRADE:35, WATCHLIST_REPAIR_ONLY:30, WATCHLIST_REMOVE_21EMA_BREAK_FOLLOWTHROUGH:0, WATCHLIST_REMOVE_THEME_LOSS:0};

function liquidityScore(addv) {
  if (!(addv > 0)) return 35;
  return clamp((Math.log10(addv) - Math.log10(20_000_000)) / (Math.log10(100_000_000) - Math.log10(20_000_000)) * 100);
}

export function weeklyWatchlistScore(c) {
  const technical = clamp((c.technical_strength_score || 0) / 85 * 100);
  const rs = c.rs_score_pct ?? ({ELITE_RS:95, STRONG_RS:85, ACCEPTABLE_RS:65, WEAK_RS:30}[c.rs_trifecta_label] ?? 40);
  const setup = setupScores[c.final_bucket] ?? 40;
  const rmvSetup = (rmvScores[c.rmv_tight_label] ?? 40) * .65 + (pivotScores[c.rmv_pivot_quality] ?? 40) * .35;
  const theme = c.theme_score_pct ?? (themeScores[c.theme_tracker_label] ?? 45);
  const persistence = persistenceScores[c.squat_label || c.watchlist_action] ?? 50;
  return Number((.16 * technical + .14 * rs + .14 * setup + .12 * theme + .10 * rmvSetup + .10 * (riskScores[c.risk_bucket] ?? 35) + .08 * liquidityScore(c.avg_dollar_volume_20_usd_equiv) + .06 * (powerScores[c.show_of_power_label] ?? 45) + .06 * clamp((c.market_dimmer || 0) / 5 * 100) + .04 * persistence).toFixed(2));
}

export function weeklyListEligible(c) {
  if (c.final_bucket === "AVOID_FRESH_LONG") return false;
  if (["STAGE_4_DAMAGED", "AURORA_X_HARD_BLOCK", "LIQUIDITY_FAIL"].includes(c.override_reason)) return false;
  if (c.liquidity_label === "LIQUIDITY_FAIL" || c.stage_label === "STAGE_4") return false;
  return !(c.weekly_context_label === "WEEKLY_CONTEXT_FAIL" && !["REPAIR_WATCH", "RSNH_WATCH_ONLY"].includes(c.setup_state));
}

export function weeklyTier(c) {
  if ((c.watchlist_action || "").startsWith("WATCHLIST_REMOVE") || ["STAGE_4_DAMAGED", "AURORA_X_HARD_BLOCK", "LIQUIDITY_FAIL"].includes(c.override_reason)) return "WEEKLY_REMOVE";
  if (c.final_bucket === "REPAIR_WATCH" || c.watchlist_action === "WATCHLIST_REPAIR_ONLY") return "WEEKLY_REPAIR_ONLY";
  if (["SQUAT_INTACT_SECOND_CHANCE", "SQUAT_RETEST_WATCH"].includes(c.squat_label)) return "WEEKLY_SQUAT_INTACT";
  if (c.final_bucket === "PULLBACK_WATCH" || ["FIRST_PULLBACK_AFTER_POWER", "SECOND_PULLBACK_AFTER_POWER"].includes(c.pullback_sequence_label)) return "WEEKLY_PULLBACK_RETEST";
  const allowed = ["TRIGGER_READY", "EARLY_ENTRY_WATCH", "PULLBACK_WATCH", "RSNH_WATCH_ONLY"];
  if (c.weekly_watchlist_score >= 70 && c.trigger_price && c.initial_stop && c.risk_pct <= 7 && allowed.includes(c.final_bucket)) return "WEEKLY_FOCUS";
  return c.weekly_watchlist_score >= 55 ? "WEEKLY_CORE" : "NOT_WEEKLY_LIST";
}

export function selectWeeklyUniverse(candidates, targetMax = 20) {
  const ranked = candidates.map(c => ({...c, weekly_watchlist_score: weeklyWatchlistScore(c)})).filter(c => weeklyListEligible(c) && c.weekly_watchlist_score >= 55).sort((a,b) => b.weekly_watchlist_score - a.weekly_watchlist_score || (b.technical_strength_score || 0) - (a.technical_strength_score || 0) || (b.rs_score_pct || 0) - (a.rs_score_pct || 0));
  const counts = new Map();
  const selected = [];
  for (const c of ranked) {
    const theme = c.theme_primary || "UNKNOWN";
    const cap = c.market_dimmer >= 4 && c.theme_tracker_label === "THEME_CONFIRMED" ? 5 : 4;
    if ((counts.get(theme) || 0) >= cap) continue;
    c.weekly_tier = weeklyTier(c);
    selected.push(c);
    counts.set(theme, (counts.get(theme) || 0) + 1);
    if (selected.length >= targetMax) break;
  }
  return {weekly_universe: selected, candidate_supply: selected.length >= 15 ? "HEALTHY" : "THIN"};
}

export function executionFocusScore(c) {
  const proximity = Math.max(0, 100 - Math.abs(c.price - c.trigger_price) / c.trigger_price * 100 / 3 * 100);
  const risk = c.risk_pct >= 2 && c.risk_pct <= 4 ? 100 : c.risk_pct < 2 ? 70 : c.risk_pct <= 7 ? 40 : 0;
  const permission = {TRADE_ALLOWED:100, SELECTIVE_ONLY:75, TRANSITION_MODE:50, WATCHLIST_ONLY:25, DEFENSE_MODE:0}[c.market_permission] ?? 25;
  return .25 * proximity + .20 * (c.rs_score_pct || 0) + .20 * Math.max(c.rmv_tightness_score_pct || 0, c.compression_score_pct || 0) + .15 * (c.theme_score_pct || 0) + .10 * risk + .10 * permission;
}

export function selectDailyTop(focusList) {
  const ranked = focusList.map(c => ({...c, execution_focus_score: executionFocusScore(c)})).filter(c => c.execution_focus_score >= 70 && !["AVOID_FRESH_LONG", "NO_CHASE"].includes(c.final_bucket) && !["WATCHLIST_ONLY", "DEFENSE_MODE"].includes(c.market_permission)).sort((a,b) => b.execution_focus_score - a.execution_focus_score);
  if (!ranked.length || ranked[0].execution_focus_score < 75) return [];
  return ranked.filter((c, index) => index === 0 || (index < 4 && ranked[0].execution_focus_score - c.execution_focus_score <= 12)).slice(0, 4).map((c, index) => ({...c, execution_tier: `DAILY_TOP${index + 1}`}));
}
