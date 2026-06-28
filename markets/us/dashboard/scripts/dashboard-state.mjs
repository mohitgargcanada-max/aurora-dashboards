export function isoTimestamp(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_GENERATED_AT_TIMESTAMP");
  const value = date.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error("INVALID_GENERATED_AT_TIMESTAMP");
  return value;
}

export function stampGeneratedAt(state, now = new Date()) {
  if (!state || typeof state !== "object") throw new Error("DASHBOARD_STATE_REQUIRED");
  return { ...state, generated_at: isoTimestamp(now) };
}
