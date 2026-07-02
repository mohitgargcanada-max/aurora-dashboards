import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from './config.mjs';
import { buildIndiaHistorySnapshotPlan } from './india-history-tools.mjs';

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.apply) throw new Error('India history snapshot packaging is dry-run only in this source PR');
  if (!args.root || !args['cache-repo']) {
    throw new Error('Usage: node scripts/market-cache/package-india-history-snapshot.mjs --root <external-history-root> --cache-repo <external-cache-repo> [--snapshot latest|weekly|monthly] [--snapshot-id latest|YYYY-WW|YYYY-MM] [--dry-run]');
  }
  const snapshot = args.snapshot || 'latest';
  const snapshotId = args['snapshot-id'] || (snapshot === 'latest' ? 'latest' : undefined);
  const result = await buildIndiaHistorySnapshotPlan({
    root: path.resolve(args.root),
    cacheRepo: path.resolve(args['cache-repo']),
    snapshot,
    snapshotId,
  });
  console.log(JSON.stringify(result, null, 2));
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
