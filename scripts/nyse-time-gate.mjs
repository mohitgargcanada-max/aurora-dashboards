import { appendFileSync } from "node:fs";
import { nyseCalendarSummary } from "../markets/us/dashboard/scripts/us-market-calendar.mjs";

const now = process.env.AURORA_GATE_NOW ? new Date(process.env.AURORA_GATE_NOW) : new Date();
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
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
const calendar = nyseCalendarSummary(now);
const inWindow = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday) && hour === 9 && minute < 20;
const run = inWindow && !calendar.is_market_holiday;

if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `RUN_US_DASHBOARD=${run ? "1" : "0"}\n`);
}

if (!run) {
  const reason = calendar.is_market_holiday
    ? `NYSE market holiday: ${calendar.today_holiday?.name || calendar.today}`
    : `outside 9am Monday-Friday America/New_York run window: ${weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  console.log(`Skipping cleanly: ${reason}`);
  process.exit(0);
}

console.log(`Run window confirmed: ${weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} America/New_York; NYSE trading day ${calendar.today}`);
