export const NYSE_HOLIDAY_SOURCE_URL = "https://www.nyse.com/trade/hours-calendars";

export const NYSE_HOLIDAYS = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-19", name: "Martin Luther King Jr. Day" },
  { date: "2026-02-16", name: "Washington's Birthday" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-05-25", name: "Memorial Day" },
  { date: "2026-06-19", name: "Juneteenth National Independence Day" },
  { date: "2026-07-03", name: "Independence Day observed" },
  { date: "2026-09-07", name: "Labor Day" },
  { date: "2026-11-26", name: "Thanksgiving Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-18", name: "Martin Luther King Jr. Day" },
  { date: "2027-02-15", name: "Washington's Birthday" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-05-31", name: "Memorial Day" },
  { date: "2027-06-18", name: "Juneteenth National Independence Day observed" },
  { date: "2027-07-05", name: "Independence Day observed" },
  { date: "2027-09-06", name: "Labor Day" },
  { date: "2027-11-25", name: "Thanksgiving Day" },
  { date: "2027-12-24", name: "Christmas Day observed" },
  { date: "2028-01-17", name: "Martin Luther King Jr. Day" },
  { date: "2028-02-21", name: "Washington's Birthday" },
  { date: "2028-04-14", name: "Good Friday" },
  { date: "2028-05-29", name: "Memorial Day" },
  { date: "2028-06-19", name: "Juneteenth National Independence Day" },
  { date: "2028-07-04", name: "Independence Day" },
  { date: "2028-09-04", name: "Labor Day" },
  { date: "2028-11-23", name: "Thanksgiving Day" },
  { date: "2028-12-25", name: "Christmas Day" }
];

const HOLIDAY_BY_DATE = new Map(NYSE_HOLIDAYS.map(holiday => [holiday.date, holiday]));

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function isWeekend(date) {
  return [0, 6].includes(dayOfWeek(date));
}

export function marketDateInNewYork(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function marketHourInNewYork(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false
  }).formatToParts(now);
  return Number(parts.find(part => part.type === "hour")?.value);
}

export function nyseHolidayForDate(date) {
  return HOLIDAY_BY_DATE.get(date) || null;
}

export function isNyseHoliday(date) {
  return Boolean(nyseHolidayForDate(date));
}

export function previousNyseTradingSession(date) {
  let cursor = date;
  while (isWeekend(cursor) || isNyseHoliday(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

export function latestCompletedNyseSession(now = new Date()) {
  let date = marketDateInNewYork(now);
  if (marketHourInNewYork(now) < 18) date = addDays(date, -1);
  return previousNyseTradingSession(date);
}

export function nextNyseHoliday(fromDate = marketDateInNewYork()) {
  return NYSE_HOLIDAYS.find(holiday => holiday.date >= fromDate) || null;
}

export function nyseCalendarSummary(now = new Date()) {
  const today = marketDateInNewYork(now);
  const todayHoliday = nyseHolidayForDate(today);
  return {
    exchange: "NYSE",
    source: "NYSE Holidays & Trading Hours",
    source_url: NYSE_HOLIDAY_SOURCE_URL,
    today,
    is_market_holiday: Boolean(todayHoliday),
    today_holiday: todayHoliday,
    next_holiday: nextNyseHoliday(today)
  };
}
