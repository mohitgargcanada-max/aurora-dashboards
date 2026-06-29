if (!process.argv.some(arg => arg.startsWith("--mode="))) process.argv.push("--mode=WEEKDAY_EOD_UPDATE");
await import("./run-full-dashboard-scan.mjs");
