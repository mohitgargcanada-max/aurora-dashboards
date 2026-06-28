import assert from "node:assert/strict";
import { auditIndexRecords, coverageGuard } from "../engine/freshness-guard.mjs";
import { buildCanadaFeatureMatrix, buildDashboardModel, renderCanadaDashboard } from "../engine/scan-engine.mjs";

function bars({ start = "2025-01-01", count = 300, base = 100, drift = 0.002, volume = 250000 } = {}) {
  const out = [];
  const date = new Date(`${start}T12:00:00Z`);
  for (let index = 0; index < count; index += 1) {
    const close = base * (1 + drift * index);
    out.push({
      date: date.toISOString().slice(0, 10),
      open: close * 0.99,
      high: close * 1.02,
      low: close * 0.98,
      close,
      volume: volume + index * 100
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return out;
}

const expectedSession = "2025-10-27";
const benchmarkBars = bars({ base: 100, drift: 0.001 });
const stockBars = bars({ base: 30, drift: 0.003, volume: 350000 });
const universe = [{ symbol: "RY.TO", name: "Royal Bank of Canada", exchange: "TSX", sector: "Financials" }];
const stockRecords = [{ symbol: "RY.TO", provider: "YAHOO_FINANCE_FIXTURE", data_as_of: expectedSession, bars: stockBars }];
const indexRecords = ["^GSPTSE", "XIC.TO", "XIU.TO", "XIT.TO", "XEG.TO"].map(symbol => ({
  symbol,
  provider: "YAHOO_FINANCE_FIXTURE",
  data_as_of: expectedSession,
  bars: benchmarkBars
}));

const indexAudit = auditIndexRecords(indexRecords, expectedSession);
const coverage = coverageGuard({ expectedSession, records: stockRecords });
const { rows, rejected } = buildCanadaFeatureMatrix({
  universe,
  stockRecords,
  benchmarkRecord: indexRecords[0],
  expectedSession
});
const model = buildDashboardModel({ rows, rejected, indexAudit, coverage, expectedSession });
const html = renderCanadaDashboard(model);

assert.equal(indexAudit.status, "INDEX_FRESHNESS_OK");
assert.equal(coverage.status, "COVERAGE_OK");
assert.equal(rows.length, 1);
assert.equal(rejected.length, 0);
assert.match(html, /AURORA Canada Unified Dashboard/);

console.log(JSON.stringify({ status: "CANADA_FIXTURE_SCAN_SMOKE_OK", rows: rows.length, expectedSession }));
