import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { latestCompletedIndiaSession } from "../engine/trading-calendar.mjs";
import { parseScanArgs } from "../../../shared/scan-orchestration.mjs";
import { buildWeekdayPrioritySymbols, refreshIndiaDailyBars, refreshIndiaIndexCache } from "./refresh-india-daily-bars.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scanPath = resolve(projectRoot, "data/india-full-dashboard-scan.json");
const cliOptions = parseScanArgs(process.argv.slice(2));
const expectedSession = cliOptions.session || process.env.AURORA_TARGET_SESSION || latestCompletedIndiaSession();

async function activeSymbols() {
  return buildWeekdayPrioritySymbols({ scanPath });
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit" });
    child.on("exit", code => code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`)));
    child.on("error", reject);
  });
}

const active = await activeSymbols();
const requestedLimit = Number(process.env.AURORA_WEEKDAY_ACTIVE_SYMBOL_LIMIT || active.size || 80);
process.env.AURORA_DAILY_FALLBACK_SYMBOL_LIMIT = String(Math.max(1, requestedLimit));
process.env.TAPETIDE_DAILY_FALLBACK_SYMBOL_LIMIT = String(Math.max(1, Number(process.env.TAPETIDE_DAILY_FALLBACK_SYMBOL_LIMIT || requestedLimit)));

const providerOrder = (process.env.AURORA_WEEKDAY_PROVIDER_ORDER || "YAHOO,TAPETIDE,EODHD")
  .split(",")
  .map(item => item.trim().toUpperCase())
  .filter(Boolean);

const report = await refreshIndiaDailyBars({
  expectedSession,
  minCurrentCoverage: 0.0001,
  providerOrder
});

console.log(JSON.stringify({
  mode: "WEEKDAY_ACTIVE_LIST_REFRESH",
  expected_session: expectedSession,
  active_symbol_count: active.size,
  refresh_status: report.status,
  provider: report.provider,
  same_date_cache: report.same_date_cache,
  coverage: report.coverage
}, null, 2));

const indexReport = await refreshIndiaIndexCache({ expectedSession });
console.log(JSON.stringify({
  mode: "INDEX_REFRESH",
  expected_session: expectedSession,
  status: indexReport.status,
  provider: indexReport.provider,
  updated: indexReport.updated,
  missing_bar: indexReport.missing_bar,
  latest_index_data_as_of: indexReport.latest_index_data_as_of,
  same_date_cache: indexReport.same_date_cache
}, null, 2));

await run(process.execPath, ["scripts/run-full-dashboard-scan.mjs", `--mode=${cliOptions.mode || "WEEKDAY_EOD_UPDATE"}`, `--session=${expectedSession}`]);
