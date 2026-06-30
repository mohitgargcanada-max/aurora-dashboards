import { execFileSync } from "node:child_process";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marketDimmer, weeklyWatchlistScore } from "../engine/aurora.mjs";
import { loadSymbol } from "../engine/cache-store.mjs";
import { buildAuroraRadarUniverse, buildMyhBreakoutRetestRows, buildRrgHierarchy, buildStrongRsRetention, enrichRadarVisibility, splitRejectedForRadarVisibility } from "../../../shared/classification-radar.mjs";
import { buildMarketConfirmationStack, buildMaRespectWatchlists, buildMyhApproachingRows } from "../../../shared/market-confirmation-and-ma-respect.mjs";
import { applyPatternQualityExecutionCap } from "../../../shared/pattern-quality-execution-cap.mjs";
import { buildWeeklyUniverseForMode, parseScanArgs, resolveScanMode, runLightweightFullUniverseDiscovery, scanRunMetadata } from "../../../shared/scan-orchestration.mjs";
import { isoTimestamp } from "./dashboard-state.mjs";
import { nyseCalendarSummary } from "./us-market-calendar.mjs";
import { enrichmentStatuses, universeReferenceRow } from "./us-universe-reference.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const trackingConfig = JSON.parse(await readFile(resolve(root, "config/tracking_basket.json"), "utf8"));
const gicsConfig = JSON.parse(await readFile(resolve(root, "config/gics_sector_proxy_map.json"), "utf8"));
const cacheRoot = resolve(root, "cache/us/ohlcv");
const archive = resolve(root, "cache/us/d_us_txt.zip");
const output = resolve(root, "data/us-dashboard-state.json");
const weeklyContractOutput = resolve(root, "data/us-weekly-contract.json");
const universeReferenceOutput = resolve(root, "cache/us/us-universe-reference.json");
const cliOptions = parseScanArgs(process.argv.slice(2));
const scanMode = resolveScanMode({ mode: cliOptions.mode });
const round = (x, n = 2) => Number.isFinite(x) ? Number(x.toFixed(n)) : null;
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const sma = (xs, n) => xs.length >= n ? mean(xs.slice(-n)) : null;
function ema(xs, n) {
  if (xs.length < n) return null;
  const k = 2 / (n + 1); let value = mean(xs.slice(0, n));
  for (const x of xs.slice(n)) value = x * k + value * (1 - k);
  return value;
}
const change = (xs, n) => xs.length > n && xs.at(-1 - n) ? (xs.at(-1) / xs.at(-1 - n) - 1) * 100 : null;
const max = (xs, n) => xs.length >= n ? Math.max(...xs.slice(-n)) : null;
const min = (xs, n) => xs.length >= n ? Math.min(...xs.slice(-n)) : null;
function atr(bars, n = 14) {
  if (bars.length <= n) return null;
  const tr = bars.slice(1).map((b, i) => Math.max(b.high - b.low, Math.abs(b.high - bars[i].close), Math.abs(b.low - bars[i].close)));
  return mean(tr.slice(-n));
}
function rmv(bars, n) {
  if (bars.length < n) return null;
  return (max(bars.map(x => x.high), n) - min(bars.map(x => x.low), n)) / mean(bars.slice(-n).map(x => x.close)) * 100;
}
function alignedRs(bars, benchmark) {
  const bm = new Map(benchmark.map(x => [x.date, x.close]));
  return bars.filter(x => bm.has(x.date)).map(x => ({ date: x.date, value: x.close / bm.get(x.date) }));
}
function rrg(rs) {
  if (rs.length < 252) return { ratio: null, momentum: null, quadrant: "RRG_MISSING_INPUT" };
  const values = rs.map(x => x.value);
  const ratio = values.at(-1) / values.at(-252) * 100;
  const prior = values.at(-127) / values.at(-252) * 100;
  const momentum = ratio / prior * 100;
  const quadrant = ratio >= 100 && momentum >= 100 ? "LEADING" : ratio >= 100 ? "WEAKENING" : momentum >= 100 ? "IMPROVING" : "LAGGING";
  return { ratio, momentum, quadrant };
}
function rmvLabel(x) { return x == null ? "RMV_UNKNOWN" : x <= 5 ? "RMV_ZERO" : x <= 10 ? "RMV_VERY_TIGHT" : x <= 15 ? "RMV_TIGHT" : x <= 25 ? "RMV_NORMAL" : "RMV_EXPANDING"; }
function riskBucket(x) { return x == null ? "RISK_UNKNOWN" : x < 2 ? "RISK_TIGHT" : x <= 4 ? "RISK_IDEAL" : x <= 7 ? "RISK_WIDE" : "RISK_TOO_WIDE"; }
function techLabel(x) { return x >= 70 ? "TECHNICALLY_ELITE" : x >= 55 ? "TECHNICALLY_STRONG" : x >= 40 ? "TECHNICALLY_ADEQUATE" : "TECHNICALLY_WEAK"; }
function marketPermissionFromDimmer(dimmer) {
  return dimmer >= 4 ? "TRADE_ALLOWED" : dimmer === 3 ? "SELECTIVE_ONLY" : dimmer === 2 ? "TRANSITION_MODE" : dimmer === 1 ? "WATCHLIST_ONLY" : "DEFENSE_MODE";
}
function marketCycleLabels(dimmer) {
  if (dimmer >= 5) return { oneil: "CONFIRMED_UPTREND", aurora: "MARKET_CYCLE_ON", dimmer_label: "DIMMER_5_FULL_AGGRESSION_LEADERS_CONFIRMING" };
  if (dimmer === 4) return { oneil: "UPTREND_RECONFIRMING", aurora: "MARKET_RECONFIRMATION", dimmer_label: "DIMMER_4_SELECTIVE_AGGRESSION" };
  if (dimmer === 3) return { oneil: "RALLY_ATTEMPT", aurora: "MARKET_TRANSITION", dimmer_label: "DIMMER_3_SELECTIVE_ONLY" };
  if (dimmer === 2) return { oneil: "UPTREND_UNDER_PRESSURE", aurora: "MARKET_UNDER_PRESSURE", dimmer_label: "DIMMER_2_WATCHLIST_ONLY" };
  return { oneil: "MARKET_IN_CORRECTION", aurora: "MARKET_CYCLE_OFF", dimmer_label: "DIMMER_0_1_DEFENSE_MODE" };
}
function axmLabel(axm) {
  if (axm == null) return "AXM_UNKNOWN";
  if (axm <= 1.5) return "AXM21_NORMAL";
  if (axm <= 2.5) return "AXM21_EXTENDED";
  if (axm <= 3.5) return "AXM21_NO_CHASE_CAUTION";
  return "AXM21_EXTREME_NO_CHASE";
}
function ve2Label({ rvol, dryup, compressed, dayPct, close, open }) {
  if (rvol >= 1.5 && dayPct >= 2) return "VE2_BREAKOUT_VOLUME_CONFIRMED";
  if (rvol >= 1.2 && close > open) return "VE2_EARLY_ENTRY_VOLUME_LIFT";
  if (dryup && compressed) return "VE2_VCP_FINAL_DRYUP";
  if (dryup) return "VE2_PULLBACK_VOLUME_CONTROLLED";
  if (rvol >= 0.8) return "VE2_BASE_VOLUME_CONSTRUCTIVE";
  return "VE2_VOLUME_NEUTRAL";
}
function pbxContext({ price, e21, s50, dryup, dayPct }) {
  const defended21 = price >= e21 && price <= e21 * 1.04;
  const defended50 = price >= s50 && price <= s50 * 1.05;
  const quality = defended21 && dryup ? "PBX_VALID" : defended50 && dryup ? "PBX_ACCEPTABLE" : defended21 ? "PBX_VOLUME_UNCONFIRMED" : "PBX_NOT_ACTIVE";
  const note = defended21 ? "PBX_21EMA_DEFENSE" : defended50 ? "PBX_50SMA_DEFENSE" : "PBX_NO_MA_DEFENSE";
  return { pbx_quality: quality, pbx_ma_defense: note, pbx_reversal: dayPct > 0 ? "PBX_REVERSAL_OK" : "PBX_REVERSAL_UNCONFIRMED" };
}
function patternContext({ r5, r15, r25, compressed, nearPivot, stage, bars }) {
  const closes = bars.map(x => x.close);
  const high63 = max(closes, 63);
  const high126 = max(closes, 126);
  const pullbackDepth = high63 ? (1 - closes.at(-1) / high63) * 100 : null;
  let pattern = "NO_CLEAR_BASE";
  if (stage === "STAGE_2" && compressed && r15 <= 15 && Math.abs(nearPivot) <= 7) pattern = "VCP_STYLE";
  else if (stage === "STAGE_2" && r15 <= 12 && Math.abs(nearPivot) <= 5) pattern = "FLAT_BASE_SHELF";
  else if (pullbackDepth != null && pullbackDepth >= 3 && pullbackDepth <= 15 && closes.at(-1) > sma(closes, 50)) pattern = "PULLBACK_BASE";
  else if (bars.length < 252) pattern = "IPO_BASE";
  else if (high126 && high63 && high63 > high126 * 0.95 && r25 <= 25) pattern = "BASE_ON_BASE_POSSIBLE";
  const baseStageCount = pattern === "NO_CLEAR_BASE" ? 0 : r25 <= 10 ? 1 : r25 <= 18 ? 2 : r25 <= 28 ? 3 : 4;
  const baseStageRisk = baseStageCount <= 1 ? "BASE_1_EARLY" : baseStageCount === 2 ? "BASE_2_VALID" : baseStageCount === 3 ? "BASE_3_CAUTION" : "BASE_4_LATE_STAGE_RISK";
  const note = pattern === "NO_CLEAR_BASE" ? "No clean shortlist base proxy from local bars." : `${pattern}; ${baseStageRisk}; shortlist-only proxy, not a hard gate.`;
  return { base_stage_count: baseStageCount, base_stage_risk: baseStageRisk, pattern_proxy: pattern, pattern_note: note };
}
function entryPermission(entryRiskPct, entryRiskAtr) {
  if (entryRiskPct == null || entryRiskAtr == null) return "WATCH_FOR_TIGHTER_SHELF";
  if (entryRiskPct <= 7) return "STANDARD_ENTRY";
  if (entryRiskPct <= 10 && entryRiskAtr <= 1.25) return "VOLATILITY_ADJUSTED_STARTER";
  return "WATCH_FOR_TIGHTER_SHELF";
}
async function loadClassificationCache() {
  try {
    const cache = JSON.parse(await readFile(resolve(root, "cache/us/fundamentals/sector-classification.json"), "utf8"));
    return cache.classifications || {};
  } catch {
    return {};
  }
}
async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}
function classificationFor(symbol, cache) {
  const row = cache[symbol];
  if (!row || row.classification_status === "UNKNOWN") {
    return {
      gics_sector: "GICS_UNKNOWN",
      main_industry: "INDUSTRY_UNKNOWN",
      sub_industry: "SUB_INDUSTRY_UNKNOWN",
      theme_primary: "GICS_UNKNOWN",
      classification_status: "UNKNOWN",
      sector_proxy: null
    };
  }
  const sector = gicsConfig.sector_aliases[row.gics_sector] || row.gics_sector || "GICS_UNKNOWN";
  return {
    gics_sector: sector,
    main_industry: row.main_industry || "INDUSTRY_UNKNOWN",
    sub_industry: row.sub_industry || "SUB_INDUSTRY_UNKNOWN",
    theme_primary: sector,
    classification_status: row.classification_status || "PARTIAL",
    sector_proxy: gicsConfig.sector_proxy_map[sector] || null
  };
}

const securityMaster = [];
try {
  const cachedMaster = JSON.parse(await readFile(resolve(root, "cache/us/security-master-stooq.json"), "utf8"));
  for (const row of cachedMaster.symbols || []) {
    if (row.symbol && row.exchange) securityMaster.push({ symbol: row.symbol, exchange: row.exchange });
  }
} catch {
  const listing = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  for (const path of listing.split(/\r?\n/)) {
    const match = path.match(/^data\/daily\/us\/(nasdaq|nyse|nysemkt) stocks\/(?:.+\/)?([^/]+)\.us\.txt$/i);
    if (match) securityMaster.push({ symbol: match[2].toUpperCase(), exchange: match[1].toUpperCase().replace("NYSEMKT", "NYSE AMERICAN") });
  }
  await mkdir(resolve(root, "cache/us"), { recursive: true });
  await writeFile(resolve(root, "cache/us/security-master-stooq.json"), JSON.stringify({ provider: "STOOQ", endpoint: "d_us_txt.zip/path-classification", generated_at: new Date().toISOString(), count: securityMaster.length, symbols: securityMaster }), "utf8");
}
if (!securityMaster.length) throw new Error("US security master is unavailable. Restore cache/us/security-master-stooq.json or cache/us/d_us_txt.zip.");

async function load(symbol) { return loadSymbol(cacheRoot, symbol); }
const benchmarkSymbols = ["SPY", "QQQ", "DIA", "IWM", "IWB", "MDY", "IJR", "IWV", "SMH", "ARKK", "IBIT", "XLK", "XLF", "XLI", "XLE", "XLY", "XLP", "XLV", "XLU", "XLC", "XLB", "XLRE"];
const benchmarkRecords = Object.fromEntries((await Promise.all(benchmarkSymbols.map(async s => [s, await load(s)]))).filter(([, x]) => x));
const spy = benchmarkRecords.SPY?.bars || [];
if (spy.length < 252) throw new Error("SPY benchmark cache is insufficient");
const asOf = spy.at(-1).date;
const completedSession = cliOptions.session || asOf;
const generatedAt = isoTimestamp();
const classificationCache = await loadClassificationCache();
const universeReference = securityMaster.map(row => universeReferenceRow(row, classificationCache[row.symbol]));
const referenceBySymbol = new Map(universeReference.map(row => [row.market_symbol, row]));
const technicalEligibleSymbols = new Set(universeReference.filter(row => row.eligible_technical).map(row => row.market_symbol));
const technicalSecurityMaster = securityMaster.filter(row => technicalEligibleSymbols.has(row.symbol));
const rawListedCount = securityMaster.length;
const technicalEligibleCount = technicalSecurityMaster.length;
const notApplicableInstrumentCount = rawListedCount - technicalEligibleCount;
const unknownReviewCount = universeReference.filter(row => row.instrument_type === "UNKNOWN_REVIEW").length;
const instrumentTypeCounts = {};
for (const row of universeReference) instrumentTypeCounts[row.instrument_type] = (instrumentTypeCounts[row.instrument_type] || 0) + 1;
await writeFile(universeReferenceOutput, JSON.stringify({
  schema_version: "1.0",
  generated_at: generatedAt,
  raw_listed_count: rawListedCount,
  technical_eligible_count: technicalEligibleCount,
  not_applicable_instrument_count: notApplicableInstrumentCount,
  unknown_review_count: unknownReviewCount,
  instrument_type_counts: instrumentTypeCounts,
  symbols: universeReference
}, null, 2), "utf8");

let loaded = 0, current = 0, valid = 0, ipoShortHistoryCount = 0;
const candidates = [];
const events = [];
for (let offset = 0; offset < technicalSecurityMaster.length; offset += 48) {
  const batch = technicalSecurityMaster.slice(offset, offset + 48);
  const records = await Promise.all(batch.map(x => load(x.symbol)));
  records.forEach((record, i) => {
    if (!record) return;
    loaded++;
    const meta = batch[i], bars = record.bars;
    if (record.data_as_of === asOf) current++;
    if (record.data_as_of === asOf && bars.length > 0 && bars.length < 252) ipoShortHistoryCount++;
    if (record.data_as_of === asOf && bars.length >= 20 && bars.length < 252) {
      const closes = bars.map(x => x.close), volumes = bars.map(x => x.volume), price = closes.at(-1);
      const rs = alignedRs(bars, spy), rsValues = rs.map(x => x.value), rs21 = ema(rsValues, 21), rsNow = rsValues.at(-1);
      const avgVol = mean(volumes.slice(-Math.min(20, volumes.length))), rvol = volumes.at(-1) / avgVol;
      const pivot = Math.max(...bars.slice(-Math.min(21, bars.length), -1).map(x => x.high));
      const trigger = pivot * 1.001, stop = Math.max(Math.min(...bars.slice(-Math.min(10, bars.length)).map(x => x.low)), (ema(closes, 21) || price) * .98);
      const riskPct = stop < trigger ? (trigger - stop) / trigger * 100 : null;
      const avwap = bars.reduce((sum, x) => sum + ((x.high + x.low + x.close) / 3) * x.volume, 0) / bars.reduce((sum, x) => sum + x.volume, 0);
      const nearPivot = (trigger - price) / trigger * 100;
      const rsConfirmed = rs21 && rsNow >= rs21 && change(rsValues, 5) > 0;
      const actionable = rsConfirmed && rvol >= .7 && nearPivot >= -1 && nearPivot <= 5 && riskPct <= 7;
      events.push({ ticker: meta.symbol, exchange: meta.exchange, event_type: "IPO_NEW_LISTING", lifecycle: bars.length <= 5 ? "NEW" : actionable ? "ACTIONABLE" : price > avwap * 1.15 ? "EXTENDED_NO_CHASE" : price < avwap * .85 ? "FAILED_REPAIR" : "DEVELOPING", event_source: "STOOQ_LISTING_HISTORY_OFFICIAL_VERIFICATION_REQUIRED", event_date: bars[0].date, days_since_event: bars.length - 1, price: round(price), listing_day_move_pct: round((bars[0].close / bars[0].open - 1) * 100), drift_pct: round((price / bars[0].close - 1) * 100), rs21: rsConfirmed ? "CONFIRMED" : "NOT_CONFIRMED", rs_high_proximity: round(rsNow / Math.max(...rsValues) * 100, 1), rmv5: round(rmv(bars, 5)), rmv15: round(rmv(bars, 15)), ve2: rvol >= 1.5 ? "EXPANSION" : rvol <= .75 ? "DRY_UP" : "NEUTRAL", avwap: round(avwap), hvc: "NOT_CALCULATED", basepivot: round(pivot), rmvp: actionable ? "VALID_PROXY" : "DEVELOPING", next_entry: round(trigger), official_trigger: round(trigger), invalidation: round(stop), stop: round(stop), risk_pct: round(riskPct), extension_pct: round((price / avwap - 1) * 100), level_2r: round(trigger + 2 * (trigger - stop)), level_3r: round(trigger + 3 * (trigger - stop)), provider: record.provider, data_as_of: record.data_as_of });
    }
    if (bars.length < 252 || record.data_as_of !== asOf) return;
    valid++;
    const closes = bars.map(x => x.close), volumes = bars.map(x => x.volume), price = closes.at(-1);
    const e10 = ema(closes, 10), e21 = ema(closes, 21), s50 = sma(closes, 50), s200 = sma(closes, 200);
    const s50Prev = mean(closes.slice(-55, -5)), s200Prev = mean(closes.slice(-205, -5));
    const stage = price > s50 && s50 > s200 && s50 > s50Prev && s200 >= s200Prev ? "STAGE_2" : price < s50 && s50 < s200 ? "STAGE_4" : price > s200 ? "TRANSITION" : "STAGE_1";
    const rs = alignedRs(bars, spy), rsValues = rs.map(x => x.value), rs21 = ema(rsValues, 21), rsSlope5 = change(rsValues, 5);
    const rs63 = max(rsValues, 63), rs252 = max(rsValues, 252), rsNow = rsValues.at(-1);
    const rsEma = rsNow >= rs21 ? "ABOVE" : "BELOW";
    const rsNh = rsNow >= rs63 * .995;
    const mansfield = (rsNow / sma(rsValues, 252) - 1) * 100;
    const trifecta = rsEma === "ABOVE" && rsSlope5 > 0 && mansfield > 0 ? "PASS" : [rsEma === "ABOVE", rsSlope5 > 0, mansfield > 0].filter(Boolean).length >= 2 ? "PARTIAL" : "FAIL";
    const rrgState = rrg(rs);
    const a14 = atr(bars), axm = a14 ? (price - e21) / a14 : null;
    const avgVol20 = mean(volumes.slice(-20)), rvol = volumes.at(-1) / avgVol20, addv = mean(bars.slice(-20).map(x => x.close * x.volume));
    const r5 = rmv(bars, 5), r15 = rmv(bars, 15), r25 = rmv(bars, 25), r50 = rmv(bars, 50);
    const priorPivot = Math.max(...bars.slice(-21, -1).map(x => x.high));
    const trigger = priorPivot * 1.001;
    const extensionPct = (price / e21 - 1) * 100;
    const nearPivot = (trigger - price) / trigger * 100;
    const dryup = mean(volumes.slice(-5)) < avgVol20 * .75;
    const compressed = r5 < r15 && r15 < r25;
    const recent10Low = Math.min(...bars.slice(-10).map(x => x.low));
    const recent50Low = Math.min(...bars.slice(-50).map(x => x.low));
    const triggerOwnedSetup = nearPivot >= -1 && nearPivot <= 5;
    const entryReference = triggerOwnedSetup ? trigger : price;
    const tacticalAnchor = Math.min(...bars.slice(-3).map(x => x.low));
    const buffer = Math.max(0.01, entryReference * 0.005);
    const anchorStop = tacticalAnchor - buffer;
    const noiseFloorStop = a14 ? entryReference - 0.5 * a14 : null;
    const entryStop = noiseFloorStop ? Math.min(anchorStop, noiseFloorStop) : anchorStop;
    const entryRiskPct = entryStop < entryReference ? (entryReference - entryStop) / entryReference * 100 : null;
    const entryRiskAtr = a14 && entryStop < entryReference ? (entryReference - entryStop) / a14 : null;
    const thesisStopRaw = Math.min(recent50Low, recent10Low, e21 * .985);
    const thesisStop = Math.min(thesisStopRaw, entryStop - buffer);
    const thesisRiskPct = thesisStop < entryReference ? (entryReference - thesisStop) / entryReference * 100 : null;
    const permissionTier = entryPermission(entryRiskPct, entryRiskAtr);
    const dayPct = change(closes, 1);
    const pbx = pbxContext({ price, e21, s50, dryup, dayPct });
    const ve2 = ve2Label({ rvol, dryup, compressed, dayPct, close: bars.at(-1).close, open: bars.at(-1).open });
    const pattern = patternContext({ r5, r15, r25, compressed, nearPivot, stage, bars });
    const classification = classificationFor(meta.symbol, classificationCache);
    const universeMeta = referenceBySymbol.get(meta.symbol) || universeReferenceRow(meta, classificationCache[meta.symbol]);
    let bucket = "REPAIR_WATCH";
    if (stage === "STAGE_4" || addv < 1_000_000) bucket = "AVOID_FRESH_LONG";
    else if (axm > 3 || price > trigger * 1.05) bucket = "NO_CHASE";
    else if (trifecta === "PASS" && nearPivot >= -1 && nearPivot <= 1 && entryRiskPct <= 7) bucket = "TRIGGER_READY";
    else if (trifecta === "PASS" && nearPivot > 1 && nearPivot <= 5 && r15 <= 15) bucket = "EARLY_ENTRY_WATCH";
    else if (price >= e21 && price <= e21 * 1.04 && dryup) bucket = "PULLBACK_WATCH";
    else if (rsNh && price < max(closes, 252) * .98) bucket = "RSNH_WATCH_ONLY";
    const marketScore = 0;
    const rsScore = Math.min(12, (trifecta === "PASS" ? 8 : trifecta === "PARTIAL" ? 5 : 2) + (rsNh ? 2 : 0) + (mansfield > 0 ? 2 : 0));
    const rrgScore = ({ LEADING: 10, IMPROVING: 8, WEAKENING: 5, LAGGING: 2 }[rrgState.quadrant] ?? 0);
    const patternScore = Math.min(13, (stage === "STAGE_2" ? 4 : 1) + (r15 <= 10 ? 4 : r15 <= 15 ? 3 : r15 <= 25 ? 1 : 0) + (compressed ? 3 : 0) + (Math.abs(nearPivot) <= 5 ? 2 : 0));
    const entryScore = Math.min(10, (Math.abs(nearPivot) <= 3 ? 4 : Math.abs(nearPivot) <= 7 ? 2 : 0) + (price >= e21 ? 2 : 0) + (rsSlope5 > 0 ? 2 : 0) + (rvol >= 1.2 ? 2 : 0));
    const volumeScore = Math.min(10, (rvol >= 1.5 ? 4 : rvol >= 1.1 ? 2 : 0) + (change(closes, 1) > 0 ? 2 : 0) + (dryup ? 2 : 0) + (volumes.at(-1) > mean(volumes.slice(-50)) ? 2 : 0));
    const pullbackScore = Math.min(8, (Math.abs(extensionPct) <= 4 ? 3 : 0) + (dryup ? 3 : 0) + (price >= s50 ? 2 : 0));
    const riskScore = entryRiskPct <= 4 ? 10 : entryRiskPct <= 7 ? 8 : entryRiskPct <= 10 ? 5 : 0;
    const extensionScore = Math.abs(axm) <= 2 ? 5 : Math.abs(axm) <= 3 ? 3 : 0;
    const technical = marketScore + rsScore + rrgScore + patternScore + entryScore + volumeScore + pullbackScore + riskScore;
    candidates.push({ ticker: meta.symbol, exchange: meta.exchange, sector: classification.gics_sector, gics_sector: classification.gics_sector, main_industry: classification.main_industry, sub_industry: classification.sub_industry, classification_status: classification.classification_status, sector_proxy: classification.sector_proxy, price: round(price), day_pct: round(dayPct), rs_trifecta: trifecta, rs_ema21: rsEma, rs_slope5: round(rsSlope5), rs63_prox: round(rsNow / rs63 * 100, 1), rs52_prox: round(rsNow / rs252 * 100, 1), mansfield: round(mansfield), rmv5: round(r5), rmv15: round(r15), rmv25: round(r25), rmv50: round(r50), stage, bucket, pivot: round(priorPivot), trigger: round(trigger), active_trigger_state: triggerOwnedSetup ? "PENDING_CERTIFIED_TRIGGER_PROXY" : "NO_ACTIVE_TRIGGER_PROXY", entry_reference: round(entryReference), stop: round(entryStop), risk_pct: round(entryRiskPct), entry_stop: round(entryStop), entry_risk_pct: round(entryRiskPct), entry_risk_atr: round(entryRiskAtr), thesis_stop: round(thesisStop), thesis_risk_pct: round(thesisRiskPct), entry_permission: permissionTier, level_2r: round(entryReference + 2 * (entryReference - entryStop)), level_3r: round(entryReference + 3 * (entryReference - entryStop)), axm_atr: round(axm), axm_label: axmLabel(axm), rvol: round(rvol), avg_dollar_volume_20_usd_equiv: round(addv, 0), liquidity_label: addv >= 100_000_000 ? "LIQUIDITY_HIGH" : addv >= 20_000_000 ? "LIQUIDITY_PASS" : "LIQUIDITY_THIN", rmv_tight_label: rmvLabel(r15), risk_bucket: riskBucket(entryRiskPct), rmv_pivot_quality: Math.abs(nearPivot) <= 3 && compressed ? "RMV_PIVOT_QUALITY_A" : Math.abs(nearPivot) <= 7 ? "RMV_PIVOT_QUALITY_B" : "RMV_PIVOT_QUALITY_NONE", final_bucket: bucket, setup: bucket === "TRIGGER_READY" ? "TRIGGER_READY" : bucket === "EARLY_ENTRY_WATCH" ? "EARLY_ENTRY" : bucket === "PULLBACK_WATCH" ? "PULLBACK" : bucket === "RSNH_WATCH_ONLY" ? "RSNH_WATCH" : bucket === "NO_CHASE" ? "NO_CHASE_RISK" : "REPAIR", rs_score_pct: round(rsScore / 12 * 100), rmv_tightness_score_pct: round(Math.max(0, 100 - r15 * 4)), compression_score_pct: compressed ? 85 : 35, theme_score_pct: classification.gics_sector === "GICS_UNKNOWN" ? 45 : 55, theme_primary: classification.theme_primary, theme_tracker_label: classification.gics_sector === "GICS_UNKNOWN" ? "THEME_UNKNOWN" : "THEME_NEUTRAL", show_of_power_label: rvol >= 2 && dayPct >= 3 ? "SHOW_OF_POWER_VALID" : "NO_SHOW_OF_POWER", market_dimmer: 0, market_permission: "WATCHLIST_ONLY", technical_strength_score: round(technical), technical_strength_label: techLabel(technical), score_components: { market: marketScore, rs: rsScore, rrg: rrgScore, pattern: patternScore, entry: entryScore, volume: volumeScore, fundamental: 5, pullback: pullbackScore, risk: riskScore, extension: extensionScore }, aurora_sig_score: round(technical + 5 + extensionScore), rrg_quadrant: rrgState.quadrant, rrg_ratio: round(rrgState.ratio), rrg_momentum: round(rrgState.momentum), rrg_direction: rrgState.quadrant === "LEADING" && rrgState.momentum >= 102 ? "NORTHEAST" : rrgState.quadrant === "IMPROVING" ? "NORTH" : rrgState.quadrant === "WEAKENING" ? "EAST" : "SOUTHWEST", pbx_quality: pbx.pbx_quality, pbx_ma_defense: pbx.pbx_ma_defense, pbx_reversal: pbx.pbx_reversal, ve2_label: ve2, ve2_grade: ve2.includes("CONFIRMED") || ve2.includes("FINAL_DRYUP") ? "A" : ve2.includes("CONSTRUCTIVE") || ve2.includes("CONTROLLED") || ve2.includes("LIFT") ? "B" : "C", basepivot_quality: Math.abs(nearPivot) <= 3 && compressed ? "BASEPIVOT_QUALITY_A" : Math.abs(nearPivot) <= 7 ? "BASEPIVOT_QUALITY_B" : "BASEPIVOT_QUALITY_C", basepivot_state: price >= priorPivot ? "BASEPIVOT_ACTIVE_AFTER_WEAK_BREAKOUT" : "BASEPIVOT_ACTIVE_BELOW_TRIGGER", rmvp: round(priorPivot * (compressed ? 0.999 : 1.002)), rmvp_quality: compressed && Math.abs(nearPivot) <= 5 ? "RMVP_QUALITY_A" : Math.abs(nearPivot) <= 7 ? "RMVP_QUALITY_B" : "RMVP_QUALITY_NONE", above_ema21: price > e21, above_ema50: price > s50, dryup, compressed, ...pattern, data_state: "CALCULATED_TECHNICAL_FUNDAMENTAL_NEUTRAL", provider: record.provider, data_as_of: record.data_as_of });
    Object.assign(candidates.at(-1), {
      instrument_type: universeMeta.instrument_type,
      eligible_technical: universeMeta.eligible_technical,
      technical_exclusion_reason: universeMeta.technical_exclusion_reason,
      provider_symbols: universeMeta.provider_symbols,
      mapping_confidence: universeMeta.mapping_confidence,
      listing_exchange: universeMeta.listing_exchange,
      cik: universeMeta.cik,
      sector_source: universeMeta.sector_source,
      sector_status: universeMeta.sector_status
    });
    const candidate = candidates.at(-1);
    const ranges = bars.map(x => x.high - x.low);
    const price52Prox = price / max(closes, 252) * 100;
    const nr4 = ranges.at(-1) <= Math.min(...ranges.slice(-4));
    const nr7 = ranges.at(-1) <= Math.min(...ranges.slice(-7));
    const insideBar = bars.at(-1).high <= bars.at(-2).high && bars.at(-1).low >= bars.at(-2).low;
    const pocketPivotProxy = bars.at(-1).close > bars.at(-1).open && volumes.at(-1) > Math.max(...volumes.slice(-11, -1)) && price > e10;
    candidate.price52_prox = round(price52Prox, 1);
    candidate.distance_to_trigger_pct = round(nearPivot);
    candidate.extension_ema21_pct = round(extensionPct);
    candidate.scan_memberships = [];
    if (price52Prox >= 99.5) candidate.scan_memberships.push("S01_52W_HIGH");
    if (nr7) candidate.scan_memberships.push("S06_NR7");
    else if (nr4) candidate.scan_memberships.push("S06_NR4");
    if (price >= priorPivot * .995) candidate.scan_memberships.push("S08_DONCHIAN_20D");
    if (compressed) candidate.scan_memberships.push("S09_ATR_RMV_CONTRACTION_PROXY");
    if (compressed && dryup) candidate.scan_memberships.push("S10_VCP_HV_PROXY");
    if (pocketPivotProxy) candidate.scan_memberships.push("S11_POCKET_PIVOT_PROXY");
    if (Math.abs(nearPivot) <= 3) candidate.scan_memberships.push("S17_NEAR_BREAKOUT");
    if (insideBar) candidate.scan_memberships.push("S21_INSIDE_BAR");
    if (rsNh) candidate.scan_memberships.push("S22_RS_LINE_NEW_HIGH");
    if (stage === "STAGE_2") candidate.scan_memberships.push("WEINSTEIN_STAGE_2");
    if (r15 <= 15) candidate.scan_memberships.push("R01_RMV_COIL", "R02_RMV_PIVOT_CANDIDATE");
    if (Math.abs(extensionPct) <= 4 && price >= e21) candidate.scan_memberships.push("R03_RMV_RETEST_CANDIDATE");
    if (["TRIGGER_READY", "EARLY_ENTRY_WATCH", "PULLBACK_WATCH"].includes(bucket)) candidate.scan_memberships.push("R05_EXECUTION_FUNNEL");
  });
}

const spyCloses = spy.map(x => x.close), spyE21 = ema(spyCloses, 21), spyS50 = sma(spyCloses, 50), spyS200 = sma(spyCloses, 200);
const breadthPct = round(candidates.filter(x => x.stage === "STAGE_2").length / valid * 100);
const riskConfirm = ["QQQ", "IWM", "SMH"].filter(s => benchmarkRecords[s]?.bars.at(-1).close > ema(benchmarkRecords[s].bars.map(x => x.close), 21)).length;
const dimmer = marketDimmer({ index_above_21: spyCloses.at(-1) > spyE21, ema21_rising: spyE21 > ema(spyCloses.slice(0, -5), 21), index_above_50: spyCloses.at(-1) > spyS50, sma50_rising: spyS50 > sma(spyCloses.slice(0, -5), 50), index_above_10: spyCloses.at(-1) > ema(spyCloses, 10), ema10_rising: ema(spyCloses, 10) > ema(spyCloses.slice(0, -5), 10), leadership_breadth_state: breadthPct >= 40 ? "LEADERSHIP_BREADTH_CONFIRMING" : breadthPct >= 25 ? "LEADERSHIP_EMERGING" : "LEADERSHIP_ISOLATED", trade_feedback_state: "TRADE_FEEDBACK_MIXED", risk_on_proxy_state: riskConfirm >= 2 ? "RISK_ON_CONFIRMING" : "RISK_ON_MIXED", reference_basket_state: "REFERENCE_BASKET_MIXED", failed_breakout_count_10d: 0, distribution_churn_count_10d: 0, market_cycle_age_days: 0 });
const marketPermission = marketPermissionFromDimmer(dimmer);
for (const c of candidates) {
  c.market_dimmer = dimmer;
  c.market_permission = marketPermission;
  c.score_components.market = round(dimmer / 5 * 12);
  c.technical_strength_score = round(c.technical_strength_score + c.score_components.market);
  c.technical_strength_label = techLabel(c.technical_strength_score);
  c.aurora_sig_score = round(c.technical_strength_score + c.score_components.fundamental + c.score_components.extension);
  c.weekly_watchlist_score = weeklyWatchlistScore(c);
  c.wwl_tier = c.weekly_watchlist_score >= 85 ? "WWL_A_PLUS" : c.weekly_watchlist_score >= 75 ? "WWL_A" : c.weekly_watchlist_score >= 65 ? "WWL_B" : c.weekly_watchlist_score >= 55 ? "WWL_C" : "WWL_REJECT";
  applyPatternQualityExecutionCap(c, { market: "US" });
  c.weekly_focus_state = !c.pattern_quality_execution_cap && c.weekly_watchlist_score >= 70 && ["TRIGGER_READY", "EARLY_ENTRY_WATCH", "PULLBACK_WATCH"].includes(c.bucket) && c.entry_risk_pct <= 10 && !["WATCHLIST_ONLY", "DEFENSE_MODE"].includes(c.market_permission) ? "WEEKLY_FOCUS" : "WEEKLY_CONTEXT";
  const noteParts = [];
  if (c.rs_score_pct >= 80) noteParts.push("strong RS leadership");
  if (c.rs_ema21 === "ABOVE") noteParts.push("RS above EMA21");
  if (c.compressed) noteParts.push("RMV compression visible");
  if (c.ve2_grade === "A") noteParts.push(`${c.ve2_label} volume`);
  if (c.pattern_proxy !== "NO_CLEAR_BASE") noteParts.push(c.pattern_note);
  if (c.entry_risk_pct != null) noteParts.push(`tactical risk ${c.entry_risk_pct}%`);
  if (c.thesis_risk_pct > 20) noteParts.push(`wide thesis risk ${c.thesis_risk_pct}% is context only`);
  c.user_note = `${noteParts.join("; ") || "calculated technical context only"}. Next: ${c.bucket === "TRIGGER_READY" ? "needs next-session trigger acceptance with VE2 confirmation" : "needs price/volume confirmation and market permission"}.`;
}
const ranked = candidates.filter(x => x.avg_dollar_volume_20_usd_equiv >= 20_000_000 && x.stage !== "STAGE_4" && x.bucket !== "AVOID_FRESH_LONG").sort((a, b) => b.weekly_watchlist_score - a.weekly_watchlist_score || b.technical_strength_score - a.technical_strength_score);
const discovery = runLightweightFullUniverseDiscovery({ market: "us", session: completedSession, cache: { featureMatrix: candidates } });
const previousWeeklyContract = await readJson(weeklyContractOutput, null);
const weeklyPlan = buildWeeklyUniverseForMode({
  mode: scanMode.run_mode,
  previousContract: previousWeeklyContract,
  rankedCandidates: ranked,
  featureMatrix: candidates,
  session: completedSession,
  generatedAt,
  targetMax: trackingConfig.weekly_max,
  market: "US"
});
const weekly = weeklyPlan.weeklyUniverse;
const weeklyFocus = weekly.filter(x => x.weekly_focus_state === "WEEKLY_FOCUS");
const daily = weeklyFocus.filter(x => !x.pattern_quality_execution_cap && ["TRIGGER_READY", "EARLY_ENTRY_WATCH", "PULLBACK_WATCH"].includes(x.bucket) && x.entry_risk_pct <= 7 && !["WATCHLIST_ONLY", "DEFENSE_MODE"].includes(x.market_permission)).slice(0, 4);
const weeklySymbols = new Set(weekly.map(x => x.ticker));
for (const candidate of candidates) {
  const failed = [];
  if (candidate.rs_trifecta !== "PASS") failed.push("RS_TRIFECTA_NOT_PASS");
  if (candidate.stage !== "STAGE_2") failed.push("STAGE_2_NOT_CONFIRMED");
  if (candidate.avg_dollar_volume_20_usd_equiv < 20_000_000) failed.push("LIQUIDITY_BELOW_WWL_GATE");
  if (!(candidate.entry_risk_pct <= 7)) failed.push("ENTRY_RISK_ABOVE_7PCT");
  if (candidate.thesis_risk_pct > 20) failed.push("WIDE_THESIS_RISK_CONTEXT");
  if (Math.abs(candidate.distance_to_trigger_pct) > 7) failed.push("TRIGGER_DISTANCE_ABOVE_7PCT");
  if (candidate.rmv15 > 25) failed.push("RMV15_NOT_CONSTRUCTIVE");
  if (candidate.axm_atr > 3) failed.push("AXM_EXTENSION_ABOVE_3ATR");
  if (!candidate.scan_memberships.length) failed.push("NO_ACTIVE_SCANNER_MATCH");
  candidate.failed_gates = failed;
  candidate.next_promotion_condition = failed[0] || "RANK_AND_ENRICHMENT_CONFIRMATION";
  if (weeklySymbols.has(candidate.ticker)) candidate.universe_route = "WEEKLY_UNIVERSE";
  else if (candidate.data_state.startsWith("PARTIAL") || candidate.data_state.startsWith("UNKNOWN")) candidate.universe_route = "DATA_REPAIR";
  else if (candidate.bucket === "AVOID_FRESH_LONG" || candidate.stage === "STAGE_4") candidate.universe_route = "REJECTED";
  else if ((candidate.scan_memberships || []).length && ((candidate.weekly_watchlist_score >= 60 && failed.length <= 3) || (failed.length <= 2 && (candidate.scan_memberships || []).includes("S01_52W_HIGH") && (candidate.scan_memberships || []).includes("S22_RS_LINE_NEW_HIGH")))) candidate.universe_route = "NEAR_WATCHLIST";
  else if (candidate.scan_memberships.length) candidate.universe_route = "SCANNER_CANDIDATE";
  else candidate.universe_route = "REJECTED";
}
const nearRanked = candidates.filter(x => x.universe_route === "NEAR_WATCHLIST").sort((a, b) => b.weekly_watchlist_score - a.weekly_watchlist_score);
const nearWatchlist = nearRanked.slice(0, trackingConfig.near_watchlist_max);
for (const candidate of nearRanked.slice(trackingConfig.near_watchlist_max)) {
  candidate.universe_route = "SCANNER_CANDIDATE";
  candidate.near_watchlist_overflow = true;
}
const trackingBasket = [...weekly, ...nearWatchlist];
if (trackingBasket.length > trackingConfig.max_total) throw new Error(`Tracking basket exceeds hard cap: ${trackingBasket.length}/${trackingConfig.max_total}`);
const benchmarks = ["SPY", "QQQ", "IWM", "DIA", "IWB", "MDY", "IJR", "IWV"].map(symbol => { const b = benchmarkRecords[symbol].bars, c = b.map(x => x.close); return { symbol, close: round(c.at(-1)), day: round(change(c, 1)), month: round(change(c, 21)), year: round(change(c, 252)), ma_stack: `${c.at(-1) > ema(c, 10) ? "P>10" : "P<10"} · ${c.at(-1) > ema(c, 21) ? "P>21" : "P<21"} · ${c.at(-1) > sma(c, 50) ? "P>50" : "P<50"} · ${c.at(-1) > sma(c, 200) ? "P>200" : "P<200"}` }; });
const sector_rrg = Object.entries(gicsConfig.sector_proxy_map).map(([sector, symbol]) => {
  const record = benchmarkRecords[symbol];
  if (!record) return { sector, symbol, ratio: null, momentum: null, quadrant: "RRG_MISSING_INPUT", stock_count: 0, leadership_count: 0, representatives: [] };
  const b = record.bars, state = rrg(alignedRs(b, spy)), c = b.map(x => x.close);
  const sectorStocks = candidates.filter(x => x.gics_sector === sector);
  const representatives = sectorStocks
    .filter(x => x.avg_dollar_volume_20_usd_equiv >= 20_000_000 && x.stage !== "STAGE_4")
    .sort((a, b) => b.weekly_watchlist_score - a.weekly_watchlist_score || b.rs_score_pct - a.rs_score_pct)
    .slice(0, 4)
    .map(x => x.ticker);
  return {
    sector,
    symbol,
    ratio: round(state.ratio),
    momentum: round(state.momentum),
    quadrant: state.quadrant,
    ret1m: round(change(c, 21) - change(spyCloses, 21)),
    ret3m: round(change(c, 63) - change(spyCloses, 63)),
    ret6m: round(change(c, 126) - change(spyCloses, 126)),
    ret12m: round(change(c, 252) - change(spyCloses, 252)),
    stock_count: sectorStocks.length,
    leadership_count: sectorStocks.filter(x => ["PASS", "PARTIAL"].includes(x.rs_trifecta) && x.rs_ema21 === "ABOVE").length,
    representatives
  };
}).sort((a, b) => (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity));
const scannerCounts = {};
for (const candidate of candidates) for (const scan of candidate.scan_memberships) scannerCounts[scan] = (scannerCounts[scan] || 0) + 1;
scannerCounts.R11_DAILY_TOP = daily.length;
scannerCounts.R15_WEEKLY_WATCHLIST = weekly.length;
const dataRepairCount = Math.max(0, technicalEligibleCount - valid - ipoShortHistoryCount);
const technicalCoveragePct = round(valid / technicalEligibleCount * 100);
events.sort((a, b) => ({ ACTIONABLE: 0, NEW: 1, DEVELOPING: 2, EXTENDED_NO_CHASE: 3, FAILED_REPAIR: 4 }[a.lifecycle] - { ACTIONABLE: 0, NEW: 1, DEVELOPING: 2, EXTENDED_NO_CHASE: 3, FAILED_REPAIR: 4 }[b.lifecycle]) || b.event_date.localeCompare(a.event_date));
const marketLabels = marketCycleLabels(dimmer);
const aboveEma21Count = candidates.filter(x => x.above_ema21).length;
const aboveEma50Count = candidates.filter(x => x.above_ema50).length;
const leadershipBreadthCount = candidates.filter(x => x.rs_score_pct >= 65 && x.rs_ema21 === "ABOVE" && ["PASS", "PARTIAL"].includes(x.rs_trifecta)).length;
const distributionChurn = spy.slice(-10).filter((bar, i, xs) => i > 0 && bar.close < xs[i - 1].close && bar.volume > xs[i - 1].volume).length;
const failedBreakouts = candidates.filter(x => x.price52_prox >= 98 && x.day_pct <= -2).length;
const sectorEvidence = sector_rrg.filter(x => ["LEADING", "IMPROVING"].includes(x.quadrant)).slice(0, 5).map(x => `${x.symbol}:${x.quadrant}`).join(", ");
const referenceBasket = ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AVGO", "TSLA", "JPM", "LLY"];
const referenceRows = referenceBasket.map(symbol => candidates.find(x => x.ticker === symbol)).filter(Boolean);
const referencePass = referenceRows.filter(x => ["PASS", "PARTIAL"].includes(x.rs_trifecta)).length;
const referenceBasketState = referenceRows.length && referencePass / referenceRows.length >= 0.6 ? "REFERENCE_BASKET_CONFIRMING" : referenceRows.length && referencePass / referenceRows.length >= 0.3 ? "REFERENCE_BASKET_MIXED" : "REFERENCE_BASKET_SQUATTING";
const sectionSort = xs => xs.sort((a, b) => b.weekly_watchlist_score - a.weekly_watchlist_score || b.technical_strength_score - a.technical_strength_score).slice(0, 50);
const marketConfirmation = buildMarketConfirmationStack({
  oneil_market_cycle: marketLabels.oneil,
  aurora_mc2_state: marketLabels.aurora,
  market_permission: marketPermission,
  market_dimmer: dimmer,
  dimmer_label: marketLabels.dimmer_label,
  benchmark_ma_stack: `SPY ${spyCloses.at(-1) > spyE21 ? "above" : "below"} EMA21`
}, {
  symbol: "SPY",
  benchmark_rs21_state: spyCloses.at(-1) > spyE21 ? "BENCHMARK_RS21_HOLDING" : "BENCHMARK_RS21_BELOW",
  bars: spy
});
enrichRadarVisibility(candidates, { market: "US" });
const maRespect = buildMaRespectWatchlists(candidates, { mutateRows: true });
const myhApproaching = buildMyhApproachingRows(candidates, { mutateRows: true });
const myhBreakoutRetests = buildMyhBreakoutRetestRows(candidates).slice(0, 25);
const rejectedSplit = splitRejectedForRadarVisibility({
  rows: candidates,
  rejected: candidates.filter(x => ["REJECTED", "DATA_REPAIR"].includes(x.universe_route)),
  market: "US",
  dataAsOf: asOf
});
const cleanedRejected = rejectedSplit.rejected;
const softRsRecoveredRows = rejectedSplit.softRsRecoveredRows;
const strongRsRetention = buildStrongRsRetention(candidates, {
  sourceLists: { weekly, weeklyFocus, daily, developingWatchlist: nearWatchlist, rs21Rsnh: candidates.filter(x => x.rs_ema21 === "ABOVE" || (x.scan_memberships || []).includes("S22_RS_LINE_NEW_HIGH")), myhApproaching: myhApproaching.myh_approaching_rows },
  retentionWindow: 20
});
const auroraRadarUniverse = buildAuroraRadarUniverse({
  market: "US",
  dataAsOf: asOf,
  lists: {
    WEEKLY_UNIVERSE: weekly,
    WEEKLY_FOCUS: weeklyFocus,
    DAILY_TOP_1_4: daily,
    DEVELOPING_WATCHLIST: nearWatchlist,
    RS21_RSNH: candidates.filter(x => x.rs_ema21 === "ABOVE" || (x.scan_memberships || []).includes("S22_RS_LINE_NEW_HIGH")),
    MYH_APPROACHING: myhApproaching.myh_approaching_rows,
    MYH_BREAKOUT_RETEST: myhBreakoutRetests,
    MA10_RESPECT: maRespect.ema10_respect_rows,
    MA21_RESPECT: maRespect.ema21_respect_rows,
    MA50_RESPECT: maRespect.sma50_respect_rows,
    STRONG_RS_RETENTION: strongRsRetention,
    SOFT_RS_REJECT_RECOVERED: softRsRecoveredRows
  },
  allCandidates: candidates
});
const rrgHierarchy = buildRrgHierarchy(candidates, { minDenominator: 3 });
const state = {
  generated_at: generatedAt,
  run: {
    run_type: scanMode.run_mode,
    status: "CALCULATED_WITH_DECLARED_GAPS",
    data_as_of: asOf,
    ...scanRunMetadata({
      mode: scanMode.run_mode,
      reason: scanMode.run_mode_reason,
      dataAsOf: asOf,
      completedSession,
      generatedAt,
      weeklyContract: weeklyPlan.weeklyContract,
      discovery,
      market: "US",
      expectedSymbols: technicalEligibleCount,
      loadedSymbols: loaded,
      validLatestSymbols: current,
      calculatedSymbols: valid,
      warnings: weeklyPlan.warnings
    }),
    provider: "STOOQ",
    fallback_label: "FREE_PRIMARY",
    universe_status: "STOOQ_STOCK_PATH_CLASSIFIED",
    expected_symbols: technicalEligibleCount,
    raw_listed_count: rawListedCount,
    technical_eligible_count: technicalEligibleCount,
    calculated_technical_count: valid,
    technical_coverage_pct: technicalCoveragePct,
    not_applicable_instrument_count: notApplicableInstrumentCount,
    ipo_short_history_count: ipoShortHistoryCount,
    data_repair_count: dataRepairCount,
    unknown_review_count: unknownReviewCount,
    instrument_type_counts: instrumentTypeCounts,
    loaded_symbols: loaded,
    valid_latest_symbols: current,
    calculated_symbols: valid,
    coverage_pct: technicalCoveragePct,
    market_permission: marketPermission,
    daily_top_status: daily.length ? `${daily.length}_QUALIFIED` : "NO_VALID_ENTRY",
    warning: "Full Stooq stock-path universe calculated. Official index memberships, sector mapping, fundamentals and official PEAD/EP/HVE catalysts remain enrichment-required; no provider was blended within a series."
  },
  market_calendar: nyseCalendarSummary(),
  market: {
    market_state: marketLabels.oneil,
    oneil_market_cycle: marketLabels.oneil,
    aurora_mc2_state: marketLabels.aurora,
    market_permission: marketPermission,
    market_dimmer: dimmer,
    dimmer_label: marketLabels.dimmer_label,
    benchmark_ma_stack: `SPY ${spyCloses.at(-1) > spyE21 ? "above" : "below"} EMA21 / ${spyCloses.at(-1) > spyS50 ? "above" : "below"} SMA50 / ${spyCloses.at(-1) > spyS200 ? "above" : "below"} SMA200`,
    breadth_ema21_count: aboveEma21Count,
    breadth_ema50_count: aboveEma50Count,
    breadth_denominator: valid,
    breadth_ema21_pct: round(aboveEma21Count / valid * 100),
    breadth_ema50_pct: round(aboveEma50Count / valid * 100),
    leadership_breadth_count: leadershipBreadthCount,
    leadership_breadth_denominator: valid,
    leadership_breadth_pct: round(leadershipBreadthCount / valid * 100),
    distribution_churn_count_10d: distributionChurn,
    failed_breakout_count_10d: failedBreakouts,
    risk_proxy_state: riskConfirm >= 2 ? "RISK_ON_CONFIRMING" : "RISK_ON_MIXED",
    reference_basket_state: referenceBasketState,
    reference_basket_detail: `${referencePass}/${referenceRows.length || referenceBasket.length} RS partial/pass`,
    sector_theme_evidence: sectorEvidence || "SECTOR_THEME_EVIDENCE_PARTIAL",
    cycle_age_sessions: 0,
    dimmer_components: `index ${spyCloses.at(-1) > spyE21 ? 1 : 0}/${spyCloses.at(-1) > spyS50 ? 1 : 0}; breadth ${aboveEma21Count}/${valid}; risk ${riskConfirm}/3`,
    reason: `${marketLabels.oneil}: ${aboveEma21Count}/${valid} above EMA21, ${leadershipBreadthCount}/${valid} RS leaders, ${riskConfirm}/3 risk proxies above EMA21.`,
    ...marketConfirmation
  },
  benchmarks,
  sector_rrg,
  core: weekly,
  weekly_focus: weeklyFocus,
  daily_top: daily,
  developing_watchlist_20: nearWatchlist,
  sections: {
    rs21_rsnh: sectionSort(candidates.filter(x => x.rs_ema21 === "ABOVE" || (x.scan_memberships || []).includes("S22_RS_LINE_NEW_HIGH"))),
    myh_approaching: sectionSort(myhApproaching.myh_approaching_rows),
    myh_breakout_retest: sectionSort(myhBreakoutRetests),
    ma10_respect: sectionSort(maRespect.ema10_respect_rows),
    ma21_respect: sectionSort(maRespect.ema21_respect_rows),
    ma50_respect: sectionSort(maRespect.sma50_respect_rows),
    industry_group_rrg: rrgHierarchy.industry_group,
    industry_rrg: rrgHierarchy.industry,
    sub_industry_rrg: rrgHierarchy.sub_industry,
    aurora_radar_universe: auroraRadarUniverse,
    strong_rs_retention: strongRsRetention,
    soft_rs_reject_recovered: softRsRecoveredRows,
    pbx_pullback: sectionSort(candidates.filter(x => x.bucket === "PULLBACK_WATCH" || x.pbx_quality.startsWith("PBX_VALID") || x.pbx_quality === "PBX_ACCEPTABLE")),
    compression_vcp: sectionSort(candidates.filter(x => x.compressed || (x.scan_memberships || []).includes("S10_VCP_HV_PROXY"))),
    basepivot_patterns: sectionSort(candidates.filter(x => Math.abs(x.distance_to_trigger_pct) <= 7 || x.pattern_proxy !== "NO_CLEAR_BASE")),
    rmvp_early_entry: sectionSort(candidates.filter(x => ["TRIGGER_READY", "EARLY_ENTRY_WATCH"].includes(x.bucket) || x.rmvp_quality !== "RMVP_QUALITY_NONE")),
    ve2_volume_signature: sectionSort(candidates.filter(x => x.ve2_grade !== "C")),
    no_chase_risk: sectionSort(candidates.filter(x => x.bucket === "NO_CHASE" || x.axm_atr > 3 || x.entry_risk_pct > 10)),
    rejected_data_repair: cleanedRejected.slice(0, 500)
  },
  all_candidates_count: candidates.length,
  soft_rs_recovered_count: rejectedSplit.soft_rs_recovered_count,
  scanner_counts: scannerCounts,
  events: events.slice(0, 100),
  event_registry_count: events.length,
  enrichment_status: enrichmentStatuses({
    hasEvents: events.length > 0,
    hasSectorCache: Object.keys(classificationCache).length > 0
  }),
  universe_reference: {
    path: "cache/us/us-universe-reference.json",
    raw_listed_count: rawListedCount,
    technical_eligible_count: technicalEligibleCount,
    not_applicable_instrument_count: notApplicableInstrumentCount,
    ipo_short_history_count: ipoShortHistoryCount,
    data_repair_count: dataRepairCount,
    unknown_review_count: unknownReviewCount,
    instrument_type_counts: instrumentTypeCounts
  },
  provenance: {
    provider_route: "OFFICIAL_US_DIRECTORIES_PENDING_PLUS_STOOQ_CACHE_FREE_PRIMARY_YAHOO_FALLBACK_EODHD_LAST_RESORT",
    classification_system: gicsConfig.classification_system,
    sector_proxy_map_source: "AURORA_MASTER_v2_18_2_US_PROFILE",
    archive_sha256: "d98527b3095e1f19afa823e06b0919325dda45663a83708a5c60ff83f0cf47f2",
    provider: "STOOQ",
    endpoint: "d_us_txt.zip/local-cache",
    data_date: asOf,
    adjustment_status: "STOOQ_ADJUSTED_OHLC",
    currency: "USD",
    fallback_label: "FREE_PRIMARY",
    cache_policy: "Historical OHLCV cache first; append latest completed daily bar on weekdays; never blend providers inside one indicator series.",
    scanner_external_status: "NOT_RUN_DATA_REQUIRED",
    missing: ["official index membership", "issuer/SEC event verification", "PEAD/EP/HVE catalyst registry", "full fundamental enrichment", "exact GICS sub-industry for uncached names"]
  }
};
state.run.status = "CALCULATED_WITH_DECLARED_GAPS";
state.run.enrichment_status = "LOCKED_ENRICHMENT_REQUIRED";
state.run.daily_top_status = daily.length ? "CONDITIONAL_NOT_PROMOTED" : "NO_VALID_ENTRY";
state.run.warning = "Universe-wide Stooq technical discovery completed. Weekly scores and Daily Top plans are provisional until official active-universe/membership, sector mapping, complete locked pattern certification, and event/fundamental enrichment finish.";
for (const candidate of state.core) candidate.technical_strength_label = "NOT_CERTIFIED_PARTIAL";
for (const candidate of state.daily_top) candidate.execution_tier = "CONDITIONAL_NOT_PROMOTED";
for (const event of state.events) {
  if (event.lifecycle === "ACTIONABLE") event.lifecycle = "DEVELOPING";
  event.promotion_state = "OFFICIAL_EVENT_VERIFICATION_REQUIRED";
}
state.routing_counts = Object.fromEntries(["WEEKLY_UNIVERSE", "NEAR_WATCHLIST", "SCANNER_CANDIDATE", "REJECTED", "DATA_REPAIR"].map(route => [route, candidates.filter(x => x.universe_route === route).length]));
state.near_watchlist = nearWatchlist;
state.weekly_contract = weeklyPlan.weeklyContract;
state.tracking_basket = {
  count: trackingBasket.length,
  max_total: trackingConfig.max_total,
  weekly_count: weekly.length,
  weekly_max: trackingConfig.weekly_max,
  near_watchlist_count: nearWatchlist.length,
  near_watchlist_max: trackingConfig.near_watchlist_max,
  symbols: trackingBasket.map(x => x.ticker)
};
state.all_candidates = candidates.map(candidate => ({
  ticker: candidate.ticker,
  exchange: candidate.exchange,
  instrument_type: candidate.instrument_type,
  eligible_technical: candidate.eligible_technical,
  technical_exclusion_reason: candidate.technical_exclusion_reason,
  provider_symbols: candidate.provider_symbols,
  mapping_confidence: candidate.mapping_confidence,
  listing_exchange: candidate.listing_exchange,
  cik: candidate.cik,
  gics_sector: candidate.gics_sector,
  sector_source: candidate.sector_source,
  sector_status: candidate.sector_status,
  main_industry: candidate.main_industry,
  sub_industry: candidate.sub_industry,
  theme_primary: candidate.theme_primary,
  classification_status: candidate.classification_status,
  route: candidate.universe_route,
  bucket: candidate.bucket,
  price: candidate.price,
  stage: candidate.stage,
  rs_trifecta: candidate.rs_trifecta,
  rs21: candidate.rs_ema21,
  rs52_prox: candidate.rs52_prox,
  price52_prox: candidate.price52_prox,
  rmv15: candidate.rmv15,
  trigger_distance_pct: candidate.distance_to_trigger_pct,
  risk_pct: candidate.risk_pct,
  entry_stop: candidate.entry_stop,
  entry_risk_pct: candidate.entry_risk_pct,
  thesis_stop: candidate.thesis_stop,
  thesis_risk_pct: candidate.thesis_risk_pct,
  entry_permission: candidate.entry_permission,
  axm_atr: candidate.axm_atr,
  axm_label: candidate.axm_label,
  pbx_quality: candidate.pbx_quality,
  ve2_label: candidate.ve2_label,
  basepivot_quality: candidate.basepivot_quality,
  rmvp_quality: candidate.rmvp_quality,
  pattern_quality_execution_cap: candidate.pattern_quality_execution_cap,
  pattern_quality_cap_reason: candidate.pattern_quality_cap_reason,
  pattern_quality_cap_level: candidate.pattern_quality_cap_level,
  promotion_block_reason: candidate.promotion_block_reason,
  quality_notes: candidate.quality_notes,
  pattern_proxy: candidate.pattern_proxy,
  pattern_note: candidate.pattern_note,
  user_note: candidate.user_note,
  wwl: candidate.weekly_watchlist_score,
  scans: candidate.scan_memberships,
  failed_gates: candidate.failed_gates,
  next_condition: candidate.next_promotion_condition,
  provider: candidate.provider,
  data_as_of: candidate.data_as_of
}));
const weeklyTemp = `${weeklyContractOutput}.tmp`; await writeFile(weeklyTemp, JSON.stringify(weeklyPlan.weeklyContract, null, 2), "utf8"); await rename(weeklyTemp, weeklyContractOutput);
const temp = `${output}.tmp`; await writeFile(temp, JSON.stringify(state), "utf8"); await rename(temp, output);
console.log(JSON.stringify({ security_master: securityMaster.length, loaded, current, calculated: valid, coverage_pct: state.run.coverage_pct, weekly: weekly.length, daily_top: daily.length, as_of: asOf }));
