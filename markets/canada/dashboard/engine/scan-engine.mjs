import { CANADA_PROFILE, FINAL_BUCKETS, REQUIRED_CANDIDATE_COLUMNS, liquidityLabel, mapCanadaTheme } from "./canada-adapter.mjs";
import { providerBlendStatus } from "./freshness-guard.mjs";
import { alignedSeries, assignPercentiles, atr, axmMatrix, clamp, emaSeries, escapeHtml, latest, mean, rmv, rmvLabel, round, rrgFromRsLine, rs21State, smaSeries, weightedRsRaw } from "./indicators.mjs";
import { loadSellExtensionWatchlistRows, renderSellExtensionWatchlistHtml } from "../../../../scripts/active-ledger/sell-extension-watchlist.mjs";
import { buildAuroraRadarUniverse, buildMyhBreakoutRetestRows, buildRrgHierarchy, buildStrongRsRetention, enrichRadarVisibility, splitRejectedForRadarVisibility } from "../../../shared/classification-radar.mjs";
import { buildMarketConfirmationStack, buildMaRespectWatchlists, buildMyhApproachingRows } from "../../../shared/market-confirmation-and-ma-respect.mjs";
import { applyPatternQualityExecutionCap } from "../../../shared/pattern-quality-execution-cap.mjs";
import { buildWeeklyUniverseForMode, runLightweightFullUniverseDiscovery } from "../../../shared/scan-orchestration.mjs";

const sellExtensionWatchlistRows = await loadSellExtensionWatchlistRows(new URL("../state/active-tracking-ledger.json", import.meta.url));

const money = value => Number.isFinite(value) ? `$${Number(value).toLocaleString("en-CA", { maximumFractionDigits: 2 })}` : "—";
const num = (value, digits = 2) => Number.isFinite(value) ? Number(value).toLocaleString("en-CA", { maximumFractionDigits: digits }) : "—";

function priceChangePct(bars, n) {
  if (bars.length <= n || bars.at(-n - 1).close <= 0) return null;
  return bars.at(-1).close / bars.at(-n - 1).close - 1;
}

function closePosition(bar) {
  const range = bar.high - bar.low;
  return range > 0 ? (bar.close - bar.low) / range : 0.5;
}

function volumeSignature(bars, price, trigger, compression, pullbackOk) {
  const volumes = bars.map(x => x.volume);
  const avg20 = mean(volumes.slice(-20));
  const avg50 = mean(volumes.slice(-50));
  const lastBar = latest(bars);
  const rvol20 = avg20 ? lastBar.volume / avg20 : null;
  const dry5 = avg20 ? mean(volumes.slice(-5)) / avg20 : null;
  const closePos = closePosition(lastBar);
  let upVol = 0, downVol = 0, distribution = 0;
  for (let i = Math.max(1, bars.length - 20); i < bars.length; i += 1) {
    if (bars[i].close > bars[i - 1].close) upVol += bars[i].volume;
    else if (bars[i].close < bars[i - 1].close) downVol += bars[i].volume;
  }
  for (let i = Math.max(20, bars.length - 30); i < bars.length; i += 1) {
    const windowAvg = mean(bars.slice(i - 20, i).map(x => x.volume));
    if (bars[i].close < bars[i - 1].close && windowAvg && bars[i].volume > windowAvg * 1.2 && closePosition(bars[i]) < 0.4) distribution += 1;
  }
  const udRatio = downVol > 0 ? upVol / downVol : upVol > 0 ? 9.99 : null;
  const dryupLabel = dry5 <= 0.5 ? "VOLUME_DRYUP_STRONG" : dry5 <= 0.7 ? "VOLUME_DRYUP_VALID" : dry5 <= 0.9 ? "VOLUME_DRYUP_WEAK" : "NO_VOLUME_DRYUP";
  const distributionLabel = distribution >= 5 ? "DISTRIBUTION_CLUSTER" : distribution >= 3 ? "DISTRIBUTION_PRESENT" : "DISTRIBUTION_CLEAR";
  let signature = "VE2_VOLUME_UNKNOWN";
  if (distributionLabel === "DISTRIBUTION_CLUSTER") signature = "VE2_DISTRIBUTION_CLUSTER_WARNING";
  else if (rvol20 >= 2 && closePos < 0.4) signature = "VE2_CLIMAX_VOLUME_WARNING";
  else if (price >= trigger && rvol20 >= 1.5 && closePos >= 0.6) signature = "VE2_BREAKOUT_VOLUME_CONFIRMED";
  else if (price >= trigger * 0.99 && rvol20 >= 1.1 && closePos >= 0.6) signature = "VE2_EARLY_ENTRY_VOLUME_LIFT";
  else if (pullbackOk && rvol20 <= 1.05 && closePos >= 0.5) signature = "VE2_PULLBACK_VOLUME_CONTROLLED";
  else if (compression && dry5 <= 0.6) signature = "VE2_VCP_FINAL_DRYUP";
  else if (udRatio >= 1.2) signature = "VE2_BASE_VOLUME_CONSTRUCTIVE";
  else if (dry5 <= 0.7) signature = "VE2_BASE_DRYUP_CONFIRMED";
  const grade = signature.includes("WARNING") || signature.includes("CLIMAX") ? "FAIL" : signature.includes("CONFIRMED") || dryupLabel === "VOLUME_DRYUP_STRONG" ? "A" : signature.includes("LIFT") || signature.includes("CONTROLLED") || signature.includes("CONSTRUCTIVE") ? "B" : "C";
  return { signature, grade, rvol20: round(rvol20), dryupLabel, distributionLabel, closePos: round(closePos), avgVol20: round(avg20, 0), avgVol50: round(avg50, 0), score: grade === "A" ? 90 : grade === "B" ? 72 : grade === "C" ? 50 : 10 };
}

function basePivotLayer(bars, ve2) {
  const baseWindowLen = Math.min(63, bars.length);
  const baseBars = bars.slice(-baseWindowLen);
  const baseHigh = Math.max(...baseBars.map(x => x.high));
  const baseLow = Math.min(...baseBars.map(x => x.low));
  const baseDepthPct = baseHigh ? (baseHigh - baseLow) / baseHigh * 100 : null;
  const right = baseBars.slice(-Math.min(Math.max(15, Math.floor(baseWindowLen * 0.45)), 35, baseWindowLen));
  const highs = right.map(x => x.high);
  const candidates = [];
  for (let i = 2; i < highs.length - 2; i += 1) {
    if (highs[i] >= Math.max(...highs.slice(i - 2, i)) && highs[i] >= Math.max(...highs.slice(i + 1, i + 3))) candidates.push(highs[i]);
  }
  const topHighs = (candidates.length >= 2 ? candidates : highs).sort((a, b) => b - a).slice(0, 5);
  const pivot = Math.max(...topHighs);
  const aligned = topHighs.filter(h => Math.abs(h - pivot) / pivot * 100 <= 2);
  const quality = aligned.length >= 3 && !ve2.signature.includes("DISTRIBUTION") ? "BASEPIVOT_QUALITY_A" : aligned.length >= 2 && !ve2.signature.includes("DISTRIBUTION") ? "BASEPIVOT_QUALITY_B" : "BASEPIVOT_QUALITY_C";
  const lastBar = latest(bars);
  const failedProbe = lastBar.high > pivot && lastBar.close < pivot && closePosition(lastBar) < 0.5;
  return {
    basepivot_price: round(pivot),
    basepivot_zone_low: round(aligned.length ? Math.min(...aligned) : pivot * 0.98),
    basepivot_zone_high: round(pivot),
    basepivot_duration_days: baseWindowLen,
    basepivot_depth_pct: round(baseDepthPct),
    basepivot_quality: quality,
    basepivot_status: lastBar.close > pivot ? "BASEPIVOT_ACTIVE_AFTER_WEAK_BREAKOUT" : "BASEPIVOT_ACTIVE_BELOW_TRIGGER",
    basepivot_false_breakout_status: failedProbe ? "BASEPIVOT_FALSE_BREAK_FILTERED" : "BASEPIVOT_OK"
  };
}

function classifyFinalBucket(row) {
  if (row.stage_label === "STAGE_4" || row.liquidity_label === "LIQUIDITY_THIN_CAUTION" && row.price < CANADA_PROFILE.liquidity_min_price) return "AVOID_FRESH_LONG";
  if (row.axm.axm_composite_label === "AXM_MULTI_ANCHOR_STRETCH" || row.ve2.signature.includes("CLIMAX")) return "NO_CHASE";
  if (row.entry_risk_pct <= 7 && row.trigger_gap_pct >= -0.5 && row.trigger_gap_pct <= 1.5 && row.rs_trifecta !== "FAIL") return "TRIGGER_READY";
  if (row.pbx_label?.startsWith("PBX_VALID") && row.entry_risk_pct <= 10) return "PULLBACK_WATCH";
  if (row.compression && row.trigger_gap_pct >= -1 && row.trigger_gap_pct <= 7) return "EARLY_ENTRY_WATCH";
  if (row.rsnh) return "RSNH_WATCH_ONLY";
  return "REPAIR_WATCH";
}

function stageLabel(bars) {
  const closes = bars.map(x => x.close);
  const sma150 = smaSeries(closes, 150);
  const lastClose = closes.at(-1);
  const ma = sma150.at(-1);
  const ma20Ago = sma150.at(-21);
  if (!Number.isFinite(ma) || !Number.isFinite(ma20Ago)) return "STAGE_UNKNOWN";
  const slope = (ma - ma20Ago) / ma20Ago;
  if (lastClose > ma && slope > 0.01) return "STAGE_2";
  if (lastClose < ma && slope < -0.01) return "STAGE_4";
  if (Math.abs(slope) <= 0.02) return lastClose >= ma ? "STAGE_1_TO_2" : "STAGE_1";
  return "TRANSITION";
}

export function buildCanadaFeatureMatrix({ universe, stockRecords, benchmarkRecord, expectedSession }) {
  const benchmark = benchmarkRecord.bars;
  const rows = [];
  const rejected = [];
  for (const item of universe) {
    const record = stockRecords.find(r => r.symbol === item.symbol);
    if (!record?.bars?.length) { rejected.push({ symbol: item.symbol, rejection_reason: "MISSING_CACHE" }); continue; }
    const blend = providerBlendStatus(record);
    if (!blend.ok) { rejected.push({ symbol: item.symbol, rejection_reason: "PROVIDER_BLEND_BLOCKED", providers: blend.providers }); continue; }
    const bars = record.bars.filter(b => b.date <= expectedSession);
    if (bars.length < 252) { rejected.push({ symbol: item.symbol, rejection_reason: "INSUFFICIENT_HISTORY" }); continue; }
    const aligned = alignedSeries(bars, benchmark);
    if (aligned.length < 252) { rejected.push({ symbol: item.symbol, rejection_reason: "RS_BENCHMARK_ALIGNMENT_FAIL" }); continue; }
    const closes = bars.map(x => x.close);
    const price = closes.at(-1);
    const ema10 = emaSeries(closes, 10).at(-1);
    const ema21 = emaSeries(closes, 21).at(-1);
    const sma50 = smaSeries(closes, 50).at(-1);
    const sma200 = smaSeries(closes, 200).at(-1);
    const atr14 = atr(bars, 14);
    const addv20 = mean(bars.slice(-20).map(x => x.close * x.volume));
    const avgVolume20 = mean(bars.slice(-20).map(x => x.volume));
    const rawRs = weightedRsRaw(closes);
    const rsValues = aligned.map(x => x.rs);
    const rsState = rs21State(rsValues);
    const rsSlope5 = rsValues.length > 5 ? (rsValues.at(-1) / rsValues.at(-6) - 1) * 100 : null;
    const rsnh63 = rsValues.length > 64 && rsValues.at(-1) >= Math.max(...rsValues.slice(-64, -1));
    const rsnh252 = rsValues.length > 253 && rsValues.at(-1) >= Math.max(...rsValues.slice(-253, -1));
    const rsTrifectaCount = [rsState.includes("RECLAIM") || rsState.includes("HOLD") || rsState.includes("ACCELERATING"), rsnh63, rsSlope5 > 0].filter(Boolean).length;
    const rs_trifecta = rsTrifectaCount === 3 ? "PASS" : rsTrifectaCount === 2 ? "PARTIAL" : "FAIL";
    const rrg = rrgFromRsLine(rsValues);
    const rmv5 = rmv(bars, 5), rmv15 = rmv(bars, 15), rmv25 = rmv(bars, 25);
    const compression = rmv5 <= 8 || rmv15 <= 15;
    const high252 = Math.max(...bars.slice(-252).map(x => x.high));
    const myhGapPct = high252 > 0 ? (high252 - price) / high252 * 100 : null;
    const pullbackDepth = priceChangePct(bars, 21) < 0 ? Math.abs(priceChangePct(bars, 21) * 100) : 0;
    const pbx_label = pullbackDepth >= 3 && price >= ema21 * 0.97 ? "PBX_VALID_PULLBACK" : "PBX_NO_PULLBACK";
    const trigger = Math.max(...bars.slice(-15, -1).map(x => x.high));
    const trigger_gap_pct = trigger > 0 ? (trigger - price) / trigger * 100 : null;
    const axm = axmMatrix(price, ema10, ema21, sma50, sma200, atr14);
    const ve2 = volumeSignature(bars, price, trigger, compression, pbx_label === "PBX_VALID_PULLBACK");
    const bpx = basePivotLayer(bars, ve2);
    const stopAnchor = Math.min(latest(bars).low, ema10 ?? price, ema21 ?? price);
    const entryRef = trigger_gap_pct <= 0 ? price : trigger;
    const atrStop = Number.isFinite(atr14) ? entryRef - 0.5 * atr14 : entryRef * 0.97;
    const entryStop = Math.min(stopAnchor * 0.995, atrStop);
    const thesisStop = Math.min(...bars.slice(-63).map(x => x.low));
    const entryRiskPct = entryRef > entryStop ? (entryRef - entryStop) / entryRef * 100 : null;
    const theme = mapCanadaTheme(item);
    const liquidity = liquidityLabel({ addv20, avgVolume20, price });
    const row = {
      symbol: item.symbol, name: item.name, exchange: item.exchange || "TSX", provider: record.provider, data_as_of: record.data_as_of, provider_route: record.provider_route || [record.provider], fallback_reason: record.fallback_reason,
      price: round(price), change_1d_pct: round(priceChangePct(bars, 1) * 100), raw_rs: rawRs, rs21_state: rsState, rs_slope_5d: round(rsSlope5), rsnh: rsnh63 || rsnh252, rsnh63, rsnh252, rs_trifecta, rrg,
      ema10: round(ema10), ema21: round(ema21), sma50: round(sma50), myh_label: "MYH_52W", myh_level: round(high252), myh_gap_pct: round(myhGapPct), myh_lookback_sessions: 252,
      rmv5: round(rmv5), rmv15: round(rmv15), rmv25: round(rmv25), rmv_label: rmvLabel(rmv15), compression, stage_label: stageLabel(bars), trigger_price: round(trigger), trigger_gap_pct: round(trigger_gap_pct),
      entry_reference: round(entryRef), entry_stop: round(entryStop), thesis_stop: round(thesisStop), entry_risk_pct: round(entryRiskPct), thesis_risk_pct: round((entryRef - thesisStop) / entryRef * 100), axm, ve2, ...bpx, pbx_label,
      theme: theme.theme, theme_confidence: theme.confidence, addv20: round(addv20, 0), avg_volume20: round(avgVolume20, 0), liquidity_label: liquidity, caution: "none from calculated technical fields", next_condition: "Needs next completed-session trigger acceptance with VE2 confirmation and valid market permission."
    };
    rows.push(row);
  }
  assignPercentiles(rows, "raw_rs", "rs_rating");
  for (const row of rows) {
    const rsScore = (row.rs_rating ?? 0) * 0.45 + (row.rs_trifecta === "PASS" ? 20 : row.rs_trifecta === "PARTIAL" ? 12 : 3) + (row.rs21_state.includes("ACCELERATING") ? 10 : row.rs21_state.includes("RECLAIM") ? 8 : row.rs21_state.includes("HOLD") ? 6 : 0);
    const setupScore = row.trigger_gap_pct <= 1.5 && row.trigger_gap_pct >= -0.5 ? 90 : row.compression ? 72 : row.pbx_label === "PBX_VALID_PULLBACK" ? 70 : 45;
    const riskScore = row.entry_risk_pct <= 7 ? 100 : row.entry_risk_pct <= 10 ? 75 : 25;
    const extScore = row.axm.axm_composite_label === "AXM_OK" ? 100 : row.axm.axm_composite_label === "AXM_SWING_CHASE_RISK" ? 40 : 20;
    row.leadership_score = round(clamp(rsScore));
    row.tactical_score = round(clamp(row.leadership_score * 0.45 + setupScore * 0.20 + riskScore * 0.15 + row.ve2.score * 0.10 + extScore * 0.10));
    row.aurora_sig_score = round(clamp((row.leadership_score * 0.50) + (row.tactical_score * 0.50)));
    row.technical_strength_score = round(clamp(row.aurora_sig_score * 0.85));
    row.final_bucket = classifyFinalBucket(row);
    if (!FINAL_BUCKETS.includes(row.final_bucket)) row.final_bucket = "REPAIR_WATCH";
    if (row.liquidity_label === "LIQUIDITY_THIN_CAUTION") row.caution = "liquidity below Canada execution floor; discovery retained but execution capped";
    if (row.basepivot_false_breakout_status !== "BASEPIVOT_OK") row.caution = row.basepivot_false_breakout_status;
    applyPatternQualityExecutionCap(row, { market: "CANADA" });
  }
  rows.sort((a, b) => b.aurora_sig_score - a.aurora_sig_score || a.symbol.localeCompare(b.symbol));
  return { rows, rejected };
}

const displayCandidateColumn = column => column === "Theme" ? "Sector / Theme" : column;
const sectorRrgState = row => String(row.sector_rrg_state || row.sector_rrg_quadrant || row.sector_rotation_state || row.rrg_sector_state || row.stock_rrg_state || row.rrg_state || "UNKNOWN / NOT_CALCULATED").toUpperCase().replace("NOT_AVAILABLE", "NOT_CALCULATED");
const sectorRrgRead = state => ({
  LEADING: "Sector tailwind supports the setup.",
  IMPROVING: "Early sector rotation; constructive, but confirm stock-level RS/setup.",
  WEAKENING: "Be selective; sector momentum is fading.",
  LAGGING: "Lower probability unless stock-level RS/setup is exceptional.",
  UNKNOWN: "Sector context unavailable; do not infer.",
  NOT_CALCULATED: "Sector context unavailable; do not infer.",
  "UNKNOWN / NOT_CALCULATED": "Sector context unavailable; do not infer."
})[state] || "Sector context unavailable; do not infer.";
const sectorContextCell = row => {
  const state = sectorRrgState(row);
  return `Theme: ${escapeHtml(row.theme || "UNKNOWN")}<small>Sector: ${escapeHtml(row.gics_sector || row.sector || row.theme || "UNKNOWN")}</small><small>Industry: ${escapeHtml(row.main_industry || row.sub_industry || row.industry || "UNKNOWN")}</small><small>Sector RRG: ${escapeHtml(state)}</small><small>Read: ${escapeHtml(sectorRrgRead(state))}</small><small>${escapeHtml(row.theme_confidence || "LOW")} confidence</small>`;
};

function rowToCells(row, rank) {
  const setup = row.final_bucket === "TRIGGER_READY" ? "TRIGGER_READY" : row.pbx_label === "PBX_VALID_PULLBACK" ? "PULLBACK" : row.compression ? "COMPRESSION" : "DEVELOPING";
  return `<tr><td>${rank}</td><td><strong>${escapeHtml(row.symbol)}</strong><small>${escapeHtml(row.exchange)} · ${escapeHtml(row.provider)}</small></td><td>${escapeHtml(row.user_note || `${row.theme}; RS ${row.rs_rating ?? "—"}; ${row.rs21_state}; ${row.ve2.signature}. Next: ${row.next_condition}`)}</td><td>${sectorContextCell(row)}</td><td><span class="status ${escapeHtml(row.final_bucket)}">${escapeHtml(row.final_bucket)}</span></td><td><span class="status ${escapeHtml(setup)}">${escapeHtml(setup)}</span></td><td>${money(row.price)}<small>${num(row.change_1d_pct)}%</small></td><td>${num(row.aurora_sig_score)}<small>L ${num(row.leadership_score)} · T ${num(row.tactical_score)}</small><small>TS ${num(row.technical_strength_score)}/85</small></td><td>${row.rs_rating ?? "—"}<small>${escapeHtml(row.rs21_state)} · ${escapeHtml(row.rs_trifecta)}</small><small>RSNH ${row.rsnh ? "yes" : "no"}</small></td><td>${escapeHtml(row.rrg.quadrant)}<small>Ratio ${num(row.rrg.ratio)} · Mom ${num(row.rrg.momentum)}</small></td><td>${num(row.rmv5)} / ${num(row.rmv15)} / ${num(row.rmv25)}<small>${escapeHtml(row.rmv_label)}</small></td><td>${money(row.basepivot_price)}<small>${escapeHtml(row.basepivot_quality)} · ${escapeHtml(row.basepivot_status)}</small><small>Depth ${num(row.basepivot_depth_pct)}%</small></td><td>${escapeHtml(row.pbx_label)}<small>Risk ${num(row.entry_risk_pct)}%</small></td><td>${escapeHtml(row.ve2.signature)}<small>Grade ${escapeHtml(row.ve2.grade)} · RVOL20 ${num(row.ve2.rvol20)}</small><small>${escapeHtml(row.ve2.dryupLabel)} · ${escapeHtml(row.ve2.distributionLabel)}</small></td><td>${escapeHtml(row.axm.axm21_label)}<small>AXM10 ${num(row.axm.axm10)} · AXM21 ${num(row.axm.axm21)}</small><small>${escapeHtml(row.axm.axm_composite_label)}</small></td><td>${money(row.entry_reference)}<small>Stop ${money(row.entry_stop)} · ${num(row.entry_risk_pct)}%</small><small>Thesis ${money(row.thesis_stop)} · ${num(row.thesis_risk_pct)}%</small></td><td>${money(row.addv20)}<small>${escapeHtml(row.liquidity_label)} · Vol20 ${num(row.avg_volume20, 0)}</small></td><td>${escapeHtml(row.caution)}<small>${escapeHtml(row.next_condition)}</small></td></tr>`;
}

function renderTable(title, id, rows, note = "") {
  const body = rows.map((row, idx) => rowToCells(row, idx + 1)).join("") || `<tr><td colspan="18">No valid rows for this section.</td></tr>`;
  return `<h2 id="${id}">${escapeHtml(title)}</h2>${note ? `<p class="notice">${escapeHtml(note)}</p>` : ""}<div class="table-wrap"><table><thead><tr>${REQUIRED_CANDIDATE_COLUMNS.map(c => `<th>${escapeHtml(displayCandidateColumn(c))}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function sellExtensionWatchlistHtml() {
  return renderSellExtensionWatchlistHtml(sellExtensionWatchlistRows, { escapeHtml, formatMoney: money });
}

const finalBucketCopy = "TRADE_READY, TRIGGER_READY, EARLY_ENTRY_WATCH, PULLBACK_WATCH, RSNH_WATCH_ONLY, NO_CHASE, PROTECT_PROFIT_REVIEW, REPAIR_WATCH, AVOID_FRESH_LONG";
const sectorRrgCopy = "Sector context is a probability/tailwind guide. Leading or improving sectors usually support better odds. Weakening or lagging sectors require stronger stock-level RS, setup quality, and risk control. Sector RRG does not create or block AURORA trade buckets. LEADING = sector tailwind supports the setup. IMPROVING = early rotation; constructive but confirm stock-level RS/setup. WEAKENING = be selective; sector momentum is fading. LAGGING = lower probability unless stock-level RS/setup is exceptional. UNKNOWN / NOT_CALCULATED = sector data unavailable; do not infer. A lagging sector lowers probability but does not automatically reject a stock.";
const stockThemeCopy = "This table shows where AURORA candidates are clustering. It is not a buy table and not a trade signal. Weighted Presence = Weekly*3 + DailyTop*4 + RSLE*2 + Developing*1. Weekly = count from WEEKLY_UNIVERSE. Daily Top = count from DAILY_TOP_1_4. RSLE = count from AURORA-RSLE Top 20. Developing = count from Developing Watchlist. Symbols = representative stocks from that theme.";
const tableScrollCopy = "Wide tables are scrollable left/right and top/bottom. Headers remain visible while scrolling.";
const columnGuideCopy = {
  "Rank": "Section rank only; it does not override bucket, setup, risk, or market permission.",
  "Symbol": "Ticker, exchange, and provider route.",
  "User Note": "Plain-English reason the stock is on the list.",
  "Theme": "Sector / Theme = row-level theme, sector, industry, and sector-RRG context. Sector context is probability/tailwind context only; it does not block, rank, or bucket candidates.",
  "AURORA Bucket": `AURORA Bucket = final trade-readiness status. Locked final buckets: ${finalBucketCopy}.`,
  "Setup": "Setup = diagnostic setup lane explaining why the stock is being watched.",
  "Price": "Latest EOD price and one-day change.",
  "Score": "Dashboard score context for ordering, not a standalone buy signal.",
  "RS": "RS means benchmark-relative strength, not RSI. RS21 = RS line versus its 21 EMA. RSNH = relative-strength line near or at new high. RS Trifecta = RS confirmation stack. Mansfield RS = longer-term trend-adjusted outperformance.",
  "RRG": "RRG shows sector rotation context.",
  "RMV": "RMV shows reduced-move volatility/tightness context.",
  "BasePivot / RMVP": "BPX/BasePivot/RMVP = structure, trigger zones, support/retest zones.",
  "PBX": "PBX = pullback quality.",
  "VE2 Volume": "VE2 = volume quality and demand/supply evidence. It is not a standalone buy signal.",
  "AXM": "AXM = ATR-based extension and no-chase risk.",
  "Entry / Stop": "Entry / Stop shows the reference trigger, stop, and risk that still need market permission and price/volume acceptance.",
  "Liquidity": "Liquidity checks whether participation is sufficient before a setup can be actionable.",
  "Caution / Next": "Caution / Next explains what must happen before promotion or execution. It may include volume confirmation, trigger acceptance, tighter shelf, pullback reset, data repair, or no-chase reset."
};
const howToReadHtml = `<h2 id="guide">How to read this dashboard</h2><div class="table-wrap"><table><thead><tr><th>Concept</th><th>Plain-English guide</th></tr></thead><tbody>
<tr><td>Market Summary</td><td>Market Summary = whether the market environment supports fresh long trades.</td></tr>
<tr><td>Daily Top</td><td>Daily Top = conditional execution candidates, maximum four, never forced.</td></tr>
<tr><td>Weekly Universe</td><td>Weekly Universe = broader AURORA watchlist selected from full-universe discovery.</td></tr>
<tr><td>RSLE</td><td>RSLE = strongest relative-strength leaders with tactical entries or developing entries.</td></tr>
<tr><td>Sector / Theme</td><td>Sector / Theme = row-level theme, sector, industry, and sector-RRG read. ${sectorRrgCopy}</td></tr>
<tr><td>Table scrolling</td><td>${tableScrollCopy}</td></tr>
<tr><td>Sector RRG</td><td>Sector RRG = sector rotation strength. ${sectorRrgCopy}</td></tr>
<tr><td>Stock Theme Leadership</td><td>Stock Theme Leadership = clustering of shortlisted stocks, not a buy signal. ${stockThemeCopy} Canada examples: Banks, Pipelines / Midstream, Oil & Gas, Uranium, Gold / Materials, Rails, Canadian Technology.</td></tr>
<tr><td>Stock row</td><td>Stock row = final decision comes from bucket + setup + RS + volume + risk + market permission.</td></tr>
<tr><td>AURORA Bucket / Setup</td><td>AURORA Bucket = final trade-readiness status. Setup = diagnostic setup lane explaining why the stock is being watched. Locked final buckets: ${finalBucketCopy}.</td></tr>
<tr><td>RS / RS21 / RSNH</td><td>RS means benchmark-relative strength, not RSI. RS21 = RS line versus its 21 EMA. RSNH = relative-strength line near or at new high. RS Trifecta = RS confirmation stack. Mansfield RS = longer-term trend-adjusted outperformance.</td></tr>
<tr><td>RRG / RMV</td><td>RRG shows rotation context. RMV shows reduced-move volatility/tightness context.</td></tr>
<tr><td>VE2 / PBX / BPX / BasePivot / RMVP / AXM</td><td>VE2 = volume quality and demand/supply evidence. PBX = pullback quality. BPX/BasePivot/RMVP = structure, trigger zones, support/retest zones. AXM = ATR-based extension and no-chase risk. None of these creates a standalone buy signal.</td></tr>
<tr><td>Entry / Stop</td><td>Entry / Stop shows the reference trigger, stop, and risk that still need market permission and price/volume acceptance.</td></tr>
<tr><td>Liquidity</td><td>Liquidity checks whether participation is sufficient before a setup can be actionable.</td></tr>
<tr><td>Caution / Next</td><td>Caution / Next explains what must happen before promotion or execution. It may include volume confirmation, trigger acceptance, tighter shelf, pullback reset, data repair, or no-chase reset.</td></tr>
</tbody></table></div>`;

function stockThemeLeadership(sections) {
  const counts = new Map();
  for (const [name, rows] of sections) {
    for (const row of rows) {
      const rec = counts.get(row.theme) || { weekly: 0, focus: 0, daily: 0, rsle: 0, developing: 0, symbols: new Set() };
      rec[name] += 1;
      rec.symbols.add(row.symbol);
      counts.set(row.theme, rec);
    }
  }
  return [...counts.entries()].map(([theme, rec]) => ({ theme, weighted: rec.weekly * 3 + rec.daily * 4 + rec.rsle * 2 + rec.developing, ...rec, symbols: [...rec.symbols].slice(0, 8).join(", ") })).sort((a, b) => b.weighted - a.weighted);
}

export function buildDashboardModel({ rows, rejected, indexAudit, coverage, expectedSession, scanMode = "SUNDAY_FULL_REBUILD", previousWeeklyContract = null, generatedAt = new Date().toISOString(), benchmarkRecord = null }) {
  for (const row of rows) applyPatternQualityExecutionCap(row, { market: "CANADA" });
  enrichRadarVisibility(rows, { market: "CANADA" });
  const indexOk = indexAudit.status === "INDEX_FRESHNESS_OK";
  const coverageOk = coverage.status === "COVERAGE_OK";
  const marketPermission = indexOk && coverageOk ? (indexAudit.context_status === "INDEX_CONTEXT_PARTIAL" ? "SELECTIVE_ONLY" : "TRADE_ALLOWED") : "DEFENSE_MODE";
  const marketConfirmation = buildMarketConfirmationStack({
    oneil_style_market_label: marketPermission === "TRADE_ALLOWED" ? "CONFIRMED_UPTREND" : marketPermission === "SELECTIVE_ONLY" ? "UPTREND_UNDER_PRESSURE" : "MARKET_IN_CORRECTION",
    mc2_cycle_state: marketPermission === "TRADE_ALLOWED" ? "MARKET_CYCLE_ON" : marketPermission === "SELECTIVE_ONLY" ? "MARKET_RECONFIRMATION" : "MARKET_CYCLE_OFF",
    final_market_permission: marketPermission
  }, {
    symbol: CANADA_PROFILE.benchmark_primary,
    bars: benchmarkRecord?.bars
  });
  const maRespect = buildMaRespectWatchlists(rows, { mutateRows: true });
  const myhApproaching = buildMyhApproachingRows(rows, { mutateRows: true });
  const eligible = rows.filter(r => r.liquidity_label !== "LIQUIDITY_DATA_REPAIR");
  const discovery = runLightweightFullUniverseDiscovery({ market: "CANADA", session: expectedSession, cache: { featureMatrix: rows } });
  const weeklyPlan = buildWeeklyUniverseForMode({
    mode: scanMode,
    previousContract: previousWeeklyContract,
    rankedCandidates: eligible,
    featureMatrix: rows,
    session: expectedSession,
    generatedAt,
    targetMax: 20,
    market: "CANADA"
  });
  const weeklyUniverse = weeklyPlan.weeklyUniverse;
  const weeklyFocus = weeklyUniverse.filter(r => !r.pattern_quality_execution_cap && ["TRIGGER_READY", "EARLY_ENTRY_WATCH", "PULLBACK_WATCH"].includes(r.final_bucket)).slice(0, 12);
  const dailyTop = weeklyFocus.filter(r => !r.pattern_quality_execution_cap && r.final_bucket === "TRIGGER_READY").slice(0, 4);
  const rsleTop20 = [...eligible].sort((a, b) => b.leadership_score - a.leadership_score || b.tactical_score - a.tactical_score).slice(0, 20);
  const developing = [...eligible].filter(r => !rsleTop20.includes(r)).sort((a, b) => b.leadership_score - a.leadership_score).slice(0, 20);
  const nearRsHigh = eligible.filter(r => r.rsnh).slice(0, 20);
  const myhApproachingRows = myhApproaching.myh_approaching_rows.slice(0, 20);
  const ma10Respect = maRespect.ema10_respect_rows.slice(0, 20);
  const ma21Respect = maRespect.ema21_respect_rows.slice(0, 20);
  const ma50Respect = maRespect.sma50_respect_rows.slice(0, 20);
  const pullbacks = eligible.filter(r => r.pbx_label === "PBX_VALID_PULLBACK").slice(0, 20);
  const basepivots = eligible.filter(r => r.basepivot_quality !== "BASEPIVOT_QUALITY_NONE").slice(0, 20);
  const rmvp = eligible.filter(r => r.compression).slice(0, 20);
  const ve2 = eligible.filter(r => !r.ve2.signature.includes("UNKNOWN")).slice(0, 20);
  const compression = eligible.filter(r => r.compression).slice(0, 20);
  const noChase = eligible.filter(r => r.final_bucket === "NO_CHASE" || r.axm.axm_composite_label !== "AXM_OK").slice(0, 20);
  const myhBreakoutRetests = buildMyhBreakoutRetestRows(rows).slice(0, 20);
  const strongRsRetention = buildStrongRsRetention(rows, {
    sourceLists: { weeklyUniverse, weeklyFocus, dailyTop, rsleTop20, developing, nearRsHigh, myhApproachingRows },
    retentionWindow: 20
  });
  const rejectedSplit = splitRejectedForRadarVisibility({ rows, rejected, market: "CANADA", dataAsOf: expectedSession });
  const cleanedRejected = rejectedSplit.rejected;
  const softRsRecoveredRows = rejectedSplit.softRsRecoveredRows;
  const auroraRadarUniverse = buildAuroraRadarUniverse({
    market: "CANADA",
    dataAsOf: expectedSession,
    lists: {
      WEEKLY_UNIVERSE: weeklyUniverse,
      WEEKLY_FOCUS: weeklyFocus,
      DAILY_TOP_1_4: dailyTop,
      RSLE_TOP_20: rsleTop20,
      DEVELOPING_WATCHLIST: developing,
      NEAR_RS_HIGH: nearRsHigh,
      MYH_APPROACHING: myhApproachingRows,
      MYH_BREAKOUT_RETEST: myhBreakoutRetests,
      MA10_RESPECT: ma10Respect,
      MA21_RESPECT: ma21Respect,
      MA50_RESPECT: ma50Respect,
      PBX_PULLBACK: pullbacks,
      BASEPIVOT: basepivots,
      RMVP: rmvp,
      NO_CHASE_RISK: noChase,
      STRONG_RS_RETENTION: strongRsRetention,
      SOFT_RS_REJECT_RECOVERED: softRsRecoveredRows
    },
    allCandidates: rows
  });
  const rrgHierarchy = buildRrgHierarchy(rows, { minDenominator: 3 });
  const themes = stockThemeLeadership([["weekly", weeklyUniverse], ["focus", weeklyFocus], ["daily", dailyTop], ["rsle", rsleTop20], ["developing", developing]]);
  return { expectedSession, rows, rejected: cleanedRejected, softRsRecoveredRows, softRsRecoveredCount: rejectedSplit.soft_rs_recovered_count, indexAudit, coverage, marketConfirmation, weeklyUniverse, weeklyFocus, dailyTop, rsleTop20, developing, nearRsHigh, myhApproachingRows, myhBreakoutRetests, ma10Respect, ma21Respect, ma50Respect, pullbacks, basepivots, rmvp, ve2, compression, noChase, themes, industryGroupRrg: rrgHierarchy.industry_group, industryRrg: rrgHierarchy.industry, subIndustryRrg: rrgHierarchy.sub_industry, auroraRadarUniverse, strongRsRetention, weeklyContract: weeklyPlan.weeklyContract, cadenceWarnings: weeklyPlan.warnings, discovery };
}

export function renderCanadaDashboard(model) {
  const indexOk = model.indexAudit.status === "INDEX_FRESHNESS_OK";
  const coverageOk = model.coverage.status === "COVERAGE_OK";
  const marketRegime = !indexOk ? "MARKET_REGIME_BLOCKED_PRIMARY_INDEX_STALE" : model.indexAudit.context_status === "INDEX_CONTEXT_PARTIAL" ? "MARKET_CONTEXT_PARTIAL" : "MARKET_CONTEXT_OK";
  const marketPermission = indexOk && coverageOk ? (model.indexAudit.context_status === "INDEX_CONTEXT_PARTIAL" ? "SELECTIVE_ONLY_CONTEXT_PARTIAL" : "TRADE_ALLOWED_OR_SELECTIVE_ONLY") : "MARKET_STATE_UNKNOWN";
  const marketConfirmation = model.marketConfirmation || buildMarketConfirmationStack({}, {});
  const myhApproachingRows = model.myhApproachingRows || [];
  const ma10Respect = model.ma10Respect || [];
  const ma21Respect = model.ma21Respect || [];
  const ma50Respect = model.ma50Respect || [];
  const themeRows = model.themes.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.theme)}</td><td>${r.weekly}</td><td>${r.daily}</td><td>${r.rsle}</td><td>${r.developing}</td><td>${r.weighted}</td><td>${escapeHtml(r.symbols)}</td></tr>`).join("");
  const rejectedRows = model.rejected.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.symbol)}</td><td>${escapeHtml(r.rejection_reason)}</td><td>Retry official/free route first; EODHD fallback is attempted only after Yahoo failure, staleness or incomplete history.</td></tr>`).join("");
  const compactRows = (rows, cells) => (rows || []).map((row, i) => `<tr><td>${i + 1}</td>${cells.map(cell => `<td>${cell(row)}</td>`).join("")}</tr>`).join("");
  const compactTable = (title, id, rows, headers, cells, note = "") => `<h2 id="${id}">${escapeHtml(title)}</h2>${note ? `<p class="notice">${escapeHtml(note)}</p>` : ""}<div class="table-wrap"><table><thead><tr><th>Rank</th>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${compactRows(rows, cells) || `<tr><td colspan="${headers.length + 1}">No rows.</td></tr>`}</tbody></table></div>`;
  const hierarchyRows = [...(model.industryGroupRrg || []), ...(model.industryRrg || []), ...(model.subIndustryRrg || [])];
  const hierarchyTable = compactTable("Industry Group / Industry / Sub-Industry RRG", "industry-rrg", hierarchyRows, ["Level", "Name", "Denominator", "Confidence", "Ratio", "Momentum", "Symbols"], [
    row => escapeHtml(row.level),
    row => `<strong>${escapeHtml(row.name)}</strong>`,
    row => `${row.denominator}<small>valid ${row.valid_rrg_denominator}</small>`,
    row => escapeHtml(row.confidence),
    row => num(row.rrg_ratio),
    row => num(row.rrg_momentum),
    row => escapeHtml(row.symbols)
  ], "Hierarchy RRG is context only. Insufficient denominators cannot create or block an AURORA trade bucket.");
  const radarTable = compactTable("AURORA_RADAR_UNIVERSE", "radar", model.auroraRadarUniverse || [], ["Symbol", "Theme / Sub-Industry", "Reason", "Memberships", "Gate", "Next", "Confidence"], [
    row => `<strong>${escapeHtml(row.symbol)}</strong><small>${escapeHtml(row.company_name || "")}</small>`,
    row => `${escapeHtml(row.aurora_theme)}<small>${escapeHtml(row.gics_sub_industry_name)}</small>`,
    row => escapeHtml(row.radar_reason),
    row => escapeHtml((row.scan_memberships || []).join(", ")),
    row => escapeHtml(row.current_gate),
    row => escapeHtml(row.next_condition),
    row => escapeHtml(row.classification_confidence)
  ], "Names-only visibility layer. Radar rows do not expand Weekly Universe, Weekly Focus or Daily Top and include no trade-plan columns.");
  const retentionTable = compactTable("STRONG_RS_RETENTION", "retention", model.strongRsRetention || [], ["Symbol", "Status", "Reason", "Score", "Gate", "Next"], [
    row => `<strong>${escapeHtml(row.symbol)}</strong><small>${escapeHtml(row.company_name || row.name || "")}</small>`,
    row => escapeHtml(row.strong_rs_retention_status),
    row => escapeHtml(row.retention_reason),
    row => num(row.rs_retention_score, 0),
    row => escapeHtml(row.current_gate),
    row => escapeHtml(row.next_condition)
  ], "Radar-only retention for strong RS leaders waiting for cleaner trigger, risk, pullback or repair.");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AURORA Canada Unified Dashboard</title><style>:root{--ink:#17201c;--muted:#66716b;--paper:#f7f8f5;--panel:#fff;--line:#d9ddd7;--green:#146b45;--greenbg:#e8f4ed;--amber:#895b00;--amberbg:#fff3d4;--red:#9b2f2f;--redbg:#fae9e7;--blue:#195a78;--bluebg:#e6f2f7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 Inter,Arial,sans-serif}header.hero{background:#143e55;color:white;padding:22px 28px;border-bottom:4px solid #d8ad42}.hero h1{margin:0;font-size:26px}.hero p{margin:5px 0 0;color:#deebe3}.nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.nav a{color:white;text-decoration:none;border:1px solid #7897a5;padding:6px 10px;border-radius:4px}.wrap{padding:20px 28px 42px}.summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.metric{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:12px}.metric b{display:block;font-size:17px;margin-top:4px}.metric small,td small{display:block;color:var(--muted);margin-top:3px}h2{font-size:19px;margin:28px 0 10px}.notice{background:var(--amberbg);border-left:4px solid #c38b16;padding:10px 12px;border-radius:4px}.table-wrap{overflow-x:auto;overflow-y:auto;max-height:70vh;position:relative;border:1px solid var(--line);background:white;border-radius:6px}table{border-collapse:collapse;width:100%;min-width:1560px}th,td{text-align:left;vertical-align:top;padding:8px 9px;border-bottom:1px solid var(--line);font-size:12px}th{background:#edf1ec;position:sticky;top:0;z-index:2;white-space:nowrap}.status{display:inline-block;padding:3px 6px;border-radius:4px;font-size:11px;font-weight:700;background:var(--bluebg);color:var(--blue);white-space:nowrap}.TRIGGER_READY,.TRADE_READY{color:var(--green);background:var(--greenbg)}.NO_CHASE,.AVOID_FRESH_LONG{color:var(--red);background:var(--redbg)}.foot{color:var(--muted);margin-top:18px}@media(max-width:900px){.summary{grid-template-columns:1fr 1fr}.wrap{padding:16px}header.hero{padding:18px}table{min-width:1280px}}</style></head><body><header class="hero"><h1>AURORA Canada Unified Dashboard</h1><p>Canada-only EOD scan · Completed session ${escapeHtml(model.expectedSession)} · Yahoo free-first with EODHD fallback · CAD</p><nav class="nav"><a href="#market">Market</a><a href="#guide">Guide</a><a href="#weekly">Weekly Universe</a><a href="#focus">Focus</a><a href="#top">Daily Top</a><a href="#rsle">RSLE Top 20</a><a href="#developing">Developing</a><a href="#overlay">Canada Overlay</a><a href="#rrg">RRG</a><a href="#themes">Theme Leadership</a><a href="#industry-rrg">Industry RRG</a><a href="#radar">Radar</a><a href="#retention">Strong RS Retention</a><a href="#rshigh">Near RS High</a><a href="#myh">MYH</a><a href="#myh-retest">MYH Retest</a><a href="#ma10">10EMA Respect</a><a href="#ma21">21EMA Respect</a><a href="#ma50">50SMA Respect</a><a href="#pullbacks">PBX Pullback</a><a href="#basepivots">BasePivot</a><a href="#rmvp">RMVP</a><a href="#ve2">VE2</a><a href="#compression">Compression</a><a href="#risk">No-Chase</a><a href="#sell-extension">Sell / Extension</a><a href="#rejected">Rejected</a><a href="#provenance">Provenance</a></nav></header><main class="wrap"><section class="summary"><div class="metric">Run state<b>FULL_LOCAL_SCAN</b><small>free-first, EODHD fallback only</small></div><div class="metric">Session<b>${escapeHtml(model.expectedSession)}</b><small>latest completed Canadian session</small></div><div class="metric">Market Regime<b>${escapeHtml(marketRegime)}</b><small>${escapeHtml(model.indexAudit.context_status || "")}</small></div><div class="metric">Coverage<b>${num(model.coverage.coverage_pct)}%</b><small>${model.coverage.current_symbols}/${model.coverage.loaded_symbols} current</small></div><div class="metric">Market Permission<b>${escapeHtml(marketPermission)}</b><small>EOD only</small></div><div class="metric">3-System<b>${escapeHtml(marketConfirmation.market_confirmation_state)}</b><small>${escapeHtml(marketConfirmation.benchmark_rs21_state)} · ${escapeHtml(marketConfirmation.benchmark_weinstein_stage)}</small></div></section><h2 id="market">Market Summary Strength Stack</h2><p class="notice">Primary benchmark ${CANADA_PROFILE.benchmark_primary} controls market-regime blocking. Three-System Market Confirmation: O'Neil ${escapeHtml(marketConfirmation.oneil_cycle_state)}; Benchmark RS21 ${escapeHtml(marketConfirmation.benchmark_rs21_state)}; Benchmark Weinstein ${escapeHtml(marketConfirmation.benchmark_weinstein_stage)}; State ${escapeHtml(marketConfirmation.market_confirmation_state)}.</p>${howToReadHtml}<h2>Column Guide</h2><div class="table-wrap"><table><thead><tr><th>Column</th><th>Meaning</th></tr></thead><tbody>${REQUIRED_CANDIDATE_COLUMNS.map(c => `<tr><td><strong>${escapeHtml(displayCandidateColumn(c))}</strong></td><td>${escapeHtml(columnGuideCopy[c] || "Canada-specific AURORA field preserved from India/US dashboard format.")}</td></tr>`).join("")}</tbody></table></div>${renderTable("WEEKLY_UNIVERSE", "weekly", model.weeklyUniverse, "Rolling 15-20 Canada candidates. No forced padding.")}${renderTable("WEEKLY_FOCUS", "focus", model.weeklyFocus, "Execution funnel from Weekly Universe.")}${renderTable("DAILY_TOP_1_4 Conditional Trade Plans", "top", model.dailyTop, "Maximum four; never forced.")}${renderTable("AURORA-RSLE Top 20", "rsle", model.rsleTop20, "Independent Canada RS leadership-entry list.")}${renderTable("Developing Watchlist Next 20", "developing", model.developing, "Emerging leaders awaiting setup, confirmation or tighter risk.")}<h2 id="overlay">Canada Small/Microcap / Exchange Overlay</h2><p class="notice">Initial production lane is TSX liquid universe. TSXV/CSE/NEO symbols must pass explicit suffix validation before inclusion; unmapped or unsupported suffixes go to DATA_REPAIR.</p><h2 id="rrg">Sector and Theme RRG</h2><p class="notice">${sectorRrgCopy}</p><h2 id="themes">Stock Theme Leadership</h2><p class="notice">${stockThemeCopy} Canada examples: Banks, Pipelines / Midstream, Oil & Gas, Uranium, Gold / Materials, Rails, Canadian Technology.</p><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Theme</th><th>Weekly</th><th>Daily Top</th><th>RSLE</th><th>Developing</th><th>Weighted Presence</th><th>Symbols</th></tr></thead><tbody>${themeRows}</tbody></table></div>${hierarchyTable}${radarTable}${retentionTable}<h2 id="rrglegend">RRG Quadrant Map</h2><p class="notice">${sectorRrgCopy}</p>${renderTable("Near RS High", "rshigh", model.nearRsHigh)}${renderTable("AURORA-MYH Approaching / Multi-Year High", "myh", myhApproachingRows, "Approaching multi-year high is a leadership radar lane, not a standalone buy signal.")}${renderTable("AURORA-MYH Breakout Retest", "myh-retest", model.myhBreakoutRetests || [], "Prior MYH breakout now retesting a valid support anchor. Radar/watchlist only unless normal AURORA gates promote it.")}${renderTable("Strong RS 10EMA Respect Watchlist", "ma10", ma10Respect, "Tracks high-momentum leaders repeatedly respecting 10EMA. Watchlist only.")}${renderTable("Strong RS 21EMA Respect Watchlist", "ma21", ma21Respect, "Tracks strong RS leaders defending or reclaiming 21EMA. Watchlist only.")}${renderTable("Strong RS 50SMA Respect Watchlist", "ma50", ma50Respect, "Tracks deeper structural resets in strong RS stocks. Watchlist only.")}${renderTable("PBX Pullback", "pullbacks", model.pullbacks)}${renderTable("BasePivot / Patterns", "basepivots", model.basepivots)}${renderTable("RMVP / Early Entry", "rmvp", model.rmvp)}${renderTable("VE2 Volume Signature", "ve2", model.ve2)}${renderTable("Compression", "compression", model.compression)}${renderTable("No-Chase / Risk", "risk", model.noChase)}${sellExtensionWatchlistHtml()}<h2 id="rejected">Rejected / Data Repair Routes</h2><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Symbol</th><th>Reason</th><th>Next Route</th></tr></thead><tbody>${rejectedRows || `<tr><td colspan="4">No rejected rows.</td></tr>`}</tbody></table></div><h2 id="provenance">Provenance</h2><div class="table-wrap"><table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody><tr><td>provider_route</td><td>${escapeHtml(JSON.stringify(model.indexAudit.provider_route))}</td></tr><tr><td>eodhd_canada_fallback_status</td><td>EODHD_FALLBACK_ENABLED_ONLY_AFTER_YAHOO_FAILURE_STALE_OR_INCOMPLETE</td></tr><tr><td>expected_completed_session</td><td>${escapeHtml(model.expectedSession)}</td></tr><tr><td>latest_index_data_as_of</td><td>${escapeHtml(model.indexAudit.present_symbols.map(x => `${x.symbol}:${x.data_as_of}:${x.provider || ""}`).join(", "))}</td></tr><tr><td>optional_context_stale</td><td>${escapeHtml(JSON.stringify(model.indexAudit.optional_stale_symbols || []))}</td></tr><tr><td>symbols_loaded</td><td>${model.coverage.loaded_symbols}</td></tr><tr><td>valid_symbols</td><td>${model.coverage.valid_history_symbols}</td></tr><tr><td>feature_matrix_count</td><td>${model.rows.length}</td></tr><tr><td>scanned_candidates</td><td>${model.rows.length}</td></tr><tr><td>rejected_count</td><td>${model.rejected.length}</td></tr></tbody></table></div><p class="foot">AURORA Canada remains EOD-only. RS means benchmark-relative strength, never RSI. No intraday order logic or live automation.</p></main></body></html>`;
}
