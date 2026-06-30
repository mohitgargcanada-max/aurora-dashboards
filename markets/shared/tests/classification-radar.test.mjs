import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuroraRadarUniverse,
  buildMyhBreakoutRetestRows,
  buildRrgHierarchy,
  buildStrongRsRetention,
  enrichRadarVisibility,
  normalizeClassification
} from "../classification-radar.mjs";

const row = (symbol, extra = {}) => ({
  symbol,
  market: "US",
  company_name: `${symbol} Inc`,
  rs_rating: 82,
  rs21_state: "RS21_HOLDING",
  rs_trifecta_label: "FAIL",
  rrg: { quadrant: "IMPROVING", ratio: 103, momentum: 104 },
  final_bucket: "REPAIR_WATCH",
  data_as_of: "2026-06-29",
  ...extra
});

test("classification fields preserve market-native taxonomy separately", () => {
  const us = normalizeClassification(row("NVDA", { sector: "Information Technology", industry: "Semiconductors", aurora_theme: "Semiconductors / Semiconductor Equipment" }), { market: "US" });
  const india = normalizeClassification(row("SYRMA", { market: "INDIA", gics_sector: "Information Technology", aurora_theme: "EMS / Electronics", market_native_industry: "Electronics Manufacturing" }), { market: "INDIA" });
  const canada = normalizeClassification(row("RY.TO", { market: "CANADA", sector: "Financials", theme: "Canadian Banks" }), { market: "CANADA" });
  assert.equal(us.gics_sector_name, "Information Technology");
  assert.equal(india.market_native_industry, "Electronics Manufacturing");
  assert.equal(canada.aurora_theme, "Canadian Banks");
});

test("unresolved classification becomes UNKNOWN / UNMAPPED_REVIEW", () => {
  const out = normalizeClassification({ symbol: "ZZZ", sector: "UNMAPPED_REVIEW", industry: "UNMAPPED_REVIEW" }, { market: "US" });
  assert.equal(out.gics_sector_name, "UNKNOWN");
  assert.equal(out.gics_industry_group_name, "UNMAPPED_REVIEW");
  assert.equal(out.gics_classification_source, "UNMAPPED_REVIEW");
});

test("industry and sub-industry RRG require denominator threshold", () => {
  const rows = [
    row("AAA", { gics_industry_group_name: "Software", gics_industry_name: "Application Software", gics_sub_industry_name: "Security Software" }),
    row("BBB", { gics_industry_group_name: "Software", gics_industry_name: "Application Software", gics_sub_industry_name: "Security Software" }),
    row("CCC", { gics_industry_group_name: "Software", gics_industry_name: "Application Software", gics_sub_industry_name: "Security Software" }),
    row("DDD", { gics_industry_group_name: "Banks", gics_industry_name: "Banks", gics_sub_industry_name: "Banks" })
  ];
  const hierarchy = buildRrgHierarchy(rows, { minDenominator: 3 });
  assert.equal(hierarchy.industry.find(x => x.name === "Application Software").confidence, "DENOMINATOR_OK");
  assert.equal(hierarchy.sub_industry.find(x => x.name === "Banks").confidence, "RRG_INSUFFICIENT_DENOMINATOR");
});

test("MYH breakout retest is radar only after prior break and retest context", () => {
  const rows = [
    row("RETEST", { myh_breakout_level: 100, bars_since_myh_breakout: 8, myh_retest_anchor: "21EMA", myh_retest_distance_pct: 1.4 }),
    row("APPROACH", { myh_state: "MYH_NEAR_HIGH", myh_gap_pct: 2 }),
    row("OLD", { myh_breakout_level: 100, bars_since_myh_breakout: 35, myh_retest_anchor: "21EMA", myh_retest_distance_pct: 1 })
  ];
  const retests = buildMyhBreakoutRetestRows(rows);
  assert.deepEqual(retests.map(x => x.symbol), ["RETEST"]);
  assert.equal(rows[0].final_bucket, "REPAIR_WATCH");
  assert.equal(rows[1].myh_status, "MYH_APPROACHING");
});

test("radar universe dedupes symbols and preserves memberships", () => {
  const aaa = row("AAA", { scan_memberships: ["RSLE_TOP_20"] });
  const radar = buildAuroraRadarUniverse({
    market: "US",
    lists: { WEEKLY_UNIVERSE: [aaa], RSLE_TOP_20: [aaa] },
    allCandidates: [aaa, row("BBB", { rs_rating: 74, rs_trifecta_label: "FAIL" })]
  });
  assert.equal(radar.filter(x => x.symbol === "AAA").length, 1);
  assert.deepEqual(new Set(radar.find(x => x.symbol === "AAA").source_lists), new Set(["WEEKLY_UNIVERSE", "RSLE_TOP_20", "all_candidates"]));
  assert.ok(radar.some(x => x.symbol === "BBB"));
});

test("strong RS retention includes soft waits and excludes hard fails", () => {
  const retained = buildStrongRsRetention([
    row("LEADER", { rs_rating: 91, final_bucket: "NO_CHASE" }),
    row("BROKEN", { rs_rating: 96, stage_label: "STAGE_4", final_bucket: "AVOID_FRESH_LONG" })
  ], { sourceLists: { weekly: [] } });
  assert.deepEqual(retained.map(x => x.symbol), ["LEADER"]);
  assert.equal(retained[0].strong_rs_retention_status, "RS_LEADER_NO_CHASE_WAIT");
  assert.equal(retained[0].final_bucket, "NO_CHASE");
});

test("Trifecta FAIL with early RS evidence is radar, not standalone rejection", () => {
  const rows = [
    row("RS70", { rs_rating: 70, rs_trifecta_label: "FAIL", rejection_reason: "RS_TRIFECTA_NOT_PASS" }),
    row("RECLAIM", { rs_rating: 40, rs21_state: "RS21_RECLAIM_2D", rs_trifecta_label: "FAIL" }),
    row("RRG", { rs_rating: 40, rs21_state: "RS21_BELOW_WARNING", rrg: { quadrant: "LEADING", ratio: 105, momentum: 102 }, rs_trifecta_label: "FAIL" }),
    row("NONE", { rs_rating: 40, rs21_state: "RS21_BELOW_WARNING", rrg: { quadrant: "LAGGING", ratio: 90, momentum: 88 }, rs_trifecta_label: "FAIL" })
  ];
  enrichRadarVisibility(rows, { market: "US" });
  assert.equal(rows[0].rejection_reason, "RS_CONFIRMATION_PENDING");
  assert.ok(rows[0].scan_memberships.includes("AURORA_RADAR_UNIVERSE"));
  assert.ok(rows[1].scan_memberships.includes("AURORA_RADAR_UNIVERSE"));
  assert.ok(rows[2].scan_memberships.includes("AURORA_RADAR_UNIVERSE"));
  assert.equal(rows[3].scan_memberships, undefined);
});
