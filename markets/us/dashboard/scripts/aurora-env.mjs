const EODHD_TOKEN_ALIASES = [
  "EODHD_API_TOKEN",
  "EODHD_API_KEY",
  "EODHD_API",
  "EODHD_TOKEN",
  "EODHD_KEY",
  "EODHD",
  "EODHD_TOKEN_VALUE",
  "EODHD_SECRET",
  "EODHD_CREDENTIAL",
  "EOD_HISTORICAL_DATA_API_KEY",
  "EOD_HISTORICAL_DATA_TOKEN",
  "EOD_HISTORICAL_DATA_KEY",
  "EODHD_APIKEY",
  "EODHDAPIKEY",
  "EODHDTOKEN"
];

const IDENTITY_FIELDS = ["name", "key", "id", "provider", "service", "source", "connector"];
const VALUE_FIELDS = ["value", "secret", "token", "api_token", "apiToken", "api_key", "apiKey", "credential"];

function normalizeKey(key) {
  return String(key || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isCredentialKey(key) {
  const normalized = normalizeKey(key);
  const aliases = EODHD_TOKEN_ALIASES.map(normalizeKey);
  if (aliases.some(alias => normalized === alias || normalized.endsWith(alias))) return true;
  const namesEodhd = normalized.includes("EODHD") || normalized.includes("EODHISTORICALDATA");
  const namesSecret = ["API", "TOKEN", "KEY", "SECRET", "CREDENTIAL"].some(part => normalized.includes(part));
  return namesEodhd && namesSecret;
}

function primitiveValue(value) {
  return value === null || value === undefined || typeof value === "object" ? "" : String(value);
}

function addStructuredSecretAlias(value, out) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const identity = IDENTITY_FIELDS.map(field => primitiveValue(value[field])).find(Boolean);
  if (!identity || !isCredentialKey(identity)) return;
  const secret = VALUE_FIELDS.map(field => primitiveValue(value[field])).find(Boolean);
  if (secret) out[identity] = secret;
}

function flattenObject(value, prefix = "", out = {}) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenObject(item, prefix ? `${prefix}_${index}` : String(index), out));
    return out;
  }
  addStructuredSecretAlias(value, out);
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}_${key}` : key;
    if (item && typeof item === "object") flattenObject(item, path, out);
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
  for (const [key, value] of Object.entries(merged)) {
    if (value && isCredentialKey(key)) return String(value);
  }
  return null;
}
