import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = await readFile(resolve("scripts/render-canonical.mjs"), "utf8");

for (const text of [
  "How to read this dashboard",
  "Market Summary = whether the market environment supports fresh long trades.",
  "Daily Top = conditional execution candidates, maximum four, never forced.",
  "Sector RRG is context. It cannot create a trade by itself.",
  "This table shows where AURORA candidates are clustering.",
  "Weighted Presence = Weekly*3 + DailyTop*4 + RSLE*2 + Developing*1",
  "AURORA Bucket = final trade-readiness status.",
  "Setup = diagnostic setup lane explaining why the stock is being watched.",
  "RS means benchmark-relative strength, not RSI.",
  "VE2 = volume quality and demand/supply evidence.",
  "Caution / Next explains what must happen before promotion or execution.",
  "AI/Semis"
]) {
  assert.ok(source.includes(text), `missing UI copy: ${text}`);
}

console.log("US UI copy tests passed.");
