import { spawnSync } from "node:child_process";

const scanArgs = process.argv.slice(2);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.execPath, ["scripts/refresh-or-repair-us-data.mjs"]);
run(process.execPath, ["scripts/scan-universe.mjs", ...scanArgs]);
run(process.execPath, ["scripts/enrich-sector-classification.mjs"]);
run(process.execPath, ["scripts/scan-universe.mjs", ...scanArgs]);
run(process.execPath, ["scripts/scan-rs-leadership.mjs"]);
