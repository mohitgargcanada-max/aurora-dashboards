import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from './config.mjs';
import { validateHistoryPackage } from './external-history-tools.mjs';

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const result = await validateHistoryPackage({
    market: args.market || 'all',
    root: args.root,
    expectedSession: args['expected-session'],
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
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
