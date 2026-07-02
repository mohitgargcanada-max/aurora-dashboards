import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from './config.mjs';
import { fetch7yHistoryExternal } from './external-history-tools.mjs';

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const result = await fetch7yHistoryExternal({
    market: args.market || 'all',
    root: args.root,
    start: args.start,
    end: args.end,
    sampleSize: args['sample-size'],
    full: args.full === true,
    apply: args.apply === true,
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
