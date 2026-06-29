import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = await readFile(resolve("scripts/render-canonical.mjs"), "utf8");

const finalBucketCopy = "TRADE_READY, TRIGGER_READY, EARLY_ENTRY_WATCH, PULLBACK_WATCH, RSNH_WATCH_ONLY, NO_CHASE, PROTECT_PROFIT_REVIEW, REPAIR_WATCH, AVOID_FRESH_LONG";

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
  "AI/Semis",
  "AURORA Sell / Extension Watchlist",
  "No tracked names currently require sell / extension review.",
  "Extension alone is not a sell signal",
  "Market FOMO / ATR Heat is context-only",
  "No entries yet. Names will appear here only after they are already tracked and trigger extension/sell-risk review evidence.",
  "sell-extension",
  finalBucketCopy,
  "Symbol",
  "Original List",
  "First Published",
  "Entry Reference",
  "Latest Close",
  "Gain/Loss from Entry",
  "AXM10 / AXM21 / AXM50",
  "Distance from 21EMA / 50SMA",
  "PX Label",
  "AURORA-X State",
  "VE2 Risk",
  "Sell / Extension Reason",
  "Caution Note",
  "Next Action",
  "Lifecycle Status"
]) {
  assert.ok(source.includes(text), `missing UI copy: ${text}`);
}

for (const bucket of [
  "AXM21_HOT",
  "AXM21_EXTREME",
  "AXM50_VERY_EXTENDED",
  "AXM50_EXTREME",
  "PX_NO_CHASE",
  "PX_HARD_WARNING",
  "VE2_CLIMAX_VOLUME_WARNING",
  "AURORA_X2_SELL_RISK_REVIEW",
  "AURORA_X3_HARD_BLOCK",
  "21EMA_BREAK_WARNING",
  "50SMA_SERIOUS_WARNING",
  "FAILED_BREAKOUT",
  "THESIS_STOP_BREACH",
  "FOMO_3_HOT",
  "FOMO_4_EUPHORIC",
  "FOMO_5_CLIMAX_RISK"
]) {
  assert.ok(!finalBucketCopy.split(", ").includes(bucket), `review label must not be a final bucket: ${bucket}`);
}

console.log("US UI copy tests passed.");
