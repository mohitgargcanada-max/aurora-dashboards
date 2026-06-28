import assert from "node:assert/strict";
import { classifyInstrument, enrichmentStatuses, resolveProviderSymbol, universeReferenceRow, yahooProviderSymbol } from "../scripts/us-universe-reference.mjs";

assert.equal(classifyInstrument("AAPL"), "COMMON_STOCK");
assert.equal(classifyInstrument("SONY", { name: "Sony Group Corporation American Depositary Shares" }), "ADR");
assert.equal(classifyInstrument("SPY"), "ETF");
assert.equal(classifyInstrument("BRLSW"), "WARRANT");
assert.equal(classifyInstrument("BPACU"), "UNIT");
assert.equal(classifyInstrument("TESTR"), "RIGHT");
assert.equal(classifyInstrument("BPOPM"), "PREFERRED");
assert.equal(yahooProviderSymbol("BRK.B"), "BRK-B");
const aapl = universeReferenceRow({ symbol: "AAPL", exchange: "NASDAQ" });
assert.equal(aapl.provider_symbols.eodhd, "AAPL.US");
assert.equal(aapl.provider_symbols.eodhd_status, "DERIVED_COMMON_STOCK");
assert.equal(aapl.mapping_confidence, "MEDIUM");

const row = universeReferenceRow(
  { symbol: "BRK-B", exchange: "NYSE", cik: "1067983", provider_symbols: { eodhd: "BRK.B.US" } },
  { provider: "NASDAQ", classification_status: "PARTIAL_NASDAQ_SECTOR_INDUSTRY" }
);
assert.equal(row.instrument_type, "COMMON_STOCK");
assert.equal(row.eligible_technical, true);
assert.equal(row.provider_symbols.yahoo, "BRK-B");
assert.equal(row.provider_symbols.eodhd, "BRK.B.US");
assert.equal(row.provider_symbols.eodhd_status, "VALIDATED");
assert.equal(resolveProviderSymbol("BRK-B", "EODHD", [row]).status, "VALIDATED");
assert.equal(resolveProviderSymbol("BRK-B", "EODHD", [row]).symbol, "BRK.B.US");
assert.equal(row.sector_status, "PROXY_SECTOR");

const preferred = universeReferenceRow({ symbol: "BPOPM", exchange: "NASDAQ" });
assert.equal(preferred.provider_symbols.eodhd, null);
assert.equal(preferred.provider_symbols.eodhd_status, "UNSUPPORTED_INSTRUMENT");
assert.equal(resolveProviderSymbol("BPOPM", "EODHD", [preferred]).symbol, null);

const warrant = universeReferenceRow({ symbol: "BRLSW", exchange: "NASDAQ" });
assert.equal(warrant.provider_symbols.eodhd_status, "UNSUPPORTED_INSTRUMENT");

const statuses = enrichmentStatuses({ hasSectorCache: true });
assert.equal(statuses.price_scan_status, "COMPLETE");
assert.equal(statuses.sector_classification_status, "PARTIAL");
assert.equal(statuses.event_registry_status, "NOT_RUN_DATA_REQUIRED");

console.log("US universe reference tests passed");
