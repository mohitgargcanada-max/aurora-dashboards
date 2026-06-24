const now = new Date();
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
const run = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday) && hour === 9 && minute < 20;

if (!run) {
  console.log(`Skipping cleanly outside 9am America/New_York run window: ${weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  process.exit(0);
}

console.log(`Run window confirmed: ${weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} America/New_York`);
