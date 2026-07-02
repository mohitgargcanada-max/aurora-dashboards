import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from './config.mjs';
import { validateBackupRoot } from '../market-data-backup/validate-backup-paths.mjs';

export const DEFAULT_7Y_SEED = Object.freeze({
  start: '2019-07-01',
  end: '2026-07-01',
  sampleSize: 10,
  cacheRepo: 'C:\\Users\\mohit\\Downloads\\aurora-market-cache',
  roots: Object.freeze({
    us: 'C:\\Users\\mohit\\Downloads\\aurora-history-seed\\us\\ohlcv',
    india: 'C:\\Users\\mohit\\Downloads\\aurora-history-seed\\india\\ohlcv',
    canada: 'C:\\Users\\mohit\\Downloads\\aurora-history-seed\\canada\\ohlcv',
  }),
});

const MARKETS = ['us', 'india', 'canada'];

const ROUTES = Object.freeze({
  us: ['YAHOO_FINANCE_PRIMARY', 'EODHD_FALLBACK_ONLY_FOR_MISSING_STALE_INCOMPLETE_UNSUPPORTED_FAILED'],
  india: ['NSE_BSE_OFFICIAL_PRIMARY', 'TAPETIDE_IF_OFFICIAL_INCOMPLETE_OR_BLOCKED', 'YAHOO_NS_BO_FALLBACK', 'EODHD_LAST_SUPPORTED_LISTINGS_ONLY'],
  canada: ['YAHOO_TO_V_PRIMARY', 'EODHD_FALLBACK_ONLY_FOR_MISSING_STALE_INCOMPLETE_UNSUPPORTED_FAILED'],
});

const APPLY_BLOCKERS = Object.freeze([
  'This command is a plan-only safety check and never writes data.',
  'Use fetch-7y-history-external.mjs with --apply for external history writes.',
  'Use package-history-snapshot.mjs with --apply for aurora-market-cache writes after validation passes.',
]);

function assertDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return value;
}

function isInsidePath(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertExternalRoot(root, label, sourceRoot) {
  const resolved = path.resolve(root);
  if (!path.isAbsolute(resolved)) throw new Error(`${label} must be absolute`);
  if (isInsidePath(resolved, sourceRoot)) throw new Error(`${label} must be outside the source repository`);
  return resolved;
}

function marketRoot(args, market, sourceRoot) {
  return assertExternalRoot(args[`${market}-root`] || DEFAULT_7Y_SEED.roots[market], `${market} history root`, sourceRoot);
}

export function planOneTime7yMarketHistorySeed(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || process.cwd());
  const start = assertDate(options.start || DEFAULT_7Y_SEED.start, '--start');
  const end = assertDate(options.end || DEFAULT_7Y_SEED.end, '--end');
  if (start > end) throw new Error('--start must be on or before --end');

  const cacheRepo = path.resolve(options.cacheRepo || DEFAULT_7Y_SEED.cacheRepo);
  const cacheRepoValidation = validateBackupRoot(cacheRepo, { sourceRoot });
  if (!cacheRepoValidation.ok) {
    throw new Error(`Invalid cache repo root: ${cacheRepoValidation.reason}`);
  }

  const sampleSize = Number(options.sampleSize ?? DEFAULT_7Y_SEED.sampleSize);
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new Error('--sample-size must be a positive integer');

  const roots = Object.fromEntries(MARKETS.map((market) => [market, marketRoot(options, market, sourceRoot)]));
  const apply = options.apply === true;
  if (apply) {
    throw new Error(`ONE_TIME_7Y_PLAN_ONLY_NO_WRITE: ${APPLY_BLOCKERS.join(' | ')}`);
  }

  return {
    mode: 'dry-run',
    applied: false,
    date_range: { start, end },
    sample_size: sampleSize,
    source_root: sourceRoot.replaceAll('\\', '/'),
    cache_repo: cacheRepo.replaceAll('\\', '/'),
    external_history_roots: Object.fromEntries(MARKETS.map((market) => [market, roots[market].replaceAll('\\', '/') ])),
    route_order: ROUTES,
    thresholds: {
      preferred_bars: 1500,
      true_5y_bars: 1260,
      three_year_bars: 756,
      two_year_bars: 504,
    },
    required_provenance: [
      'provider_per_symbol',
      'fallback_reason_per_symbol',
      'endpoint_or_source',
      'data_as_of',
      'retrieved_at',
      'currency',
      'adjustment_status',
      'warnings',
      'checksums',
    ],
    sequence: [
      'Run sample fetch for 10 symbols per market into external history roots only.',
      'Validate OHLCV, provider consistency, latest completed session, coverage thresholds, and checksums.',
      'Package validated files into aurora-market-cache latest and optional monthly/2026-07 snapshots.',
      'Dry-run restore from aurora-market-cache into active dashboard cache paths.',
      'Apply restore only after dry-run plan is inspected.',
      'Run all-market history audit and dashboard tests after restore.',
    ],
    existing_source_tools: {
      audit: 'node scripts/market-cache/audit-history-coverage.mjs --market all',
      india_validate: 'node scripts/market-cache/validate-india-history-package.mjs --root <external-india-root>',
      india_package_dry_run: 'node scripts/market-cache/package-india-history-snapshot.mjs --root <external-india-root> --cache-repo <external-cache-repo> --snapshot latest --snapshot-id latest --dry-run',
      fetch_external_sample: 'node scripts/market-cache/fetch-7y-history-external.mjs --market all --sample-size 10 --start 2019-07-01 --end 2026-07-01',
      validate_external_all: 'node scripts/market-cache/validate-history-package.mjs --market all --root <external-history-root>',
      package_external_all: 'node scripts/market-cache/package-history-snapshot.mjs --market all --root <external-history-root> --cache-repo <external-cache-repo> --snapshot latest --dry-run',
      restore_dry_run: 'node scripts/market-cache/restore-market-cache.mjs --market <market> --cache-repo <external-cache-repo> --snapshot latest --snapshot-id latest',
    },
    apply_blockers: APPLY_BLOCKERS,
  };
}

export function main(argv = process.argv.slice(2), { sourceRoot = process.cwd() } = {}) {
  const args = parseCliArgs(argv);
  const plan = planOneTime7yMarketHistorySeed({
    sourceRoot,
    start: args.start,
    end: args.end,
    cacheRepo: args['cache-repo'],
    sampleSize: args['sample-size'],
    'us-root': args['us-root'],
    'india-root': args['india-root'],
    'canada-root': args['canada-root'],
    apply: args.apply === true,
  });
  console.log(JSON.stringify(plan, null, 2));
  return plan;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
