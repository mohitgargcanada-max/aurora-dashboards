import path from 'node:path';

export const SUPPORTED_MARKETS = Object.freeze(['us', 'india', 'canada']);

export const DEFAULT_SOURCE_PATHS = Object.freeze({
  us: 'markets/us/dashboard/cache',
  india: 'markets/india/dashboard/cache',
  canada: 'markets/canada/dashboard/cache',
});

const SOURCE_CODE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
]);

const SOURCE_CODE_ROOTS = new Set([
  '.github',
  'docs',
  'markets',
  'scripts',
  'src',
  'test',
  'tests',
]);

export function assertMarket(market) {
  if (!SUPPORTED_MARKETS.includes(market)) {
    throw new Error(`Unsupported market: ${market}`);
  }
  return market;
}

export function assertSnapshot(snapshot, snapshotId) {
  if (!['latest', 'weekly', 'monthly'].includes(snapshot)) {
    throw new Error(`Unsupported snapshot: ${snapshot}`);
  }
  if (snapshot === 'latest' && snapshotId !== 'latest') {
    throw new Error('latest snapshots require --snapshot-id latest');
  }
  if (snapshot === 'weekly' && !/^\d{4}-\d{2}$/.test(snapshotId)) {
    throw new Error('weekly snapshots require --snapshot-id YYYY-WW');
  }
  if (snapshot === 'monthly' && !/^\d{4}-\d{2}$/.test(snapshotId)) {
    throw new Error('monthly snapshots require --snapshot-id YYYY-MM');
  }
}

export function defaultSourcePath(market) {
  assertMarket(market);
  return DEFAULT_SOURCE_PATHS[market];
}

export function snapshotRoot(cacheRepo, market, snapshot, snapshotId) {
  assertMarket(market);
  assertSnapshot(snapshot, snapshotId);
  if (snapshot === 'latest') {
    return path.join(cacheRepo, market, 'latest');
  }
  return path.join(cacheRepo, market, snapshot, snapshotId);
}

export function manifestPath(cacheRepo, market) {
  assertMarket(market);
  return path.join(cacheRepo, 'manifests', `${market}-cache-manifest.json`);
}

export function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--apply') {
      args.apply = true;
    } else if (arg.startsWith('--')) {
      args[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return args;
}

export function isSourceCodePath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const base = path.posix.basename(normalized).toLowerCase();
  return SOURCE_CODE_ROOTS.has(parts[0]) || base === 'package.json' || SOURCE_CODE_EXTENSIONS.has(path.posix.extname(base));
}

export function shouldIncludeCacheFile(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const base = path.posix.basename(normalized).toLowerCase();
  const parts = normalized.split('/');

  if (!normalized || normalized.includes('\0')) return false;
  if (path.posix.isAbsolute(normalized)) return false;
  if (parts.includes('..')) return false;
  if (parts.some((part) => part === '.git' || part.startsWith('.'))) return false;
  if (['thumbs.db', 'desktop.ini', '.ds_store'].includes(base)) return false;
  if (isSourceCodePath(normalized)) return false;
  if (/AURORA_.*Dashboard.*\.html$/i.test(base)) return false;
  if (/AURORA_.*Unified_Dashboard.*\.html$/i.test(base)) return false;
  if (/^dashboard\/data\/.*\.json$/i.test(normalized)) return false;
  if (/\/dashboard\/data\/.*\.json$/i.test(normalized)) return false;

  return true;
}

export function assertSafeRelativePath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized) || parts.includes('..')) {
    throw new Error(`Unsafe manifest file path: ${relativePath}`);
  }
  return normalized;
}

export function resolveAllowedRestoreTarget(market, targetPath, { sourceRoot = process.cwd() } = {}) {
  const allowedRoot = path.resolve(sourceRoot, defaultSourcePath(market));
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(allowedRoot, resolvedTarget);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedTarget;
  }
  throw new Error(`Restore target outside allowed ${market} cache root: ${targetPath}`);
}
