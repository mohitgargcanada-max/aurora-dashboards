import { appendFileSync } from "node:fs";
import { canadaCalendarSummary } from "../markets/canada/dashboard/engine/trading-calendar.mjs";

const now = process.env.AURORA_GATE_NOW ? new Date(process.env.AURORA_GATE_NOW) : new Date();
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
}).formatToParts(now).reduce((acc, part) => {
  acc[part.type] = part.value;
  return acc;
}, {});

const weekday = parts.weekday;
const hour = Number(parts.hour);
const minute = Number(parts.minute);
const calendar = canadaCalendarSummary(now);
const inWindow = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday) && hour === 9 && minute < 20;
const run = inWindow && !calendar.is_market_holiday;

if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `RUN_CANADA_DASHBOARD=${run ? "1" : "0"}\n`);
}

if (!run) {
  const reason = calendar.today_holiday
    ? `Canada exchange holiday: ${calendar.today}`
    : `outside 9:00 AM Monday-Friday America/Toronto run window: ${weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  console.log(`Skipping cleanly: ${reason}`);
  process.exit(0);
}

console.log(`Run window confirmed: ${weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} America/Toronto; TSX/TSXV trading day ${calendar.today}`);
