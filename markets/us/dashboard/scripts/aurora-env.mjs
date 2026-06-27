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
  "EOD_API_TOKEN",
  "EOD_API_KEY",
  "EOD_TOKEN",
  "EOD_KEY",
  "EOD",
  "EOD_HISTORICAL_DATA_API_KEY",
  "EOD_HISTORICAL_DATA_API_TOKEN",
  "EOD_HISTORICAL_DATA_TOKEN",
  "EOD_HISTORICAL_DATA_KEY",
  "EOD_HISTORICAL_DATA",
  "EODH_API_KEY",
  "EODH_TOKEN",
  "EODH_KEY",
  "EODHD_APIKEY",
  "EODHDAPIKEY",
  "EODHDTOKEN"
];

const IDENTITY_FIELDS = ["name", "provider", "service", "source", "connector", "id", "key"];
const VALUE_FIELDS = ["value", "secret", "token", "api_token", "apiToken", "api_key", "apiKey", "credential", "key"];

function normalizeKey(key) {
  return String(key || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isCredentialKey(key) {
  const normalized = normalizeKey(key);
  const aliases = EODHD_TOKEN_ALIASES.map(normalizeKey);
  if (aliases.some(alias => normalized === alias || normalized.endsWith(alias))) return true;
  const namesEodhd = normalized.includes("EODHD") || normalized.includes("EODHISTORICALDATA") || normalized.includes("EOD");
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

function unquote(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function expandEmbeddedBundles(out) {
  const expanded = { ...out };
  for (const value of Object.values(out)) {
    const text = primitiveValue(value).trim();
    if (!text || !/EOD/i.test(text) || !/[{=:\n]/.test(text)) continue;
    for (const [key, embedded] of Object.entries(parseAuroraKeys(text))) {
      if (embedded && isCredentialKey(key)) expanded[key] ??= embedded;
    }
  }
  return expanded;
}

export function parseAuroraKeys(raw = process.env.AURORAKEYS) {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string" && parsed.trim()) return { EODHD: parsed.trim() };
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return expandEmbeddedBundles(flattenObject(parsed));
    if (Array.isArray(parsed)) return expandEmbeddedBundles(flattenObject(parsed));
  } catch {
    // Fall through to dotenv-style parsing.
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/i, "");
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    const colonIndex = trimmed.indexOf(":");
    const index = equalsIndex > 0 ? equalsIndex : colonIndex > 0 ? colonIndex : -1;
    if (index <= 0) {
      const [key, ...rest] = trimmed.split(/\s+/);
      if (rest.length && isCredentialKey(key)) out[key] = unquote(rest.join(" "));
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    out[key] = unquote(trimmed.slice(index + 1));
  }
  if (!Object.keys(out).length && !/\s/.test(text)) return { EODHD: text };
  return expandEmbeddedBundles(out);
}

export function resolveEodhdToken(env = process.env) {
  if (env.EODHD_API_TOKEN) return String(env.EODHD_API_TOKEN);
  if (env.EODHD_API_KEY) return String(env.EODHD_API_KEY);
  const bundled = parseAuroraKeys(env.AURORAKEYS);
  if (bundled.EODHD_API_TOKEN) return String(bundled.EODHD_API_TOKEN);
  if (bundled.EODHD_API_KEY) return String(bundled.EODHD_API_KEY);
  for (const [key, value] of Object.entries(bundled)) {
    if (value && isCredentialKey(key)) return String(value);
  }
  return null;
}

export const parseBundledAuroraKeys = parseAuroraKeys;
