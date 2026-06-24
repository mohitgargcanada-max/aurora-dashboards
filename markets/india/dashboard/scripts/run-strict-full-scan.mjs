import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const refreshReportPath = resolve(projectRoot, "data/india-daily-refresh-report.json");

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit"
    });
    child.on("exit", code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
}

function explicitSession() {
  return process.argv.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg)) || process.env.AURORA_TARGET_SESSION || null;
}

async function readRefreshReport() {
  try {
    return JSON.parse(await readFile(refreshReportPath, "utf8"));
  } catch {
    return null;
  }
}

async function handleBlockedRefresh() {
  const report = await readRefreshReport();
  if (report?.status !== "DATA_REFRESH_BLOCKED") return false;
  console.error(JSON.stringify(report, null, 2));
  console.error("DATA_REFRESH_BLOCKED: preserving last-good India dashboard; current scan skipped.");
  return true;
}

async function refreshedSession() {
  const report = await readRefreshReport();
  if (!report) throw new Error("DAILY_REFRESH_REPORT_NOT_FOUND");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.expected_completed_session)) {
    throw new Error("DAILY_REFRESH_REPORT_MISSING_EXPECTED_SESSION");
  }
  return report.expected_completed_session;
}

const session = explicitSession();
try {
  await run(process.execPath, ["scripts/refresh-india-daily-bars.mjs", ...(session ? [session] : [])]);
} catch (error) {
  if (await handleBlockedRefresh()) process.exit(0);
  throw error;
}
if (await handleBlockedRefresh()) process.exit(0);
await run(process.execPath, ["scripts/run-full-dashboard-scan.mjs", await refreshedSession()]);
