import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildUsDashboardJsonExport, writeUsDashboardJsonExport } from "../scripts/write-dashboard-json-export.mjs";

const dashboardRoot = fileURLToPath(new URL("..", import.meta.url));

function candidate(overrides = {}) {
  return {
    ticker: "MOCKUS",
    exchange: "NYSE",
    bucket: "TRIGGER_READY",
    final_bucket: "TRIGGER_READY",
    price: 100,
    rs_trifecta: "PASS",
    rs_ema21: "ABOVE",
    basepivot_quality: "BASEPIVOT_QUALITY_A",
    rmvp_quality: "RMVP_QUALITY_A",
    entry_risk_pct: 4,
    avg_dollar_volume_20_usd_equiv: 100_000_000,
    provider_payload: { should_not_be_serialized: true },
    bars: [{ date: "2026-06-26", close: 100 }],
    ...overrides
  };
}

function state() {
  const weekly = candidate({ ticker: "MOCKUS" });
  const daily = candidate({ ticker: "MOCKJSON", final_bucket: "TRIGGER_READY", bucket: "TRIGGER_READY" });
  const rsle = candidate({ ticker: "MOCKAUDIT", rsle_rank: 1, rsle_leadership_score: 90 });
  return {
    generated_at: "2026-06-29T15:00:00.000Z",
    run: {
      run_type: "SUNDAY_FULL_REBUILD",
      run_mode: "SUNDAY_FULL_REBUILD",
      run_mode_reason: "CLI_MODE_EXPLICIT",
      data_as_of: "2026-06-26",
      completed_session: "2026-06-26",
      expected_symbols: 3,
      loaded_symbols: 3,
      valid_latest_symbols: 3,
      calculated_symbols: 3,
      coverage_pct: 100,
      universe_update_mode: "FULL_ELIGIBLE_UNIVERSE_REBUILD",
      deep_enrichment_scope: ["COMPLETE_ELIGIBLE_UNIVERSE"],
      warnings: []
    },
    market: { market_permission: "TRADE_ALLOWED" },
    provenance: { provider_route: "MOCK_ROUTE", provider: "MOCK_PROVIDER", data_date: "2026-06-26", adjustment_status: "MOCK_ADJUSTED" },
    core: [weekly],
    weekly_focus: [weekly],
    daily_top: [daily],
    rs_leadership: { top20_tactical: [rsle], developing_21_40: [] },
    sections: {
      rs21_rsnh: [weekly],
      pbx_pullback: [],
      basepivot_patterns: [weekly],
      rmvp_early_entry: [weekly],
      ve2_volume_signature: [weekly],
      compression_vcp: [],
      no_chase_risk: [],
      rejected_data_repair: [],
      myh_approaching: [candidate({
        ticker: "MOCKMYH",
        myh_status: "MYH_APPROACHING",
        myh_approaching_status: "MYH_WITHIN_2PCT",
        myh_target_level: 101,
        myh_gap_pct: 1.2,
        myh_lookback_label: "MYH_52W",
        myh_history_confidence: "HISTORY_AVAILABLE",
        myh_next_condition: "Needs clean close through MYH level."
      })]
    },
    all_candidates: [weekly, daily, rsle]
  };
}

const input = state();
const before = JSON.stringify(input);
const dir = await mkdtemp(join(tmpdir(), "aurora-us-json-"));
try {
  const written = await writeUsDashboardJsonExport({ outputDir: dir, scan: input, generatedAt: input.generated_at });
  const latest = JSON.parse(await readFile(written.latestPath, "utf8"));
  const scan = JSON.parse(await readFile(written.scanPath, "utf8"));

  assert.equal(latest.schema_version, "aurora_dashboard_latest_v1");
  assert.equal(latest.scan_url, "./us-full-dashboard-scan.json");
  assert.equal(scan.schema_version, "aurora_dashboard_scan_v1");
  assert.equal(scan.market, "US");
  for (const key of ["weekly_universe", "weekly_focus", "daily_top_1_4", "rsle_top_20", "developing_watchlist", "myh_approaching", "near_rs_high", "pbx_pullbacks", "basepivot_patterns", "rmvp_early_entry", "ve2_volume_signature", "compression", "no_chase_risk", "rejected_data_repair", "all_candidates"]) {
    assert.ok(Array.isArray(scan[key]), `${key} should be array`);
  }
  assert.equal(scan.myh_approaching[0].symbol, "MOCKMYH");
  assert.equal(scan.myh_approaching[0].myh_status, "MYH_APPROACHING");
  assert.equal(scan.myh_approaching[0].myh_gap_pct, 1.2);
  assert.equal(scan.myh_approaching[0].myh_lookback_label, "MYH_52W");
  assert.ok(scan.daily_top_1_4.length <= 4);
  assert.equal(scan.audit_contract.json_export_only, true);
  assert.equal(scan.audit_contract.scanner_behavior_changed, false);
  assert.equal(scan.audit_contract.dashboard_rendering_changed, false);
  assert.equal(scan.audit_contract.contains_external_report_data, false);
  assert.equal(scan.audit_contract.contains_email_data, false);
  assert.equal(scan.weekly_universe[0].name, null);
  assert.equal(scan.weekly_universe[0].provider_payload, undefined);
  assert.equal(scan.weekly_universe[0].bars, undefined);
  assert.equal(JSON.stringify(input), before);

  const validate = spawnSync(process.execPath, ["scripts/validate-dashboard-json-export.mjs", `--dir=${dir}`], { cwd: dashboardRoot, encoding: "utf8" });
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);

  const invalid = buildUsDashboardJsonExport({ scan: { ...state(), daily_top: [candidate({ final_bucket: "RSLE_TRIGGER_READY", bucket: "RSLE_TRIGGER_READY" })] } });
  await writeUsDashboardJsonExport({ outputDir: dir, scan: { ...state(), daily_top: [candidate({ final_bucket: "RSLE_TRIGGER_READY", bucket: "RSLE_TRIGGER_READY" })] } });
  assert.ok(invalid.scan.provenance.warnings.some(warning => warning.includes("UNKNOWN_FINAL_BUCKET")));
  const invalidValidate = spawnSync(process.execPath, ["scripts/validate-dashboard-json-export.mjs", `--dir=${dir}`], { cwd: dashboardRoot, encoding: "utf8" });
  assert.notEqual(invalidValidate.status, 0);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("US dashboard JSON export tests passed");
