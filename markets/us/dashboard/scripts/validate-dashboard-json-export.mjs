import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirArg = process.argv.find(arg => arg.startsWith("--dir="));
const outputDir = outputDirArg ? resolve(outputDirArg.slice("--dir=".length)) : resolve(root, "data");
const latestPath = resolve(outputDir, "latest.json");
const scanPath = resolve(outputDir, "us-full-dashboard-scan.json");

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
  "myh_approaching",
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

const REQUIRED_TOP_LEVEL = [
  "schema_version",
  "market",
  "data_as_of",
  "completed_session",
  "run_type",
  "run_mode",
  "generated_at",
  "market_summary",
  "provenance",
  "coverage",
  "audit_contract",
  ...LIST_KEYS
];

function walkRows(scan) {
  return LIST_KEYS.flatMap(key => scan[key]);
}

const latest = JSON.parse(await readFile(latestPath, "utf8"));
const scan = JSON.parse(await readFile(scanPath, "utf8"));

assert.equal(latest.scan_url, "./us-full-dashboard-scan.json");
assert.equal(scan.market, "US");
for (const key of REQUIRED_TOP_LEVEL) assert.ok(Object.hasOwn(scan, key), `missing top-level key: ${key}`);
assert.equal(typeof scan.market_summary, "object");
assert.equal(typeof scan.provenance, "object");
assert.equal(typeof scan.coverage, "object");
for (const key of LIST_KEYS) assert.ok(Array.isArray(scan[key]), `${key} must be an array`);
assert.ok(scan.daily_top_1_4.length <= 4, "daily_top_1_4 length must be <= 4");
assert.ok(scan.rsle_top_20.length <= 20, "rsle_top_20 length must be <= 20");
assert.equal(scan.audit_contract.json_export_only, true);
assert.equal(scan.audit_contract.scanner_behavior_changed, false);
assert.equal(scan.audit_contract.dashboard_rendering_changed, false);
assert.equal(scan.audit_contract.contains_external_report_data, false);
assert.equal(scan.audit_contract.contains_email_data, false);
for (const row of walkRows(scan)) {
  if (row.final_bucket != null) assert.ok(FINAL_BUCKETS.has(row.final_bucket), `invalid final_bucket: ${row.symbol}:${row.final_bucket}`);
}

console.log(JSON.stringify({ status: "PASS", latest: latestPath, scan: scanPath, rows: walkRows(scan).length }));
