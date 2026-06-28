import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveIndiaProviderSymbol } from "../scripts/india-provider-symbols.mjs";

const reliance = { exchange: "NSE", symbol: "RELIANCE", series: "EQ", isin: "INE002A01018" };
const bseRecord = { exchange: "BSE", symbol: "500325", group: "A", security_code: "500325" };

let resolved = await resolveIndiaProviderSymbol(reliance, "YAHOO");
assert.equal(resolved.provider_symbol, "RELIANCE.NS");
assert.equal(resolved.status, "DERIVED_OFFICIAL_EXCHANGE_SUFFIX");
assert.equal(resolved.mapping_confidence, "MEDIUM");

resolved = await resolveIndiaProviderSymbol(bseRecord, "YAHOO");
assert.equal(resolved.provider_symbol, "500325.BO");
assert.equal(resolved.status, "DERIVED_OFFICIAL_EXCHANGE_SUFFIX");

const mapDir = await mkdtemp(join(tmpdir(), "aurora-india-symbol-map-"));
const mapPath = join(mapDir, "india-symbol-map.json");
await mkdir(mapDir, { recursive: true });
await writeFile(mapPath, JSON.stringify([{
  canonical_symbol: "RELIANCE",
  exchange: "NSE",
  series_or_group: "EQ",
  isin: "INE002A01018",
  eodhd_symbol: "RELIANCE.XNSE",
  mapping_confidence: "HIGH",
  last_validated_at: "2026-06-25"
}]), "utf8");
resolved = await resolveIndiaProviderSymbol(reliance, "EODHD", { symbolMapPath: mapPath });
assert.equal(resolved.provider_symbol, "RELIANCE.XNSE");
assert.deepEqual(resolved.candidates, ["RELIANCE.XNSE"]);
assert.equal(resolved.status, "VALIDATED");
assert.equal(resolved.mapping_confidence, "HIGH");

resolved = await resolveIndiaProviderSymbol({ exchange: "NSE", symbol: "07AGG", series: "F" }, "EODHD", { symbolMap: [] });
assert.equal(resolved.status, "EODHD_UNSUPPORTED_SERIES");
assert.equal(resolved.mapping_confidence, "NONE");

resolved = await resolveIndiaProviderSymbol(reliance, "EODHD", { symbolMap: [], eodhdNseCodes: "XNSE,NSE" });
assert.deepEqual(resolved.candidates, ["RELIANCE.XNSE", "RELIANCE.NSE"]);
assert.equal(resolved.status, "DERIVED_EODHD_CANDIDATES");
assert.equal(resolved.mapping_confidence, "LOW");

console.log("India provider symbol tests passed");
