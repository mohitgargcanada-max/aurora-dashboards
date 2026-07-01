import path from "node:path";
import { fileURLToPath } from "node:url";

export function buildBackupPlan() {
  return {
    dry_run: true,
    recommended_destination: "separate private repo: aurora-market-data-backup",
    fallback_destination: "dedicated data branch: data/aurora-market-history",
    writes_data: false,
    provider_calls: false,
    runs_scans: false,
    structure: {
      data: {
        us: ["ohlcv", "indices", "fundamentals_optional", "manifests"],
        india: ["ohlcv", "indices", "bhavcopy_optional", "manifests"],
        canada: ["ohlcv", "indices", "fundamentals_optional", "manifests"],
        snapshots: ["weekly"],
        audit: [],
        "validation-reports": []
      }
    },
    steps: [
      "checkout source main",
      "restore latest backup package into local runtime cache",
      "validate restored cache",
      "run dashboard scan outside this dry-run planner",
      "append only new completed bars",
      "validate appended dataset",
      "package compressed backup",
      "push backup only to backup repo or data branch",
      "never commit restored/generated data to source main"
    ]
  };
}

export function renderPlan(plan = buildBackupPlan()) {
  return JSON.stringify(plan, null, 2);
}

export function runCli(argv = process.argv.slice(2)) {
  if (argv.includes("--apply")) {
    console.error("--apply is not implemented. This planner is dry-run only.");
    return 1;
  }
  if (argv.includes("--help")) {
    console.log("Usage: node scripts/market-data-backup/plan-market-data-backup.mjs");
    return 0;
  }
  console.log(renderPlan());
  return 0;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  process.exitCode = runCli();
}
