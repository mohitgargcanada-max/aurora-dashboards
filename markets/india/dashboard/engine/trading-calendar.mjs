export const INDIA_EXCHANGE_HOLIDAY_SOURCE_URL = "https://www.nseindia.com/resources/exchange-communication-holidays";

export const INDIA_EXCHANGE_HOLIDAYS = [
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-03-03", name: "Holi" },
  { date: "2026-03-26", name: "Shri Ram Navami" },
  { date: "2026-03-31", name: "Mahavir Jayanti" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-14", name: "Dr. Baba Saheb Ambedkar Jayanti" },
  { date: "2026-05-01", name: "Maharashtra Day" },
  { date: "2026-05-28", name: "Bakri Id" },
  { date: "2026-06-26", name: "Muharram" },
  { date: "2026-09-14", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti" },
  { date: "2026-10-20", name: "Dussehra" },
  { date: "2026-11-10", name: "Diwali Balipratipada" },
  { date: "2026-11-24", name: "Guru Nanak Jayanti" },
  { date: "2026-12-25", name: "Christmas" }
];

const INDIA_EXCHANGE_HOLIDAY_BY_DATE = new Map(INDIA_EXCHANGE_HOLIDAYS.map(holiday => [holiday.date, holiday]));

function isWeekendDate(date) {
  return [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

export function marketDateInIndia(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function indiaHolidayForDate(date) {
  return INDIA_EXCHANGE_HOLIDAY_BY_DATE.get(date) || null;
}

export function isIndiaMarketHoliday(date) {
  return isWeekendDate(date) || Boolean(indiaHolidayForDate(date));
}

export function indiaCalendarSummary(now = new Date()) {
  const today = marketDateInIndia(now);
  const todayHoliday = indiaHolidayForDate(today);
  return {
    exchange: "NSE/BSE",
    source: "NSE Trading Holidays",
    source_url: INDIA_EXCHANGE_HOLIDAY_SOURCE_URL,
    today,
    is_market_holiday: isIndiaMarketHoliday(today),
    today_holiday: todayHoliday
  };
}

function isIndiaTradingHoliday(date) {
  return isIndiaMarketHoliday(date.toISOString().slice(0, 10));
}

export function latestCompletedIndiaSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(now);
  const get = type => Number(parts.find(part => part.type === type)?.value);
  const date = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const hour = get("hour");
  if (hour < 18) date.setUTCDate(date.getUTCDate() - 1);
  while (isIndiaTradingHoliday(date)) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function compactSession(session) {
  return String(session || "").replaceAll("-", "");
}
