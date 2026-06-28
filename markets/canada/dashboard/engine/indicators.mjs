export const clamp = (value, low = 0, high = 100) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
export const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
export const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export const latest = values => values.at(-1);
export const escapeHtml = value => String(value ?? "").replace(/[&<>\"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

export function emaSeries(values, period) {
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

export function smaSeries(values, period) {
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

export function atr(bars, period = 14) {
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

export function rmv(bars, period) {
  const xs = bars.slice(-period);
  if (xs.length < period) return null;
  const avg = mean(xs.map(x => x.close));
  return avg ? (Math.max(...xs.map(x => x.high)) - Math.min(...xs.map(x => x.low))) / avg * 100 : null;
}

export function weightedRsRaw(closes, offset = 0) {
  const end = closes.length - 1 - offset;
  if (end - 252 < 0) return null;
  const q4 = closes[end] / closes[end - 63] - 1;
  const q3 = closes[end - 63] / closes[end - 126] - 1;
  const q2 = closes[end - 126] / closes[end - 189] - 1;
  const q1 = closes[end - 189] / closes[end - 252] - 1;
  return (2 * q4 + q3 + q2 + q1) / 5;
}

export function assignPercentiles(rows, source, target, low = 1, high = 99) {
  const valid = rows.filter(row => Number.isFinite(row[source])).sort((a, b) => a[source] - b[source]);
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

export function alignedSeries(bars, benchmark) {
  const bm = new Map(benchmark.map(x => [x.date, x.close]));
  const aligned = [];
  for (const bar of bars) {
    const bmClose = bm.get(bar.date);
    if (bmClose > 0 && bar.close > 0) aligned.push({ date: bar.date, close: bar.close, rs: bar.close / bmClose, volume: bar.volume, high: bar.high, low: bar.low, open: bar.open });
  }
  return aligned;
}

export function rs21State(rsValues) {
  const ema21 = emaSeries(rsValues, 21);
  const i = rsValues.length - 1;
  if (i < 21 || !Number.isFinite(ema21[i])) return "RS_DATA_REPAIR";
  const crossedAgo = [0, 1, 2, 3, 4, 5].find(ago => {
    const j = i - ago;
    return j > 0 && Number.isFinite(ema21[j - 1]) && rsValues[j] >= ema21[j] && rsValues[j - 1] < ema21[j - 1];
  });
  const hold3 = [0, 1, 2].every(ago => Number.isFinite(ema21[i - ago]) && rsValues[i - ago] >= ema21[i - ago]);
  const slope5 = i >= 5 ? rsValues[i] / rsValues[i - 5] - 1 : null;
  if (crossedAgo !== undefined) return `RS21_RECLAIM_${crossedAgo}D`;
  if (hold3 && slope5 > 0) return "RS21_ACCELERATING";
  if (hold3) return "RS21_HOLD_ABOVE";
  return rsValues[i] >= ema21[i] ? "RS21_ABOVE_UNSTABLE" : "RS21_BELOW";
}

export function rrgFromRsLine(rsValues) {
  if (rsValues.length < 52) return { quadrant: "RRG_DATA_REPAIR", ratio: null, momentum: null };
  const ema10 = emaSeries(rsValues, 10);
  const ratio = 100 * rsValues.at(-1) / ema10.at(-1);
  const ratioSeries = rsValues.map((value, idx) => Number.isFinite(ema10[idx]) ? 100 * value / ema10[idx] : null).filter(Number.isFinite);
  const ratioEma = emaSeries(ratioSeries, 10);
  const momentum = ratioSeries.length >= 10 ? 100 * ratioSeries.at(-1) / ratioEma.at(-1) : null;
  const quadrant = ratio >= 100 && momentum >= 100 ? "LEADING" : ratio >= 100 ? "WEAKENING" : momentum >= 100 ? "IMPROVING" : "LAGGING";
  return { quadrant, ratio: round(ratio), momentum: round(momentum) };
}

export function rmvLabel(value) {
  if (!Number.isFinite(value)) return "RMV_UNKNOWN";
  if (value <= 5) return "RMV_ZERO";
  if (value <= 10) return "RMV_VERY_TIGHT";
  if (value <= 15) return "RMV_TIGHT";
  if (value <= 25) return "RMV_NORMAL";
  return "RMV_EXPANDING";
}

export function axmMatrix(price, ema10, ema21, sma50, sma200, atr14) {
  if (!Number.isFinite(price) || !Number.isFinite(atr14) || atr14 <= 0) return { axm10: null, axm21: null, axm50: null, axm200: null, axm10_label: "AXM_UNKNOWN", axm21_label: "AXM_UNKNOWN", axm50_label: "AXM_UNKNOWN", axm200_label: "AXM_UNKNOWN", axm_composite_label: "AXM_UNKNOWN" };
  const axm10 = Number.isFinite(ema10) ? (price - ema10) / atr14 : null;
  const axm21 = Number.isFinite(ema21) ? (price - ema21) / atr14 : null;
  const axm50 = Number.isFinite(sma50) ? (price - sma50) / atr14 : null;
  const axm200 = Number.isFinite(sma200) ? (price - sma200) / atr14 : null;
  const label = (value, bands, names) => !Number.isFinite(value) ? "AXM_UNKNOWN" : value < bands[0] ? names[0] : value < bands[1] ? names[1] : value < bands[2] ? names[2] : names[3];
  const axm10Label = label(axm10, [1, 2, 3], ["AXM10_NORMAL", "AXM10_STRONG", "AXM10_HOT", "AXM10_VERY_HOT"]);
  const axm21Label = label(axm21, [1.5, 3, 4], ["AXM21_NORMAL", "AXM21_EXTENDED", "AXM21_HOT", "AXM21_EXTREME"]);
  const axm50Label = label(axm50, [2.5, 5, 7.5], ["AXM50_NORMAL", "AXM50_EXTENDED", "AXM50_VERY_EXTENDED", "AXM50_EXTREME"]);
  const stretched = [axm10Label.includes("HOT"), axm21Label.includes("HOT") || axm21Label.includes("EXTREME"), axm50Label.includes("VERY") || axm50Label.includes("EXTREME")].filter(Boolean).length;
  return {
    axm10: round(axm10), axm21: round(axm21), axm50: round(axm50), axm200: round(axm200),
    axm10_label: axm10Label, axm21_label: axm21Label, axm50_label: axm50Label,
    axm200_label: label(axm200, [5, 10, 15], ["AXM200_NORMAL", "AXM200_EXTENDED", "AXM200_VERY_EXTENDED", "AXM200_EXTREME"]),
    axm_composite_label: stretched >= 2 ? "AXM_MULTI_ANCHOR_STRETCH" : axm21Label === "AXM21_EXTREME" ? "AXM_SWING_CHASE_RISK" : "AXM_OK"
  };
}
