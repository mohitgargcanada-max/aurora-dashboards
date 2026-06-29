import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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

const LIST_KEYS = [
  "weekly_universe",
  "weekly_focus",
  "daily_top_1_4",
  "rsle_top_20",
  "developing_watchlist",
  "near_rs_high",
  "pbx_pullbacks",
  "basepivot_patterns",
  "rmvp_early_entry",
  "ve2_volume_signature",
  "compression",
  "no_chase_risk",
  "rejected_data_repair",
  "all_candidates"
];

const pick = (row, keys) => {
  for (const key of keys) {
    if (row?.[key] !== undefined) return row[key];
  }
  return null;
};

const cloneJson = value => value == null ? value : JSON.parse(JSON.stringify(value));

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function candidateSymbol(row) {
  return pick(row, ["symbol", "ticker"]);
}

export function serializeUsDashboardCandidate(row = {}, rank = null) {
  return {
    rank: pick(row, ["rank", "weekly_rank", "focus_rank", "rsle_rank"]) ?? rank,
    symbol: candidateSymbol(row),
    name: pick(row, ["name", "company_name"]),
    exchange: pick(row, ["exchange"]),
    market: pick(row, ["market"]) ?? "US",
    theme: pick(row, ["theme", "theme_primary", "gics_sector", "sector"]),
    theme_confidence: pick(row, ["theme_confidence", "classification_status"]),
    source_lane: pick(row, ["source_lane", "route", "universe_route"]),
    aurora_bucket: pick(row, ["aurora_bucket", "bucket", "final_bucket"]),
    final_bucket: pick(row, ["final_bucket", "bucket"]),
    setup: pick(row, ["setup", "rsle_setup_lane"]),
    setup_state: pick(row, ["setup_state"]),
    weekly_tier: pick(row, ["weekly_tier", "wwl_tier"]),
    execution_tier: pick(row, ["execution_tier"]),
    price: pick(row, ["price"]),
    score: pick(row, ["score", "wwl", "weekly_watchlist_score", "rsle_tactical_score"]),
    aurora_sig_score: pick(row, ["aurora_sig_score"]),
    technical_strength_score: pick(row, ["technical_strength_score"]),
    weekly_watchlist_score: pick(row, ["weekly_watchlist_score", "wwl"]),
    leadership_score: pick(row, ["leadership_score", "rsle_leadership_score", "rs_leadership_score"]),
    tactical_score: pick(row, ["tactical_score", "rsle_tactical_score"]),
    execution_focus_score: pick(row, ["execution_focus_score"]),
    rs_rating: pick(row, ["rs_rating", "rs_score_pct"]),
    rs_trifecta: pick(row, ["rs_trifecta", "trifecta"]),
    rs_trifecta_count: pick(row, ["rs_trifecta_count"]),
    rs21_state: pick(row, ["rs21_state", "rs_ema21", "rs21"]),
    rs_1w_relative_return_pct: pick(row, ["rs_1w_relative_return_pct", "rs_1w_relative"]),
    rs_1w_percentile: pick(row, ["rs_1w_percentile", "rs_1w_rating"]),
    rs_1m_relative_return_pct: pick(row, ["rs_1m_relative_return_pct", "rs_1m_relative"]),
    rs_1m_percentile: pick(row, ["rs_1m_percentile", "rs_1m_rating"]),
    rs_3m_relative_return_pct: pick(row, ["rs_3m_relative_return_pct", "rs_3m_relative"]),
    rs_3m_percentile: pick(row, ["rs_3m_percentile", "rs_3m_rating"]),
    rs_horizon_state: pick(row, ["rs_horizon_state"]),
    mansfield_state: pick(row, ["mansfield_state"]),
    rrg_quadrant: pick(row, ["rrg_quadrant"]) ?? row.rrg?.quadrant ?? null,
    rrg_ratio: pick(row, ["rrg_ratio"]) ?? row.rrg?.ratio ?? null,
    rrg_momentum: pick(row, ["rrg_momentum"]) ?? row.rrg?.momentum ?? null,
    rmv5: pick(row, ["rmv5"]),
    rmv15: pick(row, ["rmv15"]),
    rmv25: pick(row, ["rmv25"]),
    base_pivot_price: pick(row, ["base_pivot_price", "basepivot_price", "pivot", "trigger"]),
    basepivot_quality: pick(row, ["basepivot_quality"]),
    basepivot_status: pick(row, ["basepivot_status", "basepivot_state"]),
    base_stage_count: pick(row, ["base_stage_count"]),
    base_stage_risk: pick(row, ["base_stage_risk"]),
    pattern_proxy: pick(row, ["pattern_proxy"]),
    rmvp_price: pick(row, ["rmvp_price", "rmvp"]),
    rmvp_quality: pick(row, ["rmvp_quality"]),
    rmvp_status: pick(row, ["rmvp_status"]),
    pbx_score: pick(row, ["pbx_score"]),
    pbx_depth_label: pick(row, ["pbx_depth_label"]),
    pbx_duration_label: pick(row, ["pbx_duration_label"]),
    pbx_ma_touch_profile: pick(row, ["pbx_ma_touch_profile", "pbx_ma_defense"]),
    pbx_failure_label: pick(row, ["pbx_failure_label", "pbx_reversal"]),
    ve2_status: pick(row, ["ve2_status"]),
    ve2_signature_label: pick(row, ["ve2_signature_label", "ve2_label"]),
    ve2_pattern_volume_grade: pick(row, ["ve2_pattern_volume_grade", "ve2_grade"]),
    ve2_dryup_label: pick(row, ["ve2_dryup_label"]),
    ve2_distribution_label: pick(row, ["ve2_distribution_label"]),
    rvol_20d: pick(row, ["rvol_20d", "rvol"]),
    close_pos: pick(row, ["close_pos"]),
    axm10_value: pick(row, ["axm10_value"]),
    axm10_label: pick(row, ["axm10_label"]),
    axm21_value: pick(row, ["axm21_value", "axm_atr"]),
    axm21_label: pick(row, ["axm21_label", "axm_label"]),
    axm50_value: pick(row, ["axm50_value"]),
    axm50_label: pick(row, ["axm50_label"]),
    axm200_value: pick(row, ["axm200_value"]),
    axm200_label: pick(row, ["axm200_label"]),
    axm_risk: pick(row, ["axm_risk"]),
    pattern_quality_execution_cap: pick(row, ["pattern_quality_execution_cap"]),
    pattern_quality_cap_reason: pick(row, ["pattern_quality_cap_reason"]),
    pattern_quality_cap_level: pick(row, ["pattern_quality_cap_level"]),
    entry_reference: pick(row, ["entry_reference"]),
    trigger_price: pick(row, ["trigger_price", "trigger"]),
    entry_stop: pick(row, ["entry_stop", "stop"]),
    entry_risk_pct: pick(row, ["entry_risk_pct", "risk_pct"]),
    thesis_stop: pick(row, ["thesis_stop"]),
    thesis_risk_pct: pick(row, ["thesis_risk_pct"]),
    liquidity_label: pick(row, ["liquidity_label"]),
    addv20: pick(row, ["addv20"]),
    addv20_usd: pick(row, ["addv20_usd", "avg_dollar_volume_20_usd_equiv", "avg_dollar_volume_20"]),
    avg_volume_20d: pick(row, ["avg_volume_20d", "avg_volume20"]),
    caution: pick(row, ["caution"]),
    next_condition: pick(row, ["next_condition", "next_tactical_condition", "next_promotion_condition"]),
    promotion_block_reason: pick(row, ["promotion_block_reason"]),
    data_state: pick(row, ["data_state"]),
    warnings: pick(row, ["warnings"]) ?? []
  };
}

function serializeList(rows) {
  return asArray(rows).map((row, index) => serializeUsDashboardCandidate(row, index + 1));
}

function coverageFromState(state = {}) {
  const run = state.run || {};
  return {
    expected_symbols: run.expected_symbols ?? run.technical_eligible_count ?? null,
    loaded_symbols: run.loaded_symbols ?? null,
    valid_latest_symbols: run.valid_latest_symbols ?? null,
    calculated_symbols: run.calculated_symbols ?? run.calculated_technical_count ?? null,
    selected_weekly_universe_count: asArray(state.core).length,
    selected_weekly_focus_count: asArray(state.weekly_focus).length,
    selected_daily_top_count: asArray(state.daily_top).length,
    selected_rsle_count: asArray(state.rs_leadership?.top20_tactical || state.rs_leadership?.top20).length,
    coverage_pct: run.coverage_pct ?? run.technical_coverage_pct ?? null
  };
}

function provenanceFromState(state = {}) {
  const run = state.run || {};
  const provenance = state.provenance || {};
  return {
    provider_route: provenance.provider_route ?? null,
    benchmark: "SPY",
    benchmark_provider: provenance.provider ?? null,
    benchmark_data_as_of: provenance.data_date ?? run.data_as_of ?? null,
    adjustment_status: provenance.adjustment_status ?? null,
    run_mode: run.run_mode ?? run.run_type ?? null,
    run_mode_reason: run.run_mode_reason ?? null,
    universe_update_mode: run.universe_update_mode ?? null,
    deep_enrichment_scope: run.deep_enrichment_scope ?? null,
    warnings: asArray(run.warnings)
  };
}

export function buildUsDashboardJsonExport({ latest = {}, scan = {}, generatedAt } = {}) {
  const state = cloneJson(scan);
  const generated = generatedAt ?? state.generated_at ?? new Date().toISOString();
  const run = state.run || {};
  const rsleTop20 = state.rs_leadership?.top20_tactical || state.rs_leadership?.top20 || [];
  const rsleDeveloping = state.rs_leadership?.developing_21_40 || [];
  const sections = state.sections || {};
  const scanPayload = {
    schema_version: "aurora_dashboard_scan_v1",
    market: "US",
    data_as_of: run.data_as_of ?? state.data_as_of ?? null,
    completed_session: run.completed_session ?? run.data_as_of ?? null,
    run_type: run.run_type ?? null,
    run_mode: run.run_mode ?? run.run_type ?? null,
    generated_at: generated,
    market_summary: cloneJson(state.market || {}),
    provenance: provenanceFromState(state),
    coverage: coverageFromState(state),
    weekly_universe: serializeList(state.core),
    weekly_focus: serializeList(state.weekly_focus),
    daily_top_1_4: serializeList(state.daily_top).slice(0, 4),
    rsle_top_20: serializeList(rsleTop20).slice(0, 20),
    developing_watchlist: serializeList(rsleDeveloping.length ? rsleDeveloping : state.developing_watchlist_20 || state.near_watchlist),
    near_rs_high: serializeList(sections.rs21_rsnh),
    pbx_pullbacks: serializeList(sections.pbx_pullback),
    basepivot_patterns: serializeList(sections.basepivot_patterns),
    rmvp_early_entry: serializeList(sections.rmvp_early_entry),
    ve2_volume_signature: serializeList(sections.ve2_volume_signature),
    compression: serializeList(sections.compression_vcp),
    no_chase_risk: serializeList(sections.no_chase_risk),
    rejected_data_repair: serializeList(sections.rejected_data_repair),
    all_candidates: serializeList(state.all_candidates),
    audit_contract: {
      audit_only: true,
      json_export_only: true,
      scanner_behavior_changed: false,
      dashboard_rendering_changed: false,
      contains_external_report_data: false,
      contains_email_data: false
    }
  };

  for (const key of LIST_KEYS) scanPayload[key] = asArray(scanPayload[key]);

  const latestPayload = {
    schema_version: "aurora_dashboard_latest_v1",
    market: "US",
    dashboard_version: latest.dashboard_version ?? state.dashboard_version ?? null,
    data_as_of: scanPayload.data_as_of,
    completed_session: scanPayload.completed_session,
    run_type: scanPayload.run_type,
    run_mode: scanPayload.run_mode,
    generated_at: generated,
    scan_url: "./us-full-dashboard-scan.json",
    dashboard_url: "../index.html",
    notes: [
      "Machine-readable dashboard export only",
      "No scanner behavior changed",
      "No external report data included",
      "No email data included"
    ]
  };

  for (const row of [
    ...scanPayload.weekly_universe,
    ...scanPayload.weekly_focus,
    ...scanPayload.daily_top_1_4,
    ...scanPayload.rsle_top_20,
    ...scanPayload.developing_watchlist,
    ...scanPayload.near_rs_high,
    ...scanPayload.pbx_pullbacks,
    ...scanPayload.basepivot_patterns,
    ...scanPayload.rmvp_early_entry,
    ...scanPayload.ve2_volume_signature,
    ...scanPayload.compression,
    ...scanPayload.no_chase_risk,
    ...scanPayload.rejected_data_repair,
    ...scanPayload.all_candidates
  ]) {
    if (row.final_bucket && !FINAL_BUCKETS.has(row.final_bucket)) scanPayload.provenance.warnings.push(`UNKNOWN_FINAL_BUCKET:${row.symbol}:${row.final_bucket}`);
  }

  return { latest: latestPayload, scan: scanPayload };
}

async function writeJsonAtomic(path, payload) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await rename(tmp, path);
}

export async function writeUsDashboardJsonExport({ outputDir, latest = {}, scan = {}, generatedAt } = {}) {
  if (!outputDir) throw new Error("outputDir is required");
  await mkdir(outputDir, { recursive: true });
  const payload = buildUsDashboardJsonExport({ latest, scan, generatedAt });
  const latestPath = resolve(outputDir, "latest.json");
  const scanPath = resolve(outputDir, "us-full-dashboard-scan.json");
  await writeJsonAtomic(latestPath, payload.latest);
  await writeJsonAtomic(scanPath, payload.scan);
  return { latestPath, scanPath, ...payload };
}
