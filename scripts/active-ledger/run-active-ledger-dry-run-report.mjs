import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { populateLedgerFromScan } from './populate-active-tracking-ledger.mjs';
import { LEDGER_FILES, SUPPORTED_MARKETS } from './validate-active-tracking-ledger.mjs';

const SCAN_FILES = Object.freeze({
  us: 'markets/us/dashboard/data/us-full-dashboard-scan.json',
  india: 'markets/india/dashboard/data/india-full-dashboard-scan.json',
  canada: 'markets/canada/dashboard/data/canada-full-dashboard-scan.json',
});

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function hasPathTraversal(filePath) {
  return String(filePath).split(/[\\/]+/).includes('..') || String(filePath).includes('\0');
}

function normalizedPath(filePath) {
  return String(filePath).replace(/\\/g, '/');
}

function rejectsGeneratedOutput(filePath) {
  const normalized = normalizedPath(filePath);
  return /(^|\/)cache(\/|$)/.test(normalized)
    || /(^|\/)dashboard\/data\//.test(normalized)
    || /AURORA_.*Dashboard.*\.html$/.test(normalized)
    || /AURORA_.*Unified_Dashboard.*\.html$/.test(normalized);
}

function parseArgs(argv) {
  const args = { strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') args.all = true;
    else if (arg === '--strict') args.strict = true;
    else if (['--market', '--as-of', '--out', '--ledger', '--scan-file'].includes(arg)) {
      if (!argv[index + 1]) throw new Error(`${arg} requires a value`);
      args[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return args;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function marketConfig(market, args) {
  if (!SUPPORTED_MARKETS.includes(market)) throw new Error(`Unsupported market: ${market}`);
  if ((args.ledger || args.scanFile) && !args.market) {
    throw new Error('--ledger and --scan-file overrides require --market');
  }
  const ledger = args.ledger ?? LEDGER_FILES[market];
  const scanFile = args.scanFile ?? SCAN_FILES[market];
  if (hasPathTraversal(ledger) || hasPathTraversal(scanFile)) throw new Error('Path traversal is not allowed');
  return { market, ledger, scanFile };
}

function candidateLists(scan) {
  const found = [];
  const missing = [];
  const checks = [
    ['WEEKLY_UNIVERSE', /weekly[_-]?universe/i],
    ['WEEKLY_FOCUS', /weekly[_-]?focus/i],
    ['DAILY_TOP_1_4', /daily[_-]?top[_-]?(1[_-]?4|14)?/i],
    ['RSLE_TOP_20', /rsle[_-]?top[_-]?20|top[_-]?20/i],
    ['RSLE_DEVELOPING_21_40', /rsle[_-]?developing|developing[_-]?watchlist/i],
  ];
  const keys = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      visit(child);
    }
  }
  visit(scan);
  for (const [label, pattern] of checks) {
    if (keys.some(key => pattern.test(key))) found.push(label);
    else missing.push(label);
  }
  return { found, missing };
}

async function marketReport(config, asOf) {
  const base = {
    market: config.market,
    ledger_path: config.ledger,
    scan_file: config.scanFile,
    mode: 'DRY_RUN_ONLY',
    status: 'OK',
    confirmations: {
      ledger_files_written: false,
      workflow_run_triggered: false,
      providers_called: false,
      diagnostic_labels_converted_to_final_buckets: false,
      mfh_fomo_atr_context_only: true,
    },
  };

  if (!(await exists(config.scanFile))) {
    return { ...base, status: 'SCAN_FILE_MISSING', candidates: 0, added: 0, updated: 0, skipped: 0, skipped_reasons: {} };
  }

  const ledger = await readJson(config.ledger, 'ledger JSON');
  const scan = await readJson(config.scanFile, 'scan JSON');
  const result = populateLedgerFromScan({ ledger, scan, market: config.market, asOf });
  const lists = candidateLists(scan);
  return {
    ...base,
    status: result.report.status,
    candidate_lists_found: lists.found,
    candidate_lists_missing: lists.missing,
    candidates: result.report.candidates,
    added: result.report.added,
    updated: result.report.updated,
    skipped: result.report.skipped,
    skipped_reasons: result.report.skipped_reasons,
  };
}

async function writeReport(outPath, report) {
  if (hasPathTraversal(outPath)) throw new Error('Path traversal is not allowed');
  if (rejectsGeneratedOutput(outPath)) throw new Error('--out must not target cache, dashboard/data, or dashboard HTML artifacts');
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

export async function runDryRunReportCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const asOf = args.asOf ?? todayUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('--as-of must be YYYY-MM-DD');
  if (args.all && args.market) throw new Error('Use either --all or --market, not both');
  if (!args.all && !args.market) throw new Error('Usage: node scripts/active-ledger/run-active-ledger-dry-run-report.mjs --all|--market <us|india|canada> [--as-of YYYY-MM-DD] [--strict] [--out report.json]');
  if (args.market && !SUPPORTED_MARKETS.includes(args.market)) throw new Error(`Unsupported market: ${args.market}`);

  const markets = args.all ? SUPPORTED_MARKETS : [args.market];
  const reports = [];
  for (const market of markets) {
    reports.push(await marketReport(marketConfig(market, args), asOf));
  }
  const report = {
    generated_at: new Date().toISOString(),
    as_of: asOf,
    mode: 'DRY_RUN_ONLY',
    markets: reports,
  };

  if (args.out) await writeReport(args.out, report);
  console.log(JSON.stringify(report, null, 2));
  if (args.strict && reports.some(item => item.status !== 'OK' && item.status !== 'NO_CANDIDATES_FOUND')) {
    throw new Error('Active-ledger dry-run report found missing or invalid inputs');
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runDryRunReportCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
