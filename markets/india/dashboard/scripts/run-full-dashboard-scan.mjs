import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { latestCompletedIndiaSession } from "../engine/trading-calendar.mjs";
import { auditIndexRecords, deriveExpectedCompletedSession, INDIA_PROVIDER_ROUTE, rejectionReasonCounts } from "../engine/freshness-guard.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cacheRoot = resolve(root, "cache/india/ohlcv");
const indexRoot = resolve(root, "cache/india/indices");
const dataRoot = resolve(root, "data");
const universePath = resolve(dataRoot, "india-universe.json");
const dashboardPath = resolve(root, "..", "AURORA_India_Unified_Dashboard.html");
const scanPath = resolve(dataRoot, "india-full-dashboard-scan.json");
const expectedSession = await deriveExpectedCompletedSession({
  refreshReportPath: resolve(dataRoot, "india-daily-refresh-report.json"),
  explicitSession: process.argv[2] || process.env.AURORA_TARGET_SESSION || latestCompletedIndiaSession(),
  stockCacheRoot: cacheRoot
});
if (!expectedSession) throw new Error("Unable to derive expected completed India session");

const NSE_EQUITY_SERIES = new Set(["EQ", "BE", "SM", "ST", "BZ"]);
const BSE_EQUITY_GROUPS = new Set(["A", "B", "T", "TS", "X", "XT", "Z", "ZP", "M", "MT", "MS"]);
const LIQUIDITY_MIN_INR = 16_000_000;
const INDIA_REFERENCE_BASKET = ["RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "SBIN", "INFY", "LT", "ITC", "HINDUNILVR"];
const MYH_DEFINITIONS = [
  { label: "MYH_5Y", sessions: 1260 },
  { label: "MYH_3Y", sessions: 756 },
  { label: "MYH_2Y", sessions: 504 }
];

const clamp = (value, low = 0, high = 100) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = values => {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
};
const pctChange = (values, n, offset = 0) => {
  const end = values.length - 1 - offset;
  const start = end - n;
  return start >= 0 && values[start] > 0 ? values[end] / values[start] - 1 : null;
};
const latest = values => values.at(-1);
const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const money = value => Number.isFinite(value) ? `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
const num = (value, digits = 2) => Number.isFinite(value) ? Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits }) : "—";

const EXPLICIT_SECTOR_THEME = new Map(Object.entries({
  ADANIENT: ["Industrials", "Conglomerate / Capex"],
  ADANIPORTS: ["Industrials", "Ports / Logistics"],
  ADANIGREEN: ["Utilities", "Renewables"],
  ADANIENSOL: ["Utilities", "Power Transmission"],
  ANGELONE: ["Financials", "Capital Markets"],
  APOLLO: ["Materials", "Specialty Materials"],
  ATGL: ["Utilities", "Gas Distribution"],
  CENTUM: ["Information Technology", "EMS / Defence Electronics"],
  DEEPAKFERT: ["Materials", "Chemicals / Fertilizers"],
  DREDGECORP: ["Industrials", "Ports / Dredging"],
  FINCABLES: ["Industrials", "Cables / Electrification"],
  HBLENGINE: ["Industrials", "Railway / Defence Electronics"],
  HONASA: ["Consumer Staples", "Beauty / Consumer Brands"],
  IDEA: ["Communication Services", "Telecom"],
  IDEAFORGE: ["Industrials", "Defence / Drones"],
  IXIGO: ["Consumer Discretionary", "Travel Tech"],
  LAURUSLABS: ["Health Care", "Pharma / CDMO"],
  LLOYDSENT: ["Industrials", "Engineering / Capital Goods"],
  MOTHERSON: ["Consumer Discretionary", "Auto Components"],
  NAVINFLUOR: ["Materials", "Specialty Chemicals"],
  NETWEB: ["Information Technology", "AI Infrastructure"],
  PRUDENT: ["Financials", "Wealth / Distribution"],
  RAIN: ["Materials", "Carbon / Chemicals"],
  RATEGain: ["Information Technology", "Travel SaaS"],
  RATEGAIN: ["Information Technology", "Travel SaaS"],
  SANSERA: ["Consumer Discretionary", "Auto Components"],
  SASKEN: ["Information Technology", "Engineering R&D"],
  SATIN: ["Financials", "Microfinance"],
  SYRMA: ["Information Technology", "EMS / Electronics"],
  TATACOMM: ["Communication Services", "Digital Infrastructure"],
  THERMAX: ["Industrials", "Capital Goods / Energy"],
  THYROCARE: ["Health Care", "Diagnostics"],
  TIINDIA: ["Consumer Discretionary", "Auto Components"],
  TVSMOTOR: ["Consumer Discretionary", "Two-Wheelers"],
  VIMTALABS: ["Health Care", "Testing / Diagnostics"],
  ZEEL: ["Communication Services", "Media"]
}));

function emaSeries(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let ema = mean(values.slice(0, period));
  out[period - 1] = ema;
  for (let i = period; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function smaSeries(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = values.slice(0, period).reduce((a, b) => a + b, 0);
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i += 1) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

function atr(bars, period = 14) {
  if (bars.length <= period) return null;
  const values = [];
  for (let i = 1; i < bars.length; i += 1) {
    values.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    ));
  }
  return mean(values.slice(-period));
}

function rmv(bars, period) {
  const xs = bars.slice(-period);
  if (xs.length < period) return null;
  const avg = mean(xs.map(x => x.close));
  return avg ? (Math.max(...xs.map(x => x.high)) - Math.min(...xs.map(x => x.low))) / avg * 100 : null;
}

function adr(bars, period = 20) {
  const xs = bars.slice(-period);
  if (xs.length < Math.min(period, 10)) return null;
  return mean(xs.map(x => x.high - x.low));
}

function multiYearHighLayer(bars) {
  const supported = MYH_DEFINITIONS.find(definition => bars.length >= definition.sessions);
  if (!supported) {
    return {
      myh_label: "MYH_HISTORY_INSUFFICIENT",
      myh_state: "NOT_AVAILABLE",
      myh_level: null,
      myh_gap_pct: null,
      myh_lookback_sessions: bars.length
    };
  }
  const window = bars.slice(-supported.sessions);
  const prior = window.slice(0, -1);
  const lastBar = latest(window);
  const priorHigh = Math.max(...prior.map(x => x.high));
  const windowHigh = Math.max(...window.map(x => x.high));
  const gap = priorHigh > 0 ? (priorHigh - lastBar.close) / priorHigh * 100 : null;
  let state = "NOT_AVAILABLE";
  if (Number.isFinite(priorHigh) && lastBar.close >= priorHigh) state = "MYH_BREAKOUT_CONFIRMED";
  else if (Number.isFinite(priorHigh) && lastBar.high >= priorHigh) state = "MYH_BREAKOUT_FAILED";
  else if (Number.isFinite(gap) && gap <= 3) state = "MYH_NEAR_HIGH";
  return {
    myh_label: supported.label,
    myh_state: state,
    myh_level: round(priorHigh),
    myh_gap_pct: round(gap),
    myh_lookback_sessions: supported.sessions,
    myh_window_high: round(windowHigh)
  };
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

function assignPercentiles(rows, source, target, low = 1, high = 99) {
  const valid = rows.filter(row => Number.isFinite(row[source])).sort((a, b) => a[source] - b[source]);
  if (!valid.length) return;
  let i = 0;
  while (i < valid.length) {
    let j = i + 1;
    while (j < valid.length && valid[j][source] === valid[i][source]) j += 1;
    const rank = (i + 1 + j) / 2;
    const value = valid.length === 1 ? high : low + (high - low) * (rank - 1) / (valid.length - 1);
    for (let k = i; k < j; k += 1) valid[k][target] = round(value, 0);
    i = j;
  }
}

function alignedSeries(bars, benchmark) {
  const bm = new Map(benchmark.map(x => [x.date, x.close]));
  const aligned = [];
  for (const bar of bars) {
    const bmClose = bm.get(bar.date);
    if (bmClose > 0 && bar.close > 0) aligned.push({ date: bar.date, close: bar.close, rs: bar.close / bmClose });
  }
  return aligned;
}

function rrg(values) {
  if (values.length >= 126) {
    const ratio = values.at(-1) / values.at(-64) * 100;
    const priorRatio = values.at(-22) / values.at(-85) * 100;
    const momentum = ratio / priorRatio * 100;
    const quadrant = ratio >= 100 && momentum >= 100 ? "LEADING" : ratio >= 100 ? "WEAKENING" : momentum >= 100 ? "IMPROVING" : "LAGGING";
    return { quadrant, ratio: round(ratio), momentum: round(momentum) };
  }
  if (values.length >= 21) {
    const shortRatio = values.at(-1) / values.at(-21) * 100;
    const shortMomentum = values.length >= 11 ? shortRatio / (values.at(-11) / values.at(-21) * 100) * 100 : null;
    return {
      quadrant: shortRatio >= 100 && shortMomentum >= 100 ? "IMPROVING" : shortRatio >= 100 ? "WEAKENING" : shortMomentum >= 100 ? "IMPROVING" : "LAGGING",
      ratio: round(shortRatio),
      momentum: round(shortMomentum)
    };
  }
  return { quadrant: "NOT_AVAILABLE", ratio: null, momentum: null };
}

function rs21State(rsValues) {
  const ema21 = emaSeries(rsValues, 21);
  const i = rsValues.length - 1;
  if (i < 21 || !Number.isFinite(ema21[i])) return "NOT_AVAILABLE";
  const above = rsValues[i] >= ema21[i];
  const crossedAgo = [0, 1, 2, 3, 4, 5].find(ago => {
    const j = i - ago;
    return j > 0 && Number.isFinite(ema21[j - 1]) && rsValues[j] >= ema21[j] && rsValues[j - 1] < ema21[j - 1];
  });
  const hold3 = [0, 1, 2].every(ago => Number.isFinite(ema21[i - ago]) && rsValues[i - ago] >= ema21[i - ago]);
  const slope5 = i >= 5 ? rsValues[i] / rsValues[i - 5] - 1 : null;
  if (crossedAgo !== undefined) return `RS21_RECLAIM_${crossedAgo}D`;
  if (hold3 && slope5 > 0) return "RS21_ACCELERATING";
  if (hold3) return "RS21_HOLDING";
  return above ? "RS21_ABOVE_UNSTABLE" : "RS21_BELOW_WARNING";
}

function classify(row) {
  if (row.axm_risk === "AXM_NO_CHASE" || row.extension_ema21_pct > 12 || row.ve2_signature_label === "VE2_CLIMAX_VOLUME_WARNING") return "NO_CHASE_RISK";
  if (row.basepivot_false_breakout_status === "BASEPIVOT_FALSE_BREAK_FILTERED" || row.ve2_signature_label === "VE2_DISTRIBUTION_CLUSTER_WARNING") return "DEVELOPING_RS_LEADER";
  if (row.trigger_gap_pct >= -0.75 && row.trigger_gap_pct <= 1.5 && row.entry_risk_pct <= 10 && row.basepivot_quality !== "BASEPIVOT_QUALITY_NONE") return "TRIGGER_READY";
  if (row.rsnh && row.trigger_gap_pct > 0 && row.trigger_gap_pct <= 5) return "RSNH_WATCH";
  if (row.compression && row.trigger_gap_pct >= 0 && row.trigger_gap_pct <= 7 && row.ve2_distribution_label !== "DISTRIBUTION_CLUSTER") return "COMPRESSION";
  if (row.pbx_valid_pullback && row.entry_risk_pct <= 10) return "PULLBACK";
  if ((row.inside_bar || row.rmvp_status === "RMVP_ACTIVE") && row.trigger_gap_pct >= -1 && row.trigger_gap_pct <= 7) return "RMVP_EARLY_ENTRY";
  if (row.rs21_state?.includes("RECLAIM") && row.entry_risk_pct <= 10) return "RS21_RECLAIM_ENTRY";
  return row.rs_rating >= 85 || row.rs_short_rating >= 85 ? "DEVELOPING_RS_LEADER" : null;
}

function entryTier(entryRiskPct, entryRiskAtr) {
  if (!Number.isFinite(entryRiskPct)) return "WATCH_FOR_TIGHTER_SHELF";
  if (entryRiskPct <= 7) return "STANDARD_ENTRY";
  if (entryRiskPct <= 10 && entryRiskAtr <= 1.25) return "VOLATILITY_ADJUSTED_STARTER";
  return "WATCH_FOR_TIGHTER_SHELF";
}

function liquidityLabel(pct, addv) {
  if (!Number.isFinite(addv)) return "DATA_REPAIR";
  if (addv < LIQUIDITY_MIN_INR) return pct >= 70 ? "HIGH_BUT_BELOW_MIN_INR" : "THIN_CAUTION";
  if (pct >= 70) return "HIGH";
  if (pct >= 40) return "ADEQUATE";
  if (pct >= 15) return "THIN";
  return "VERY_THIN";
}

function deliveryLabel(value) {
  if (!Number.isFinite(value) || value <= 0) return "DELIVERY_NOT_AVAILABLE";
  if (value >= 65) return "DELIVERY_VERY_HIGH";
  if (value >= 50) return "DELIVERY_HIGH";
  if (value >= 35) return "DELIVERY_NORMAL";
  if (value >= 20) return "DELIVERY_LOW";
  return "DELIVERY_VERY_LOW";
}

function inferSectorTheme(symbol, name = "") {
  const explicit = EXPLICIT_SECTOR_THEME.get(symbol);
  if (explicit) return {
    gics_sector: explicit[0],
    aurora_theme: explicit[1],
    sector_mapping_source: "AURORA_EXPLICIT_INDIA_THEME_MAP",
    sector_mapping_confidence: "HIGH"
  };
  const text = `${symbol} ${name}`.toUpperCase();
  const rules = [
    [/BANK|FINANCE|CAPITAL|SECURIT|BROKING|WEALTH|CREDIT|MICROFIN|INSURANCE|LIFE|ASSET|AMC|EXCHANGE/, "Financials", "Financials / Capital Markets"],
    [/PHARMA|LAB|HEALTH|HOSPITAL|DIAGNOSTIC|LIFE SCI|BIO|MEDIC|THERAPEUT|VACCINE/, "Health Care", "Health Care"],
    [/SOFT|TECH|INFOTECH|DIGITAL|DATA|COMPUT|NETWORK|ELECTRON|EMS|SEMICON|CLOUD|AI|SYSTEMS/, "Information Technology", "Technology / Electronics"],
    [/MOTOR|AUTO|TYRE|TIRE|VEHICLE|WHEEL|COMPONENT|FORG|GEAR|BEARING|TRACTOR/, "Consumer Discretionary", "Auto / Auto Ancillary"],
    [/HOTEL|TRAVEL|TOUR|AIR|RETAIL|FASHION|FOOTWEAR|JEWEL|GEMS|TEXTILE|APPAREL|CONSUMER/, "Consumer Discretionary", "Consumer Discretionary"],
    [/FOOD|FMCG|BEVERAGE|DAIRY|AGRO|SUGAR|TEA|COFFEE|TOBACCO|CARE/, "Consumer Staples", "Consumer Staples"],
    [/POWER|ENERGY|GREEN|RENEW|SOLAR|WIND|GRID|GAS|TRANSMISSION|UTILITY/, "Utilities", "Power / Utilities"],
    [/OIL|PETRO|REFIN|COAL|LNG|DRILL|OFFSHORE/, "Energy", "Energy / Oil & Gas"],
    [/CHEM|FERT|CEMENT|STEEL|METAL|MINERAL|CARBON|PAINT|PAPER|PLASTIC|RUBBER|GLASS|MATERIAL/, "Materials", "Materials / Commodities"],
    [/REALTY|REAL ESTATE|REIT|PROPERTY|DEVELOP/, "Real Estate", "Real Estate"],
    [/PORT|LOGISTIC|RAIL|WAGON|SHIP|DEFEN|AERO|ENGINEER|INFRA|CONSTRUCT|CAPITAL|MACHINE|ELECTRICAL|CABLE|TRANSFORM|INDUSTR/, "Industrials", "Industrials / Capex"],
    [/MEDIA|ENTERTAIN|TELECOM|COMMUNICATION|BROADCAST|CABLE TV/, "Communication Services", "Communication Services"]
  ];
  for (const [pattern, sector, theme] of rules) {
    if (pattern.test(text)) return {
      gics_sector: sector,
      aurora_theme: theme,
      sector_mapping_source: "AURORA_NAME_KEYWORD_MAP",
      sector_mapping_confidence: "MEDIUM"
    };
  }
  return {
    gics_sector: "UNMAPPED_REVIEW",
    aurora_theme: "UNMAPPED_REVIEW",
    sector_mapping_source: "NOT_AVAILABLE",
    sector_mapping_confidence: "LOW"
  };
}

function rmvLabel(value) {
  if (!Number.isFinite(value)) return "RMV_UNKNOWN";
  if (value <= 5) return "RMV_ZERO";
  if (value <= 10) return "RMV_VERY_TIGHT";
  if (value <= 15) return "RMV_TIGHT";
  if (value <= 25) return "RMV_NORMAL";
  return "RMV_EXPANDING";
}

function axmLabel(value, bands) {
  if (!Number.isFinite(value)) return "UNKNOWN";
  if (value <= bands[0]) return bands[3][0];
  if (value <= bands[1]) return bands[3][1];
  if (value <= bands[2]) return bands[3][2];
  return bands[3][3];
}

function axmMatrix(price, e10, e21, s50, s200, a14) {
  if (!Number.isFinite(price) || !Number.isFinite(a14) || a14 <= 0) {
    return { axm10: null, axm21: null, axm50: null, axm200: null, axm10_label: "UNKNOWN", axm21_label: "UNKNOWN", axm50_label: "UNKNOWN", axm200_label: "UNKNOWN", axm_risk: "AXM_UNKNOWN" };
  }
  const axm10 = Number.isFinite(e10) ? (price - e10) / a14 : null;
  const axm21 = Number.isFinite(e21) ? (price - e21) / a14 : null;
  const axm50 = Number.isFinite(s50) ? (price - s50) / a14 : null;
  const axm200 = Number.isFinite(s200) ? (price - s200) / a14 : null;
  const axm21Label = axmLabel(axm21, [2, 4, 6, ["AXM21_NORMAL", "AXM21_EXTENDED", "AXM21_HOT", "AXM21_EXTREME"]]);
  const labels = {
    axm10: round(axm10),
    axm21: round(axm21),
    axm50: round(axm50),
    axm200: round(axm200),
    axm10_label: axmLabel(axm10, [1, 2, 3, ["AXM10_NORMAL", "AXM10_STRONG", "AXM10_HOT", "AXM10_VERY_HOT"]]),
    axm21_label: axm21Label,
    axm50_label: axmLabel(axm50, [4, 8, 12, ["AXM50_NORMAL", "AXM50_EXTENDED", "AXM50_VERY_EXTENDED", "AXM50_EXTREME"]]),
    axm200_label: axmLabel(axm200, [8, 16, 24, ["AXM200_NORMAL", "AXM200_EXTENDED", "AXM200_VERY_EXTENDED", "AXM200_EXTREME"]])
  };
  labels.axm_risk = axm21Label === "AXM21_EXTREME" || labels.axm10_label === "AXM10_VERY_HOT" ? "AXM_NO_CHASE" : axm21Label === "AXM21_HOT" ? "AXM_HOT_CAUTION" : "AXM_OK";
  return labels;
}

function closePosition(bar) {
  const range = bar.high - bar.low;
  return range > 0 ? (bar.close - bar.low) / range : 0.5;
}

function volumeSignature(bars, price, trigger, pullbackOk, compression) {
  const lastBar = latest(bars);
  const volumes = bars.map(x => x.volume);
  const avg10 = mean(volumes.slice(-10));
  const avg20 = mean(volumes.slice(-20));
  const avg50 = mean(volumes.slice(-50));
  const rvol20 = avg20 ? lastBar.volume / avg20 : null;
  const dry5 = avg20 ? mean(volumes.slice(-5)) / avg20 : null;
  const dry10 = avg50 ? mean(volumes.slice(-10)) / avg50 : null;
  const closePos = closePosition(lastBar);
  let upVol = 0;
  let downVol = 0;
  for (let i = Math.max(1, bars.length - 20); i < bars.length; i += 1) {
    if (bars[i].close > bars[i - 1].close) upVol += bars[i].volume;
    else if (bars[i].close < bars[i - 1].close) downVol += bars[i].volume;
  }
  const udRatio = downVol > 0 ? upVol / downVol : upVol > 0 ? 9.99 : null;
  let distribution10 = 0;
  let distribution30 = 0;
  for (let i = Math.max(20, bars.length - 30); i < bars.length; i += 1) {
    const windowAvg = mean(bars.slice(i - 20, i).map(x => x.volume));
    const isDistribution = bars[i].close < bars[i - 1].close && windowAvg && bars[i].volume > windowAvg * 1.2 && closePosition(bars[i]) < 0.40;
    if (isDistribution) {
      distribution30 += 1;
      if (i >= bars.length - 10) distribution10 += 1;
    }
  }
  const dryupLabel = dry5 <= 0.50 ? "VOLUME_DRYUP_STRONG" : dry5 <= 0.70 ? "VOLUME_DRYUP_VALID" : dry5 <= 0.90 ? "VOLUME_DRYUP_WEAK" : "NO_VOLUME_DRYUP";
  const udLabel = udRatio >= 1.2 ? "UD_ACCUMULATION" : udRatio >= 0.8 ? "UD_NEUTRAL" : "UD_DISTRIBUTION";
  const distributionLabel = distribution10 === 0 && distribution30 <= 2 ? "DISTRIBUTION_CLEAR" : distribution10 <= 2 || distribution30 <= 4 ? "DISTRIBUTION_PRESENT" : "DISTRIBUTION_CLUSTER";
  const deliveryPct = Number(lastBar.delivery_pct);
  const delivery = deliveryLabel(deliveryPct);
  const deliverySignature = deliveryPct >= 50 && lastBar.close >= bars.at(-2)?.close && closePos >= 0.60
    ? "VE2_DELIVERY_ACCUMULATION_CONFIRM"
    : deliveryPct >= 50 && bars.length >= 2 && lastBar.close < bars.at(-2).close && closePos < 0.40
      ? "VE2_DELIVERY_DISTRIBUTION_WARNING"
      : delivery === "DELIVERY_NOT_AVAILABLE"
        ? "VE2_DELIVERY_NOT_AVAILABLE"
        : "VE2_DELIVERY_NEUTRAL";
  let signature = "VE2_VOLUME_UNKNOWN";
  if (deliverySignature === "VE2_DELIVERY_DISTRIBUTION_WARNING") signature = deliverySignature;
  else if (distributionLabel === "DISTRIBUTION_CLUSTER") signature = "VE2_DISTRIBUTION_CLUSTER_WARNING";
  else if (rvol20 >= 2 && closePos < 0.40) signature = "VE2_CLIMAX_VOLUME_WARNING";
  else if (price >= trigger && rvol20 >= 1.5 && closePos >= 0.60) signature = closePos >= 0.75 && rvol20 >= 2 ? "VE2_BREAKOUT_VOLUME_CONFIRMED_STRONG" : "VE2_BREAKOUT_VOLUME_CONFIRMED";
  else if (price >= trigger * 0.99 && rvol20 >= 1.1 && closePos >= 0.60) signature = "VE2_EARLY_ENTRY_VOLUME_LIFT";
  else if (pullbackOk && rvol20 <= 1.05 && closePos >= 0.50) signature = "VE2_PULLBACK_VOLUME_CONTROLLED";
  else if (compression && dry5 <= 0.60) signature = "VE2_VCP_FINAL_DRYUP";
  else if (deliverySignature === "VE2_DELIVERY_ACCUMULATION_CONFIRM" && udLabel !== "UD_DISTRIBUTION") signature = deliverySignature;
  else if (dry5 <= 0.70) signature = "VE2_BASE_DRYUP_CONFIRMED";
  else if (udLabel === "UD_ACCUMULATION") signature = "VE2_BASE_VOLUME_CONSTRUCTIVE";
  const grade = signature.includes("WARNING") || signature.includes("CLIMAX") || distributionLabel === "DISTRIBUTION_CLUSTER" ? "FAIL" : signature.includes("CONFIRMED_STRONG") || dryupLabel === "VOLUME_DRYUP_STRONG" ? "A" : signature.includes("CONFIRMED") || signature.includes("LIFT") || signature.includes("CONTROLLED") || udLabel === "UD_ACCUMULATION" ? "B" : "C";
  const deliveryBonus = deliverySignature === "VE2_DELIVERY_ACCUMULATION_CONFIRM" ? 6 : deliverySignature === "VE2_DELIVERY_DISTRIBUTION_WARNING" ? -20 : 0;
  const score = clamp((grade === "A" ? 90 : grade === "B" ? 72 : grade === "C" ? 50 : 10) + deliveryBonus, 0, 100);
  return {
    ve2_status: avg20 ? "CALCULATED" : "UNKNOWN",
    ve2_signature_label: signature,
    ve2_pattern_volume_grade: grade,
    ve2_volume_score: score,
    avg_vol_10d: round(avg10, 0),
    avg_vol_20d: round(avg20, 0),
    avg_vol_50d: round(avg50, 0),
    rvol_20d: round(rvol20),
    close_pos: round(closePos),
    vol_dryup_5_20: round(dry5),
    vol_dryup_10_50: round(dry10),
    ve2_dryup_label: dryupLabel,
    ud_ratio_20d: round(udRatio),
    ve2_ud_label: udLabel,
    distribution_cluster_10d: distribution10,
    distribution_cluster_30d: distribution30,
    ve2_distribution_label: distributionLabel,
    delivery_quantity: Number.isFinite(Number(lastBar.delivery_quantity)) ? Number(lastBar.delivery_quantity) : null,
    delivery_pct: Number.isFinite(deliveryPct) && deliveryPct > 0 ? round(deliveryPct) : null,
    delivery_label: delivery,
    ve2_delivery_label: deliverySignature
  };
}

function basePivotLayer(bars, a14, adr20Abs, ve2) {
  const baseWindowLen = Math.min(63, bars.length);
  const baseBars = bars.slice(-baseWindowLen);
  const baseHigh = Math.max(...baseBars.map(x => x.high));
  const baseLow = Math.min(...baseBars.map(x => x.low));
  const baseMean = mean(baseBars.map(x => x.close));
  const baseDepthPct = baseHigh ? (baseHigh - baseLow) / baseHigh * 100 : null;
  const atrPct = a14 && latest(bars).close ? a14 / latest(bars).close * 100 : null;
  const adrPct = adr20Abs && latest(bars).close ? adr20Abs / latest(bars).close * 100 : null;
  const tolerance = Math.max(1.0, 0.25 * (atrPct ?? 0), 0.20 * (adrPct ?? 0), !Number.isFinite(atrPct) && !Number.isFinite(adrPct) ? 1.5 : 0);
  const rightSideLen = Math.min(Math.max(15, Math.floor(baseWindowLen * 0.45)), 35, baseWindowLen);
  const right = baseBars.slice(-rightSideLen);
  const highs = right.map(x => x.high);
  const candidates = [];
  for (let i = 2; i < highs.length - 2; i += 1) {
    if (highs[i] >= Math.max(...highs.slice(i - 2, i)) && highs[i] >= Math.max(...highs.slice(i + 1, i + 3))) candidates.push(highs[i]);
  }
  const pivotCandidates = candidates.length >= 2 ? candidates : highs;
  const topHighs = pivotCandidates.sort((a, b) => b - a).slice(0, Math.min(5, pivotCandidates.length));
  const anchor = median(topHighs);
  const aligned = topHighs.filter(h => Math.abs(h - anchor) / anchor * 100 <= tolerance);
  const pivot = aligned.length >= 2 ? Math.max(...aligned) : Math.max(...topHighs);
  const zoneLow = aligned.length >= 2 ? Math.min(...aligned) : pivot * (1 - tolerance / 100);
  const zoneHigh = aligned.length >= 2 ? Math.max(...aligned) : pivot;
  const rightRangePct = baseMean ? (Math.max(...right.map(x => x.high)) - Math.min(...right.map(x => x.low))) / baseMean * 100 : null;
  const orderly = Number.isFinite(rightRangePct) && Number.isFinite(adrPct) ? rightRangePct <= Math.max(15, 1.5 * adrPct) : true;
  const quality = baseWindowLen >= 15 && aligned.length >= 3 && orderly && !ve2.ve2_signature_label?.includes("DISTRIBUTION") ? "BASEPIVOT_QUALITY_A" : baseWindowLen >= 15 && aligned.length >= 2 && !ve2.ve2_signature_label?.includes("DISTRIBUTION") ? "BASEPIVOT_QUALITY_B" : pivot ? "BASEPIVOT_QUALITY_C" : "BASEPIVOT_QUALITY_NONE";
  const lastBar = latest(bars);
  const failedProbe = lastBar.high > pivot && lastBar.close < pivot && closePosition(lastBar) < 0.50;
  const progressAdr = adr20Abs ? (Math.max(...bars.slice(-5).map(x => x.high)) - pivot) / adr20Abs : null;
  const status = failedProbe ? "BASEPIVOT_FAILED_PROBE" : lastBar.close > pivot && progressAdr >= 2 ? "BASEPIVOT_BREAKOUT_PROGRESS_CONFIRMED" : lastBar.close > pivot ? "BASEPIVOT_ACTIVE_AFTER_WEAK_BREAKOUT" : "BASEPIVOT_ACTIVE_BELOW_TRIGGER";
  return {
    basepivot_price: round(pivot),
    basepivot_zone_low: round(zoneLow),
    basepivot_zone_high: round(zoneHigh),
    basepivot_duration_days: baseWindowLen,
    basepivot_depth_pct: round(baseDepthPct),
    basepivot_depth_adr_units: round(Number.isFinite(baseDepthPct) && Number.isFinite(adrPct) && adrPct > 0 ? baseDepthPct / adrPct : null),
    basepivot_quality: quality,
    basepivot_status: status,
    basepivot_false_breakout_status: failedProbe ? "BASEPIVOT_FALSE_BREAK_FILTERED" : "BASEPIVOT_OK",
    right_side_range_pct: round(rightRangePct)
  };
}

function rmvpLayer(bars, rmv5, rmv15, basePivot, ve2) {
  const lastBar = latest(bars);
  const shelf = bars.slice(-Math.min(8, bars.length));
  const shelfHigh = Math.max(...shelf.slice(0, -1).map(x => x.high));
  const shelfLow = Math.min(...shelf.map(x => x.low));
  const rmvp = Number.isFinite(shelfHigh) ? shelfHigh * 1.001 : null;
  const tight = Number.isFinite(rmv5) && Number.isFinite(rmv15) && rmv5 <= Math.min(8, rmv15);
  const near = Number.isFinite(rmvp) && lastBar.close >= rmvp * 0.97 && lastBar.close <= rmvp * 1.02;
  const quality = tight && near && ["VE2_VCP_FINAL_DRYUP", "VE2_BASE_DRYUP_CONFIRMED", "VE2_EARLY_ENTRY_VOLUME_LIFT"].includes(ve2.ve2_signature_label) ? "RMVP_QUALITY_A" : tight && near ? "RMVP_QUALITY_B" : tight ? "RMVP_QUALITY_C" : "RMVP_QUALITY_NONE";
  const status = quality === "RMVP_QUALITY_A" || quality === "RMVP_QUALITY_B" ? "RMVP_ACTIVE" : quality === "RMVP_QUALITY_C" ? "RMVP_DEVELOPING" : "RMVP_NONE";
  return {
    rmvp_price: round(rmvp),
    rmvp_support: round(shelfLow * 0.995),
    rmvp_quality: quality,
    rmvp_status: status,
    rmvp_distance_pct: round(Number.isFinite(rmvp) ? (rmvp - lastBar.close) / rmvp * 100 : null)
  };
}

function pbxLayer(bars, price, e10, e21, s50, ve2) {
  const lookback = bars.slice(-Math.min(63, bars.length));
  const high = Math.max(...lookback.map(x => x.high));
  const highIdx = lookback.findLastIndex(x => x.high === high);
  const duration = highIdx >= 0 ? lookback.length - 1 - highIdx : null;
  const depth = high ? (high - price) / high * 100 : null;
  const depthLabel = depth < 8 ? "PBX_TOO_SHALLOW" : depth <= 15 ? "PBX_VALID" : depth <= 20 ? "PBX_IDEAL" : depth <= 30 ? "PBX_DEEP" : "PBX_EXCESSIVE";
  const durationLabel = duration <= 2 ? "PBX_TOO_FAST" : duration <= 8 ? "PBX_NORMAL" : duration <= 15 ? "PBX_MATURE" : "PBX_STALE";
  const lastBar = latest(bars);
  const touch = Number.isFinite(e10) && lastBar.low <= e10 && lastBar.close >= e10 ? "PBX_10EMA_DEFENSE" : Number.isFinite(e21) && lastBar.low <= e21 && lastBar.close >= e21 ? "PBX_21EMA_DEFENSE" : Number.isFinite(s50) && lastBar.low <= s50 && lastBar.close >= s50 ? "PBX_50SMA_DEFENSE" : "PBX_NO_MA_DEFENSE";
  const reversal = closePosition(lastBar) >= 0.60 && (bars.length < 2 || lastBar.close >= bars.at(-2).close) ? "PBX_REVERSAL_OK" : "PBX_REVERSAL_UNCONFIRMED";
  const failure = lastBar.close < e21 && ve2.ve2_distribution_label !== "DISTRIBUTION_CLEAR" ? "PBX_FAILURE_CLUSTER" : "PBX_FAILURE_CLEAR";
  const score = clamp(
    (depthLabel === "PBX_IDEAL" ? 95 : depthLabel === "PBX_VALID" ? 82 : depthLabel === "PBX_DEEP" ? 65 : depthLabel === "PBX_TOO_SHALLOW" ? 45 : 10) * 0.35 +
    (durationLabel === "PBX_NORMAL" ? 90 : durationLabel === "PBX_MATURE" ? 75 : durationLabel === "PBX_TOO_FAST" ? 45 : 30) * 0.20 +
    (touch === "PBX_10EMA_DEFENSE" ? 85 : touch === "PBX_21EMA_DEFENSE" ? 90 : touch === "PBX_50SMA_DEFENSE" ? 70 : 25) * 0.20 +
    (reversal === "PBX_REVERSAL_OK" ? 85 : 35) * 0.15 +
    (failure === "PBX_FAILURE_CLEAR" ? 80 : 5) * 0.10
  );
  return {
    pbx_depth_pct: round(depth),
    pbx_depth_label: depthLabel,
    pbx_duration_days: duration,
    pbx_duration_label: durationLabel,
    pbx_ma_touch_label: touch,
    pbx_reversal_label: reversal,
    pbx_failure_label: failure,
    pbx_score: round(score),
    pbx_valid_pullback: ["PBX_VALID", "PBX_IDEAL", "PBX_DEEP"].includes(depthLabel) && ["PBX_NORMAL", "PBX_MATURE"].includes(durationLabel) && touch !== "PBX_NO_MA_DEFENSE" && failure === "PBX_FAILURE_CLEAR"
  };
}

function estimateBaseStageCount(bars) {
  const xs = bars.slice(-Math.min(252, bars.length));
  if (xs.length < 80) return 1;
  let count = 0;
  for (let end = xs.length; end >= 42; end -= 42) {
    const start = Math.max(0, end - 63);
    const window = xs.slice(start, end);
    if (window.length < 30) continue;
    const high = Math.max(...window.map(x => x.high));
    const low = Math.min(...window.map(x => x.low));
    const depth = high > 0 ? (high - low) / high * 100 : null;
    const lastClose = window.at(-1).close;
    const closesNearTopHalf = high > low && lastClose >= low + (high - low) * 0.50;
    const baseLike = Number.isFinite(depth) && depth >= 6 && depth <= 35 && closesNearTopHalf;
    if (baseLike) count += 1;
  }
  return Math.max(1, Math.min(4, count || 1));
}

function patternContext(bars, row, sessionDate) {
  const stageCount = estimateBaseStageCount(bars);
  const stageRisk = stageCount <= 1 ? "BASE_1_EARLY" : stageCount === 2 ? "BASE_2_VALID" : stageCount === 3 ? "BASE_3_CAUTION" : "BASE_4_LATE_STAGE_RISK";
  const listedAt = row.listing_date ? Date.parse(row.listing_date) : NaN;
  const sessionAt = Date.parse(sessionDate);
  const listedDays = Number.isFinite(listedAt) && Number.isFinite(sessionAt) ? (sessionAt - listedAt) / 86_400_000 : null;
  const ipoStyle = row.adaptive_history || (Number.isFinite(listedDays) && listedDays >= 0 && listedDays <= 365);
  let proxy = "NO_CLEAR_BASE";
  if (ipoStyle && row.basepivot_quality !== "BASEPIVOT_QUALITY_NONE") proxy = "IPO_BASE";
  else if (row.compression && ["VOLUME_DRYUP_STRONG", "VOLUME_DRYUP_VALID"].includes(row.ve2_dryup_label)) proxy = "VCP_STYLE";
  else if (row.basepivot_depth_pct <= 15 && row.basepivot_duration_days >= 20 && ["BASEPIVOT_QUALITY_A", "BASEPIVOT_QUALITY_B"].includes(row.basepivot_quality)) proxy = "FLAT_BASE_SHELF";
  else if (row.pbx_valid_pullback) proxy = "PULLBACK_BASE";
  else if (row.basepivot_depth_pct <= 20 && stageCount >= 2 && row.compression) proxy = "BASE_ON_BASE_POSSIBLE";
  else if (row.basepivot_depth_pct >= 15 && row.basepivot_depth_pct <= 35 && row.basepivot_duration_days >= 35 && row.trigger_gap_pct <= 10) proxy = "CUP_HANDLE_POSSIBLE";
  else if (row.basepivot_depth_pct >= 20 && row.basepivot_depth_pct <= 40 && row.basepivot_duration_days >= 35) proxy = "DOUBLE_BOTTOM_POSSIBLE";
  const note = proxy === "NO_CLEAR_BASE"
    ? `${stageRisk}; no clear base proxy`
    : `${stageRisk}; ${proxy.replaceAll("_", " ").toLowerCase()}`;
  return {
    base_stage_count: stageCount,
    base_stage_risk: stageRisk,
    pattern_proxy: proxy,
    pattern_note: note
  };
}

function finalBucket(row) {
  if (row.setup_label === "NO_CHASE_RISK") return "NO_CHASE";
  if (row.setup_label === "TRIGGER_READY") return "TRIGGER_READY";
  if (["RS21_RECLAIM_ENTRY", "RMVP_EARLY_ENTRY"].includes(row.setup_label)) return "EARLY_ENTRY_WATCH";
  if (row.setup_label === "PULLBACK") return "PULLBACK_WATCH";
  if (row.setup_label === "RSNH_WATCH") return "RSNH_WATCH_ONLY";
  if (row.setup_label === "COMPRESSION") return "EARLY_ENTRY_WATCH";
  if (row.setup_label === "DEVELOPING_RS_LEADER") return "RSNH_WATCH_ONLY";
  return "REPAIR_WATCH";
}

function riskBucket(row) {
  const risk = row.entry_risk_pct;
  if (!Number.isFinite(risk)) return "RISK_UNKNOWN";
  if (risk < 2) return "RISK_TIGHT";
  if (risk <= 4) return "RISK_IDEAL";
  if (risk <= 7) return "RISK_WIDE";
  return "RISK_TOO_WIDE";
}

function triggerStatus(row) {
  if (!Number.isFinite(row.trigger) || !Number.isFinite(row.price)) return "TRIGGER_UNKNOWN";
  const triggerGap = row.trigger_gap_pct;
  if (row.price >= row.trigger * 1.03) return "ABOVE_TRIGGER_EXTENDED_WAIT_RETEST";
  if (row.price >= row.trigger) return "ABOVE_TRIGGER_CLOSE_ACCEPTED";
  if (Number.isFinite(row.day_high) && row.day_high >= row.trigger) return "TRIGGER_TOUCHED_NO_CLOSE_ACCEPTANCE";
  if (triggerGap >= 0 && triggerGap <= 1.5) return "NEAR_TRIGGER";
  if (triggerGap > 1.5 && triggerGap <= 5) return "BELOW_TRIGGER_WATCH";
  return "AWAY_FROM_TRIGGER_REPAIR";
}

function freshExecutionCandidate(row) {
  return Number.isFinite(row.trigger_gap_pct)
    && row.trigger_gap_pct >= -3
    && row.trigger_gap_pct <= 3
    && row.trigger_status !== "ABOVE_TRIGGER_EXTENDED_WAIT_RETEST"
    && row.trigger_status !== "TRIGGER_TOUCHED_NO_CLOSE_ACCEPTANCE"
    && row.final_bucket !== "RSNH_WATCH_ONLY"
    && row.final_bucket !== "REPAIR_WATCH";
}

function weeklyScore(row, marketContext) {
  const technical = clamp(((row.leadership_score ?? 0) * 0.55 + (row.tactical_score ?? 0) * 0.45) / 85 * 100);
  const rs = row.rs_rating ?? ({ PASS: 90, PARTIAL: 70, FAIL: 35 }[row.rs_trifecta_label] ?? 40);
  const setup = { TRADE_READY: 100, TRIGGER_READY: 92, EARLY_ENTRY_WATCH: 84, PULLBACK_WATCH: 78, RSNH_WATCH_ONLY: 64, REPAIR_WATCH: 48, NO_CHASE: 35, PROTECT_PROFIT_REVIEW: 20, AVOID_FRESH_LONG: 0 }[row.final_bucket] ?? 40;
  const rmvComponent = { RMV_ZERO: 100, RMV_VERY_TIGHT: 90, RMV_TIGHT: 75, RMV_NORMAL: 50, RMV_EXPANDING: 20, RMV_UNKNOWN: 40 }[row.rmv_tight_label] ?? 40;
  const bpxComponent = { BASEPIVOT_QUALITY_A: 94, BASEPIVOT_QUALITY_B: 78, BASEPIVOT_QUALITY_C: 55, BASEPIVOT_QUALITY_NONE: 20 }[row.basepivot_quality] ?? 40;
  const pbxComponent = row.pbx_valid_pullback ? row.pbx_score : 45;
  const ve2Component = row.ve2_volume_score ?? 45;
  const risk = { RISK_IDEAL: 100, RISK_TIGHT: 80, RISK_WIDE: 45, RISK_TOO_WIDE: 0, RISK_UNKNOWN: 35 }[row.risk_bucket] ?? 35;
  const liquidity = row.addv20_inr > 0 ? clamp((Math.log10(row.addv20_inr) - Math.log10(LIQUIDITY_MIN_INR)) / (Math.log10(4_000_000_000) - Math.log10(LIQUIDITY_MIN_INR)) * 100) : 35;
  const theme = { LEADING: 88, IMPROVING: 78, WEAKENING: 52, LAGGING: 35, NOT_AVAILABLE: 45 }[row.rrg.quadrant] ?? 45;
  const power = row.day_change_pct >= 5 && row.addv20_inr >= LIQUIDITY_MIN_INR ? 85 : row.day_change_pct >= 2 ? 65 : 45;
  const market = clamp((marketContext.market_dimmer ?? 0) / 5 * 100);
  return round(0.14 * technical + 0.13 * rs + 0.12 * setup + 0.10 * theme + 0.09 * rmvComponent + 0.08 * bpxComponent + 0.07 * pbxComponent + 0.07 * ve2Component + 0.08 * risk + 0.06 * liquidity + 0.03 * power + 0.03 * market);
}

function weeklyTier(row, marketContext) {
  if (row.final_bucket === "NO_CHASE") return "WEEKLY_CORE";
  if (row.final_bucket === "REPAIR_WATCH") return "WEEKLY_REPAIR_ONLY";
  if (row.final_bucket === "PULLBACK_WATCH") return "WEEKLY_PULLBACK_RETEST";
  if (row.weekly_watchlist_score >= 70 && row.trigger && row.entry_stop && row.entry_risk_pct <= 7 && ["TRIGGER_READY", "EARLY_ENTRY_WATCH", "PULLBACK_WATCH", "RSNH_WATCH_ONLY"].includes(row.final_bucket)) return "WEEKLY_FOCUS";
  return "WEEKLY_CORE";
}

function executionFocusScore(row, marketContext) {
  const triggerProximity = Math.max(0, 100 - Math.abs(row.trigger_gap_pct ?? 99) / 3 * 100);
  const rs = row.rs_rating ?? 40;
  const setupTightness = Math.max(
    { RMV_ZERO: 100, RMV_VERY_TIGHT: 90, RMV_TIGHT: 75, RMV_NORMAL: 50, RMV_EXPANDING: 20, RMV_UNKNOWN: 40 }[row.rmv_tight_label] ?? 40,
    row.compression ? 90 : 45
  );
  const structure = Math.max(
    { BASEPIVOT_QUALITY_A: 94, BASEPIVOT_QUALITY_B: 78, BASEPIVOT_QUALITY_C: 55, BASEPIVOT_QUALITY_NONE: 20 }[row.basepivot_quality] ?? 40,
    { RMVP_QUALITY_A: 92, RMVP_QUALITY_B: 78, RMVP_QUALITY_C: 56, RMVP_QUALITY_NONE: 20 }[row.rmvp_quality] ?? 30
  );
  const volume = row.ve2_volume_score ?? 45;
  const theme = { LEADING: 88, IMPROVING: 78, WEAKENING: 52, LAGGING: 35, NOT_AVAILABLE: 45 }[row.rrg.quadrant] ?? 45;
  const risk = { RISK_IDEAL: 100, RISK_TIGHT: 70, RISK_WIDE: 40, RISK_TOO_WIDE: 0, RISK_UNKNOWN: 35 }[row.risk_bucket] ?? 35;
  const permission = { TRADE_ALLOWED: 100, SELECTIVE_ONLY: 75, TRANSITION_MODE: 50, WATCHLIST_ONLY: 25, DEFENSE_MODE: 0, MARKET_STATE_UNKNOWN: 25 }[marketContext.final_market_permission] ?? 25;
  return round(0.20 * triggerProximity + 0.18 * rs + 0.16 * setupTightness + 0.14 * structure + 0.10 * volume + 0.10 * theme + 0.07 * risk + 0.05 * permission);
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, payload) {
  await writeFile(`${path}.tmp`, JSON.stringify(payload, null, 2));
  await rename(`${path}.tmp`, path);
}

async function loadFallbackDecisionPack() {
  for (const file of ["india-fallback-decision-pack.json", "india-provider-fallback-decision-pack.json"]) {
    try {
      return await loadJson(resolve(dataRoot, file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function blockScan(status, details) {
  const fallbackDecisionPack = await loadFallbackDecisionPack();
  const report = {
    generated_at: new Date().toISOString(),
    status,
    expected_completed_session: expectedSession,
    provider_route: INDIA_PROVIDER_ROUTE,
    ...details
  };
  if (fallbackDecisionPack) report.fallback_decision_pack = fallbackDecisionPack;
  await writeJsonAtomic(scanPath, report);
  console.error(JSON.stringify({ status, scan: scanPath, ...details }, null, 2));
  process.exit(1);
}

async function indexFreshnessAudit() {
  const records = [];
  for (const file of (await readdir(indexRoot)).filter(x => x.endsWith(".json")).sort()) {
    records.push({ record: await loadJson(resolve(indexRoot, file)) });
  }
  return auditIndexRecords(records, { expectedSession, expectedCount: 18 });
}

const indexAudit = await indexFreshnessAudit();
if (indexAudit.stale_count) {
  await blockScan("DATA_STALE_INDEX_BLOCKED", {
    latest_index_data_as_of: indexAudit.latest_index_data_as_of,
    stale_indices: indexAudit.stale_indices
  });
}

function buildUniverseLookup(universe) {
  const bySymbol = new Map();
  const byIsin = new Map();
  for (const company of universe?.companies || []) {
    for (const listing of company.listings || []) {
      const item = {
        company_name: listing.name || company.name || listing.symbol,
        listing_date: listing.listing_date || null,
        isin: listing.isin || company.isin || null
      };
      bySymbol.set(`${listing.exchange}__${listing.symbol}`, item);
      if (item.isin) byIsin.set(item.isin, item);
    }
  }
  return { bySymbol, byIsin };
}

const benchmarkRecord = await loadJson(resolve(indexRoot, "NIFTY500.json"));
const universeLookup = buildUniverseLookup(await loadJson(universePath).catch(() => ({ companies: [] })));
const benchmark = benchmarkRecord.bars.map(x => ({ date: x.date, close: x.adjusted_close ?? x.close }));
const benchmarkCloses = benchmark.map(x => x.close);
const files = (await readdir(cacheRoot)).filter(x => x.endsWith(".json"));

const featureRows = [];
const rows = [];
const rejected = [];
for (const file of files) {
  const record = await loadJson(resolve(cacheRoot, file));
  const series = record.series || "UNKNOWN";
  const listingMeta = universeLookup.bySymbol.get(`${record.exchange}__${record.symbol}`) || universeLookup.byIsin.get(record.isin) || {};
  const companyName = listingMeta.company_name || record.name || record.symbol;
  const sectorTheme = inferSectorTheme(record.symbol, companyName);
  const isNseEquity = record.exchange === "NSE" && NSE_EQUITY_SERIES.has(series);
  const isBseEquity = record.exchange === "BSE" && BSE_EQUITY_GROUPS.has(series);
  if (!isNseEquity && !isBseEquity) {
    rejected.push({ exchange: record.exchange, symbol: record.symbol, reason: "NON_EQUITY_SERIES", series, next_condition: "Use only equity/SME/restricted-equity routes." });
    continue;
  }
  if (record.data_as_of !== expectedSession) {
    rejected.push({ exchange: record.exchange, symbol: record.symbol, reason: "STALE_LATEST_BAR", series, data_as_of: record.data_as_of, next_condition: `Append ${expectedSession} completed bar.` });
    continue;
  }
  const bars = record.bars
    .map(x => ({
      date: x.date,
      open: x.adjusted_open ?? x.open,
      high: x.adjusted_high ?? x.high,
      low: x.adjusted_low ?? x.low,
      close: x.adjusted_close ?? x.close,
      volume: x.adjusted_volume ?? x.volume,
      turnover: x.turnover ?? ((x.adjusted_close ?? x.close) * (x.adjusted_volume ?? x.volume)),
      trades: x.trades ?? 0,
      delivery_quantity: x.delivery_quantity ?? null,
      delivery_pct: x.delivery_pct ?? null
    }))
    .filter(x => x.date && [x.open, x.high, x.low, x.close, x.volume].every(Number.isFinite));
  const minimumBars = record.exchange === "BSE" ? 21 : 63;
  if (bars.length < minimumBars) {
    rejected.push({ exchange: record.exchange, symbol: record.symbol, reason: "INSUFFICIENT_SCAN_HISTORY", series, rows: bars.length, next_condition: `Need ${minimumBars}+ bars for adaptive scan.` });
    continue;
  }
  const aligned = alignedSeries(bars, benchmark);
  if (aligned.length < minimumBars) {
    rejected.push({ exchange: record.exchange, symbol: record.symbol, reason: "BENCHMARK_ALIGNMENT_FAIL", series, rows: aligned.length, next_condition: "Repair benchmark/date alignment." });
    continue;
  }
  const closes = bars.map(x => x.close);
  const rsValues = aligned.map(x => x.rs);
  const price = latest(closes);
  const e10 = latest(emaSeries(closes, 10));
  const e21 = latest(emaSeries(closes, 21));
  const e50 = latest(emaSeries(closes, 50));
  const s50 = latest(smaSeries(closes, 50));
  const s200 = latest(smaSeries(closes, 200));
  const a14 = atr(bars);
  const adr20Abs = adr(bars);
  const addv20 = mean(bars.slice(-20).map(x => x.turnover || x.close * x.volume));
  const rmv5 = rmv(bars, 5), rmv15 = rmv(bars, 15), rmv25 = rmv(bars, Math.min(25, bars.length));
  const compression = Number.isFinite(rmv5) && Number.isFinite(rmv15) && Number.isFinite(rmv25) && rmv5 < rmv15 && rmv15 <= rmv25;
  const insideBar = bars.length >= 2 && latest(bars).high <= bars.at(-2).high && latest(bars).low >= bars.at(-2).low;
  const roughPivotLookback = Math.min(21, bars.length - 1);
  const roughPivot = Math.max(...bars.slice(-1 - roughPivotLookback, -1).map(x => x.high));
  const roughTrigger = roughPivot * 1.001;
  const roughPullbackOk = price >= e21 && price <= e21 * 1.04 && (pctChange(closes, 21) ?? 0) > 0;
  const axm = axmMatrix(price, e10, e21, s50, s200, a14);
  const ve2 = volumeSignature(bars, price, roughTrigger, roughPullbackOk, compression);
  const bpx = basePivotLayer(bars, a14, adr20Abs, ve2);
  const rmvp = rmvpLayer(bars, rmv5, rmv15, bpx, ve2);
  const trigger = (bpx.basepivot_price ?? roughPivot) * 1.001;
  const entryReference = Math.max(price, trigger);
  const pbx = pbxLayer(bars, price, e10, e21, s50, ve2);
  const myh = multiYearHighLayer(bars);
  const tacticalSupports = [
    latest(bars).low * 0.995,
    Number.isFinite(e10) ? e10 * 0.995 : null,
    Number.isFinite(e21) && pbx.pbx_ma_touch_label !== "PBX_NO_MA_DEFENSE" ? e21 * 0.995 : null,
    rmvp.rmvp_support,
    bpx.basepivot_zone_low && price > bpx.basepivot_price ? bpx.basepivot_zone_low * 0.995 : null,
    a14 ? entryReference - 0.5 * a14 : null
  ].filter(x => Number.isFinite(x) && x > 0 && x < entryReference);
  const entryStop = tacticalSupports.length ? Math.max(...tacticalSupports) : null;
  const thesisWindow = bars.slice(-Math.min(50, bars.length));
  const thesisStop = Math.min(...thesisWindow.map(x => x.low));
  const entryRiskPct = entryStop < entryReference ? (entryReference - entryStop) / entryReference * 100 : null;
  const entryRiskAtr = a14 && entryStop < entryReference ? (entryReference - entryStop) / a14 : null;
  const thesisRiskPct = thesisStop < entryReference ? (entryReference - thesisStop) / entryReference * 100 : null;
  const rsHighLookback = Math.min(63, rsValues.length);
  const rsHigh = Math.max(...rsValues.slice(-rsHighLookback));
  const rsSlope5 = pctChange(rsValues, 5);
  const row = {
    exchange: record.exchange,
    symbol: record.symbol,
    company_name: companyName,
    series,
    isin: record.isin,
    listing_date: listingMeta.listing_date || null,
    ...sectorTheme,
    provider: record.provider,
    fallback_label: record.fallback_label,
    adjustment_status: record.adjustment_status,
    data_as_of: record.data_as_of,
    rows: bars.length,
    adaptive_history: bars.length < 252,
    price: round(price),
    day_high: round(latest(bars).high),
    day_low: round(latest(bars).low),
    day_change_pct: round(pctChange(closes, 1) * 100),
    addv20_inr: round(addv20, 0),
    rs_1w_rel: round(((1 + (pctChange(closes, 5) ?? 0)) / (1 + (pctChange(benchmarkCloses, 5) ?? 0)) - 1) * 100),
    rs_1m_rel: round(((1 + (pctChange(closes, 21) ?? 0)) / (1 + (pctChange(benchmarkCloses, 21) ?? 0)) - 1) * 100),
    rs_3m_rel: bars.length >= 64 ? round(((1 + (pctChange(closes, 63) ?? 0)) / (1 + (pctChange(benchmarkCloses, 63) ?? 0)) - 1) * 100) : null,
    rs_raw: weightedRsRaw(closes, 0),
    rs_raw_5: weightedRsRaw(closes, 5),
    rs_raw_20: weightedRsRaw(closes, 20),
    rs_short_raw: pctChange(rsValues, Math.min(21, rsValues.length - 1)),
    rs21_state: rs21State(rsValues),
    rsnh: latest(rsValues) >= rsHigh * 0.995,
    rs_high_gap_pct: round((latest(rsValues) / rsHigh - 1) * 100),
    rs_slope5_pct: round(rsSlope5 * 100),
    rrg: rrg(rsValues),
    above_ema21: price >= e21,
    above_ema50: Number.isFinite(e50) ? price >= e50 : null,
    ema21_rising: bars.length >= 26 ? e21 > emaSeries(closes, 21).at(-6) : null,
    extension_ema21_pct: round((price / e21 - 1) * 100),
    ...axm,
    rmv5: round(rmv5), rmv15: round(rmv15), rmv25: round(rmv25),
    compression,
    ...ve2,
    ...bpx,
    ...rmvp,
    ...pbx,
    ...myh,
    inside_bar: insideBar,
    pullback_ok: pbx.pbx_valid_pullback,
    trigger: round(trigger),
    trigger_gap_pct: round((trigger - price) / trigger * 100),
    entry_reference: round(entryReference),
    entry_stop: round(entryStop),
    entry_risk_pct: round(entryRiskPct),
    entry_risk_atr: round(entryRiskAtr),
    thesis_stop: round(thesisStop),
    thesis_risk_pct: round(thesisRiskPct),
    entry_permission: entryTier(entryRiskPct, entryRiskAtr),
    source_lane: record.exchange === "BSE" ? "BSE_EXCLUSIVE_CAUTION" : series === "EQ" ? "NSE_CORE" : "NSE_RESTRICTED_CAUTION"
  };
  Object.assign(row, patternContext(bars, row, expectedSession));
  featureRows.push(row);
}

for (const [source, target] of [
  ["addv20_inr", "liquidity_pct"],
  ["rs_1w_rel", "rs_1w_pct"],
  ["rs_1m_rel", "rs_1m_pct"],
  ["rs_3m_rel", "rs_3m_pct"],
  ["rs_raw", "rs_rating"],
  ["rs_raw_5", "rs_rating_5d_ago"],
  ["rs_raw_20", "rs_rating_20d_ago"],
  ["rs_short_raw", "rs_short_rating"]
]) assignPercentiles(featureRows, source, target);

const setupScore = { TRIGGER_READY: 100, RS21_RECLAIM_ENTRY: 92, PULLBACK: 88, RMVP_EARLY_ENTRY: 84, COMPRESSION: 80, RSNH_WATCH: 74, DEVELOPING_RS_LEADER: 62, NO_CHASE_RISK: 30 };
const rs21Score = { RS21_RECLAIM_0D: 100, RS21_RECLAIM_1D: 96, RS21_RECLAIM_2D: 92, RS21_RECLAIM_3D: 88, RS21_RECLAIM_4D: 84, RS21_RECLAIM_5D: 80, RS21_ACCELERATING: 92, RS21_HOLDING: 78, RS21_ABOVE_UNSTABLE: 62, RS21_BELOW_WARNING: 20, NOT_AVAILABLE: 0 };
const rrgScore = { LEADING: 100, IMPROVING: 84, WEAKENING: 58, LAGGING: 25, NOT_AVAILABLE: 0 };
for (const row of featureRows) {
  row.rs_rating = row.rs_rating ?? row.rs_short_rating ?? null;
  row.rs_rating_delta_5d = Number.isFinite(row.rs_rating) && Number.isFinite(row.rs_rating_5d_ago) ? round(row.rs_rating - row.rs_rating_5d_ago, 0) : null;
  row.rs_rating_delta_20d = Number.isFinite(row.rs_rating) && Number.isFinite(row.rs_rating_20d_ago) ? round(row.rs_rating - row.rs_rating_20d_ago, 0) : null;
  row.liquidity_label = liquidityLabel(row.liquidity_pct, row.addv20_inr);
  row.rs_trifecta_count = [row.rs21_state !== "RS21_BELOW_WARNING" && row.rs21_state !== "NOT_AVAILABLE", row.rsnh, row.rs_slope5_pct > 0].filter(Boolean).length;
  row.rs_trifecta_label = row.rs_trifecta_count === 3 ? "PASS" : row.rs_trifecta_count === 2 ? "PARTIAL" : "FAIL";
  row.setup_label = classify(row);
  row.final_bucket = finalBucket(row);
  row.risk_bucket = riskBucket(row);
  row.trigger_status = triggerStatus(row);
  row.rmv_tight_label = rmvLabel(row.rmv15);
  row.leadership_score = round(
    (row.rs_rating ?? 40) * 0.24 + (row.rs_1w_pct ?? 40) * 0.10 + (row.rs_1m_pct ?? 40) * 0.12 + (row.rs_3m_pct ?? row.rs_short_rating ?? 40) * 0.12 +
    (rs21Score[row.rs21_state] ?? 0) * 0.16 + (rrgScore[row.rrg.quadrant] ?? 0) * 0.10 + (row.rs_trifecta_count / 3 * 100) * 0.10 + (row.liquidity_pct ?? 0) * 0.06
  );
  row.structure_score = round(Math.max(
    { BASEPIVOT_QUALITY_A: 94, BASEPIVOT_QUALITY_B: 78, BASEPIVOT_QUALITY_C: 55, BASEPIVOT_QUALITY_NONE: 20 }[row.basepivot_quality] ?? 40,
    { RMVP_QUALITY_A: 92, RMVP_QUALITY_B: 78, RMVP_QUALITY_C: 56, RMVP_QUALITY_NONE: 20 }[row.rmvp_quality] ?? 30
  ));
  row.pbx_conviction_score = row.pbx_valid_pullback ? row.pbx_score : row.setup_label === "PULLBACK" ? 45 : 50;
  row.axm_safety_score = row.axm_risk === "AXM_OK" ? 85 : row.axm_risk === "AXM_HOT_CAUTION" ? 45 : row.axm_risk === "AXM_NO_CHASE" ? 10 : 40;
  row.tactical_score = round(
    (setupScore[row.setup_label] ?? 40) * 0.30 +
    (row.entry_permission === "STANDARD_ENTRY" ? 100 : row.entry_permission === "VOLATILITY_ADJUSTED_STARTER" ? 72 : 25) * 0.18 +
    Math.max(0, 100 - Math.abs(row.trigger_gap_pct ?? 9) * 10) * 0.16 +
    row.structure_score * 0.14 +
    (row.ve2_volume_score ?? 45) * 0.10 +
    row.pbx_conviction_score * 0.07 +
    row.axm_safety_score * 0.05
  );
  row.total_score = round(row.leadership_score * 0.6 + row.tactical_score * 0.4);
  const notes = [];
  if (row.source_lane === "BSE_EXCLUSIVE_CAUTION") notes.push("BSE exclusive short-history overlay");
  if (row.adaptive_history) notes.push("adaptive history");
  if (row.liquidity_label.includes("THIN") || row.liquidity_label.includes("BELOW")) notes.push(row.liquidity_label);
  if (row.series !== "EQ" && row.exchange === "NSE") notes.push(`${row.series} series caution`);
  if (row.entry_permission !== "STANDARD_ENTRY") notes.push(row.entry_permission);
  if (row.setup_label === "NO_CHASE_RISK") notes.push("no chase");
  if (row.axm_risk !== "AXM_OK") notes.push(row.axm_risk);
  if (row.ve2_signature_label?.includes("WARNING")) notes.push(row.ve2_signature_label);
  if (row.basepivot_false_breakout_status === "BASEPIVOT_FALSE_BREAK_FILTERED") notes.push("false breakout filtered");
  row.caution = notes.join("; ") || "none from calculated technical fields";
  row.execution_permission = row.source_lane === "BSE_EXCLUSIVE_CAUTION" ? "BSE_EXCLUSIVE_CAUTION" : row.entry_permission;
  row.next_condition = row.entry_permission === "WATCH_FOR_TIGHTER_SHELF" ? "Wait for inside bar, RMV5 coil, pullback shelf or retest." : row.setup_label === "TRIGGER_READY" ? "Needs next-session trigger acceptance above BasePivot/RMVP with VE2 confirmation." : "Needs price/volume confirmation and market permission.";
  if (!row.setup_label) {
    rejected.push({ exchange: row.exchange, symbol: row.symbol, reason: "NO_RECOGNIZABLE_SETUP_GEOMETRY", series: row.series, rows: row.rows, next_condition: "Wait for RS21 reclaim, trigger proximity, compression, pullback, or RMVP." });
    continue;
  }
  rows.push(row);
}

async function sectorRrg() {
  const sectors = [];
  for (const file of (await readdir(indexRoot)).filter(x => x.endsWith(".json") && x !== "NIFTY500.json")) {
    const rec = await loadJson(resolve(indexRoot, file));
    const aligned = alignedSeries(rec.bars.map(x => ({ date: x.date, close: x.adjusted_close ?? x.close })), benchmark);
    const values = aligned.map(x => x.rs);
    const state = rrg(values);
    sectors.push({ symbol: rec.symbol, provider: rec.provider, data_as_of: rec.data_as_of, ...state, rs_1m: round(pctChange(values, 21) * 100), rs_3m: round(pctChange(values, 63) * 100) });
  }
  return sectors.sort((a, b) => (rrgScore[b.quadrant] ?? 0) - (rrgScore[a.quadrant] ?? 0) || (b.rs_1m ?? -999) - (a.rs_1m ?? -999));
}

function buildMarketContext(featureRows, setupRows, sectorRows) {
  const indexBars = benchmarkRecord.bars.map(x => ({
    date: x.date,
    open: x.adjusted_open ?? x.open ?? x.close,
    high: x.adjusted_high ?? x.high ?? x.close,
    low: x.adjusted_low ?? x.low ?? x.close,
    close: x.adjusted_close ?? x.close,
    volume: x.adjusted_volume ?? x.volume ?? 0
  })).filter(x => x.date && [x.open, x.high, x.low, x.close].every(Number.isFinite));
  const indexVolumes = indexBars.map(x => x.volume);
  const ema10 = latest(emaSeries(benchmarkCloses, 10));
  const ema21 = latest(emaSeries(benchmarkCloses, 21));
  const ema50 = latest(emaSeries(benchmarkCloses, 50));
  const ema200 = latest(emaSeries(benchmarkCloses, 200));
  const benchmarkClose = latest(benchmarkCloses);
  const ema10Prior = emaSeries(benchmarkCloses, 10).at(-6);
  const ema21Prior = emaSeries(benchmarkCloses, 21).at(-6);
  const ema50Prior = emaSeries(benchmarkCloses, 50).at(-6);
  const valid = featureRows.filter(x => x.exchange === "NSE" && x.rows >= 63);
  const above21 = valid.filter(x => x.above_ema21).length;
  const above50 = valid.filter(x => x.above_ema50).length;
  const leaders = valid.filter(x => (x.rs_rating ?? 0) >= 80 && x.rs_trifecta_count >= 2 && x.above_ema21 && x.addv20_inr >= LIQUIDITY_MIN_INR).length;
  const setupCount = setupRows.filter(x => x.exchange === "NSE").length;
  const leadingSectors = sectorRows.filter(x => x.quadrant === "LEADING").length;
  const improvingSectors = sectorRows.filter(x => x.quadrant === "IMPROVING").length;
  const referenceRows = INDIA_REFERENCE_BASKET.map(symbol => featureRows.find(x => x.exchange === "NSE" && x.symbol === symbol)).filter(Boolean);
  const referencePositive = referenceRows.filter(x => x.above_ema21 && x.rs_trifecta_count >= 2).length;
  const leadershipState = leaders >= 10 ? "LEADERSHIP_CLUSTER_CONFIRMED" : leaders >= 6 ? "LEADERSHIP_BREADTH_CONFIRMING" : leaders >= 3 ? "LEADERSHIP_EMERGING" : leaders >= 1 ? "LEADERSHIP_ISOLATED" : "LEADERSHIP_ABSENT";
  const referenceBasketState = referencePositive / Math.max(referenceRows.length, 1) >= 0.60 ? "REFERENCE_BASKET_CONFIRMING" : referencePositive / Math.max(referenceRows.length, 1) >= 0.35 ? "REFERENCE_BASKET_MIXED" : referenceRows.some(x => x.above_ema21) ? "REFERENCE_BASKET_SQUATTING" : "REFERENCE_BASKET_BREAKING_SUPPORT";
  const riskOnProxyState = (leadingSectors + improvingSectors) >= 6 && above21 / Math.max(valid.length, 1) >= 0.45 ? "RISK_ON_CONFIRMING" : (leadingSectors + improvingSectors) >= 3 ? "RISK_ON_MIXED" : "RISK_OFF";
  let distributionChurnCount = 0;
  for (let i = Math.max(20, indexBars.length - 10); i < indexBars.length; i += 1) {
    const avgVol20 = mean(indexVolumes.slice(i - 20, i));
    if (indexBars[i].close < indexBars[i - 1].close && avgVol20 && indexBars[i].volume > avgVol20 * 1.1 && closePosition(indexBars[i]) < 0.45) distributionChurnCount += 1;
  }
  const failedBreakouts = setupRows.filter(x => x.exchange === "NSE" && x.basepivot_false_breakout_status === "BASEPIVOT_FALSE_BREAK_FILTERED").length;
  let marketCycleAgeDays = 0;
  const e21Series = emaSeries(benchmarkCloses, 21);
  for (let i = benchmarkCloses.length - 1; i >= 0; i -= 1) {
    if (!Number.isFinite(e21Series[i]) || benchmarkCloses[i] < e21Series[i]) break;
    marketCycleAgeDays += 1;
  }
  const cycleAgeLabel = marketCycleAgeDays > 60 ? "CYCLE_LONG_IN_TOOTH" : marketCycleAgeDays >= 16 ? "CYCLE_MID_NORMAL" : leaders >= 6 ? "NEW_CYCLE_ACCELERATION" : "CHOPPY_CYCLE";
  const indexScore = Math.min(
    (benchmarkClose > ema21 && ema21 > ema21Prior ? 1 : 0) +
    (benchmarkClose > ema50 && ema50 > ema50Prior ? 1 : 0) +
    (benchmarkClose > ema10 && ema10 > ema10Prior ? 0.5 : 0),
    2.5
  );
  const breadthScore = { LEADERSHIP_ABSENT: 0, LEADERSHIP_ISOLATED: 0.25, LEADERSHIP_EMERGING: 0.5, LEADERSHIP_BREADTH_CONFIRMING: 0.85, LEADERSHIP_CLUSTER_CONFIRMED: 1 }[leadershipState] ?? 0.25;
  const tradeFeedbackState = "TRADE_FEEDBACK_UNKNOWN";
  const tradeFeedbackScore = 0.25;
  const riskProxyScore = { RISK_ON_CONFIRMING: 1, RISK_ON_MIXED: 0.5, RISK_OFF: 0, UNKNOWN: 0.25 }[riskOnProxyState] ?? 0.25;
  const referenceBasketScore = { REFERENCE_BASKET_CONFIRMING: 1, REFERENCE_BASKET_MIXED: 0.5, REFERENCE_BASKET_SQUATTING: 0.25, REFERENCE_BASKET_BREAKING_SUPPORT: 0 }[referenceBasketState] ?? 0.25;
  let penalty = 0;
  if (failedBreakouts >= 5) penalty += 0.5;
  if (distributionChurnCount >= 3) penalty += 0.5;
  if (marketCycleAgeDays > 60 && distributionChurnCount >= 2) penalty += 0.5;
  const rawDimmer = indexScore + breadthScore + tradeFeedbackScore + riskProxyScore + referenceBasketScore - penalty;
  const dimmer = round(clamp(rawDimmer, 0, 5), 0);
  const dimmerLabel = [
    "DIMMER_0_DEFENSE_ONLY",
    "DIMMER_1_WATCHLIST_PROTECT_CAPITAL",
    "DIMMER_2_PILOT_ONLY",
    "DIMMER_3_SELECTIVE_NORMAL",
    "DIMMER_4_AGGRESSIVE_NO_CHASE",
    "DIMMER_5_FULL_AGGRESSION_LEADERS_CONFIRMING"
  ][dimmer] ?? "DIMMER_NOT_CALCULATED";
  const mc2CycleState = benchmarkClose > ema21 && ema21 > ema21Prior && leaders >= 6 && distributionChurnCount < 3
    ? "MARKET_CYCLE_ON"
    : benchmarkClose > ema21 && leaders >= 3
      ? "MARKET_RECONFIRMATION"
      : benchmarkClose > ema21
        ? "MARKET_TRANSITION"
        : benchmarkClose < ema21 && leaders < 3
          ? "MARKET_UNDER_PRESSURE"
          : "MARKET_CYCLE_OFF";
  const oneilStyleMarketLabel = mc2CycleState === "MARKET_CYCLE_ON"
    ? "CONFIRMED_UPTREND"
    : mc2CycleState === "MARKET_RECONFIRMATION"
      ? "UPTREND_RECONFIRMING"
      : mc2CycleState === "MARKET_TRANSITION"
        ? "RALLY_ATTEMPT"
        : mc2CycleState === "MARKET_UNDER_PRESSURE"
          ? "UPTREND_UNDER_PRESSURE"
          : "MARKET_IN_CORRECTION";
  const missing = ["trade_feedback", "full_theme_rank_model"];
  const finalPermission = dimmer >= 4 && ["MARKET_CYCLE_ON", "MARKET_RECONFIRMATION"].includes(mc2CycleState) ? "TRADE_ALLOWED" : dimmer >= 3 ? "SELECTIVE_ONLY" : dimmer === 2 ? "TRANSITION_MODE" : dimmer === 1 ? "WATCHLIST_ONLY" : "DEFENSE_MODE";
  const actionBias = { TRADE_ALLOWED: "normal", SELECTIVE_ONLY: "selective", TRANSITION_MODE: "pilot-only", WATCHLIST_ONLY: "watchlist-only", DEFENSE_MODE: "defensive" }[finalPermission];
  return {
    benchmark: "NIFTY500",
    benchmark_close: round(benchmarkClose),
    benchmark_ma_stack: {
      above_ema10: benchmarkClose > ema10,
      ema10_rising_5d: ema10 > ema10Prior,
      above_ema21: benchmarkClose > ema21,
      ema21_rising_5d: ema21 > ema21Prior,
      above_ema50: benchmarkClose > ema50,
      ema50_rising_5d: ema50 > ema50Prior,
      above_ema200: benchmarkClose > ema200
    },
    mc2_cycle_state: mc2CycleState,
    oneil_style_market_label: oneilStyleMarketLabel,
    leadership_breadth_state: leadershipState,
    trade_feedback_state: tradeFeedbackState,
    failed_breakout_count_10d: failedBreakouts,
    distribution_churn_count_10d: distributionChurnCount,
    risk_on_proxy_state: riskOnProxyState,
    reference_basket_state: referenceBasketState,
    market_cycle_age_days: marketCycleAgeDays,
    market_cycle_age_label: cycleAgeLabel,
    market_dimmer_label: dimmerLabel,
    market_dimmer_components: {
      index_score: round(indexScore),
      breadth_score: round(breadthScore),
      trade_feedback_score: round(tradeFeedbackScore),
      risk_proxy_score: round(riskProxyScore),
      reference_basket_score: round(referenceBasketScore),
      penalty: round(penalty),
      raw: round(rawDimmer)
    },
    breadth: {
      valid_nse_denominator: valid.length,
      above_ema21_count: above21,
      above_ema21_pct: round(above21 / Math.max(valid.length, 1) * 100),
      above_ema50_count: above50,
      above_ema50_pct: round(above50 / Math.max(valid.length, 1) * 100),
      leadership_count: leaders,
      leadership_pct: round(leaders / Math.max(valid.length, 1) * 100),
      recognizable_setup_count: setupCount
    },
    sector_theme_evidence: {
      leading_sectors: leadingSectors,
      improving_sectors: improvingSectors,
      top_sectors: sectorRows.slice(0, 5).map(x => `${x.symbol}:${x.quadrant}`)
    },
    reference_basket: {
      symbols_checked: referenceRows.length,
      confirming_count: referencePositive,
      confirming_pct: round(referencePositive / Math.max(referenceRows.length, 1) * 100),
      symbols: referenceRows.map(x => `${x.symbol}:${x.rs_trifecta_label}`)
    },
    unavailable_inputs: missing,
    market_dimmer: dimmer,
    final_market_permission: finalPermission,
    action_bias: actionBias,
    reason: `${oneilStyleMarketLabel}: NIFTY500 ${benchmarkClose > ema21 ? "above" : "below"} rising EMA21 and ${benchmarkClose > ema50 ? "above" : "below"} EMA50; breadth ${above21}/${valid.length} above EMA21; RS leadership ${leaders}/${valid.length} (${leadershipState}); sectors leading/improving ${leadingSectors + improvingSectors}/${sectorRows.length}; reference basket ${referenceBasketState}.`
  };
}

function userNote(row) {
  const pieces = [];
  if (row.source_lane === "BSE_EXCLUSIVE_CAUTION") pieces.push("BSE-only discovery; keep as caution until fuller history/surveillance is checked");
  if (row.sector_mapping_confidence === "HIGH") pieces.push(row.aurora_theme);
  if (row.rs_rating >= 90) pieces.push("top-decile RS leadership");
  else if (row.rs_rating >= 80) pieces.push("strong RS leadership");
  else if (row.rs_trifecta_label === "PASS") pieces.push("RS Trifecta pass");
  else if (row.rs_trifecta_label === "PARTIAL") pieces.push("RS Trifecta partial");
  if (row.rsnh) pieces.push("near/new RS high");
  if (row.myh_state === "MYH_BREAKOUT_CONFIRMED") pieces.push(`${row.myh_label} breakout confirmed`);
  if (row.myh_state === "MYH_NEAR_HIGH") pieces.push(`${row.myh_label} near high`);
  if (row.rs21_state?.includes("RECLAIM")) pieces.push("RS21 reclaim");
  else if (row.rs21_state === "RS21_ACCELERATING") pieces.push("RS above EMA21 and accelerating");
  if (row.setup_label === "TRIGGER_READY") pieces.push("price is near trigger");
  if (row.setup_label === "PULLBACK") pieces.push("constructive pullback near EMA21");
  if (row.setup_label === "COMPRESSION") pieces.push("RMV compression is visible");
  if (["BASEPIVOT_QUALITY_A", "BASEPIVOT_QUALITY_B"].includes(row.basepivot_quality)) pieces.push(`${row.basepivot_quality.replace("BASEPIVOT_QUALITY_", "BasePivot ")} at ${money(row.basepivot_price)}`);
  if (["RMVP_QUALITY_A", "RMVP_QUALITY_B"].includes(row.rmvp_quality)) pieces.push(`${row.rmvp_quality.replace("RMVP_QUALITY_", "RMVP ")} at ${money(row.rmvp_price)}`);
  if (row.pattern_proxy && row.pattern_proxy !== "NO_CLEAR_BASE") pieces.push(`${row.pattern_proxy.replaceAll("_", " ")}; ${row.base_stage_risk}`);
  else if (row.base_stage_risk) pieces.push(row.base_stage_risk);
  if (row.pbx_valid_pullback) pieces.push(`${row.pbx_depth_label}/${row.pbx_duration_label} pullback`);
  if (row.ve2_pattern_volume_grade === "A" || row.ve2_pattern_volume_grade === "B") pieces.push(`${row.ve2_signature_label} volume`);
  if (row.ve2_delivery_label === "VE2_DELIVERY_ACCUMULATION_CONFIRM") pieces.push(`delivery accumulation ${num(row.delivery_pct)}%`);
  if (row.ve2_delivery_label === "VE2_DELIVERY_DISTRIBUTION_WARNING") pieces.push(`delivery distribution warning ${num(row.delivery_pct)}%`);
  if (row.axm_risk !== "AXM_OK") pieces.push(row.axm_risk);
  if (row.entry_risk_pct <= 7) pieces.push(`tactical risk ${num(row.entry_risk_pct)}%`);
  else pieces.push(`entry risk ${num(row.entry_risk_pct)}%; wait for tighter shelf`);
  if (row.liquidity_label?.includes("THIN") || row.liquidity_label?.includes("BELOW")) pieces.push(row.liquidity_label);
  return `${pieces.join("; ")}. Next: ${row.next_condition}`;
}

const sectorRows = await sectorRrg();
const marketContext = buildMarketContext(featureRows, rows, sectorRows);

for (const row of rows) row.user_note = userNote(row);

for (const row of rows) {
  row.weekly_watchlist_score = weeklyScore(row, marketContext);
  row.weekly_score_label = row.weekly_watchlist_score >= 85 ? "WWL_A_PLUS" : row.weekly_watchlist_score >= 75 ? "WWL_A" : row.weekly_watchlist_score >= 65 ? "WWL_B" : row.weekly_watchlist_score >= 55 ? "WWL_C" : "WWL_REJECT";
}

rows.sort((a, b) => b.total_score - a.total_score || b.addv20_inr - a.addv20_inr);
const weeklyEligible = rows
  .filter(x => x.source_lane !== "BSE_EXCLUSIVE_CAUTION" && !["NO_CHASE", "AVOID_FRESH_LONG", "REPAIR_WATCH"].includes(x.final_bucket) && x.weekly_watchlist_score >= 55)
  .sort((a, b) => b.weekly_watchlist_score - a.weekly_watchlist_score || b.leadership_score - a.leadership_score || b.addv20_inr - a.addv20_inr);
const weeklyUniverse = [];
const sourceLaneCounts = new Map();
for (const row of weeklyEligible) {
  const lane = row.source_lane || "UNKNOWN";
  const cap = lane === "NSE_RESTRICTED_CAUTION" ? 3 : 20;
  if ((sourceLaneCounts.get(lane) || 0) >= cap) continue;
  row.weekly_tier = weeklyTier(row, marketContext);
  weeklyUniverse.push({ ...row, weekly_rank: weeklyUniverse.length + 1 });
  sourceLaneCounts.set(lane, (sourceLaneCounts.get(lane) || 0) + 1);
  if (weeklyUniverse.length >= 20) break;
}

const focusList = weeklyUniverse
  .filter(x => x.weekly_tier === "WEEKLY_FOCUS" && freshExecutionCandidate(x) && x.addv20_inr >= LIQUIDITY_MIN_INR && x.entry_risk_pct <= 7 && !["WATCHLIST_ONLY", "DEFENSE_MODE"].includes(marketContext.final_market_permission))
  .map(x => ({ ...x, execution_focus_score: executionFocusScore(x, marketContext) }))
  .filter(x => x.execution_focus_score >= 70 && !["AVOID_FRESH_LONG", "NO_CHASE"].includes(x.final_bucket))
  .sort((a, b) => b.execution_focus_score - a.execution_focus_score);
const dailyTop = focusList.length && focusList[0].execution_focus_score >= 75
  ? focusList.filter((x, i) => i === 0 || (i < 4 && focusList[0].execution_focus_score - x.execution_focus_score <= 12)).slice(0, 4).map((x, i) => ({ ...x, rank: i + 1, execution_tier: `DAILY_TOP${i + 1}` }))
  : [];

const rsleTop20 = rows.filter(x => x.source_lane !== "BSE_EXCLUSIVE_CAUTION").slice(0, 20).map((x, i) => ({ ...x, rank: i + 1 }));
const developing20 = rows.filter(x => x.source_lane !== "BSE_EXCLUSIVE_CAUTION").slice(20, 40).map((x, i) => ({ ...x, rank: i + 21 }));
const bseOverlay = rows.filter(x => x.source_lane === "BSE_EXCLUSIVE_CAUTION").slice(0, 20).map((x, i) => ({ ...x, rank: i + 1 }));
const stockSectorThemeRows = stockSectorThemeLeadership({ weeklyUniverse, dailyTop, rsleTop20, developing20 });
const nearRsHigh = rows.filter(x => x.rs_high_gap_pct >= -1.5).slice(0, 25);
const multiYearHighs = rows
  .filter(x => ["MYH_BREAKOUT_CONFIRMED", "MYH_NEAR_HIGH", "MYH_BREAKOUT_FAILED"].includes(x.myh_state))
  .sort((a, b) => {
    const stateScore = { MYH_BREAKOUT_CONFIRMED: 3, MYH_NEAR_HIGH: 2, MYH_BREAKOUT_FAILED: 1 };
    return (stateScore[b.myh_state] ?? 0) - (stateScore[a.myh_state] ?? 0)
      || (a.myh_gap_pct ?? 999) - (b.myh_gap_pct ?? 999)
      || b.total_score - a.total_score;
  })
  .slice(0, 25);
const pullbacks = rows.filter(x => x.setup_label === "PULLBACK").slice(0, 25);
const compression = rows.filter(x => x.setup_label === "COMPRESSION").slice(0, 25);
const basePivots = rows.filter(x => ["BASEPIVOT_QUALITY_A", "BASEPIVOT_QUALITY_B"].includes(x.basepivot_quality)).slice(0, 25);
const rmvpEntries = rows.filter(x => ["RMVP_QUALITY_A", "RMVP_QUALITY_B"].includes(x.rmvp_quality) || x.setup_label === "RMVP_EARLY_ENTRY").slice(0, 25);
const volumeSignatures = rows.filter(x => ["A", "B"].includes(x.ve2_pattern_volume_grade)).slice(0, 25);
const noChase = rows.filter(x => x.setup_label === "NO_CHASE_RISK").slice(0, 25);
const rejectionCounts = rejectionReasonCounts(rejected);

const result = {
  generated_at: new Date().toISOString(),
  data_as_of: expectedSession,
  benchmark: "NIFTY500",
  provider_route: INDIA_PROVIDER_ROUTE,
  total_cache_records: files.length,
  feature_matrix_count: featureRows.length,
  scanned_candidates: rows.length,
  rejected_count: rejected.length,
  rejection_reason_counts: rejectionCounts,
  top_rejection_reasons: Object.entries(rejectionCounts).slice(0, 10).map(([reason, count]) => ({ reason, count })),
  liquidity_min_inr: LIQUIDITY_MIN_INR,
  market_context: marketContext,
  weekly_universe: weeklyUniverse,
  focus_list: focusList.slice(0, 16).map((x, i) => ({ ...x, focus_rank: i + 1 })),
  daily_top_1_4: dailyTop,
  rsle_top20: rsleTop20,
  developing_watchlist_20: developing20,
  bse_exclusive_overlay_20: bseOverlay,
  stock_sector_theme_leadership: stockSectorThemeRows,
  near_rs_high: nearRsHigh,
  multi_year_highs: multiYearHighs,
  pullbacks,
  compression,
  basepivots: basePivots,
  rmvp_entries: rmvpEntries,
  volume_signatures: volumeSignatures,
  no_chase: noChase,
  sector_rrg: sectorRows,
  rejected: rejected.slice(0, 250)
};

if ((result.feature_matrix_count === 0 || result.scanned_candidates === 0) && process.env.AURORA_ALLOW_EMPTY_DASHBOARD_PUBLISH !== "1") {
  await blockScan("EMPTY_SCAN_BLOCKED", {
    feature_matrix_count: result.feature_matrix_count,
    scanned_candidates: result.scanned_candidates,
    rejected_count: result.rejected_count,
    rejection_reason_counts: result.rejection_reason_counts
  });
}

await writeJsonAtomic(scanPath, result);

function rowsHtml(items, fields) {
  return items.map(x => `<tr>${fields.map(([label, fn]) => `<td>${fn(x)}</td>`).join("")}</tr>`).join("");
}
function stockSectorThemeLeadership({ weeklyUniverse, dailyTop, rsleTop20, developing20 }) {
  const buckets = [
    ["weekly_count", weeklyUniverse],
    ["daily_top_count", dailyTop],
    ["rsle_count", rsleTop20],
    ["developing_count", developing20]
  ];
  const byTheme = new Map();
  for (const [field, items] of buckets) {
    for (const item of items) {
      const themeKey = item.aurora_theme || "UNMAPPED_REVIEW";
      if (!byTheme.has(themeKey)) byTheme.set(themeKey, { name: themeKey, weekly_count: 0, daily_top_count: 0, rsle_count: 0, developing_count: 0, symbols: new Set(), mapping_confidence: "MIXED" });
      byTheme.get(themeKey)[field] += 1;
      byTheme.get(themeKey).symbols.add(item.symbol);
    }
  }
  const rows = [...byTheme.values()]
    .map(row => ({
      ...row,
      total_presence: row.weekly_count * 3 + row.daily_top_count * 4 + row.rsle_count * 2 + row.developing_count,
      symbols: [...row.symbols].slice(0, 12).join(", ")
    }))
    .filter(row => row.name !== "UNMAPPED_REVIEW")
    .sort((a, b) => b.total_presence - a.total_presence || b.daily_top_count - a.daily_top_count || a.name.localeCompare(b.name));
  return rows.slice(0, 30);
}
const symbolCell = x => `<strong>${escape(x.symbol)}</strong><small>${escape(x.exchange)} ${escape(x.series)} · ${escape(x.source_lane)}</small>`;
const sectorCell = x => `${escape(x.aurora_theme || "UNMAPPED_REVIEW")}<small>${escape(x.sector_mapping_confidence || "LOW")} confidence</small>`;
const setupCell = x => `<span class="status ${escape(x.setup_label)}">${escape(x.setup_label)}</span><small>${escape(x.execution_permission ?? x.entry_permission)}</small>`;
const rsCell = x => `${num(x.rs_rating, 0)}<small>1W ${num(x.rs_1w_rel)}% · 1M ${num(x.rs_1m_rel)}% · 3M ${num(x.rs_3m_rel)}%</small><small>${escape(x.rs21_state)} · ${escape(x.rs_trifecta_label)}</small>`;
const riskCell = x => `${money(x.entry_reference)}<small>Stop ${money(x.entry_stop)} · ${num(x.entry_risk_pct)}%</small><small>Thesis ${money(x.thesis_stop)} · ${num(x.thesis_risk_pct)}%</small>`;
const signalFields = [
  ["Rank", x => x.rank ?? x.weekly_rank ?? x.focus_rank ?? ""],
  ["Symbol", symbolCell],
  ["User Note", x => escape(x.user_note)],
  ["Theme", sectorCell],
  ["AURORA Bucket", x => `<span class="status ${escape(x.final_bucket)}">${escape(x.final_bucket)}</span><small>${escape(x.weekly_tier ?? x.execution_tier ?? "")}</small>`],
  ["Setup", setupCell],
  ["Price", x => `${money(x.price)}<small>${num(x.day_change_pct)}% · H ${money(x.day_high)} / L ${money(x.day_low)}</small>`],
  ["Trigger State", x => `${money(x.trigger)}<small>${num(x.trigger_gap_pct)}% gap</small><small>${escape(x.trigger_status)}</small>`],
  ["Score", x => `${num(x.total_score)}<small>L ${num(x.leadership_score)} · T ${num(x.tactical_score)}</small><small>WWL ${num(x.weekly_watchlist_score)} ${escape(x.weekly_score_label ?? "")}</small>`],
  ["RS", rsCell],
  ["MYH", x => `${escape(x.myh_label)}<small>${escape(x.myh_state)} · gap ${num(x.myh_gap_pct)}%</small><small>Level ${money(x.myh_level)} · ${num(x.myh_lookback_sessions, 0)} sessions</small>`],
  ["RRG", x => `${escape(x.rrg.quadrant)}<small>Ratio ${num(x.rrg.ratio)} · Mom ${num(x.rrg.momentum)}</small>`],
  ["RMV", x => `${num(x.rmv5)} / ${num(x.rmv15)} / ${num(x.rmv25)}<small>${x.compression ? "compression" : "no compression"}</small>`],
  ["BasePivot / RMVP", x => `${money(x.basepivot_price)}<small>${escape(x.basepivot_quality)} · ${escape(x.basepivot_status)}</small><small>RMVP ${money(x.rmvp_price)} · ${escape(x.rmvp_quality)}</small><small>Base ${escape(x.base_stage_risk)} · ${escape(x.pattern_proxy)}</small>`],
  ["PBX", x => `${escape(x.pbx_depth_label)} / ${escape(x.pbx_duration_label)}<small>${escape(x.pbx_ma_touch_label)} · ${escape(x.pbx_reversal_label)}</small><small>PBX ${num(x.pbx_score)} · ${escape(x.pbx_failure_label)}</small>`],
  ["VE2 Volume", x => `${escape(x.ve2_signature_label)}<small>Grade ${escape(x.ve2_pattern_volume_grade)} · RVOL20 ${num(x.rvol_20d)}</small><small>${escape(x.ve2_dryup_label)} · ${escape(x.ve2_distribution_label)}</small><small>Delivery ${num(x.delivery_pct)}% · ${escape(x.ve2_delivery_label)}</small>`],
  ["AXM", x => `${escape(x.axm21_label)}<small>AXM10 ${num(x.axm10)} · AXM21 ${num(x.axm21)}</small><small>${escape(x.axm_risk)}</small>`],
  ["Entry / Stop", riskCell],
  ["Liquidity", x => `${num(x.addv20_inr, 0)}<small>${escape(x.liquidity_label)} P${num(x.liquidity_pct, 0)}</small>`],
  ["Caution / Next", x => `${escape(x.caution)}<small>${escape(x.next_condition)}</small>`]
];

function table(title, id, items, note = "") {
  return `<h2 id="${id}">${title}</h2>${note ? `<p class="notice">${note}</p>` : ""}<div class="table-wrap"><table><thead><tr>${signalFields.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rowsHtml(items, signalFields)}</tbody></table></div>`;
}

const sectorFields = [
  ["Sector", x => `<strong>${escape(x.symbol)}</strong><small>${escape(x.provider)} · ${escape(x.data_as_of)}</small>`],
  ["Quadrant", x => escape(x.quadrant)],
  ["Ratio", x => num(x.ratio)],
  ["Momentum", x => num(x.momentum)],
  ["RS 1M", x => `${num(x.rs_1m)}%`],
  ["RS 3M", x => `${num(x.rs_3m)}%`]
];
const stockSectorThemeFields = [
  ["Theme", x => `<strong>${escape(x.name)}</strong>`],
  ["Weekly", x => num(x.weekly_count, 0)],
  ["Daily Top", x => num(x.daily_top_count, 0)],
  ["RSLE", x => num(x.rsle_count, 0)],
  ["Developing", x => num(x.developing_count, 0)],
  ["Weighted Presence", x => num(x.total_presence, 0)],
  ["Symbols", x => escape(x.symbols)]
];
const marketFields = [
  ["Field", x => escape(x.field)],
  ["Value", x => x.value],
  ["Meaning", x => escape(x.meaning)]
];
const marketRows = [
  { field: "O'Neil-Style Market Cycle", value: `<strong>${escape(marketContext.oneil_style_market_label)}</strong>`, meaning: `Mapped from AURORA MC2 state ${marketContext.mc2_cycle_state}` },
  { field: "AURORA-MC2 Cycle State", value: `<strong>${escape(marketContext.mc2_cycle_state)}</strong>`, meaning: "Locked AURORA market-cycle label" },
  { field: "Final Market Permission", value: `<strong>${escape(marketContext.final_market_permission)}</strong>`, meaning: marketContext.action_bias },
  { field: "Market Dimmer", value: `<strong>${marketContext.market_dimmer}/5</strong>`, meaning: `${marketContext.market_dimmer_label}; ${marketContext.reason}` },
  { field: "Benchmark MA Stack", value: `EMA21 ${marketContext.benchmark_ma_stack.above_ema21 ? "above" : "below"} / EMA50 ${marketContext.benchmark_ma_stack.above_ema50 ? "above" : "below"} / EMA200 ${marketContext.benchmark_ma_stack.above_ema200 ? "above" : "below"}`, meaning: marketContext.mc2_cycle_state },
  { field: "Breadth", value: `${marketContext.breadth.above_ema21_count}/${marketContext.breadth.valid_nse_denominator} above EMA21 = ${num(marketContext.breadth.above_ema21_pct)}%`, meaning: `${marketContext.breadth.above_ema50_count}/${marketContext.breadth.valid_nse_denominator} above EMA50 = ${num(marketContext.breadth.above_ema50_pct)}%` },
  { field: "RS Leadership Breadth", value: `${marketContext.breadth.leadership_count}/${marketContext.breadth.valid_nse_denominator} = ${num(marketContext.breadth.leadership_pct)}%`, meaning: `${marketContext.leadership_breadth_state}; RS rating >= 80, liquidity pass, above EMA21 and RS Trifecta partial/pass` },
  { field: "Distribution / Churn", value: `${marketContext.distribution_churn_count_10d} index churn days / ${marketContext.failed_breakout_count_10d} failed breakouts`, meaning: "Used as MC2 dimmer penalty when elevated" },
  { field: "Risk Proxy", value: escape(marketContext.risk_on_proxy_state), meaning: `Reference basket: ${marketContext.reference_basket_state}` },
  { field: "Cycle Age", value: `${marketContext.market_cycle_age_days} sessions`, meaning: marketContext.market_cycle_age_label },
  { field: "Sector Evidence", value: `${marketContext.sector_theme_evidence.leading_sectors} leading / ${marketContext.sector_theme_evidence.improving_sectors} improving`, meaning: marketContext.sector_theme_evidence.top_sectors.join(", ") },
  { field: "Reference Basket", value: `${marketContext.reference_basket.confirming_count}/${marketContext.reference_basket.symbols_checked} = ${num(marketContext.reference_basket.confirming_pct)}%`, meaning: marketContext.reference_basket.symbols.join(", ") },
  { field: "Dimmer Components", value: `Index ${num(marketContext.market_dimmer_components.index_score)} / Breadth ${num(marketContext.market_dimmer_components.breadth_score)} / Risk ${num(marketContext.market_dimmer_components.risk_proxy_score)} / Ref ${num(marketContext.market_dimmer_components.reference_basket_score)}`, meaning: `Trade feedback ${num(marketContext.market_dimmer_components.trade_feedback_score)}; penalty ${num(marketContext.market_dimmer_components.penalty)}; raw ${num(marketContext.market_dimmer_components.raw)}` },
  { field: "Unavailable Inputs", value: escape(marketContext.unavailable_inputs.join(", ")), meaning: "Unknown inputs receive conservative partial score; no silent market upgrade." }
];
const rrgLegendFields = [
  ["Item", x => `<strong>${escape(x.item)}</strong>`],
  ["Meaning", x => escape(x.meaning)],
  ["User Action", x => escape(x.action)]
];
const rrgLegendRows = [
  { item: "LEADING", meaning: "Relative strength and relative momentum are both above benchmark baseline.", action: "Best area to hunt entries if setup/risk are clean." },
  { item: "IMPROVING", meaning: "Momentum is improving before full leadership is confirmed.", action: "Useful early-entry watch zone." },
  { item: "WEAKENING", meaning: "Still strong versus benchmark, but momentum is fading.", action: "Avoid chasing; prefer pullback/retest only." },
  { item: "LAGGING", meaning: "Both relative strength and momentum are weak.", action: "Repair watch unless a catalyst changes behavior." }
];
const columnGuideFields = [
  ["Column", x => `<strong>${escape(x.column)}</strong>`],
  ["Meaning", x => escape(x.meaning)],
  ["How to Use", x => escape(x.use)]
];
const columnGuideRows = [
  { column: "Symbol", meaning: "Ticker, exchange, series, and source lane.", use: "Confirm route and whether the name is NSE core, restricted/caution, or BSE overlay." },
  { column: "User Note", meaning: "Plain-English reason the stock is on the list.", use: "Start here before reading the numeric fields." },
  { column: "Theme", meaning: "Aurora sector/theme cluster.", use: "Shows leadership clustering without cluttering the row." },
  { column: "AURORA Bucket", meaning: "Locked final trade bucket plus weekly/daily tier.", use: "Use this as the main trade-readiness label." },
  { column: "Setup", meaning: "Diagnostic setup label and entry permission.", use: "Confirms whether it is trigger-ready, pullback, compression, RMVP, or watch-only." },
  { column: "Score", meaning: "Total, leadership, tactical, and weekly watchlist scores.", use: "Ranks candidates after all local calculations." },
  { column: "RS", meaning: "Relative strength versus benchmark: RS rating, 1W/1M/3M relative returns, RS21 and Trifecta state.", use: "Primary leadership evidence. This is not RSI." },
  { column: "RRG", meaning: "Relative rotation quadrant with ratio and momentum.", use: "Use as sector/stock leadership context; no direction labels shown." },
  { column: "RMV", meaning: "5/15/25-day range compression.", use: "Finds tightness, VCP-style contraction, and compression setups." },
  { column: "BasePivot / RMVP", meaning: "Base pivot, reduced-move pivot, base-count proxy, and shortlist pattern context.", use: "Defines nearby structure, early-entry pivots, and late-stage base caution." },
  { column: "PBX", meaning: "Pullback depth, duration, MA defense, reversal and failure check.", use: "Grades whether the pullback is constructive." },
  { column: "VE2 Volume", meaning: "Volume signature, dry-up, RVOL, distribution, and delivery confirmation.", use: "Adds conviction or caution; not a standalone signal." },
  { column: "AXM", meaning: "ATR extension from key moving averages.", use: "Prevents chasing extended leaders." },
  { column: "Entry / Stop", meaning: "Entry reference, tactical stop, and thesis stop.", use: "Use tactical risk for entry permission; thesis risk is context." },
  { column: "Liquidity", meaning: "20-day average rupee turnover and liquidity percentile.", use: "Thin names are cautioned, not automatically hidden." },
  { column: "Caution / Next", meaning: "Main caution and next promotion condition.", use: "Shows what must happen before upgrade." }
];
const rejectedFields = [
  ["Exchange", x => escape(x.exchange)],
  ["Symbol", x => escape(x.symbol)],
  ["Series", x => escape(x.series)],
  ["Reason", x => escape(x.reason)],
  ["Rows", x => escape(x.rows ?? "")],
  ["Next Condition", x => escape(x.next_condition)]
];

const finalBucketCopy = "TRADE_READY, TRIGGER_READY, EARLY_ENTRY_WATCH, PULLBACK_WATCH, RSNH_WATCH_ONLY, NO_CHASE, PROTECT_PROFIT_REVIEW, REPAIR_WATCH, AVOID_FRESH_LONG";
const sectorRrgCopy = "LEADING = sector is outperforming and momentum is positive. IMPROVING = sector is strengthening and may be rotating into leadership. WEAKENING = sector is still relatively strong but momentum is fading. LAGGING = sector is weak versus benchmark. Sector RRG is context. It cannot create a trade by itself.";
const stockThemeCopy = "This table shows where AURORA candidates are clustering. It is not a buy table and not a trade signal. Weighted Presence = Weekly*3 + DailyTop*4 + RSLE*2 + Developing*1. Weekly = count from WEEKLY_UNIVERSE. Daily Top = count from DAILY_TOP_1_4. RSLE = count from AURORA-RSLE Top 20. Developing = count from Developing Watchlist. Symbols = representative stocks from that theme.";
const howToReadHtml = `<h2 id="guide">How to read this dashboard</h2><div class="table-wrap"><table><thead><tr><th>Concept</th><th>Plain-English guide</th></tr></thead><tbody>
<tr><td>Market Summary</td><td>Market Summary = whether the market environment supports fresh long trades.</td></tr>
<tr><td>Daily Top</td><td>Daily Top = conditional execution candidates, maximum four, never forced.</td></tr>
<tr><td>Weekly Universe</td><td>Weekly Universe = broader AURORA watchlist selected from full-universe discovery.</td></tr>
<tr><td>RSLE</td><td>RSLE = strongest relative-strength leaders with tactical entries or developing entries.</td></tr>
<tr><td>Sector RRG</td><td>Sector RRG = sector rotation strength. ${sectorRrgCopy}</td></tr>
<tr><td>Stock Theme Leadership</td><td>Stock Theme Leadership = clustering of shortlisted stocks, not a buy signal. ${stockThemeCopy} India examples: Auto Components, EMS / Electronics, Defence, Capital Markets, Energy / Infra, Pharma / CDMO.</td></tr>
<tr><td>Stock row</td><td>Stock row = final decision comes from bucket + setup + RS + volume + risk + market permission.</td></tr>
<tr><td>AURORA Bucket / Setup</td><td>AURORA Bucket = final trade-readiness status. Setup = diagnostic setup lane explaining why the stock is being watched. Locked final buckets: ${finalBucketCopy}.</td></tr>
<tr><td>RS / RS21 / RSNH</td><td>RS means benchmark-relative strength, not RSI. RS21 = RS line versus its 21 EMA. RSNH = relative-strength line near or at new high. RS Trifecta = RS confirmation stack. Mansfield RS = longer-term trend-adjusted outperformance.</td></tr>
<tr><td>RRG / RMV</td><td>RRG shows rotation context. RMV shows reduced-move volatility/tightness context.</td></tr>
<tr><td>VE2 / PBX / BPX / BasePivot / RMVP / AXM</td><td>VE2 = volume quality and demand/supply evidence. PBX = pullback quality. BPX/BasePivot/RMVP = structure, trigger zones, support/retest zones. AXM = ATR-based extension and no-chase risk. None of these creates a standalone buy signal.</td></tr>
<tr><td>Entry / Stop</td><td>Entry / Stop shows the reference trigger, stop, and risk that still need market permission and price/volume acceptance.</td></tr>
<tr><td>Liquidity</td><td>Liquidity checks whether participation is sufficient before a setup can be actionable.</td></tr>
<tr><td>Caution / Next</td><td>Caution / Next explains what must happen before promotion or execution. It may include volume confirmation, trigger acceptance, tighter shelf, pullback reset, data repair, or no-chase reset.</td></tr>
</tbody></table></div>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AURORA India Unified Dashboard</title><style>
:root{--ink:#17201c;--muted:#66716b;--paper:#f7f8f5;--panel:#fff;--line:#d9ddd7;--green:#146b45;--greenbg:#e8f4ed;--amber:#895b00;--amberbg:#fff3d4;--red:#9b2f2f;--redbg:#fae9e7;--blue:#195a78;--bluebg:#e6f2f7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 Inter,Arial,sans-serif}header.hero{background:#153f2d;color:white;padding:22px 28px;border-bottom:4px solid #d8ad42}.hero h1{margin:0;font-size:26px}.hero p{margin:5px 0 0;color:#deebe3}.nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.nav a{color:white;text-decoration:none;border:1px solid #72917f;padding:6px 10px;border-radius:4px}.wrap{padding:20px 28px 42px}.summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.metric{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:12px}.metric b{display:block;font-size:17px;margin-top:4px}.metric small,td small{display:block;color:var(--muted);margin-top:3px}h2{font-size:19px;margin:28px 0 10px}.notice{background:var(--amberbg);border-left:4px solid #c38b16;padding:10px 12px;border-radius:4px}.goodnote{background:var(--greenbg);border-left:4px solid var(--green);padding:10px 12px;border-radius:4px}.table-wrap{overflow:auto;border:1px solid var(--line);background:white;border-radius:6px}table{border-collapse:collapse;width:100%;min-width:1660px}th,td{text-align:left;vertical-align:top;padding:8px 9px;border-bottom:1px solid var(--line);font-size:12px}th{background:#edf1ec;position:sticky;top:0;z-index:1;white-space:nowrap}.status{display:inline-block;padding:3px 6px;border-radius:4px;font-size:11px;font-weight:700;background:var(--bluebg);color:var(--blue);white-space:nowrap}.TRIGGER_READY,.STANDARD_ENTRY{color:var(--green);background:var(--greenbg)}.PULLBACK,.COMPRESSION,.RMVP_EARLY_ENTRY,.RS21_RECLAIM_ENTRY{color:var(--blue);background:var(--bluebg)}.NO_CHASE_RISK{color:var(--red);background:var(--redbg)}input{padding:8px;border:1px solid var(--line);border-radius:4px;min-width:260px}.foot{color:var(--muted);margin-top:18px}@media(max-width:900px){.summary{grid-template-columns:1fr 1fr}.wrap{padding:16px}header.hero{padding:18px}table{min-width:1280px}}</style></head><body><header class="hero"><h1>AURORA India Unified Dashboard</h1><p>Full local scan · Completed session ${escape(expectedSession)} · NSE core + BSE-exclusive overlay · Free-first cache only</p><nav class="nav"><a href="#market">Market</a><a href="#guide">Column Guide</a><a href="#weekly">Weekly Universe</a><a href="#focus">Focus</a><a href="#top">Daily Top</a><a href="#rsle">RSLE Top 20</a><a href="#developing">Developing 20</a><a href="#bse">BSE Overlay</a><a href="#rrg">RRG</a><a href="#stocksectors">Theme Leadership</a><a href="#rrglegend">RRG Map</a><a href="#rshigh">Near RS High</a><a href="#myh">Multi-Year High</a><a href="#pullbacks">PBX Pullback</a><a href="#basepivots">BasePivot</a><a href="#rmvp">RMVP</a><a href="#ve2">VE2 Volume</a><a href="#compression">Compression</a><a href="#risk">No-Chase</a><a href="#rejected">Rejected/Data Repair</a><a href="#provenance">Provenance</a></nav></header><main class="wrap">
<section class="summary"><div class="metric">Run state<b>FULL_LOCAL_SCAN</b><small>No paid API calls</small></div><div class="metric">Session<b>${escape(expectedSession)}</b><small>latest completed bar</small></div><div class="metric">Market Cycle<b>${escape(marketContext.oneil_style_market_label)}</b><small>${escape(marketContext.mc2_cycle_state)}</small></div><div class="metric">Daily Top<b>${dailyTop.length}</b><small>maximum four, no padding</small></div><div class="metric">Market Permission<b>${escape(marketContext.final_market_permission)}</b><small>${escape(marketContext.market_dimmer_label)}</small></div></section>
<h2 id="market">Market Summary Strength Stack</h2><p class="goodnote">Benchmark: NIFTY500 via cached index history. Market context is recalculated every scan using AURORA-MC2 plus an O'Neil-style user-facing cycle label. Unknown inputs receive conservative partial score, not a silent upgrade.</p><div class="table-wrap"><table><thead><tr>${marketFields.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rowsHtml(marketRows, marketFields)}</tbody></table></div>
${howToReadHtml}
<h2>Column Guide</h2><div class="table-wrap"><table><thead><tr>${columnGuideFields.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rowsHtml(columnGuideRows, columnGuideFields)}</tbody></table></div>
<p><input id="search" placeholder="Filter tables by symbol, setup, caution..."></p>
${table("WEEKLY_UNIVERSE", "weekly", weeklyUniverse, "Rolling 15-20 stock AURORA weekly basket from the full local scan. It is separate from RSLE. No forced padding.")}
${table("WEEKLY_FOCUS", "focus", result.focus_list, "Execution funnel candidates from Weekly Universe with liquidity, setup, trigger/stop, and market permission gates.")}
${table("DAILY_TOP_1_4 Conditional Trade Plans", "top", dailyTop, "Chosen from WEEKLY_FOCUS using execution_focus_score. These are conditional trade plans, not automatic buys.")}
${table("AURORA-RSLE Top 20", "rsle", rsleTop20, "RSLE remains separate from Weekly Universe. Wide thesis risk is shown but does not erase discovery.")}
${table("Developing Watchlist Next 20", "developing", developing20, "Names with RS/setup evidence but less immediate execution quality than RSLE Top 20.")}
${table("BSE-Exclusive Overlay", "bse", bseOverlay, "Short-history BSE-only discovery. Always tagged BSE_EXCLUSIVE_CAUTION; do not promote without liquidity, surveillance and fresh-bar confirmation.")}
<h2 id="rrg">Sector and Theme RRG</h2><p class="notice">${sectorRrgCopy}</p><div class="table-wrap"><table><thead><tr>${sectorFields.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rowsHtml(result.sector_rrg, sectorFields)}</tbody></table></div>
<h2 id="stocksectors">Stock Theme Leadership</h2><p class="notice">${stockThemeCopy} India examples: Auto Components, EMS / Electronics, Defence, Capital Markets, Energy / Infra, Pharma / CDMO.</p><div class="table-wrap"><table><thead><tr>${stockSectorThemeFields.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rowsHtml(result.stock_sector_theme_leadership, stockSectorThemeFields)}</tbody></table></div>
<h2 id="rrglegend">RRG Quadrant Map</h2><div class="table-wrap"><table><thead><tr>${rrgLegendFields.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rowsHtml(rrgLegendRows, rrgLegendFields)}</tbody></table></div>
${table("Near RS High", "rshigh", nearRsHigh.slice(0, 20), "Stocks whose RS line is within 1.5% of its recent RS high.")}
${table("AURORA-MYH Multi-Year High", "myh", multiYearHighs.slice(0, 20), "AURORA-MYH leadership lane from the master scan: MYH_2Y / MYH_3Y / MYH_5Y with MYH_NEAR_HIGH, MYH_BREAKOUT_CONFIRMED, or MYH_BREAKOUT_FAILED. Requires enough retained history; not a standalone buy signal.")}
${table("PBX Pullback", "pullbacks", pullbacks.slice(0, 20), "Power Pullback Engine candidates using depth, duration, MA defense, reversal quality, and failure cluster.")}
${table("BasePivot / Patterns", "basepivots", basePivots.slice(0, 20), "BPX structural pivot candidates. BPX identifies structure; VE2 validates fuel.")}
${table("RMVP / Early Entry", "rmvp", rmvpEntries.slice(0, 20), "Low-cheat RMV pivot candidates with tight tactical support.")}
${table("VE2 Volume Signature", "ve2", volumeSignatures.slice(0, 20), "Volume signatures used as conviction inputs only. They do not create final buckets.")}
${table("Compression", "compression", compression.slice(0, 20), "RMV5 < RMV15 <= RMV25 style compression candidates.")}
${table("No-Chase / Risk", "risk", noChase.slice(0, 20), "Leadership may be present, but extension/risk says wait for pullback, shelf, or retest.")}
<h2 id="rejected">Rejected / Data Repair Routes</h2><p class="notice">Rejection blocks promotion, not discovery. The scanner keeps exact failed gate and next promotion condition.</p><div class="table-wrap"><table><thead><tr>${rejectedFields.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rowsHtml(rejected.slice(0, 150), rejectedFields)}</tbody></table></div>
<h2 id="provenance">Provenance</h2><div class="table-wrap"><table><tbody><tr><th>Provider route</th><td>${escape(result.provider_route)}</td></tr><tr><th>Benchmark</th><td>${escape(result.benchmark)} · ${escape(benchmarkRecord.provider)} · ${escape(benchmarkRecord.data_as_of)}</td></tr><tr><th>Top rejection reasons</th><td>${escape(result.top_rejection_reasons.map(x => `${x.reason}:${x.count}`).join(", "))}</td></tr><tr><th>Daily Top Formula</th><td>From WEEKLY_FOCUS only: 20% trigger proximity, 18% RS, 16% RMV/compression tightness, 14% BPX/RMVP structure, 10% VE2 volume, 10% RRG/theme proxy, 7% risk clarity, 5% market permission. Top name must score >=75; additional names must score >=70 and be within 12 points of #1. Never force four.</td></tr><tr><th>Conviction layers</th><td>AXM guards extension; PBX grades pullbacks; BPX/BasePivot and RMVP define structure; VE2 validates volume fuel. None of these create new final buckets.</td></tr><tr><th>Liquidity minimum reference</th><td>${money(LIQUIDITY_MIN_INR)} ADDV20. Not a discovery kill-switch; thin names are cautioned.</td></tr><tr><th>BSE overlay</th><td>Quick-mode short history, unadjusted, BSE exclusive, caution-only until full history/surveillance checks are added.</td></tr><tr><th>Scan JSON</th><td>${escape(scanPath)}</td></tr></tbody></table></div><p class="foot">Decision-support only. Confirm surveillance, series, corporate actions, next-session price/volume behavior, and risk before acting.</p></main><script>document.getElementById('search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))})</script></body></html>`;

await writeFile(`${dashboardPath}.tmp`, html);
await rename(`${dashboardPath}.tmp`, dashboardPath);
console.log(JSON.stringify({
  dashboard: dashboardPath,
  scan: scanPath,
  data_as_of: expectedSession,
  candidates: result.scanned_candidates,
  daily_top: dailyTop.map(x => x.symbol),
  myh: multiYearHighs.map(x => x.symbol).slice(0, 10),
  rsle_top5: rsleTop20.slice(0, 5).map(x => x.symbol),
  bse_overlay_count: bseOverlay.length,
  rejected: rejected.length
}, null, 2));
