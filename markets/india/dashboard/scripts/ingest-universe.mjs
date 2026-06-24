import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../engine/bhavcopy-parser.mjs";
import { normalizeDate, normalizeSymbol } from "../engine/cache-store.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sources = process.argv.slice(2).map(value => resolve(value));
if (!sources.length) throw new Error("Usage: node scripts/ingest-universe.mjs <NSE/BSE security-master CSV> [...]");

const pick = (row, names) => {
  for (const name of names) if (row[name] !== undefined && row[name] !== "") return String(row[name]).trim();
  return "";
};
const listings = [];
for (const path of sources) {
  const exchange = /BSE/i.test(path) ? "BSE" : "NSE";
  for (const row of parseCsv(await readFile(path, "utf8"))) {
    const symbol = normalizeSymbol(pick(row, ["SYMBOL", "SECURITY ID", "SCRIP_ID", "SC_NAME"]));
    const securityCode = pick(row, ["SECURITY CODE", "SC_CODE", "SCRIP_CD"]);
    const isin = pick(row, ["ISIN NUMBER", "ISIN_NUMBER", "ISIN", "ISIN_NO"]).toUpperCase();
    const series = pick(row, ["SERIES", "GROUP", "SC_GROUP"]).toUpperCase();
    const name = pick(row, ["NAME OF COMPANY", "NAME_OF_COMPANY", "ISSUER NAME", "SECURITY NAME", "SC_NAME"]);
    if (!symbol && !securityCode) continue;
    listings.push({
      exchange,
      symbol: symbol || securityCode,
      security_code: securityCode || null,
      isin: isin || null,
      series: series || null,
      name: name || symbol,
      listing_date: normalizeDate(pick(row, ["DATE OF LISTING", "DATE_OF_LISTING", "LISTING DATE"])) || null,
      status: "ACTIVE",
      source: path
    });
  }
}

const byCompany = new Map();
for (const listing of listings) {
  const key = listing.isin || `${listing.exchange}__${listing.symbol}`;
  if (!byCompany.has(key)) byCompany.set(key, { company_id: key, isin: listing.isin, name: listing.name, listings: [] });
  byCompany.get(key).listings.push(listing);
}
const universe = {
  schema_version: "3.0",
  generated_at: new Date().toISOString(),
  sources,
  listing_count: listings.length,
  company_count: byCompany.size,
  companies: [...byCompany.values()].sort((a, b) => a.company_id.localeCompare(b.company_id))
};
const output = resolve(projectRoot, "data/india-universe.json");
const temporary = `${output}.tmp`;
await writeFile(temporary, JSON.stringify(universe, null, 2));
await rename(temporary, output);
console.log(JSON.stringify({ listing_count: universe.listing_count, company_count: universe.company_count, output }));
