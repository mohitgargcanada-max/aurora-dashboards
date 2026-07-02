import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from './config.mjs';
import { validateIndiaHistoryPackage } from './india-history-tools.mjs';

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (!args.root) throw new Error('Usage: node scripts/market-cache/validate-india-history-package.mjs --root <external-history-root>');
  const result = await validateIndiaHistoryPackage(path.resolve(args.root));
  console.log(JSON.stringify({
    ok: result.ok,
    root: result.root,
    coverage: result.coverage,
    errors: result.errors.slice(0, 50),
    error_count: result.errors.length,
  }, null, 2));
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
