import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_PATTERNS = [
  /(^|\/)markets\/[^/]+\/dashboard\/cache(\/|$)/,
  /(^|\/)markets\/[^/]+\/dashboard\/data(\/|$)/,
  /(^|\/)cache(\/|$)/,
  /(^|\/)AURORA_.*Dashboard.*\.html$/i,
  /(^|\/)AURORA_.*Unified_Dashboard.*\.html$/i
];

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

export function isForbiddenBackupPath(candidatePath) {
  const normalized = normalizePath(candidatePath);
  return FORBIDDEN_PATTERNS.some(pattern => pattern.test(normalized));
}

export function isInsidePath(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateBackupRoot(candidateRoot, { sourceRoot = process.cwd() } = {}) {
  if (!candidateRoot) {
    return { ok: false, reason: "BACKUP_ROOT_REQUIRED" };
  }
  if (!path.isAbsolute(candidateRoot)) {
    return { ok: false, reason: "BACKUP_ROOT_MUST_BE_ABSOLUTE" };
  }
  if (isForbiddenBackupPath(candidateRoot)) {
    return { ok: false, reason: "BACKUP_ROOT_MATCHES_GENERATED_SOURCE_PATH" };
  }
  if (isInsidePath(candidateRoot, sourceRoot)) {
    return { ok: false, reason: "BACKUP_ROOT_INSIDE_SOURCE_REPO" };
  }
  return { ok: true, reason: "BACKUP_ROOT_ACCEPTED" };
}

function parseArgs(argv) {
  const args = { root: null, sourceRoot: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.root = argv[++index];
    else if (arg === "--source-root") args.sourceRoot = argv[++index];
    else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log("Usage: node scripts/market-data-backup/validate-backup-paths.mjs --root <absolute-external-backup-root> [--source-root <repo-root>]");
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const result = validateBackupRoot(args.root, { sourceRoot: args.sourceRoot });
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  process.exitCode = runCli();
}
