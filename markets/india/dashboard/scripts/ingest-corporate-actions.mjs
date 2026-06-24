import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../engine/bhavcopy-parser.mjs";
import { normalizeDate, normalizeSymbol } from "../engine/cache-store.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Usage: node scripts/ingest-corporate-actions.mjs <corporate-actions.csv>");

const rows = parseCsv(await readFile(source, "utf8"));
const actions = [];
for (const row of rows) {
  const purpose = String(row.PURPOSE || "").trim();
  const purposeUpper = purpose.toUpperCase();
  let type = "OTHER";
  if (/BONUS/.test(purposeUpper)) type = "BONUS";
  else if (/SPLIT|SUB-DIVISION|SUB DIVISION/.test(purposeUpper)) type = "SPLIT";
  else if (/RIGHTS/.test(purposeUpper)) type = "RIGHTS";
  else if (/DIVIDEND/.test(purposeUpper)) type = "DIVIDEND";
  else if (/MERGER|AMALGAMATION|DEMERGER|SCHEME OF ARRANGEMENT/.test(purposeUpper)) type = "REORGANIZATION";
  const date = normalizeDate(row["EX-DATE"]);
  const symbol = normalizeSymbol(row.SYMBOL);
  if (!symbol || !date) continue;
  actions.push({
    symbol,
    company_name: String(row["COMPANY NAME"] || "").trim(),
    series: String(row.SERIES || "").trim().toUpperCase(),
    type,
    purpose,
    face_value: Number(row["FACE VALUE"]) || null,
    ex_date: date,
    record_date: normalizeDate(row["RECORD DATE"]) || null,
    adjustment_required: ["BONUS", "SPLIT", "RIGHTS", "REORGANIZATION"].includes(type)
  });
}
actions.sort((a, b) => a.ex_date.localeCompare(b.ex_date) || a.symbol.localeCompare(b.symbol));
const result = {
  schema_version: "3.0",
  generated_at: new Date().toISOString(),
  source,
  action_count: actions.length,
  adjustment_required_count: actions.filter(x => x.adjustment_required).length,
  first_date: actions[0]?.ex_date || null,
  last_date: actions.at(-1)?.ex_date || null,
  counts_by_type: Object.fromEntries([...new Set(actions.map(x => x.type))].sort().map(type => [type, actions.filter(x => x.type === type).length])),
  actions
};
const output = resolve(projectRoot, "data/india-corporate-actions.json");
const temporary = output + ".tmp";
await writeFile(temporary, JSON.stringify(result, null, 2));
await rename(temporary, output);
console.log(JSON.stringify({ action_count: result.action_count, adjustment_required_count: result.adjustment_required_count, first_date: result.first_date, last_date: result.last_date, counts_by_type: result.counts_by_type, output }));
