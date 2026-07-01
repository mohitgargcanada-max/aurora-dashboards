import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const REQUIRED_LATEST_KEYS = ["schema_version", "market", "data_as_of", "completed_session", "generated_at", "scan_url"];
const REQUIRED_SCAN_SECTIONS = [
  "weekly_universe",
  "weekly_focus",
  "daily_top_1_4",
  "rsle_top_20",
  "developing_watchlist",
  "near_rs_high",
  "aurora_radar_universe",
  "strong_rs_retention",
  "soft_rs_reject_recovered",
  "myh_breakout_retest",
  "industry_group_rrg",
  "industry_rrg",
  "sub_industry_rrg",
  "rejected_data_repair",
  "all_candidates"
];
const FORBIDDEN_EXTERNAL_KEYS = new Set([
  "email_body",
  "email_symbols",
  "email_thread_id",
  "external_report",
  "external_report_data",
  "external_report_symbols",
  "gmail_message_id",
  "gmail_thread_id",
  "report_symbols",
  "traderlion_report",
  "traderlion_symbols"
]);

function parseArgs(argv) {
  const args = { dir: resolve(root, "data"), runStartIso: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run-start-iso") args.runStartIso = argv[++i] || "";
    else if (arg.startsWith("--run-start-iso=")) args.runStartIso = arg.slice("--run-start-iso=".length);
    else if (arg === "--dir") args.dir = resolve(argv[++i] || "");
    else if (arg.startsWith("--dir=")) args.dir = resolve(arg.slice("--dir=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function readJson(path, errors) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
    return null;
  }
}

function symbolSet(rows) {
  return new Set(rows.map(row => row?.symbol || row?.ticker).filter(Boolean));
}

function hasBlockedRefreshReason(scan) {
  const evidence = [
    scan?.status,
    scan?.run_status,
    scan?.refresh_status,
    scan?.run_mode_reason,
    scan?.market_summary?.status,
    scan?.market_summary?.run_status,
    scan?.provenance?.run_mode_reason,
    ...(Array.isArray(scan?.provenance?.warnings) ? scan.provenance.warnings : []),
    ...(Array.isArray(scan?.notes) ? scan.notes : [])
  ];
  return evidence.some(value => String(value || "").includes("DATA_REFRESH_BLOCKED"));
}

function generatedAtIsFresh(value, runStartIso) {
  if (!runStartIso) return true;
  const generated = Date.parse(value);
  const runStart = Date.parse(runStartIso);
  return Number.isFinite(generated) && Number.isFinite(runStart) && generated >= runStart;
}

function findForbiddenKeys(value, path = "$", out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${path}[${index}]`, out));
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    const allowedAuditFlag = path === "$.scan.audit_contract" && (key === "contains_external_report_data" || key === "contains_email_data");
    if (!allowedAuditFlag && FORBIDDEN_EXTERNAL_KEYS.has(key.toLowerCase())) out.push(childPath);
    findForbiddenKeys(item, childPath, out);
  }
  return out;
}

export async function validateJsonExportContract({ dir = resolve(root, "data"), runStartIso = null } = {}) {
  const errors = [];
  const latest = await readJson(resolve(dir, "latest.json"), errors);
  const scan = await readJson(resolve(dir, "us-full-dashboard-scan.json"), errors);
  if (!latest || !scan) return { ok: false, errors };

  for (const key of REQUIRED_LATEST_KEYS) if (!Object.hasOwn(latest, key)) errors.push(`latest.json missing required key: ${key}`);
  if (latest.market !== "US") errors.push(`latest.json market must be US, got ${latest.market}`);
  if (!String(latest.scan_url || "").endsWith("us-full-dashboard-scan.json")) errors.push("latest.json scan_url must point to us-full-dashboard-scan.json");
  if (!generatedAtIsFresh(latest.generated_at, runStartIso)) errors.push(`latest.json generated_at is older than run start: ${latest.generated_at} < ${runStartIso}`);

  if (scan.market !== "US") errors.push(`us-full-dashboard-scan.json market must be US, got ${scan.market}`);
  if (!generatedAtIsFresh(scan.generated_at, runStartIso)) errors.push(`us-full-dashboard-scan.json generated_at is older than run start: ${scan.generated_at} < ${runStartIso}`);
  for (const key of REQUIRED_SCAN_SECTIONS) {
    if (!Object.hasOwn(scan, key)) errors.push(`us-full-dashboard-scan.json missing required section: ${key}`);
    else if (!Array.isArray(scan[key])) errors.push(`us-full-dashboard-scan.json section must be an array: ${key}`);
  }

  if (Array.isArray(scan.weekly_universe)) {
    if (scan.weekly_universe.length === 0 && !hasBlockedRefreshReason(scan)) errors.push("weekly_universe is empty without DATA_REFRESH_BLOCKED status evidence");
    else if (scan.weekly_universe.length > 0 && (scan.weekly_universe.length < 15 || scan.weekly_universe.length > 20)) errors.push(`weekly_universe must contain 15-20 rows, got ${scan.weekly_universe.length}`);
  }

  if (Array.isArray(scan.daily_top_1_4) && Array.isArray(scan.weekly_focus) && scan.daily_top_1_4.length) {
    const weeklyFocusSymbols = symbolSet(scan.weekly_focus);
    for (const symbol of symbolSet(scan.daily_top_1_4)) if (!weeklyFocusSymbols.has(symbol)) errors.push(`daily_top_1_4 symbol is not in weekly_focus: ${symbol}`);
  }

  for (const keyPath of findForbiddenKeys({ latest, scan })) errors.push(`external report/email field is not allowed: ${keyPath}`);
  if (scan.audit_contract) {
    if (scan.audit_contract.contains_external_report_data !== false) errors.push("audit_contract.contains_external_report_data must be false");
    if (scan.audit_contract.contains_email_data !== false) errors.push("audit_contract.contains_email_data must be false");
  }

  return { ok: errors.length === 0, errors };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await validateJsonExportContract({ dir: args.dir, runStartIso: args.runStartIso });
  if (!result.ok) {
    console.error("US_JSON_EXPORT_CONTRACT_INVALID");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ status: "PASS", latest: resolve(args.dir, "latest.json"), scan: resolve(args.dir, "us-full-dashboard-scan.json") }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
