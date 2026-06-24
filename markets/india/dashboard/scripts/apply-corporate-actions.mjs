import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cacheRoot = resolve(process.argv[2] || resolve(projectRoot, "cache/india/ohlcv"));
const actionPath = resolve(process.argv[3] || resolve(projectRoot, "data/india-corporate-actions.json"));
const registry = JSON.parse(await readFile(actionPath, "utf8"));
const bySymbol = new Map();
for (const action of registry.actions) {
  if (!bySymbol.has(action.symbol)) bySymbol.set(action.symbol, []);
  bySymbol.get(action.symbol).push(action);
}

const ratio = text => {
  const match = String(text).match(/([0-9]+(?:\.[0-9]+)?)\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
};
const splitValues = text => {
  const match = String(text).match(/From\s+R(?:s|e)\s*([0-9]+(?:\.[0-9]+)?).*?To\s+R(?:s|e)\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? [Number(match[1]), Number(match[2])] : null;
};
const round = value => Number(value.toFixed(8));

let adjustedRecords = 0;
let appliedEvents = 0;
let unresolvedEvents = 0;
const unresolved = [];
for (const file of (await readdir(cacheRoot)).filter(x => x.endsWith(".json"))) {
  const path = resolve(cacheRoot, file);
  const record = JSON.parse(await readFile(path, "utf8"));
  const actions = (bySymbol.get(record.symbol) || []).filter(x => record.bars[0]?.date < x.ex_date && record.bars.at(-1)?.date >= x.ex_date);
  let bars = record.bars.map(bar => ({
    ...bar,
    adjusted_open: bar.open,
    adjusted_high: bar.high,
    adjusted_low: bar.low,
    adjusted_close: bar.close,
    adjusted_volume: bar.volume
  }));
  const applied = [];
  const warnings = [];

  for (const action of actions.sort((a, b) => a.ex_date.localeCompare(b.ex_date))) {
    let factor = null;
    if (action.type === "BONUS") {
      const values = ratio(action.purpose);
      if (values) factor = values[1] / (values[0] + values[1]);
    } else if (action.type === "SPLIT") {
      const values = splitValues(action.purpose);
      if (values) factor = values[1] / values[0];
    } else if (action.type === "RIGHTS") {
      const values = ratio(action.purpose);
      const premiumMatch = action.purpose.match(/(?:Premium|Prm)\s+R(?:s|e)\s*([0-9]+(?:\.[0-9]+)?)/i);
      const prior = [...bars].reverse().find(x => x.date < action.ex_date);
      if (values && premiumMatch && prior?.close > 0) {
        const issuePrice = Number(premiumMatch[1]) + Number(action.face_value || 0);
        factor = (values[1] * prior.close + values[0] * issuePrice) / ((values[0] + values[1]) * prior.close);
      }
    } else if (action.type === "REORGANIZATION") {
      warnings.push(`REORGANIZATION_REPAIR_REQUIRED:${action.ex_date}:${action.purpose}`);
      unresolved.push({ symbol: record.symbol, ex_date: action.ex_date, type: action.type, purpose: action.purpose });
      unresolvedEvents += 1;
      continue;
    } else {
      continue;
    }

    if (!Number.isFinite(factor) || factor <= 0 || factor >= 1.5) {
      warnings.push(`UNPARSED_ACTION:${action.ex_date}:${action.purpose}`);
      unresolved.push({ symbol: record.symbol, ex_date: action.ex_date, type: action.type, purpose: action.purpose });
      unresolvedEvents += 1;
      continue;
    }

    bars = bars.map(bar => bar.date < action.ex_date ? {
      ...bar,
      adjusted_open: round(bar.adjusted_open * factor),
      adjusted_high: round(bar.adjusted_high * factor),
      adjusted_low: round(bar.adjusted_low * factor),
      adjusted_close: round(bar.adjusted_close * factor),
      adjusted_volume: Math.round(bar.adjusted_volume / factor)
    } : bar);
    applied.push({ ex_date: action.ex_date, type: action.type, purpose: action.purpose, factor: round(factor) });
    appliedEvents += 1;
  }

  if (!actions.length) record.adjustment_status = "NO_ADJUSTMENT_EVENTS_IN_RANGE";
  else if (warnings.length) record.adjustment_status = applied.length ? "PARTIAL_ADJUSTED_DATA_REPAIR_REQUIRED" : "DATA_REPAIR_REQUIRED";
  else record.adjustment_status = "ADJUSTED_CORPORATE_ACTIONS";
  record.adjustment_events = applied;
  record.warnings = [...new Set([...(record.warnings || []), ...warnings])];
  record.bars = bars;
  const temporary = path + ".tmp";
  await writeFile(temporary, JSON.stringify(record));
  await rename(temporary, path);
  if (applied.length) adjustedRecords += 1;
}

const report = {
  schema_version: "3.0",
  generated_at: new Date().toISOString(),
  adjusted_records: adjustedRecords,
  applied_events: appliedEvents,
  unresolved_events: unresolvedEvents,
  unresolved
};
const output = resolve(projectRoot, "data/india-adjustment-audit.json");
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ adjusted_records: adjustedRecords, applied_events: appliedEvents, unresolved_events: unresolvedEvents, output }));
