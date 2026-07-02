import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditIndiaHistoryCoverage } from './india-history-tools.mjs';
import { parseCliArgs } from './config.mjs';

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const root = path.resolve(args.root || 'markets/india/dashboard/cache/india/ohlcv');
  const result = await auditIndiaHistoryCoverage(root);
  console.log(JSON.stringify({
    root: result.root,
    coverage: result.coverage,
    errors: result.errors.slice(0, 50),
    error_count: result.errors.length,
  }, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
