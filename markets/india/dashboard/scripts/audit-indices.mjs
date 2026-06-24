import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSeries } from "../engine/cache-store.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(process.argv[2] || resolve(projectRoot, "cache/india/indices"));
const expectedSession = process.argv[3] || null;
const files = (await readdir(root)).filter(x => x.endsWith(".json")).sort();
const records = [];
for (const file of files) {
  const text = await readFile(resolve(root, file), "utf8");
  const record = JSON.parse(text);
  const validation = validateSeries(record.bars, { minimumBars: 252, expectedSession });
  records.push({
    symbol: record.symbol,
    name: record.name,
    provider: record.provider,
    fallback_label: record.fallback_label,
    adjustment_status: record.adjustment_status,
    rows: record.bars.length,
    first_date: record.bars[0]?.date || null,
    data_as_of: record.data_as_of,
    valid: validation.ok,
    failure: validation.ok ? null : validation.code,
    sha256: createHash("sha256").update(text).digest("hex")
  });
}
const report = {
  schema_version: "3.0",
  generated_at: new Date().toISOString(),
  expected_session: expectedSession,
  expected_indices: 18,
  loaded_indices: records.length,
  valid_indices: records.filter(x => x.valid).length,
  coverage_pct: Number((100 * records.filter(x => x.valid).length / 18).toFixed(2)),
  records
};
const output = resolve(projectRoot, "data/india-index-cache-audit.json");
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ expected_indices: report.expected_indices, loaded_indices: report.loaded_indices, valid_indices: report.valid_indices, coverage_pct: report.coverage_pct, output }));
