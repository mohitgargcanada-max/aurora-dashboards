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

const RS21_PASS = ["RS21_HOLDING", "RS21_ACCELERATING", "RS21_RECLAIM_0D", "RS21_RECLAIM_1D", "RS21_RECLAIM_2D", "RS21_RECLAIM_3D", "RS21_RECLAIM_4D", "RS21_RECLAIM_5D"];

const text = value => {
  if (Array.isArray(value)) return value.filter(Boolean).map(text).join(" ");
  if (value && typeof value === "object") return Object.values(value).filter(v => v == null || typeof v !== "object").map(text).join(" ");
  return String(value ?? "");
};

const number = (...values) => values.find(Number.isFinite);
const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function first(row, keys) {
  for (const key of keys) if (row?.[key] !== undefined && row[key] !== null) return row[key];
  return null;
}

function addUnique(row, key, value) {
  if (!value) return;
  const current = Array.isArray(row[key]) ? row[key] : row[key] ? [row[key]] : [];
  if (!current.includes(value)) current.push(value);
  row[key] = current;
}

function addNote(existing, addition) {
  if (!addition) return existing ?? "";
  const current = text(existing);
  if (!current) return addition;
  return current.includes(addition) ? current : `${addition}; ${current}`;
}

function componentState(kind, label) {
  const value = text(label);
  if (!value || value === "UNKNOWN" || value.includes("UNKNOWN") || value === "NOT_AVAILABLE") return "UNKNOWN";
  if (kind === "oneil") {
    if (["TRADE_ALLOWED", "CONFIRMED_UPTREND", "MARKET_CYCLE_ON"].some(x => value.includes(x))) return "PASS";
    if (["SELECTIVE_ONLY", "UPTREND_UNDER_PRESSURE", "MARKET_RECONFIRMATION", "UPTREND_RECONFIRMING", "MARKET_TRANSITION", "RALLY_ATTEMPT"].some(x => value.includes(x))) return "PARTIAL";
    if (["WATCHLIST_ONLY", "DEFENSE_MODE", "MARKET_CYCLE_OFF", "MARKET_IN_CORRECTION"].some(x => value.includes(x))) return "FAIL";
  }
  if (kind === "rs21") {
    if (["BENCHMARK_RS21_ACCELERATING", "BENCHMARK_RS21_HOLDING", "BENCHMARK_RS21_RECLAIM"].some(x => value.includes(x))) return "PASS";
    if (value.includes("BENCHMARK_RS21_APPROACHING")) return "PARTIAL";
    if (value.includes("BENCHMARK_RS21_BELOW")) return "FAIL";
  }
  if (kind === "stage") {
    if (["BENCHMARK_STAGE_2A", "BENCHMARK_STAGE_2B"].some(x => value.includes(x))) return "PASS";
    if (["BENCHMARK_STAGE_1_TO_2", "BENCHMARK_STAGE_2C"].some(x => value.includes(x))) return "PARTIAL";
    if (["BENCHMARK_STAGE_1", "BENCHMARK_STAGE_3"].some(x => value.includes(x))) return "CAUTION";
    if (value.includes("BENCHMARK_STAGE_4")) return "FAIL";
  }
  return "UNKNOWN";
}

function deriveBenchmarkRs21(row = {}, marketContext = {}) {
  const explicit = first(row, ["benchmark_rs21_state", "rs21_state"]);
  if (explicit) {
    const value = text(explicit).replace(/^RS21_/, "BENCHMARK_RS21_");
    if (value.includes("RECLAIM")) return "BENCHMARK_RS21_RECLAIM";
    if (value.includes("ACCELERATING")) return "BENCHMARK_RS21_ACCELERATING";
    if (value.includes("HOLDING") || value.includes("ABOVE")) return "BENCHMARK_RS21_HOLDING";
    if (value.includes("BELOW")) return "BENCHMARK_RS21_BELOW";
  }
  const rsLine = number(row.benchmark_rs_line, row.rs_line, row.rs_now);
  const rsEma21 = number(row.benchmark_rs_ema21, row.rs_ema21_value);
  if (Number.isFinite(rsLine) && Number.isFinite(rsEma21)) {
    if (rsLine >= rsEma21 * 1.01) return "BENCHMARK_RS21_ACCELERATING";
    if (rsLine >= rsEma21) return "BENCHMARK_RS21_HOLDING";
    if (rsLine >= rsEma21 * 0.99) return "BENCHMARK_RS21_APPROACHING";
    return "BENCHMARK_RS21_BELOW";
  }
  const stack = text(first(marketContext, ["benchmark_ma_stack"]) ?? first(row, ["benchmark_ma_stack"]));
  if (/above.*EMA21|P>21|above_ema21.*true/i.test(stack)) return "BENCHMARK_RS21_HOLDING";
  if (/below.*EMA21|P<21|above_ema21.*false/i.test(stack)) return "BENCHMARK_RS21_BELOW";
  if (marketContext?.benchmark_ma_stack?.above_ema21 === true) return "BENCHMARK_RS21_HOLDING";
  if (marketContext?.benchmark_ma_stack?.above_ema21 === false) return "BENCHMARK_RS21_BELOW";
  return "BENCHMARK_RS21_UNKNOWN";
}

function sma(values, period) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function deriveWeinsteinStage(row = {}) {
  const explicit = first(row, ["benchmark_weinstein_stage", "benchmark_stage_label", "benchmark_stage_lifecycle", "weinstein_stage", "stage_label", "stage"]);
  if (explicit) {
    const value = text(explicit).toUpperCase();
    if (value.includes("1_TO_2")) return "BENCHMARK_STAGE_1_TO_2";
    if (value.includes("2A")) return "BENCHMARK_STAGE_2A";
    if (value.includes("2B") || value === "STAGE_2") return "BENCHMARK_STAGE_2B";
    if (value.includes("2C")) return "BENCHMARK_STAGE_2C";
    if (value.includes("STAGE_1")) return "BENCHMARK_STAGE_1";
    if (value.includes("STAGE_3")) return "BENCHMARK_STAGE_3";
    if (value.includes("STAGE_4")) return "BENCHMARK_STAGE_4";
  }
  const price = number(row.benchmark_close, row.close, row.price);
  const ma = number(row.benchmark_sma30w, row.sma30w);
  const slope = number(row.benchmark_sma30w_slope_4w_pct, row.sma30w_slope_4w_pct);
  if (Number.isFinite(price) && Number.isFinite(ma) && Number.isFinite(slope)) {
    if (price > ma && slope > 1) return slope > 4 ? "BENCHMARK_STAGE_2B" : "BENCHMARK_STAGE_2A";
    if (price > ma && slope >= -1) return "BENCHMARK_STAGE_1_TO_2";
    if (price < ma && slope < -1) return "BENCHMARK_STAGE_4";
    return "BENCHMARK_STAGE_1";
  }
  const bars = Array.isArray(row.bars) ? row.bars : [];
  const closes = bars.map(x => x.adjusted_close ?? x.close).filter(Number.isFinite);
  const last = closes.at(-1);
  const ma150 = sma(closes, 150);
  const priorMa150 = closes.length >= 170 ? closes.slice(0, -20).slice(-150).reduce((sum, value) => sum + value, 0) / 150 : null;
  if (Number.isFinite(last) && Number.isFinite(ma150) && Number.isFinite(priorMa150)) {
    const slopePct = (ma150 / priorMa150 - 1) * 100;
    if (last > ma150 && slopePct > 1) return slopePct > 4 ? "BENCHMARK_STAGE_2B" : "BENCHMARK_STAGE_2A";
    if (last > ma150 && slopePct >= -1) return "BENCHMARK_STAGE_1_TO_2";
    if (last < ma150 && slopePct < -1) return "BENCHMARK_STAGE_4";
    return "BENCHMARK_STAGE_1";
  }
  return "BENCHMARK_STAGE_UNKNOWN";
}

export function buildMarketConfirmationStack(marketContext = {}, benchmarkFeatureRow = {}, context = {}) {
  const warnings = [];
  const oneilCycleLabel = first(marketContext, ["oneil_style_market_label", "oneil_market_cycle", "market_state"]) ?? "UNKNOWN";
  const oneilCycleState = first(marketContext, ["mc2_cycle_state", "aurora_mc2_state", "final_market_permission", "market_permission"]) ?? "UNKNOWN";
  const benchmarkRs21State = deriveBenchmarkRs21(benchmarkFeatureRow, marketContext);
  const benchmarkStage = deriveWeinsteinStage(benchmarkFeatureRow);
  const components = {
    oneil_component: componentState("oneil", `${oneilCycleLabel} ${oneilCycleState} ${marketContext.final_market_permission ?? ""} ${marketContext.market_permission ?? ""}`),
    benchmark_rs21_component: componentState("rs21", benchmarkRs21State),
    benchmark_weinstein_component: componentState("stage", benchmarkStage)
  };
  if (components.benchmark_weinstein_component === "UNKNOWN") warnings.push("BENCHMARK_WEINSTEIN_STAGE_UNKNOWN");
  if (components.benchmark_rs21_component === "UNKNOWN") warnings.push("BENCHMARK_RS21_UNKNOWN");
  const values = Object.values(components);
  const constructive = values.filter(x => x === "PASS" || x === "PARTIAL").length;
  const caution = values.filter(x => x === "CAUTION").length;
  let state = "MARKET_CONFIRMATION_UNKNOWN";
  if (components.oneil_component === "FAIL" || (benchmarkStage === "BENCHMARK_STAGE_4" && components.benchmark_rs21_component === "FAIL")) state = "MARKET_CONFIRMATION_FAIL";
  else if (values.includes("FAIL") || caution >= 2) state = "MARKET_CONFIRMATION_CAUTION";
  else if (components.oneil_component === "PASS" && components.benchmark_rs21_component === "PASS" && ["PASS", "PARTIAL"].includes(components.benchmark_weinstein_component)) state = "THREE_SYSTEM_CONFIRMATION";
  else if (constructive >= 2 && !values.includes("FAIL")) state = "TWO_OF_THREE_CONFIRMATION";
  else if (values.every(x => x !== "UNKNOWN")) state = "MIXED_CONFIRMATION";
  const score = values.reduce((sum, value) => sum + ({ PASS: 2, PARTIAL: 1, CAUTION: 0.5, UNKNOWN: 0, FAIL: -2 }[value] ?? 0), 0);
  return {
    market_confirmation_state: state,
    market_confirmation_score: round(score),
    oneil_cycle_label: oneilCycleLabel,
    oneil_cycle_state: oneilCycleState,
    benchmark_rs21_state: benchmarkRs21State,
    benchmark_rs21_note: "Benchmark RS21 is benchmark-relative RS context. It is not RSI.",
    benchmark_weinstein_stage: benchmarkStage,
    benchmark_weinstein_stage_note: "Weinstein context: Stage 1 basing, Stage 2 advancing, Stage 3 topping, Stage 4 declining.",
    confirmation_components: components,
    warnings: [...warnings, ...(context.warnings || [])]
  };
}

function strongRs(row) {
  const rs21 = text(first(row, ["rs21_state", "rs_ema21", "rs21"]));
  const rrg = text(row.rrg?.quadrant || row.rrg_quadrant);
  const mansfield = number(row.mansfield, row.mansfield_rs, row.mansfield_rs_value);
  return number(row.rs_rating, row.rs_score_pct, row.rs_short_rating) >= 70
    || number(row.rs_1m_percentile, row.rs_1m_rating, row.rs_1m_pct) >= 70
    || number(row.rs_3m_percentile, row.rs_3m_rating, row.rs_3m_pct) >= 70
    || RS21_PASS.some(label => rs21.includes(label)) || rs21 === "ABOVE"
    || row.rsnh === true || row.rsnh63 === true || row.rsnh252 === true || number(row.rs52_prox, row.rs63_prox) >= 98
    || ["IMPROVING", "LEADING"].includes(rrg)
    || mansfield > 0 || text(row.mansfield_rs_state).includes("POSITIVE") || text(row.mansfield_rs_state).includes("RISING");
}

function hardExcluded(row) {
  const haystack = text([
    row.stage, row.stage_label, row.weinstein_stage, row.final_bucket, row.axm_risk, row.axm_label, row.axm?.axm_composite_label,
    row.liquidity_label, row.ve2_distribution_label, row.ve2?.distributionLabel, row.caution, row.data_state, row.base_stage_risk,
    row.weekly_context, row.promotion_block_reason
  ]);
  if (/STAGE_4|AURORA_X_HARD_BLOCK|LIQUIDITY_(HARD_)?FAIL|DISTRIBUTION_CLUSTER|WEEKLY_BROKEN_NO_BASE|DATA_REPAIR_INVALID/.test(haystack)) return true;
  if (/CLOSE_BELOW_50SMA.*SERIOUS|BROKEN.*50SMA/.test(haystack) && !/RECLAIM|RECOVERY/.test(haystack)) return true;
  return false;
}

function stagePrefix(row) {
  const stage = first(row, ["weinstein_stage", "stage_label", "stage"]);
  if (!stage || text(stage).includes("UNKNOWN")) return "";
  return `Weinstein ${text(stage)}; `;
}

function enrichRow(row, fields, context) {
  const out = context.mutateRows ? row : { ...row };
  out.user_note = addNote(out.user_note || out.note || out.pattern_note, `${stagePrefix(out)}${fields.userNote}`.trim());
  out.final_bucket = out.final_bucket || out.bucket;
  if (out.final_bucket && !FINAL_BUCKETS.has(out.final_bucket)) fields.warnings.push(`UNKNOWN_FINAL_BUCKET:${out.symbol || out.ticker}:${out.final_bucket}`);
  for (const membership of fields.memberships) addUnique(out, "scan_memberships", membership);
  Object.assign(out, fields.extra);
  return out;
}

function maLabel(anchor, row) {
  const haystack = text(row);
  if (haystack.includes(`PBX_REPEATED_${anchor}_RESPECT`) || number(row[`${anchor.toLowerCase()}_respect_touch_count_42d`], row.ma_respect_touch_count_42d) >= 2) return `MA${anchor.slice(0, -3)}_RESPECT_REPEATED`;
  if (haystack.includes(`PBX_FIRST_${anchor}_TOUCH`) || haystack.includes("FRESH_BOUNCE")) return `MA${anchor.slice(0, -3)}_RESPECT_FRESH_BOUNCE`;
  if (haystack.includes("SUPPORT_LOST")) return `MA${anchor.slice(0, -3)}_RESPECT_SUPPORT_LOST_REPAIR`;
  if (anchor === "50SMA" && haystack.includes("WEEKLY_RECOVERY")) return "MA50_RESPECT_WEEKLY_RECOVERY";
  return anchor === "10EMA" ? "MA10_RESPECT_WATCH_FOR_21EMA" : anchor === "21EMA" ? "MA21_RESPECT_WATCH_FOR_TRIGGER" : "MA50_RESPECT_STRUCTURAL_TEST";
}

function maEligible(row, anchor) {
  const haystack = text(row);
  const primary = text(row.ma_character_primary);
  if (primary && !primary.includes(anchor) && !haystack.includes(anchor)) return false;
  const price = number(row.price, row.close);
  const ma = anchor === "10EMA" ? number(row.ema10, row.ema10_value, row.ma10, row.axm?.ema10)
    : anchor === "21EMA" ? number(row.ema21, row.ema21_value, row.ma21, row.axm?.ema21)
      : number(row.sma50, row.sma50_value, row.ma50, row.axm?.sma50);
  if (text(row.ma_character_primary).includes(anchor)) return true;
  if (haystack.includes(anchor)) return true;
  if (Number.isFinite(price) && Number.isFinite(ma) && price >= ma * 0.985 && price <= ma * 1.06) return true;
  if (anchor === "21EMA" && text(row.rs21_state).includes("ACCELERATING")) return true;
  return false;
}

export function buildMaRespectWatchlists(featureRows = [], context = {}) {
  const warnings = [];
  const out = { ema10_respect_rows: [], ema21_respect_rows: [], sma50_respect_rows: [], warnings };
  for (const row of featureRows || []) {
    if (!row || !strongRs(row) || hardExcluded(row)) continue;
    for (const [anchor, key, membership, next] of [
      ["10EMA", "ema10_respect_rows", "MA10_RESPECT", "Strong RS 10EMA-respect leader. Watch for fresh 10EMA bounce or tight shelf; support-loss shifts attention to 21EMA."],
      ["21EMA", "ema21_respect_rows", "MA21_RESPECT", "Strong RS 21EMA-respect leader. Needs fresh bounce/reclaim from 21EMA with constructive close and no distribution follow-through."],
      ["50SMA", "sma50_respect_rows", "MA50_RESPECT", "Strong RS 50SMA structural-test candidate. Needs weekly recovery / close above 50SMA with VE2 not distribution."]
    ]) {
      if (!maEligible(row, anchor)) continue;
      if (anchor === "50SMA" && text(row.ma_character_primary).includes("21EMA") && !text(row).includes("50SMA")) continue;
      const label = maLabel(anchor, row);
      const enriched = enrichRow(row, {
        warnings,
        memberships: [membership],
        userNote: `${anchor} respect watchlist only`,
        extra: {
          ma_respect_status: label,
          ma_respect_anchor: anchor,
          ma_respect_touch_count_42d: number(row.ma_respect_touch_count_42d, row.touch_count_42d, row.pbx_touch_count_42d) ?? null,
          ma_respect_last_touch_date: first(row, ["ma_respect_last_touch_date", "last_touch_date"]),
          ma_respect_last_bounce_date: first(row, ["ma_respect_last_bounce_date", "last_bounce_date"]),
          ma_respect_bounce_quality: first(row, ["ma_respect_bounce_quality", "pbx_reversal_label", "pbx_reversal"]),
          ma_respect_next_condition: next,
          ma_character_primary: first(row, ["ma_character_primary"]) || anchor,
          ma_character_alignment: first(row, ["ma_character_alignment"]) || `${anchor}_WATCHLIST_ONLY`,
          watchlist_action: "WATCHLIST_ONLY",
          next_condition: row.next_condition || next
        }
      }, context);
      out[key].push(enriched);
      break;
    }
  }
  for (const key of ["ema10_respect_rows", "ema21_respect_rows", "sma50_respect_rows"]) out[key].sort((a, b) => (number(b.weekly_watchlist_score, b.total_score, b.aurora_sig_score) ?? 0) - (number(a.weekly_watchlist_score, a.total_score, a.aurora_sig_score) ?? 0));
  return out;
}

export function buildMyhApproachingRows(featureRows = [], context = {}) {
  const warnings = [];
  const rows = [];
  for (const row of featureRows || []) {
    if (!row || !strongRs(row) || hardExcluded(row)) continue;
    let gap = number(row.myh_gap_pct, row.price52_prox != null ? 100 - row.price52_prox : null);
    const level = number(row.myh_level, row.myh_target_level, row.price52_high, row.high_52w);
    const lookback = first(row, ["myh_label", "myh_lookback_label"]) || (row.price52_prox != null ? "MYH_52W" : null);
    if (!Number.isFinite(gap) || gap < 0 || gap > 8) {
      if (!Number.isFinite(gap) && /MYH_HISTORY_INSUFFICIENT|NOT_AVAILABLE/.test(text(row.myh_label || row.myh_state))) {
        warnings.push(`MYH_APPROACHING_DATA_REPAIR:${row.symbol || row.ticker}`);
      }
      continue;
    }
    if (/MYH_BREAKOUT_FAILED|FAILED_BREAKOUT.*DISTRIBUTION_CLUSTER/.test(text(row))) continue;
    const status = gap <= 2 ? "MYH_WITHIN_2PCT" : gap <= 5 ? "MYH_WITHIN_5PCT" : "MYH_WITHIN_8PCT";
    rows.push(enrichRow(row, {
      warnings,
      memberships: ["MYH_APPROACHING"],
      userNote: `${status}; approaching multi-year high is a leadership radar lane, not a standalone buy signal`,
      extra: {
        myh_approaching_status: status,
        myh_target_level: level,
        myh_gap_pct: round(gap),
        myh_lookback_label: lookback || "MYH_HISTORY_UNKNOWN",
        myh_history_confidence: lookback ? "HISTORY_AVAILABLE" : "MYH_APPROACHING_DATA_REPAIR",
        myh_next_condition: "Needs clean close through MYH level with constructive VE2 and no failed-probe close.",
        watchlist_action: "WATCHLIST_ONLY"
      }
    }, context));
  }
  return { myh_approaching_rows: rows.sort((a, b) => (a.myh_gap_pct ?? 999) - (b.myh_gap_pct ?? 999)).slice(0, context.limit ?? 50), warnings };
}
