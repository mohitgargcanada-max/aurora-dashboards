import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { refreshDailyBars } from "./refresh-stooq-daily-bars.mjs";
import { repairUsHistory } from "./repair-us-history-5y.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const summaryPath = resolve(projectRoot, "data/us-refresh-or-repair-report.json");

async function main() {
  const allowStale = process.argv.includes("--allow-stale") || process.env.AURORA_ALLOW_STALE_REFRESH === "1";
  const strictCurrent = process.argv.includes("--strict-current") || process.env.AURORA_STRICT_CURRENT_HISTORY_REPAIR === "1";
  const result = { generated_at: new Date().toISOString(), daily_refresh: null, history_repair: null, final_status: null };
  try {
    const daily = await refreshDailyBars({ allowStale: false });
    result.daily_refresh = daily;
    result.final_status = daily.status;
    try {
      result.history_repair = await repairUsHistory({ staleOnly: true, strictCurrent: false, allowStale: true });
    } catch (repairAfterDailyError) {
      result.history_repair = repairAfterDailyError.report || { status: "FAILED_AFTER_DAILY_REFRESH", warning: repairAfterDailyError.message };
    }
  } catch (error) {
    result.daily_refresh = error.report || { status: "FAILED", warning: error.message };
    try {
      const repair = await repairUsHistory({ staleOnly: true, strictCurrent, allowStale });
      result.history_repair = repair;
      result.final_status = repair.status;
    } catch (repairError) {
      result.history_repair = repairError.report || { status: "FAILED", warning: repairError.message };
      result.final_status = "DATA_REFRESH_BLOCKED";
      if (!allowStale) {
        await mkdir(resolve(summaryPath, ".."), { recursive: true });
        await writeFile(summaryPath, JSON.stringify(result, null, 2), "utf8");
        const finalError = new Error("US data refresh and 5Y repair both failed");
        finalError.report = result;
        throw finalError;
      }
    }
  }
  await mkdir(resolve(summaryPath, ".."), { recursive: true });
  await writeFile(summaryPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    if (error.report) console.error(JSON.stringify(error.report));
    throw error;
  });
}
