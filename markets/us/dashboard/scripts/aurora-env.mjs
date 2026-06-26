export function parseBundledAuroraKeys(raw = process.env.AURORAKEYS) {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to dotenv-style parsing.
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export function resolveEodhdToken(env = process.env) {
  const bundled = parseBundledAuroraKeys(env.AURORAKEYS);
  return env.EODHD_API_TOKEN || env.EODHD_API_KEY || bundled.EODHD_API_TOKEN || bundled.EODHD_API_KEY || null;
}
