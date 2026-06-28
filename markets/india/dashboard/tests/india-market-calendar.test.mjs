import assert from "node:assert/strict";
import {
  indiaCalendarSummary,
  indiaHolidayForDate,
  isIndiaMarketHoliday,
  latestCompletedIndiaSession
} from "../engine/trading-calendar.mjs";

assert.equal(indiaHolidayForDate("2026-06-26").name, "Muharram");
assert.equal(isIndiaMarketHoliday("2026-06-26"), true);
assert.equal(isIndiaMarketHoliday("2026-06-27"), true);
assert.equal(isIndiaMarketHoliday("2026-06-29"), false);
assert.equal(latestCompletedIndiaSession(new Date("2026-06-26T04:00:00Z")), "2026-06-25");
assert.equal(latestCompletedIndiaSession(new Date("2026-06-29T13:00:00Z")), "2026-06-29");

const holidaySummary = indiaCalendarSummary(new Date("2026-06-26T04:00:00Z"));
assert.equal(holidaySummary.is_market_holiday, true);
assert.equal(holidaySummary.today_holiday.date, "2026-06-26");

console.log("India market calendar tests passed");
