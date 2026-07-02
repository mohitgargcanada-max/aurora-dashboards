import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateJsonExportContract } from "../scripts/validate-json-export-contract.mjs";

const generatedAt = "2026-07-01T12:00:00.000Z";

function row(symbol) {
  return { symbol, market: "US" };
}

function validLatest(overrides = {}) {
  return {
    schema_version: "aurora_dashboard_latest_v1",
    market: "US",
    data_as_of: "2026-06-30",
    completed_session: "2026-06-30",
    generated_at: generatedAt,
    scan_url: "./us-full-dashboard-scan.json",
    ...overrides
  };
}

function validScan(overrides = {}) {
  const weekly = Array.from({ length: 15 }, (_, index) => row(`W${index + 1}`));
  const focus = [weekly[0], weekly[1]];
  return {
    schema_version: "aurora_dashboard_scan_v1",
    market: "US",
    data_as_of: "2026-06-30",
    completed_session: "2026-06-30",
    generated_at: generatedAt,
    weekly_universe: weekly,
    weekly_focus: focus,
    daily_top_1_4: [focus[0]],
    rsle_top_20: [],
    developing_watchlist: [],
    near_rs_high: [],
    aurora_radar_universe: [],
    strong_rs_retention: [],
    soft_rs_reject_recovered: [],
    myh_approaching: [],
    myh_breakout_retest: [],
    industry_group_rrg: [],
    industry_rrg: [],
    sub_industry_rrg: [],
    rejected_data_repair: [],
    all_candidates: weekly,
    audit_contract: {
      contains_external_report_data: false,
      contains_email_data: false
    },
    ...overrides
  };
}

async function withExport(latest, scan, fn) {
  const dir = await mkdtemp(join(tmpdir(), "aurora-us-contract-"));
  try {
    await writeFile(join(dir, "latest.json"), JSON.stringify(latest, null, 2));
    await writeFile(join(dir, "us-full-dashboard-scan.json"), JSON.stringify(scan, null, 2));
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function validate(latest = validLatest(), scan = validScan(), opts = {}) {
  return await withExport(latest, scan, dir => validateJsonExportContract({ dir, ...opts }));
}

test("valid minimal export with all required sections passes", async () => {
  const result = await validate();
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("missing aurora_radar_universe fails", async () => {
  const scan = validScan();
  delete scan.aurora_radar_universe;
  const result = await validate(validLatest(), scan);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /aurora_radar_universe/);
});

test("missing strong_rs_retention fails", async () => {
  const scan = validScan();
  delete scan.strong_rs_retention;
  const result = await validate(validLatest(), scan);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /strong_rs_retention/);
});

test("missing RRG hierarchy sections fail", async () => {
  const scan = validScan();
  delete scan.industry_group_rrg;
  delete scan.industry_rrg;
  delete scan.sub_industry_rrg;
  const result = await validate(validLatest(), scan);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /industry_group_rrg/);
  assert.match(result.errors.join("\n"), /industry_rrg/);
  assert.match(result.errors.join("\n"), /sub_industry_rrg/);
});

test("stale generated_at fails when run-start is provided", async () => {
  const result = await validate(
    validLatest({ generated_at: "2026-07-01T11:59:59.000Z" }),
    validScan({ generated_at: "2026-07-01T11:59:59.000Z" }),
    { runStartIso: generatedAt }
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /older than run start/);
});

test("daily_top_1_4 outside weekly_focus fails", async () => {
  const result = await validate(validLatest(), validScan({ daily_top_1_4: [row("NOTFOCUS")] }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /not in weekly_focus/);
});

test("blocked empty weekly_universe passes only with DATA_REFRESH_BLOCKED evidence", async () => {
  const blocked = await validate(validLatest(), validScan({ weekly_universe: [], weekly_focus: [], daily_top_1_4: [], run_status: "DATA_REFRESH_BLOCKED" }));
  assert.equal(blocked.ok, true, blocked.errors.join("\n"));

  const unblocked = await validate(validLatest(), validScan({ weekly_universe: [], weekly_focus: [], daily_top_1_4: [] }));
  assert.equal(unblocked.ok, false);
  assert.match(unblocked.errors.join("\n"), /DATA_REFRESH_BLOCKED/);
});

test("external email and report fields fail", async () => {
  const result = await validate(validLatest(), validScan({ gmail_thread_id: "abc", external_report_symbols: ["XYZ"] }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /gmail_thread_id/);
  assert.match(result.errors.join("\n"), /external_report_symbols/);
});
