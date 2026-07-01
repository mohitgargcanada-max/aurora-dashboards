import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildBackupPlan } from "../plan-market-data-backup.mjs";
import { isForbiddenBackupPath, validateBackupRoot } from "../validate-backup-paths.mjs";
import { readManifestFile, validateManifest } from "../validate-market-data-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const fixturesDir = path.join(__dirname, "fixtures");

test("normal dashboard cache paths are rejected", () => {
  assert.equal(isForbiddenBackupPath("markets/us/dashboard/cache/ohlcv/MSFT.json"), true);
});

test("normal dashboard data JSON paths are rejected", () => {
  assert.equal(isForbiddenBackupPath("markets/india/dashboard/data/latest.json"), true);
});

test("dashboard HTML paths are rejected", () => {
  assert.equal(isForbiddenBackupPath("markets/canada/AURORA_Canada_Unified_Dashboard.html"), true);
});

test("safe external backup root is accepted", () => {
  const externalRoot = path.join(os.tmpdir(), "aurora-market-data-backup-test-root");
  assert.deepEqual(validateBackupRoot(externalRoot, { sourceRoot: repoRoot }), {
    ok: true,
    reason: "BACKUP_ROOT_ACCEPTED"
  });
});

test("manifest includes required provenance fields", () => {
  const manifest = readManifestFile(path.join(fixturesDir, "valid-manifest.json"));
  assert.deepEqual(validateManifest(manifest), { ok: true, errors: [] });
});

test("invalid source label is rejected", () => {
  const result = validateManifest(readManifestFile(path.join(fixturesDir, "invalid-manifest.json")));
  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("series[0].source_priority_label:INVALID"), true);
});

test("missing checksum is rejected", () => {
  const result = validateManifest(readManifestFile(path.join(fixturesDir, "invalid-manifest.json")));
  assert.equal(result.errors.includes("series[0].checksum:REQUIRED_NONEMPTY"), true);
});

test("missing adjustment_status is rejected", () => {
  const result = validateManifest(readManifestFile(path.join(fixturesDir, "invalid-manifest.json")));
  assert.equal(result.errors.includes("series[0].adjustment_status:REQUIRED_NONEMPTY"), true);
});

test("invalid date range is rejected", () => {
  const result = validateManifest(readManifestFile(path.join(fixturesDir, "invalid-manifest.json")));
  assert.equal(result.errors.includes("series[0].series_start_after_series_end"), true);
});

test("dry-run plan does not write files", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "aurora-backup-plan-"));
  try {
    const before = readdirSync(tempDir);
    const plan = buildBackupPlan();
    const after = readdirSync(tempDir);
    assert.equal(plan.dry_run, true);
    assert.equal(plan.writes_data, false);
    assert.deepEqual(after, before);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("no real market data fixture is present", () => {
  for (const fileName of readdirSync(fixturesDir)) {
    const fullPath = path.join(fixturesDir, fileName);
    assert.equal(/\.(csv|parquet|gz)$/i.test(fileName), false);
    const text = readFileSync(fullPath, "utf8");
    assert.equal(/US_FAKE|INDIA_FAKE|CANADA_FAKE/.test(text), true);
    assert.equal(/\b(AAPL|MSFT|RELIANCE|SHOP|RY|TD)\b/.test(text), false);
    assert.equal(existsSync(fullPath), true);
  }
});
