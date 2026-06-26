import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditIndexRecords, deriveExpectedCompletedSession } from "../engine/freshness-guard.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(process.argv[2] || resolve(projectRoot, "cache/india/indices"));
const expectedSession = await deriveExpectedCompletedSession({
  refreshReportPath: resolve(projectRoot, "data/india-daily-refresh-report.json"),
  explicitSession: process.argv[3] || null,
  stockCacheRoot: resolve(projectRoot, "cache/india/ohlcv")
});
const files = (await readdir(root)).filter(x => x.endsWith(".json")).sort();
const records = [];
for (const file of files) {
  const text = await readFile(resolve(root, file), "utf8");
  const record = JSON.parse(text);
  records.push({ text, record });
}
const audit = auditIndexRecords(records, { expectedSession, expectedCount: 18 });
for (const record of audit.records) {
  record.sha256 = createHash("sha256").update(record.sha256_source).digest("hex");
  delete record.sha256_source;
}
const report = {
  schema_version: "3.0",
  generated_at: new Date().toISOString(),
  expected_completed_session: expectedSession,
  expected_session: expectedSession,
  expected_indices: 18,
  loaded_indices: audit.records.length,
  valid_indices: audit.valid_indices,
  coverage_pct: audit.coverage_pct,
  stale_indices: audit.stale_indices,
  stale_count: audit.stale_count,
  freshness_coverage_pct: audit.freshness_coverage_pct,
  blocking_reason: audit.blocking_reason,
  records: audit.records
};
const output = resolve(projectRoot, "data/india-index-cache-audit.json");
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  expected_indices: report.expected_indices,
  loaded_indices: report.loaded_indices,
  valid_indices: report.valid_indices,
  coverage_pct: report.coverage_pct,
  expected_session: report.expected_session,
  stale_count: report.stale_count,
  freshness_coverage_pct: report.freshness_coverage_pct,
  blocking_reason: report.blocking_reason,
  output
}));
