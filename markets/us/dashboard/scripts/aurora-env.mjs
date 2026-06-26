const EODHD_TOKEN_ALIASES = [
  "EODHD_API_TOKEN",
  "EODHD_API_KEY",
  "EODHD_TOKEN",
  "EODHD_KEY",
  "EODHD",
  "EODHD_TOKEN_VALUE",
  "EODHD_APIKEY",
  "EODHDAPIKEY",
  "EODHDTOKEN"
];

function normalizeKey(key) {
  return String(key || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function flattenObject(value, prefix = "", out = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}_${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item)) flattenObject(item, path, out);
    else out[path] = item;
  }
  return out;
}

export function parseBundledAuroraKeys(raw = process.env.AURORAKEYS) {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return flattenObject(parsed);
  } catch {
    // Fall through to dotenv-style parsing.
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/i, "");
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
  const merged = { ...bundled, ...env };
  const aliases = new Set(EODHD_TOKEN_ALIASES.map(normalizeKey));
  for (const [key, value] of Object.entries(merged)) {
    const normalized = normalizeKey(key);
    if (value && [...aliases].some(alias => normalized === alias || normalized.endsWith(alias))) return String(value);
  }
  return null;
}
