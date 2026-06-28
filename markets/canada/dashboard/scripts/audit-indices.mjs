import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJson } from "../engine/cache-store.mjs";
import { auditIndexRecords } from "../engine/freshness-guard.mjs";
import { latestCompletedCanadaSession } from "../engine/trading-calendar.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const indexRoot = resolve(root, "cache/canada/indices");
const dataRoot = resolve(root, "data");
let records = [];
try {
  const files = await readdir(indexRoot);
  records = (await Promise.all(files.filter(f => f.endsWith(".json")).map(f => readJson(resolve(indexRoot, f))))).filter(Boolean);
} catch {}
const expected = process.argv[2] || process.env.AURORA_TARGET_SESSION || latestCompletedCanadaSession();
const audit = auditIndexRecords(records, expected);
await writeJson(resolve(dataRoot, "canada-index-cache-audit.json"), audit);
if (audit.status !== "INDEX_FRESHNESS_OK") {
  console.error(JSON.stringify(audit, null, 2));
  process.exitCode = 1;
}
