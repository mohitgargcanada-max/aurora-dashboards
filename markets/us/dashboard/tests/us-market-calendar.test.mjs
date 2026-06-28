import assert from "node:assert/strict";
import {
  isNyseHoliday,
  latestCompletedNyseSession,
  nextNyseHoliday,
  nyseCalendarSummary
} from "../scripts/us-market-calendar.mjs";

assert.equal(isNyseHoliday("2026-07-03"), true);
assert.equal(latestCompletedNyseSession(new Date("2026-07-03T16:00:00Z")), "2026-07-02");
assert.equal(latestCompletedNyseSession(new Date("2026-07-06T23:00:00Z")), "2026-07-06");

const next = nextNyseHoliday("2026-06-27");
assert.equal(next.date, "2026-07-03");
assert.equal(next.name, "Independence Day observed");

const holidaySummary = nyseCalendarSummary(new Date("2026-07-03T16:00:00Z"));
assert.equal(holidaySummary.is_market_holiday, true);
assert.equal(holidaySummary.today_holiday.date, "2026-07-03");

console.log("US market calendar tests passed");
