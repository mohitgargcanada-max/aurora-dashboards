import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = resolve(tmpdir(), `aurora-scan-guard-${process.pid}`);
const fixtureRoot = resolve(tempRoot, "markets/india/dashboard");
await rm(tempRoot, { recursive: true, force: true });
await mkdir(resolve(fixtureRoot, "scripts"), { recursive: true });
await mkdir(resolve(fixtureRoot, "engine"), { recursive: true });
await mkdir(resolve(fixtureRoot, "data"), { recursive: true });
await mkdir(resolve(fixtureRoot, "cache/india/ohlcv"), { recursive: true });
await mkdir(resolve(tempRoot, "markets/shared"), { recursive: true });
await cp(resolve(root, "scripts/run-full-dashboard-scan.mjs"), resolve(fixtureRoot, "scripts/run-full-dashboard-scan.mjs"));
await cp(resolve(root, "engine/cache-store.mjs"), resolve(fixtureRoot, "engine/cache-store.mjs"));
await cp(resolve(root, "engine/freshness-guard.mjs"), resolve(fixtureRoot, "engine/freshness-guard.mjs"));
await cp(resolve(root, "engine/trading-calendar.mjs"), resolve(fixtureRoot, "engine/trading-calendar.mjs"));
await cp(resolve(root, "../../shared/scan-orchestration.mjs"), resolve(tempRoot, "markets/shared/scan-orchestration.mjs"));
await cp(resolve(root, "cache/india/indices"), resolve(fixtureRoot, "cache/india/indices"), { recursive: true });

const script = resolve(fixtureRoot, "scripts/run-full-dashboard-scan.mjs");
const htmlPath = resolve(fixtureRoot, "../AURORA_India_Unified_Dashboard.html");
const scanPath = resolve(fixtureRoot, "data/india-full-dashboard-scan.json");
await writeFile(resolve(fixtureRoot, "data/india-daily-refresh-report.json"), JSON.stringify({ expected_completed_session: "2099-01-02" }));
await writeFile(htmlPath, "last-good");

let run = spawnSync(process.execPath, [script], { cwd: fixtureRoot, encoding: "utf8" });
assert.equal(run.status, 1);
assert.match(run.stderr, /DATA_STALE_INDEX_BLOCKED/);
assert.equal(await readFile(htmlPath, "utf8"), "last-good");
let report = JSON.parse(await readFile(scanPath, "utf8"));
assert.equal(report.status, "DATA_STALE_INDEX_BLOCKED");
assert.equal(report.expected_completed_session, "2099-01-02");
assert.ok(report.stale_indices.length > 0);

await writeFile(resolve(fixtureRoot, "data/india-daily-refresh-report.json"), JSON.stringify({ expected_completed_session: "2026-06-22" }));

run = spawnSync(process.execPath, [script], { cwd: fixtureRoot, encoding: "utf8" });
assert.equal(run.status, 1);
assert.match(run.stderr, /EMPTY_SCAN_BLOCKED/);
assert.equal(await readFile(htmlPath, "utf8"), "last-good");
report = JSON.parse(await readFile(scanPath, "utf8"));
assert.equal(report.status, "EMPTY_SCAN_BLOCKED");
assert.equal(report.feature_matrix_count, 0);
assert.equal(report.scanned_candidates, 0);

run = spawnSync(process.execPath, [script], {
  cwd: fixtureRoot,
  encoding: "utf8",
  env: { ...process.env, AURORA_ALLOW_EMPTY_DASHBOARD_PUBLISH: "1" }
});
assert.equal(run.status, 0);
assert.notEqual(await readFile(htmlPath, "utf8"), "last-good");
await rm(tempRoot, { recursive: true, force: true });

console.log("scan-guard tests passed");
