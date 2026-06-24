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
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function compactSession(session) {
  return String(session || "").replaceAll("-", "");
}
