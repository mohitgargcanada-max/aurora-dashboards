const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" });

function ymd(date) { return date.toISOString().slice(0, 10); }
function utcDateFromYmd(value) { return new Date(`${value}T12:00:00Z`); }
function dayOfWeek(value) { return utcDateFromYmd(value).getUTCDay(); }
function addDays(value, days) { const d = utcDateFromYmd(value); d.setUTCDate(d.getUTCDate() + days); return ymd(d); }
function observedWeekendHoliday(value) {
  const dow = dayOfWeek(value);
  if (dow === 6) return addDays(value, -1);
  if (dow === 0) return addDays(value, 1);
  return value;
}
function nthWeekday(year, monthIndex, weekday, nth) {
  const d = new Date(Date.UTC(year, monthIndex, 1, 12));
  const offset = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(1 + offset + (nth - 1) * 7);
  return ymd(d);
}
function lastWeekday(year, monthIndex, weekday) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0, 12));
  const offset = (d.getUTCDay() - weekday + 7) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return ymd(d);
}
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function canadaMarketHolidays(year) {
  const easter = easterSunday(year);
  return new Set([
    observedWeekendHoliday(`${year}-01-01`),
    addDays(easter, -2),
    nthWeekday(year, 1, 1, 3),
    lastWeekday(year, 4, 1),
    observedWeekendHoliday(`${year}-07-01`),
    nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 9, 1, 2),
    observedWeekendHoliday(`${year}-12-25`),
    observedWeekendHoliday(`${year}-12-26`)
  ]);
}

export function isCanadaTradingDay(value) {
  const dow = dayOfWeek(value);
  if (dow === 0 || dow === 6) return false;
  return !canadaMarketHolidays(Number(value.slice(0, 4))).has(value);
}

export function previousCanadaTradingDay(value) {
  let d = addDays(value, -1);
  while (!isCanadaTradingDay(d)) d = addDays(d, -1);
  return d;
}

export function latestCompletedCanadaSession(now = new Date()) {
  const parts = Object.fromEntries(fmt.formatToParts(now).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  const today = dateFmt.format(now);
  const hour = Number(parts.hour);
  if (isCanadaTradingDay(today) && hour >= 17) return today;
  return previousCanadaTradingDay(today);
}
