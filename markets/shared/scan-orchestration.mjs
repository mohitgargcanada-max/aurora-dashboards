export const SCAN_MODES = Object.freeze({
  SUNDAY_FULL_REBUILD: "SUNDAY_FULL_REBUILD",
  WEEKDAY_EOD_UPDATE: "WEEKDAY_EOD_UPDATE"
});

export const FINAL_BUCKETS = Object.freeze([
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

export const WEEKLY_LIST_SOURCE = "AURORA_WEEKLY_DISCOVERY";

export const WEEKDAY_DEEP_ENRICHMENT_SCOPE = Object.freeze([
  "WEEKLY_UNIVERSE",
  "WEEKLY_FOCUS",
  "DAILY_TOP_1_4",
  "RSLE_TOP20",
  "DEVELOPING_WATCHLIST",
  "HIGH_PRIORITY_REJECTED_DATA_REPAIR",
  "NEW_EXCEPTION_CANDIDATES",
  "ACTIVE_CATALYST_EVENT_NAMES"
]);

const HARD_REMOVAL_REASONS = new Set([
  "STAGE_4_DAMAGED",
  "AURORA_X_HARD_BLOCK",
  "LIQUIDITY_FAIL",
  "LIQUIDITY_HARD_FAIL",
  "WEEKLY_BROKEN_NO_BASE",
  "REPEATED_FAILED_ATTEMPTS_WITH_DISTRIBUTION",
  "STALE_SETUP_REMOVE",
  "DATA_REPAIR_INVALID"
]);

function symbolOf(row) {
  return row?.ticker || row?.symbol;
}

export function parseScanArgs(argv = []) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith("--mode=")) out.mode = arg.slice("--mode=".length);
    else if (arg.startsWith("--session=")) out.session = arg.slice("--session=".length);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) out.session ||= arg;
  }
  return out;
}

export function resolveScanMode({ mode, now = new Date() } = {}) {
  if (mode) {
    if (!Object.values(SCAN_MODES).includes(mode)) throw new Error(`Unknown scan mode: ${mode}`);
    return { run_mode: mode, run_mode_reason: "CLI_MODE_EXPLICIT" };
  }
  const day = now.getUTCDay();
  if (day === 0 || day === 6) {
    return { run_mode: SCAN_MODES.SUNDAY_FULL_REBUILD, run_mode_reason: "WEEKEND_CALENDAR_INFERRED" };
  }
  return { run_mode: SCAN_MODES.WEEKDAY_EOD_UPDATE, run_mode_reason: "WEEKDAY_CALENDAR_INFERRED" };
}

export function weekIdForSession(session) {
  const date = new Date(`${session}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function runLightweightFullUniverseDiscovery({ market, session, cache }) {
  const featureMatrix = cache?.featureMatrix || cache?.candidates || [];
  return {
    market,
    session,
    universe_update_mode: "LIGHTWEIGHT_FULL_UNIVERSE_NUMERIC_DISCOVERY",
    deep_enrichment_scope: [...WEEKDAY_DEEP_ENRICHMENT_SCOPE],
    feature_matrix: featureMatrix,
    calculated_symbols: featureMatrix.length,
    ohlcv_fetch_calls: 0,
    source: "CACHED_OHLCV_PLUS_APPENDED_COMPLETED_BAR"
  };
}
export function hardWeeklyRemovalReason(row) {
  if (!row) return "MISSING_FROM_CURRENT_MATRIX";
  if (row.stale_remove) return "STALE_SETUP_REMOVE";
  if ((row.watchlist_action || "").startsWith("WATCHLIST_REMOVE")) return row.watchlist_action;
  if (HARD_REMOVAL_REASONS.has(row.override_reason)) return row.override_reason;
  if (HARD_REMOVAL_REASONS.has(row.removal_reason)) return row.removal_reason;
  if (row.stage === "STAGE_4" || row.stage_label === "STAGE_4" || row.stage_label === "STAGE_4_DAMAGED") return "STAGE_4_DAMAGED";
  if (row.liquidity_label === "LIQUIDITY_FAIL") return "LIQUIDITY_FAIL";
  if ((row.bucket || row.final_bucket) === "AVOID_FRESH_LONG") return "HARD_AVOID_FRESH_LONG";
  if ((row.data_state || "").startsWith("UNKNOWN_INVALID")) return "DATA_REPAIR_INVALID";
  return null;
}

export function createWeeklyContract(rows, { session, generatedAt, market = "US" }) {
  const symbols = rows.map(symbolOf).filter(Boolean);
  const normalizedMarket = market.toUpperCase();
  return {
    market: normalizedMarket,
    week_id: weekIdForSession(session),
    weekly_contract_id: `${normalizedMarket}-${weekIdForSession(session)}-${session}`,
    weekly_list_created_asof: session,
    weekly_list_source: WEEKLY_LIST_SOURCE,
    weekly_universe_symbols: symbols,
    carry_forward_count: 0,
    daily_status: Object.fromEntries(symbols.map(symbol => [symbol, "FRESH_WEEKLY_REBUILD"])),
    removal_flag: {},
    removal_reason: {},
    stale_setup_review: {},
    stale_remove: {},
    generated_at: generatedAt
  };
}

export function updateWeeklyContractForWeekday({ previousContract, featureMatrix, rankedCandidates, session, generatedAt, targetMax = 20, market = "US" }) {
  const bySymbol = new Map(featureMatrix.map(row => [symbolOf(row), row]));
  const previousSymbols = previousContract?.weekly_universe_symbols || [];
  const selected = [];
  const removalFlag = {};
  const removalReason = {};
  const dailyStatus = {};

  for (const symbol of previousSymbols) {
    const row = bySymbol.get(symbol);
    const reason = hardWeeklyRemovalReason(row);
    if (reason) {
      removalFlag[symbol] = true;
      removalReason[symbol] = reason;
      dailyStatus[symbol] = "REMOVED_BY_HARD_RULE";
      continue;
    }
    row.daily_status = "CARRY_FORWARD_RECALCULATED";
    row.removal_flag = false;
    row.removal_reason = null;
    selected.push(row);
    dailyStatus[symbol] = "CARRY_FORWARD_RECALCULATED";
  }

  if (!previousSymbols.length) {
    const fallback = rankedCandidates.slice(0, targetMax);
    return {
      weeklyUniverse: fallback,
      weeklyContract: createWeeklyContract(fallback, { session, generatedAt, market }),
      warnings: ["NO_ACTIVE_WEEKLY_CONTRACT_FOUND_FELL_BACK_TO_FULL_REBUILD_SELECTION"]
    };
  }

  const weeklyContract = {
    ...previousContract,
    market: previousContract.market || market.toUpperCase(),
    weekly_universe_symbols: selected.map(symbolOf),
    carry_forward_count: selected.length,
    daily_status: { ...(previousContract.daily_status || {}), ...dailyStatus },
    removal_flag: { ...(previousContract.removal_flag || {}), ...removalFlag },
    removal_reason: { ...(previousContract.removal_reason || {}), ...removalReason },
    stale_setup_review: previousContract.stale_setup_review || {},
    stale_remove: previousContract.stale_remove || {},
    generated_at: generatedAt,
    last_updated_asof: session
  };
  return { weeklyUniverse: selected, weeklyContract, warnings: [] };
}

export function buildWeeklyUniverseForMode({ mode, previousContract, rankedCandidates, featureMatrix, session, generatedAt, targetMax = 20, market = "US" }) {
  if (mode === SCAN_MODES.SUNDAY_FULL_REBUILD) {
    const weeklyUniverse = rankedCandidates.slice(0, targetMax);
    for (const row of weeklyUniverse) {
      row.daily_status = "FRESH_WEEKLY_REBUILD";
      row.removal_flag = false;
      row.removal_reason = null;
    }
    return { weeklyUniverse, weeklyContract: createWeeklyContract(weeklyUniverse, { session, generatedAt, market }), warnings: [] };
  }
  return updateWeeklyContractForWeekday({ previousContract, featureMatrix, rankedCandidates, session, generatedAt, targetMax, market });
}

export function scanRunMetadata({ mode, reason, market, dataAsOf, completedSession, generatedAt, weeklyContract, discovery, expectedSymbols, loadedSymbols, validLatestSymbols, calculatedSymbols, warnings = [] }) {
  const staleDashboard = Boolean(completedSession && dataAsOf && completedSession !== dataAsOf);
  const safeExpected = expectedSymbols || 0;
  const coveragePct = safeExpected ? Number((calculatedSymbols / safeExpected * 100).toFixed(2)) : null;
  return {
    run_mode: mode,
    run_mode_reason: reason,
    market,
    data_as_of: dataAsOf,
    completed_session: completedSession || dataAsOf,
    generated_at: generatedAt,
    weekly_contract_id: weeklyContract?.weekly_contract_id || null,
    weekly_contract_created_asof: weeklyContract?.weekly_list_created_asof || null,
    universe_update_mode: mode === SCAN_MODES.SUNDAY_FULL_REBUILD ? "FULL_ELIGIBLE_UNIVERSE_REBUILD" : discovery?.universe_update_mode,
    deep_enrichment_scope: mode === SCAN_MODES.SUNDAY_FULL_REBUILD ? ["COMPLETE_ELIGIBLE_UNIVERSE"] : discovery?.deep_enrichment_scope,
    expected_symbols: expectedSymbols,
    loaded_symbols: loadedSymbols,
    valid_latest_symbols: validLatestSymbols,
    calculated_symbols: calculatedSymbols,
    coverage_pct: coveragePct,
    stale_dashboard_flag: staleDashboard,
    warnings: staleDashboard ? [...warnings, "COMPLETED_SESSION_DIFFERS_FROM_CACHE_DATA_AS_OF"] : warnings
  };
}
