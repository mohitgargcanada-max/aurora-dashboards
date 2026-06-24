import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSymbol } from "../engine/cache-store.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const statePath = resolve(root, "data/us-dashboard-state.json");
const cacheRoot = resolve(root, "cache/us/ohlcv");
const outputPath = resolve(root, "data/rs-leadership-scan.json");
const LIQUIDITY_MIN = 20_000_000;

const round = (x, n = 2) => Number.isFinite(x) ? Number(x.toFixed(n)) : null;
const mean = xs => xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : null;
const pctChange = (xs, n, offset = 0) => {
  const end = xs.length - 1 - offset;
  const start = end - n;
  return start >= 0 && xs[start] ? xs[end] / xs[start] - 1 : null;
};
const sliceAt = (xs, n, offset = 0) => {
  const end = xs.length - offset;
  return end >= n ? xs.slice(end - n, end) : [];
};
function emaSeries(xs, n) {
  const out = Array(xs.length).fill(null);
  if (xs.length < n) return out;
  const k = 2 / (n + 1);
  let value = mean(xs.slice(0, n));
  out[n - 1] = value;
  for (let i = n; i < xs.length; i++) {
    value = xs[i] * k + value * (1 - k);
    out[i] = value;
  }
  return out;
}
function atr(bars, n = 14) {
  if (bars.length <= n) return null;
  const values = bars.slice(1).map((bar, i) => Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - bars[i].close),
    Math.abs(bar.low - bars[i].close)
  ));
  return mean(values.slice(-n));
}
function rmv(bars, n) {
  const window = bars.slice(-n);
  if (window.length < n) return null;
  return (Math.max(...window.map(x => x.high)) - Math.min(...window.map(x => x.low))) / mean(window.map(x => x.close)) * 100;
}
function weightedRsRaw(closes, offset = 0) {
  const end = closes.length - 1 - offset;
  if (end - 252 < 0) return null;
  const q4 = closes[end] / closes[end - 63] - 1;
  const q3 = closes[end - 63] / closes[end - 126] - 1;
  const q2 = closes[end - 126] / closes[end - 189] - 1;
  const q1 = closes[end - 189] / closes[end - 252] - 1;
  return (2 * q4 + q3 + q2 + q1) / 5;
}
function assignPercentiles(rows, source, target) {
  const valid = rows.filter(x => Number.isFinite(x[source])).sort((a, b) => a[source] - b[source]);
  if (!valid.length) return;
  let i = 0;
  while (i < valid.length) {
    let j = i + 1;
    while (j < valid.length && valid[j][source] === valid[i][source]) j++;
    const midpointRank = (i + 1 + j) / 2;
    const percentile = valid.length === 1 ? 99 : 1 + 98 * (midpointRank - 1) / (valid.length - 1);
    for (let k = i; k < j; k++) valid[k][target] = round(percentile, 0);
    i = j;
  }
}
function alignedRs(bars, benchmark) {
  const bm = new Map(benchmark.map(x => [x.date, x.close]));
  return bars.filter(x => bm.has(x.date)).map(x => ({ date: x.date, value: x.close / bm.get(x.date) }));
}
function rs21State(values, ema21) {
  const last = values.length - 1;
  if (last < 5 || !Number.isFinite(ema21[last])) return "NOT_AVAILABLE";
  const above = values[last] >= ema21[last];
  const crossedAgo = [0, 1, 2, 3, 4, 5].find(ago => {
    const i = last - ago;
    return i > 0 && Number.isFinite(ema21[i - 1]) && values[i] >= ema21[i] && values[i - 1] < ema21[i - 1];
  });
  const hold3 = [0, 1, 2].every(ago => values[last - ago] >= ema21[last - ago]);
  const slope5 = values[last] / values[last - 5] - 1;
  const emaRising = ema21[last] > ema21[last - 5];
  const distance = (values[last] / ema21[last] - 1) * 100;
  if (crossedAgo !== undefined) return `RECLAIM_${crossedAgo}D`;
  if (hold3 && slope5 > 0 && emaRising) return "ABOVE_ACCELERATING";
  if (hold3) return "ABOVE_HOLDING";
  if (!above && distance >= -1.5) return "APPROACHING_RECLAIM";
  return above ? "ABOVE_UNSTABLE" : "BELOW_WARNING";
}
function rrgState(values) {
  if (values.length < 384) return { quadrant: "NOT_AVAILABLE", direction: "NOT_AVAILABLE", ratio: null, momentum: null };
  const snapshot = offset => {
    const end = values.length - 1 - offset;
    const ratio = values[end] / values[end - 252] * 100;
    const priorRatio = values[end - 126] / values[end - 378] * 100;
    const momentum = ratio / priorRatio * 100;
    const quadrant = ratio >= 100 && momentum >= 100 ? "LEADING" : ratio >= 100 ? "WEAKENING" : momentum >= 100 ? "IMPROVING" : "LAGGING";
    return { ratio, momentum, quadrant };
  };
  const now = snapshot(0);
  const prior = snapshot(5);
  const improving = now.ratio > prior.ratio && now.momentum > prior.momentum;
  return { ...now, direction: improving ? "NORTHEAST" : now.ratio >= prior.ratio ? "EAST" : now.momentum >= prior.momentum ? "NORTH" : "SOUTHWEST" };
}
function classifySetup(row) {
  const constructiveRs21 = !["BELOW_WARNING", "NOT_AVAILABLE"].includes(row.rs21_state);
  if (row.distance_to_trigger_pct >= -1 && row.distance_to_trigger_pct <= 1) return "RSLE_TRIGGER_READY";
  if (row.distance_to_trigger_pct > 1 && row.distance_to_trigger_pct <= 5 && (row.compressed || row.inside_bar || row.pocket_pivot)) return "RSLE_EARLY_ENTRY";
  if (row.extension_ema21_pct >= 0 && row.extension_ema21_pct <= 4 && constructiveRs21) return "RSLE_PULLBACK";
  if (row.pocket_pivot) return "RSLE_POCKET_PIVOT";
  if (row.inside_bar && row.distance_to_trigger_pct > 0 && row.distance_to_trigger_pct <= 7) return "RSLE_INSIDE_BAR";
  if (row.rmv15 < 10 && row.distance_to_trigger_pct > 0 && row.distance_to_trigger_pct <= 7) return "RSLE_RMV_COIL";
  if (row.rs_new_high && row.distance_to_trigger_pct > 0 && row.distance_to_trigger_pct <= 7) return "RSLE_RSNH_WATCH";
  if (row.rs21_state !== "BELOW_WARNING") return "RSLE_WATCH_FOR_TIGHTER_SHELF";
  return "RSLE_DATA_REPAIR";
}
function entryReferenceForSetup(setup, trigger, price) {
  if (["RSLE_TRIGGER_READY", "RSLE_EARLY_ENTRY", "RSLE_INSIDE_BAR", "RSLE_RMV_COIL", "RSLE_RSNH_WATCH"].includes(setup)) return trigger;
  if (["RSLE_PULLBACK", "RSLE_POCKET_PIVOT"].includes(setup)) return price;
  return null;
}
function scoreRs21(state) {
  if (state === "ABOVE_ACCELERATING") return 100;
  if (state === "ABOVE_HOLDING") return 85;
  if (["RECLAIM_0D", "RECLAIM_1D", "RECLAIM_2D"].includes(state)) return 75;
  if (["RECLAIM_3D", "RECLAIM_4D", "RECLAIM_5D"].includes(state)) return 65;
  if (state === "APPROACHING_RECLAIM") return 40;
  if (state === "BELOW_WARNING") return 10;
  return 0;
}
function scoreRrg(rrg) {
  if (rrg.quadrant === "LEADING" && rrg.direction === "NORTHEAST") return 95;
  if (rrg.quadrant === "LEADING") return 85;
  if (rrg.quadrant === "IMPROVING" && ["NORTHEAST", "NORTH"].includes(rrg.direction)) return 80;
  if (rrg.quadrant === "IMPROVING") return 70;
  if (rrg.quadrant === "WEAKENING") return 35;
  if (rrg.quadrant === "LAGGING") return 15;
  return 0;
}
function scoreSetup(setup) {
  return {
    RSLE_TRIGGER_READY: 100,
    RSLE_EARLY_ENTRY: 90,
    RSLE_POCKET_PIVOT: 90,
    RSLE_PULLBACK: 80,
    RSLE_INSIDE_BAR: 75,
    RSLE_RMV_COIL: 75,
    RSLE_RSNH_WATCH: 55,
    RSLE_WATCH_FOR_TIGHTER_SHELF: 35,
    RSLE_DATA_REPAIR: 0
  }[setup] ?? 0;
}
function scoreEntryRisk(tier, pct) {
  if (tier === "RSLE_STANDARD_ENTRY" && pct <= 4) return 100;
  if (tier === "RSLE_STANDARD_ENTRY") return 80;
  if (tier === "RSLE_VOLATILITY_ADJUSTED_STARTER") return 55;
  if (tier === "RSLE_WATCH_FOR_TIGHTER_SHELF") return 20;
  return 0;
}
function scoreVe2(row) {
  if (row.rvol >= 1.5 && row.price_change_1d_pct > 0) return 100;
  if (row.rvol >= 1.0 || row.compressed) return 80;
  if (row.rvol >= 0.7) return 50;
  return 20;
}
function scoreExtension(row) {
  if (row.axm_atr == null) return 45;
  if (row.axm_atr <= 1.5) return 100;
  if (row.axm_atr <= 2.5) return 80;
  if (row.axm_atr <= 3.5) return 45;
  return 15;
}

const state = JSON.parse(await readFile(statePath, "utf8"));
const spyRecord = await loadSymbol(cacheRoot, "SPY");
const spy = spyRecord.bars;
const universe = [...new Map(state.all_candidates.map(x => [x.ticker, x])).values()];
const liquidRows = [];

for (let offset = 0; offset < universe.length; offset += 64) {
  const batch = universe.slice(offset, offset + 64);
  const records = await Promise.all(batch.map(async meta => {
    try { return [meta, await loadSymbol(cacheRoot, meta.ticker)]; }
    catch { return [meta, null]; }
  }));
  for (const [meta, record] of records) {
    if (!record || record.data_as_of !== state.run.data_as_of || record.bars.length < 379) continue;
    const bars = record.bars;
    const closes = bars.map(x => x.close);
    const volumes = bars.map(x => x.volume);
    const rs = alignedRs(bars, spy);
    const rsValues = rs.map(x => x.value);
    if (rsValues.length < 379) continue;
    const price = closes.at(-1);
    const addv20 = mean(bars.slice(-20).map(x => x.close * x.volume));
    if (!(addv20 >= LIQUIDITY_MIN)) continue;
    const rsEma21 = emaSeries(rsValues, 21);
    const currentRs = rsValues.at(-1);
    const slope5 = pctChange(rsValues, 5) * 100;
    const rs63High = Math.max(...rsValues.slice(-63));
    const trifectaCount = [currentRs >= rsEma21.at(-1), currentRs >= rs63High * 0.995, slope5 > 0].filter(Boolean).length;
    const pivot = Math.max(...bars.slice(-21, -1).map(x => x.high));
    const trigger = pivot * 1.001;
    const e10 = emaSeries(closes, 10).at(-1);
    const e21 = emaSeries(closes, 21).at(-1);
    const a14 = atr(bars);
    const avgVol20 = mean(volumes.slice(-20));
    const insideBar = bars.at(-1).high <= bars.at(-2).high && bars.at(-1).low >= bars.at(-2).low;
    const pocketPivot = bars.at(-1).close > bars.at(-1).open && volumes.at(-1) > Math.max(...volumes.slice(-11, -1)) && price > e10;
    const r5 = rmv(bars, 5), r15 = rmv(bars, 15), r25 = rmv(bars, 25);
    const distanceToTrigger = (trigger - price) / trigger * 100;
    const extensionEma21 = (price / e21 - 1) * 100;
    const priceChange1d = pctChange(closes, 1) * 100;
    const setupProbe = {
      distance_to_trigger_pct: round(distanceToTrigger),
      extension_ema21_pct: round(extensionEma21),
      compressed: r5 < r15 && r15 < r25,
      inside_bar: insideBar,
      pocket_pivot: pocketPivot,
      rmv15: r15,
      rs_new_high: currentRs >= rs63High * 0.995,
      rs21_state: rs21State(rsValues, rsEma21)
    };
    const setup = classifySetup(setupProbe);
    const entryReference = entryReferenceForSetup(setup, trigger, price);
    const buffer = entryReference ? Math.max(0.01, entryReference * 0.005) : null;
    const tacticalAnchor = Math.min(...bars.slice(-3).map(x => x.low));
    const anchorStop = buffer ? tacticalAnchor - buffer : null;
    const noiseFloorStop = entryReference && a14 ? entryReference - 0.5 * a14 : null;
    const tacticalStop = anchorStop != null && noiseFloorStop != null ? Math.min(anchorStop, noiseFloorStop) : null;
    const tacticalRisk = tacticalStop != null && tacticalStop < entryReference ? (entryReference - tacticalStop) / entryReference * 100 : null;
    const tacticalRiskAtr = tacticalStop != null && a14 ? (entryReference - tacticalStop) / a14 : null;
    const thesisStopRaw = Math.min(...bars.slice(-50).map(x => x.low), e21 * 0.985);
    const thesisStop = tacticalStop != null ? Math.min(thesisStopRaw, tacticalStop - buffer) : thesisStopRaw;
    const thesisRisk = entryReference && thesisStop < entryReference ? (entryReference - thesisStop) / entryReference * 100 : null;
    let riskTier = "RSLE_WATCH_FOR_TIGHTER_SHELF";
    if (tacticalRisk <= 7) riskTier = "RSLE_STANDARD_ENTRY";
    else if (tacticalRisk <= 10 && tacticalRiskAtr <= 1.25 && (trifectaCount === 3 || (trifectaCount === 2 && setupProbe.rs21_state.startsWith("RECLAIM")))) riskTier = "RSLE_VOLATILITY_ADJUSTED_STARTER";
    const row = {
      ticker: meta.ticker,
      exchange: meta.exchange,
      weekly_route: meta.route,
      provider: record.provider,
      data_as_of: record.data_as_of,
      price: round(price),
      avg_dollar_volume_20: round(addv20, 0),
      rs_1w_relative: round(((1 + pctChange(closes, 5)) / (1 + pctChange(spy.map(x => x.close), 5)) - 1) * 100),
      rs_1m_relative: round(((1 + pctChange(closes, 21)) / (1 + pctChange(spy.map(x => x.close), 21)) - 1) * 100),
      rs_3m_relative: round(((1 + pctChange(closes, 63)) / (1 + pctChange(spy.map(x => x.close), 63)) - 1) * 100),
      rs_raw_0: weightedRsRaw(closes, 0),
      rs_raw_5: weightedRsRaw(closes, 5),
      rs_raw_20: weightedRsRaw(closes, 20),
      rs21_state: rs21State(rsValues, rsEma21),
      rs_new_high: currentRs >= rs63High * 0.995,
      rs_slope5_pct: round(slope5),
      trifecta_count: trifectaCount,
      trifecta: trifectaCount === 3 ? "PASS" : trifectaCount === 2 ? "PARTIAL" : "FAIL",
      rrg: rrgState(rsValues),
      rmv5: round(r5), rmv15: round(r15), rmv25: round(r25),
      compressed: r5 < r15 && r15 < r25,
      inside_bar: insideBar,
      pocket_pivot: pocketPivot,
      rvol: round(volumes.at(-1) / avgVol20),
      price_change_1d_pct: round(priceChange1d),
      trigger: round(trigger),
      entry_reference: round(entryReference),
      distance_to_trigger_pct: round(distanceToTrigger),
      stop: round(tacticalStop),
      risk_pct: round(tacticalRisk),
      entry_stop: round(tacticalStop),
      entry_risk_pct: round(tacticalRisk),
      entry_risk_atr: round(tacticalRiskAtr),
      thesis_stop: round(thesisStop),
      thesis_risk_pct: round(thesisRisk),
      entry_risk_tier: riskTier,
      level_2r: round(entryReference && tacticalStop ? entryReference + 2 * (entryReference - tacticalStop) : null),
      level_3r: round(entryReference && tacticalStop ? entryReference + 3 * (entryReference - tacticalStop) : null),
      extension_ema21_pct: round(extensionEma21),
      axm_atr: round(a14 ? (price - e21) / a14 : null)
    };
    row.setup = setup;
    liquidRows.push(row);
  }
}

for (const [source, target] of [
  ["rs_1w_relative", "rs_1w_rating"], ["rs_1m_relative", "rs_1m_rating"], ["rs_3m_relative", "rs_3m_rating"],
  ["rs_raw_0", "rs_rating"], ["rs_raw_5", "rs_rating_5d_ago"], ["rs_raw_20", "rs_rating_20d_ago"]
]) assignPercentiles(liquidRows, source, target);

const rows = liquidRows.filter(row => row.setup !== "RSLE_DATA_REPAIR");

const permissionPriority = { RSLE_STANDARD_ENTRY: 4, RSLE_VOLATILITY_ADJUSTED_STARTER: 3, RSLE_EXECUTION_CAUTION: 2, RSLE_WATCH_FOR_TIGHTER_SHELF: 1 };
for (const row of rows) {
  row.rs_rating_delta_5d = row.rs_rating - row.rs_rating_5d_ago;
  row.rs_rating_delta_20d = row.rs_rating - row.rs_rating_20d_ago;
  row.rsle_leadership_score = round(
    row.rs_rating * 0.25 + row.rs_1w_rating * 0.10 + row.rs_1m_rating * 0.15 + row.rs_3m_rating * 0.15 +
    scoreRs21(row.rs21_state) * 0.15 + scoreRrg(row.rrg) * 0.10 + ({ PASS: 100, PARTIAL: 65, FAIL: 25 }[row.trifecta] || 0) * 0.10
  );
  row.rsle_tactical_score = round(row.rsle_leadership_score * 0.45 + scoreSetup(row.setup) * 0.20 + scoreEntryRisk(row.entry_risk_tier, row.entry_risk_pct) * 0.15 + scoreVe2(row) * 0.10 + scoreExtension(row) * 0.10);
  row.rs_leadership_score = row.rsle_leadership_score;
  row.entry_permission = row.entry_risk_tier;
  row.position_size_factor = row.entry_risk_tier === "RSLE_STANDARD_ENTRY" ? 1 : row.entry_risk_tier === "RSLE_VOLATILITY_ADJUSTED_STARTER" ? 0.5 : 0;
  row.next_tactical_condition = row.entry_risk_tier === "RSLE_WATCH_FOR_TIGHTER_SHELF" ? "WAIT_FOR_INSIDE_BAR_RMV5_COIL_OR_SUPPORT_RETEST" : row.setup === "RSLE_TRIGGER_READY" ? "EOD_TRIGGER_ACCEPTANCE" : "CLEAR_ACTIVE_TRIGGER_WITHOUT_EXTENSION";
  const notes = [];
  if (row.rs_rating_delta_20d >= 10) notes.push("RS rating rapidly improving");
  else if (row.rs_rating_delta_20d > 0) notes.push("RS rating improving");
  else if (row.rs_rating_delta_20d <= -10) notes.push("RS rating deterioration");
  if (row.rs21_state.startsWith("RECLAIM")) notes.push("fresh RS21 reclaim");
  if (row.rrg.direction === "NORTHEAST") notes.push("RRG northeast");
  if (row.compressed) notes.push("RMV compression");
  if (row.inside_bar) notes.push("inside bar");
  if (row.pocket_pivot) notes.push("pocket-pivot proxy");
  row.note = notes.join("; ") || "RS leadership holding";
  const cautions = [];
  if (row.trifecta === "FAIL") cautions.push("Trifecta not confirmed");
  if (row.entry_risk_tier === "RSLE_VOLATILITY_ADJUSTED_STARTER") cautions.push("7-10% entry risk; reduced size only");
  if (row.entry_risk_tier === "RSLE_WATCH_FOR_TIGHTER_SHELF") cautions.push("entry risk >10% or no active setup anchor; wait for tighter shelf");
  if (row.thesis_risk_pct > 10) cautions.push("broad thesis invalidation");
  if (row.axm_atr > 3) cautions.push("AXM >3 ATR");
  if (row.rvol < 0.7) cautions.push("low current volume");
  row.caution = cautions.join("; ") || "none from calculated technical fields";
  delete row.rs_raw_0; delete row.rs_raw_5; delete row.rs_raw_20;
}

rows.sort((a, b) => b.rsle_leadership_score - a.rsle_leadership_score || b.rsle_tactical_score - a.rsle_tactical_score || b.avg_dollar_volume_20 - a.avg_dollar_volume_20 || a.ticker.localeCompare(b.ticker));
const tacticalCandidates = rows
  .filter(row => row.rsle_leadership_score >= 50 && !["RSLE_WATCH_FOR_TIGHTER_SHELF", "RSLE_DATA_REPAIR"].includes(row.setup))
  .sort((a, b) => (permissionPriority[b.entry_risk_tier] || 0) - (permissionPriority[a.entry_risk_tier] || 0) || b.rsle_tactical_score - a.rsle_tactical_score || b.rsle_leadership_score - a.rsle_leadership_score || b.avg_dollar_volume_20 - a.avg_dollar_volume_20 || a.ticker.localeCompare(b.ticker));
const rsleTop20 = tacticalCandidates.slice(0, 20).map((row, index) => ({
  ...row,
  rsle_rank: index + 1,
  rsle_list_tier: "RSLE_TOP_20_TACTICAL"
}));
const topSymbols = new Set(rsleTop20.map(x => x.ticker));
const rsleDeveloping = rows
  .filter(row => !topSymbols.has(row.ticker))
  .sort((a, b) => b.rsle_leadership_score - a.rsle_leadership_score || b.rsle_tactical_score - a.rsle_tactical_score || b.avg_dollar_volume_20 - a.avg_dollar_volume_20 || a.ticker.localeCompare(b.ticker))
  .slice(0, 20)
  .map((row, index) => ({ ...row, rsle_rank: index + 21, rsle_list_tier: "RSLE_DEVELOPING_21_40" }));
const result = {
  generated_at: new Date().toISOString(),
  data_as_of: state.run.data_as_of,
  benchmark: "SPY",
  provider: "STOOQ",
  endpoint: "d_us_txt.zip/local-cache",
  adjustment_status: "STOOQ_ADJUSTED_OHLC",
  currency: "USD",
  fallback_label: "FREE_PRIMARY",
  universe_input_count: universe.length,
  liquid_universe_count: liquidRows.length,
  liquidity_min_usd: LIQUIDITY_MIN,
  eligible_setup_count: rows.length,
  methodology: "RS and liquidity define leadership discovery. Tactical readiness is scored separately from leadership. RSLE setup labels are diagnostics and never become locked AURORA final buckets.",
  top20_tactical: rsleTop20,
  developing_21_40: rsleDeveloping,
  top10_primary: rsleTop20.slice(0, 10),
  leadership_queue_11_20: rsleTop20.slice(10, 20),
  rsle_top20: rsleTop20,
  pullback_candidates: tacticalCandidates.filter(row => row.setup === "RSLE_PULLBACK").slice(0, 20),
  risk_observation: {
    top20_standard_entries: rsleTop20.filter(row => row.entry_risk_tier === "RSLE_STANDARD_ENTRY").length,
    top20_volatility_adjusted_starters: rsleTop20.filter(row => row.entry_risk_tier === "RSLE_VOLATILITY_ADJUSTED_STARTER").length,
    top20_watch_for_tighter_shelf: rsleTop20.filter(row => row.entry_risk_tier === "RSLE_WATCH_FOR_TIGHTER_SHELF").length,
    top20_status: rsleTop20.some(row => row.entry_risk_tier !== "RSLE_WATCH_FOR_TIGHTER_SHELF") ? "TACTICAL_ENTRIES_PRESENT" : "NO_TACTICAL_ENTRY_IN_TOP20"
  },
  candidates: [...rsleTop20, ...rsleDeveloping, ...rows.filter(row => !topSymbols.has(row.ticker)).slice(20, 80)]
};
const temp = `${outputPath}.tmp`;
await writeFile(temp, JSON.stringify(result, null, 2), "utf8");
await rename(temp, outputPath);
state.rs_leadership = {
  data_as_of: result.data_as_of,
  benchmark: result.benchmark,
  liquidity_min_usd: result.liquidity_min_usd,
  top20_tactical: result.top20_tactical,
  developing_21_40: result.developing_21_40,
  top10: result.top10_primary,
  leadership_queue_11_20: result.leadership_queue_11_20,
  top20: result.rsle_top20,
  pullbacks: result.pullback_candidates.slice(0, 5),
  risk_observation: result.risk_observation
};
const stateTemp = `${statePath}.tmp`;
await writeFile(stateTemp, JSON.stringify(state), "utf8");
await rename(stateTemp, statePath);
console.log(JSON.stringify({ data_as_of: result.data_as_of, input: universe.length, eligible: rows.length, top: rows.slice(0, 20).map(x => [x.ticker, x.setup, x.rs_leadership_score]) }));
