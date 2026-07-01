import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_PROVENANCE_FIELDS = [
  "symbol",
  "market",
  "exchange",
  "provider",
  "endpoint_or_source",
  "retrieved_at",
  "data_as_of",
  "currency",
  "adjustment_status",
  "delayed_or_live",
  "fallback_reason",
  "warnings",
  "series_start",
  "series_end",
  "row_count",
  "checksum",
  "source_priority_label"
];

export const SOURCE_PRIORITY_LABELS = new Set([
  "FREE_PRIMARY",
  "YAHOO_FALLBACK",
  "EODHD_FALLBACK",
  "OFFICIAL_VERIFIED",
  "CROSS_VERIFIED",
  "STALE",
  "PARTIAL",
  "CONFLICT",
  "NOT_AVAILABLE"
]);

function asSeriesList(manifest) {
  if (Array.isArray(manifest)) return manifest;
  if (Array.isArray(manifest?.series)) return manifest.series;
  if (manifest && typeof manifest === "object") return [manifest];
  return [];
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function validateManifest(manifest) {
  const errors = [];
  const series = asSeriesList(manifest);
  if (!series.length) errors.push("MANIFEST_SERIES_REQUIRED");

  for (const [index, item] of series.entries()) {
    for (const field of REQUIRED_PROVENANCE_FIELDS) {
      if (!(field in item)) errors.push(`series[${index}].${field}:REQUIRED`);
    }
    if (item.source_priority_label && !SOURCE_PRIORITY_LABELS.has(item.source_priority_label)) {
      errors.push(`series[${index}].source_priority_label:INVALID`);
    }
    if (!item.checksum) errors.push(`series[${index}].checksum:REQUIRED_NONEMPTY`);
    if (!item.adjustment_status) errors.push(`series[${index}].adjustment_status:REQUIRED_NONEMPTY`);
    if (!Number.isInteger(item.row_count) || item.row_count <= 0) {
      errors.push(`series[${index}].row_count:MUST_BE_POSITIVE_INTEGER`);
    }
    if (!isIsoDate(item.series_start) || !isIsoDate(item.series_end)) {
      errors.push(`series[${index}].series_dates:YYYY_MM_DD_REQUIRED`);
    } else if (item.series_start > item.series_end) {
      errors.push(`series[${index}].series_start_after_series_end`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function readManifestFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const args = { file: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") args.file = argv[++index];
    else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: node scripts/market-data-backup/validate-market-data-manifest.mjs --file <manifest.json>");
    return 0;
  }
  if (!args.file) {
    console.error("--file is required");
    return 1;
  }
  const result = validateManifest(readManifestFile(args.file));
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  process.exitCode = runCli();
}
