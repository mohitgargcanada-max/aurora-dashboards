const UNKNOWN = "UNKNOWN";
const UNMAPPED = "UNMAPPED_REVIEW";

const RS21_EARLY = new Set([
  "RS21_APPROACHING",
  "RS21_RECLAIM_0D",
  "RS21_RECLAIM_1D",
  "RS21_RECLAIM_2D",
  "RS21_RECLAIM_3D",
  "RS21_RECLAIM_4D",
  "RS21_RECLAIM_5D",
  "RS21_HOLD_ABOVE",
  "RS21_HOLDING",
  "RS21_ACCELERATING"
]);

const RS_HORIZON_EARLY = new Set([
  "RS_HORIZON_EARLY_TURN",
  "RS_HORIZON_ACCELERATING",
  "RS_HORIZON_BROADENING",
  "RS_HORIZON_2_OF_3",
  "RS_HORIZON_3_OF_3"
]);

const HARD_FAIL = /STAGE_4|AURORA_X_HARD_BLOCK|LIQUIDITY_(HARD_)?FAIL|DISTRIBUTION_CLUSTER|DATA_REPAIR_INVALID|INVALID|STALE_PROVIDER|UNSUPPORTED_SYMBOL/i;

const text = value => {
  if (Array.isArray(value)) return value.filter(Boolean).map(text).join(" ");
  if (value && typeof value === "object") return Object.values(value).filter(v => v == null || typeof v !== "object").map(text).join(" ");
  return String(value ?? "");
};

const number = (...values) => values.find(Number.isFinite);
const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function first(row, keys) {
  for (const key of keys) if (row?.[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  return null;
}

function symbolOf(row) {
  return row?.symbol || row?.ticker;
}

function normalized(value, fallback = UNKNOWN) {
  const raw = text(value).trim();
  if (!raw || raw === "-" || raw === "NOT_AVAILABLE") return fallback;
  if (/UNMAPPED_REVIEW|GICS_UNKNOWN|INDUSTRY_UNKNOWN/i.test(raw)) return raw.includes("UNMAPPED") ? UNMAPPED : UNKNOWN;
  return raw;
}

function hardExcluded(row) {
  return HARD_FAIL.test(text([
    row.stage,
    row.stage_label,
    row.weinstein_stage,
    row.final_bucket,
    row.liquidity_label,
    row.ve2_distribution_label,
    row.ve2?.distributionLabel,
    row.caution,
    row.data_state,
    row.rejection_reason,
    row.reason
  ]));
}

export function normalizeClassification(row = {}, { market = row.market || "" } = {}) {
  const marketNativeSector = normalized(first(row, ["market_native_sector", "sector", "gics_sector", "gics_sector_name", "theme", "aurora_theme"]), UNKNOWN);
  const marketNativeIndustry = normalized(first(row, ["market_native_industry", "industry", "main_industry", "aurora_theme", "theme"]), UNKNOWN);
  const marketNativeSubindustry = normalized(first(row, ["market_native_subindustry", "sub_industry", "subindustry", "aurora_subtheme", "theme"]), UNKNOWN);
  const sectorName = normalized(first(row, ["gics_sector_name", "gics_sector", "sector", "market_native_sector"]), marketNativeSector);
  const industryGroupName = normalized(first(row, ["gics_industry_group_name", "industry_group", "aurora_theme", "theme", "market_native_industry"]), marketNativeIndustry);
  const industryName = normalized(first(row, ["gics_industry_name", "industry", "main_industry", "aurora_theme", "theme", "market_native_industry"]), industryGroupName);
  const subIndustryName = normalized(first(row, ["gics_sub_industry_name", "sub_industry", "subindustry", "aurora_subtheme", "aurora_theme", "theme", "market_native_subindustry"]), industryName);
  const unresolved = [sectorName, industryGroupName, industryName, subIndustryName].some(value => value === UNKNOWN || value === UNMAPPED);
  return {
    market: String(market || row.exchange || "").toUpperCase() || null,
    gics_sector_code: first(row, ["gics_sector_code"]),
    gics_sector_name: unresolved && sectorName === UNMAPPED ? UNKNOWN : sectorName,
    gics_industry_group_code: first(row, ["gics_industry_group_code"]),
    gics_industry_group_name: unresolved && industryGroupName === UNMAPPED ? UNMAPPED : industryGroupName,
    gics_industry_code: first(row, ["gics_industry_code"]),
    gics_industry_name: unresolved && industryName === UNMAPPED ? UNMAPPED : industryName,
    gics_sub_industry_code: first(row, ["gics_sub_industry_code"]),
    gics_sub_industry_name: unresolved && subIndustryName === UNMAPPED ? UNMAPPED : subIndustryName,
    gics_classification_source: first(row, ["gics_classification_source", "sector_mapping_source", "theme_source"]) || (unresolved ? UNMAPPED : "MARKET_NATIVE_OR_PROVIDER_MAPPING"),
    gics_classification_confidence: first(row, ["gics_classification_confidence", "sector_mapping_confidence", "theme_confidence"]) || (unresolved ? "LOW" : "MEDIUM"),
    aurora_theme: normalized(first(row, ["aurora_theme", "theme"]), industryGroupName),
    aurora_subtheme: normalized(first(row, ["aurora_subtheme", "sub_industry", "subindustry", "theme"]), subIndustryName),
    market_native_sector: marketNativeSector,
    market_native_industry: marketNativeIndustry,
    market_native_subindustry: marketNativeSubindustry
  };
}

export function applyCrossMarketClassification(rows = [], context = {}) {
  return rows.map(row => Object.assign(context.mutateRows === false ? { ...row } : row, normalizeClassification(row, context)));
}

export function earlyRsEvidence(row = {}) {
  const reasons = [];
  if (number(row.rs_rating, row.rs_score_pct, row.rs_short_rating) >= 70) reasons.push("RS_RATING_GE_70");
  const rs21 = text(first(row, ["rs21_state", "rs_ema21", "rs21"]));
  if ([...RS21_EARLY].some(label => rs21.includes(label))) reasons.push(rs21.includes("RECLAIM") ? "RS21_RECLAIM" : "RS21_CONSTRUCTIVE");
  const horizon = text(first(row, ["rs_horizon_state", "rs_1w_state", "rs_1m_state", "rs_3m_state"]));
  if ([...RS_HORIZON_EARLY].some(label => horizon.includes(label))) reasons.push("RS_HORIZON_ACCELERATING");
  const rrg = text(row.rrg?.quadrant || row.rrg_quadrant);
  if (["IMPROVING", "LEADING"].includes(rrg)) reasons.push(`RRG_${rrg}`);
  if (row.rsnh === true || row.rsnh63 === true || row.rsnh252 === true || row.rsnh_before_price === true) reasons.push("RSNH_BEFORE_PRICE");
  const mansfield = number(row.mansfield, row.mansfield_rs, row.mansfield_rs_value);
  if (mansfield > 0 || /POSITIVE|RISING/i.test(text(row.mansfield_rs_state))) reasons.push("MANSFIELD_IMPROVING");
  if (row.strong_rs_retention_status) reasons.push("PRIOR_STRONG_RS_RETENTION");
  return reasons;
}

export function applyRsTrifectaDiagnostic(row = {}) {
  const label = text(first(row, ["rs_trifecta_label", "rs_trifecta"])).toUpperCase();
  if (!/FAIL|NOT_PASS/.test(label)) return row;
  const reasons = earlyRsEvidence(row);
  if (!reasons.length || hardExcluded(row)) return row;
  const note = reasons.includes("RS21_RECLAIM") ? "RS21_RECLAIM_BUT_TRIFECTA_FAIL"
    : reasons.includes("RS_RATING_GE_70") ? "RS_RATING_STRONG_TRIFECTA_FAIL"
      : reasons.some(reason => reason.startsWith("RRG_")) ? "RRG_IMPROVING_TRIFECTA_FAIL"
        : reasons.includes("RS_HORIZON_ACCELERATING") ? "RS_HORIZON_ACCELERATING_TRIFECTA_FAIL"
          : reasons.includes("MANSFIELD_IMPROVING") ? "MANSFIELD_IMPROVING_TRIFECTA_FAIL"
            : "RS_CONFIRMATION_PENDING";
  row.rs_trifecta_diagnostic_note = note;
  row.rejection_reason = row.rejection_reason === "RS_TRIFECTA_NOT_PASS" ? "RS_CONFIRMATION_PENDING" : row.rejection_reason;
  row.current_gate = row.current_gate || note;
  row.radar_reason = row.radar_reason || note;
  addMembership(row, "AURORA_RADAR_UNIVERSE");
  return row;
}

function addMembership(row, membership) {
  const current = Array.isArray(row.scan_memberships) ? row.scan_memberships : row.scan_memberships ? [row.scan_memberships] : [];
  if (!current.includes(membership)) current.push(membership);
  row.scan_memberships = current;
}

export function applyMyhLaneFields(row = {}) {
  const breakoutBars = number(row.bars_since_myh_breakout, row.myh_bars_since_breakout);
  const level = number(row.myh_breakout_level, row.myh_level, row.myh_target_level);
  const distance = number(row.myh_retest_distance_pct, row.myh_gap_pct);
  const retestAnchor = first(row, ["myh_retest_anchor", "support_retest_anchor", "ma_character_primary"]);
  const state = text(row.myh_status || row.myh_state || row.myh_label);
  let status = state.includes("MYH_NEAR_HIGH") ? "MYH_APPROACHING"
    : state.includes("BREAKOUT_FAILED") ? "MYH_FAILED_BREAKOUT_REPAIR"
      : state.includes("BREAKOUT_CONFIRMED") ? "MYH_BREAKOUT_CONFIRMING"
        : row.axm_risk === "AXM_NO_CHASE" ? "MYH_EXTENDED_NO_CHASE"
          : row.myh_status || "MYH_APPROACHING";
  if (Number.isFinite(breakoutBars) && breakoutBars >= 1 && breakoutBars <= 20 && Number.isFinite(level) && Number.isFinite(distance) && Math.abs(distance) <= 6 && retestAnchor && earlyRsEvidence(row).length && !hardExcluded(row)) {
    status = "MYH_BREAKOUT_RETEST";
  }
  row.myh_status = status;
  row.myh_breakout_level = round(level);
  row.bars_since_myh_breakout = Number.isFinite(breakoutBars) ? breakoutBars : null;
  row.myh_retest_anchor = retestAnchor || null;
  row.myh_retest_distance_pct = round(distance);
  row.myh_next_condition ||= status === "MYH_BREAKOUT_RETEST"
    ? "Watch for constructive retest close with visible tactical stop; radar only unless normal AURORA gates promote it."
    : "Needs normal AURORA confirmation before promotion.";
  if (status === "MYH_BREAKOUT_RETEST") addMembership(row, "MYH_BREAKOUT_RETEST");
  return row;
}

export function buildMyhBreakoutRetestRows(rows = [], { limit = 50 } = {}) {
  return rows.map(row => applyMyhLaneFields(row)).filter(row => row.myh_status === "MYH_BREAKOUT_RETEST").slice(0, limit);
}

export function buildStrongRsRetention(rows = [], { sourceLists = {}, retentionWindow = 20, limit = 50 } = {}) {
  const active = new Set(Object.values(sourceLists).flat().map(symbolOf).filter(Boolean));
  return rows
    .filter(row => !active.has(symbolOf(row)) && !hardExcluded(row))
    .filter(row => {
      const reasons = earlyRsEvidence(row);
      const strong = reasons.length && (number(row.rs_rating, row.rs_1m_percentile, row.rs_3m_percentile) >= 80 || /PASS|PARTIAL/i.test(text(first(row, ["rs_trifecta_label", "rs_trifecta"]))) || reasons.some(reason => /RS21|RRG|MANSFIELD|RSNH/.test(reason)));
      return strong || (number(row.days_since_last_seen) <= retentionWindow && reasons.length);
    })
    .map(row => {
      addMembership(row, "STRONG_RS_RETENTION");
      return Object.assign(row, {
        strong_rs_retention_status: row.strong_rs_retention_status || (row.final_bucket === "NO_CHASE" ? "RS_LEADER_NO_CHASE_WAIT" : row.final_bucket === "REPAIR_WATCH" ? "RS_LEADER_REPAIR_WAIT" : "RS_LEADER_OUT_OF_RADAR"),
        retention_reason: row.retention_reason || earlyRsEvidence(row).join(", "),
        last_seen_list: row.last_seen_list || "CURRENT_SCAN_ONLY",
        last_seen_date: row.last_seen_date || row.data_as_of || null,
        days_since_last_seen: number(row.days_since_last_seen) ?? null,
        rs_retention_score: round((number(row.rs_rating, row.rs_1m_percentile, row.rs_3m_percentile) ?? 70) + earlyRsEvidence(row).length * 3, 0),
        current_gate: row.current_gate || row.final_bucket || row.setup_label || "RADAR_ONLY",
        next_condition: row.next_condition || "Wait for clean trigger, tighter risk, or repaired setup."
      });
    })
    .sort((a, b) => (b.rs_retention_score ?? 0) - (a.rs_retention_score ?? 0))
    .slice(0, limit);
}

export function buildAuroraRadarUniverse({ lists = {}, allCandidates = [], market = "", dataAsOf = null, limit = 200 } = {}) {
  const bySymbol = new Map();
  const add = (row, source) => {
    if (!row || hardExcluded(row) && !earlyRsEvidence(row).length) return;
    const symbol = symbolOf(row);
    if (!symbol) return;
    applyRsTrifectaDiagnostic(row);
    applyMyhLaneFields(row);
    const existing = bySymbol.get(symbol);
    const sourceLists = new Set([...(existing?.source_lists || []), source]);
    const scanMemberships = new Set([...(existing?.scan_memberships || []), ...(Array.isArray(row.scan_memberships) ? row.scan_memberships : row.scan_memberships ? [row.scan_memberships] : []), source]);
    const classification = normalizeClassification(row, { market });
    bySymbol.set(symbol, {
      symbol,
      company_name: row.company_name || row.name || null,
      market: classification.market || market,
      ...classification,
      radar_reason: row.radar_reason || row.retention_reason || row.myh_status || row.setup_label || row.final_bucket || "RADAR_VISIBILITY",
      scan_memberships: [...scanMemberships],
      current_gate: row.current_gate || row.final_bucket || row.setup_label || "RADAR_ONLY",
      next_condition: row.next_condition || row.myh_next_condition || null,
      source_lists: [...sourceLists],
      data_as_of: row.data_as_of || dataAsOf,
      classification_confidence: classification.gics_classification_confidence
    });
  };
  for (const [source, rows] of Object.entries(lists)) for (const row of rows || []) add(row, source);
  for (const row of allCandidates) if (earlyRsEvidence(row).length) add(row, "all_candidates");
  return [...bySymbol.values()].slice(0, limit);
}

function groupRows(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const name = normalized(row[key], UNMAPPED);
    const item = map.get(name) || [];
    item.push(row);
    map.set(name, item);
  }
  return map;
}

export function buildRrgHierarchy(rows = [], { minDenominator = 3 } = {}) {
  const levels = [
    ["industry_group", "gics_industry_group_name"],
    ["industry", "gics_industry_name"],
    ["sub_industry", "gics_sub_industry_name"]
  ];
  const out = {};
  for (const [level, key] of levels) {
    out[level] = [...groupRows(rows, key).entries()].map(([name, members]) => {
      const valid = members.filter(row => Number.isFinite(row.rrg?.ratio ?? row.rrg_ratio) && Number.isFinite(row.rrg?.momentum ?? row.rrg_momentum));
      const denominator = members.length;
      const sufficient = valid.length >= minDenominator;
      return {
        level,
        name,
        denominator,
        valid_rrg_denominator: valid.length,
        confidence: sufficient ? "DENOMINATOR_OK" : "RRG_INSUFFICIENT_DENOMINATOR",
        rrg_ratio: sufficient ? round(valid.reduce((sum, row) => sum + (row.rrg?.ratio ?? row.rrg_ratio), 0) / valid.length) : null,
        rrg_momentum: sufficient ? round(valid.reduce((sum, row) => sum + (row.rrg?.momentum ?? row.rrg_momentum), 0) / valid.length) : null,
        symbols: members.map(symbolOf).filter(Boolean).slice(0, 8).join(", ")
      };
    }).sort((a, b) => b.denominator - a.denominator || a.name.localeCompare(b.name));
  }
  return out;
}

export function enrichRadarVisibility(rows = [], context = {}) {
  applyCrossMarketClassification(rows, { ...context, mutateRows: true });
  for (const row of rows) {
    applyRsTrifectaDiagnostic(row);
    applyMyhLaneFields(row);
  }
  return rows;
}
