import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backupMarketCache } from '../backup-market-cache.mjs';
import { assertMarket, defaultSourcePath } from '../config.mjs';
import { hashFile } from '../hash-file.mjs';
import {
  buildIndiaHistorySnapshotPlan,
  validateIndiaHistoryPackage,
} from '../india-history-tools.mjs';
import { restoreMarketCache } from '../restore-market-cache.mjs';
import { loadManifest, validateManifest } from '../validate-manifest.mjs';

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aurora-market-cache-test-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeFixtureCache(root) {
  await mkdir(path.join(root, 'nested'), { recursive: true });
  await mkdir(path.join(root, 'dashboard', 'data'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, '.git'), { recursive: true });
  await writeFile(path.join(root, 'AAA.json'), '{"close":101}\n');
  await writeFile(path.join(root, 'nested', 'BBB.csv'), 'date,close\n2026-06-26,5\n');
  await writeFile(path.join(root, 'dashboard', 'data', 'scan.json'), '{"generated":true}\n');
  await writeFile(path.join(root, 'AURORA_US_Dashboard.html'), '<html></html>\n');
  await writeFile(path.join(root, 'package.json'), '{"private":true}\n');
  await writeFile(path.join(root, 'scripts', 'backup.mjs'), 'export default true;\n');
  await writeFile(path.join(root, 'src', 'helper.js'), 'export default true;\n');
  await writeFile(path.join(root, '.DS_Store'), 'junk\n');
  await writeFile(path.join(root, '.git', 'config'), 'junk\n');
}

function indiaBars(count, { start = '2020-01-01', provider = null } = {}) {
  const startDate = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      volume: 1000,
      ...(provider ? { provider } : {}),
    };
  });
}

async function writeIndiaHistoryRecord(root, fileName, { bars = indiaBars(504), provider = 'NSE_OFFICIAL_BHAVCOPY', symbol = 'AAA', exchange = 'NSE', series = 'EQ' } = {}) {
  await mkdir(path.dirname(path.join(root, fileName)), { recursive: true });
  await writeFile(path.join(root, fileName), `${JSON.stringify({
    market: 'india',
    exchange,
    symbol,
    series,
    provider,
    data_as_of: bars.at(-1)?.date || null,
    bars,
  }, null, 2)}\n`);
}

async function writeUsBackupPackage(root, options = {}) {
  const content = options.content ?? '{"close":101}\n';
  const relativePath = options.filePath ?? 'AAA.json';
  const cacheRepo = path.join(root, 'aurora-market-cache');
  const snapshot = path.join(cacheRepo, 'us', 'latest');
  const filePath = path.join(snapshot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  const bytes = Buffer.byteLength(content);
  const manifest = {
    schema_version: '1.0',
    market: options.manifestMarket ?? 'us',
    snapshot_type: options.snapshotType ?? 'latest',
    snapshot_id: options.snapshotId ?? 'latest',
    created_at: '2026-06-28T00:00:00.000Z',
    source_repo: 'aurora-dashboards',
    source_commit: 'test-commit',
    data_as_of: '2026-06-26',
    source_cache_path: 'markets/us/dashboard/cache',
    file_count: 1,
    total_bytes: bytes,
    files: [{ path: relativePath, bytes, sha256: await hashFile(filePath) }],
    warnings: [],
  };
  await mkdir(path.join(cacheRepo, 'manifests'), { recursive: true });
  await writeFile(path.join(cacheRepo, 'manifests', 'us-cache-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { cacheRepo, snapshot, manifest };
}

test('unsupported market rejected', async () => {
  await assert.rejects(
    () => backupMarketCache({ market: 'uk', cacheRepo: 'unused' }),
    /Unsupported market: uk/,
  );
});

test('US, India, Canada are all accepted', () => {
  for (const market of ['us', 'india', 'canada']) {
    assert.equal(assertMarket(market), market);
    assert.match(defaultSourcePath(market), new RegExp(`markets/${market}/dashboard/cache`));
  }
});

// Phase B intentionally validates dry-run restore/backup behavior only. Production apply-mode tests and apply-mode execution are deferred to Phase C, before apply mode can be enabled.
test('backup dry-run writes nothing', async (t) => {
  const root = await tempDir(t);
  const source = path.join(root, 'source');
  const cacheRepo = path.join(root, 'aurora-market-cache');
  await mkdir(source, { recursive: true });
  await writeFixtureCache(source);

  const result = await backupMarketCache({
    market: 'us',
    source,
    cacheRepo,
    snapshot: 'latest',
    snapshotId: 'latest',
  });

  assert.equal(result.applied, false);
  assert.equal(await exists(path.join(cacheRepo, 'us', 'latest', 'AAA.json')), false);
  assert.equal(await exists(path.join(cacheRepo, 'manifests', 'us-cache-manifest.json')), false);
});

test('backup dry-run excludes generated artifacts and source-code paths', async (t) => {
  const root = await tempDir(t);
  const destination = await tempDir(t);
  const source = path.join(root, 'source');
  const cacheRepo = path.join(destination, 'aurora-market-cache');
  await mkdir(source, { recursive: true });
  await writeFixtureCache(source);

  const result = await backupMarketCache({
    market: 'us',
    source,
    cacheRepo,
    snapshot: 'latest',
    snapshotId: 'latest',
    sourceRoot: root,
  });

  assert.equal(result.applied, false);
  assert.deepEqual(result.manifest.files.map((file) => file.path), ['AAA.json', 'nested/BBB.csv']);
  assert.equal(result.plan.some((step) => step.op === 'push'), false);
  assert.equal(await exists(path.join(cacheRepo, 'us', 'latest', 'AAA.json')), false);
  assert.equal(await exists(path.join(cacheRepo, 'manifests', 'us-cache-manifest.json')), false);
});

test('backup dry-run rejects in-repo destination roots', async (t) => {
  const root = await tempDir(t);
  const source = path.join(root, 'source');
  await mkdir(source, { recursive: true });
  await writeFixtureCache(source);

  await assert.rejects(() => backupMarketCache({
    market: 'us',
    source,
    cacheRepo: path.join(root, 'aurora-market-cache'),
    snapshot: 'latest',
    snapshotId: 'latest',
    sourceRoot: root,
  }), /Invalid cache repo root: BACKUP_ROOT_INSIDE_SOURCE_REPO/);
});

test('restore dry-run passes on valid US fixture and writes nothing', async (t) => {
  const root = await tempDir(t);
  const { cacheRepo } = await writeUsBackupPackage(root);
  const target = path.join(root, defaultSourcePath('us'));

  const result = await restoreMarketCache({
    market: 'us',
    target,
    cacheRepo,
    snapshot: 'latest',
    snapshotId: 'latest',
    sourceRoot: root,
  });

  assert.equal(result.applied, false);
  assert.equal(await exists(path.join(target, 'AAA.json')), false);
  assert.equal(result.plan.some((step) => step.op === 'push'), false);
});

test('restore dry-run rejects disallowed target root', async (t) => {
  const root = await tempDir(t);
  const { cacheRepo } = await writeUsBackupPackage(root);

  await assert.rejects(() => restoreMarketCache({
    market: 'us',
    target: path.join(root, 'target'),
    cacheRepo,
    snapshot: 'latest',
    snapshotId: 'latest',
    sourceRoot: root,
  }), /Restore target outside allowed us cache root/);
});

test('restore dry-run rejects wrong market manifest', async (t) => {
  const root = await tempDir(t);
  const { cacheRepo } = await writeUsBackupPackage(root, { manifestMarket: 'india' });

  await assert.rejects(() => restoreMarketCache({
    market: 'us',
    target: path.join(root, defaultSourcePath('us')),
    cacheRepo,
    snapshot: 'latest',
    snapshotId: 'latest',
    sourceRoot: root,
  }), /Manifest does not match requested market\/snapshot/);
});

test('checksum mismatch fails validation', async (t) => {
  const root = await tempDir(t);
  const { cacheRepo, snapshot } = await writeUsBackupPackage(root);

  const manifest = await loadManifest(path.join(cacheRepo, 'manifests', 'us-cache-manifest.json'));
  await writeFile(path.join(snapshot, 'AAA.json'), '{"close":999}\n');

  await assert.rejects(() => validateManifest(manifest, snapshot), /SHA256 mismatch/);
});

test('path traversal in manifest is rejected', async (t) => {
  const root = await tempDir(t);
  const snapshot = path.join(root, 'snapshot');
  await mkdir(snapshot, { recursive: true });
  const manifest = {
    schema_version: '1.0',
    market: 'us',
    snapshot_type: 'latest',
    snapshot_id: 'latest',
    created_at: '2026-06-28T00:00:00.000Z',
    source_repo: 'aurora-dashboards',
    source_commit: 'test',
    data_as_of: null,
    source_cache_path: 'source',
    file_count: 1,
    total_bytes: 0,
    files: [{ path: '../evil.json', bytes: 0, sha256: 'bad' }],
    warnings: [],
  };

  await assert.rejects(() => validateManifest(manifest, snapshot), /Unsafe manifest file path/);
});

test('valid India OHLCV history package passes and reports MYH coverage counts', async (t) => {
  const root = await tempDir(t);
  await writeIndiaHistoryRecord(root, 'NSE__PREFERRED.json', { symbol: 'PREFERRED', bars: indiaBars(1500) });
  await writeIndiaHistoryRecord(root, 'NSE__FIVEY.json', { symbol: 'FIVEY', bars: indiaBars(1260) });
  await writeIndiaHistoryRecord(root, 'NSE__THREEY.json', { symbol: 'THREEY', bars: indiaBars(756) });
  await writeIndiaHistoryRecord(root, 'NSE__TWOY.json', { symbol: 'TWOY', bars: indiaBars(504) });
  await writeIndiaHistoryRecord(root, 'NSE__SHORT.json', { symbol: 'SHORT', bars: indiaBars(100) });
  await writeIndiaHistoryRecord(root, 'NSE__EMPTY.json', { symbol: 'EMPTY', bars: [] });

  const result = await validateIndiaHistoryPackage(root);

  assert.equal(result.ok, false);
  assert.equal(result.coverage.symbols_ge_1500_bars, 1);
  assert.equal(result.coverage.symbols_ge_5y, 2);
  assert.equal(result.coverage.symbols_ge_3y, 3);
  assert.equal(result.coverage.symbols_ge_2y, 4);
  assert.equal(result.coverage.symbols_lt_2y, 1);
  assert.equal(result.coverage.symbols_no_usable_history, 1);
  assert.equal(result.errors.some((error) => error.includes('NO_USABLE_HISTORY')), true);
});

test('valid India OHLCV fixture passes without validation errors', async (t) => {
  const root = await tempDir(t);
  await writeIndiaHistoryRecord(root, 'NSE__AAA.json', { bars: indiaBars(1500) });

  const result = await validateIndiaHistoryPackage(root);

  assert.equal(result.ok, true);
  assert.equal(result.coverage.symbols_ge_1500_bars, 1);
  assert.equal(result.coverage.symbol_format.exchange_prefixed_plain_files, 1);
});

test('India history validation rejects unsorted and duplicate dates', async (t) => {
  const root = await tempDir(t);
  const unsorted = [
    ...indiaBars(1, { start: '2026-01-02' }),
    ...indiaBars(1, { start: '2026-01-01' }),
  ];
  const duplicate = [
    ...indiaBars(1, { start: '2026-02-01' }),
    ...indiaBars(1, { start: '2026-02-01' }),
  ];
  await writeIndiaHistoryRecord(root, 'NSE__UNSORTED.json', { symbol: 'UNSORTED', bars: unsorted });
  await writeIndiaHistoryRecord(root, 'NSE__DUPLICATE.json', { symbol: 'DUPLICATE', bars: duplicate });

  const result = await validateIndiaHistoryPackage(root);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes('UNSORTED_DATE')), true);
  assert.equal(result.errors.some((error) => error.includes('DUPLICATE_DATE')), true);
});

test('India history validation rejects invalid OHLCV and mixed provider series', async (t) => {
  const root = await tempDir(t);
  const invalid = indiaBars(2);
  invalid[1] = { ...invalid[1], low: 20 };
  await writeIndiaHistoryRecord(root, 'NSE__BAD.json', { symbol: 'BAD', bars: invalid });
  await writeIndiaHistoryRecord(root, 'NSE__MIXED.json', {
    symbol: 'MIXED',
    provider: 'NSE_OFFICIAL_BHAVCOPY',
    bars: indiaBars(2, { provider: 'YAHOO' }),
  });

  const result = await validateIndiaHistoryPackage(root);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes('INVALID_OHLCV')), true);
  assert.equal(result.errors.some((error) => error.includes('MIXED_PROVIDER_SERIES')), true);
});

test('India history package dry-run excludes generated artifact paths', async (t) => {
  const sourceRoot = await tempDir(t);
  const historyRoot = await tempDir(t);
  const cacheRepo = path.join(await tempDir(t), 'aurora-market-cache');
  await writeIndiaHistoryRecord(historyRoot, 'NSE__AAA.json', { bars: indiaBars(1500) });
  await mkdir(path.join(historyRoot, 'dashboard', 'data'), { recursive: true });
  await mkdir(path.join(historyRoot, 'scripts'), { recursive: true });
  await writeFile(path.join(historyRoot, 'dashboard', 'data', 'india-full-dashboard-scan.json'), '{}\n');
  await writeFile(path.join(historyRoot, 'AURORA_India_Dashboard.html'), '<html></html>\n');
  await writeFile(path.join(historyRoot, 'scripts', 'helper.mjs'), 'export default true;\n');

  const result = await buildIndiaHistorySnapshotPlan({
    root: historyRoot,
    cacheRepo,
    sourceRoot,
    snapshot: 'latest',
    snapshotId: 'latest',
    sourceCommit: 'test-commit',
  });

  assert.equal(result.applied, false);
  assert.deepEqual(result.manifest.files.map((file) => file.path), ['NSE__AAA.json']);
  assert.equal(result.plan.some((step) => String(step.from || '').includes('dashboard')), false);
  assert.equal(result.plan.some((step) => String(step.from || '').includes('AURORA_India_Dashboard.html')), false);
});

test('India history package dry-run rejects in-repo history roots', async (t) => {
  const sourceRoot = await tempDir(t);
  const historyRoot = path.join(sourceRoot, 'markets', 'india', 'dashboard', 'cache', 'india', 'ohlcv');
  const cacheRepo = path.join(await tempDir(t), 'aurora-market-cache');
  await writeIndiaHistoryRecord(historyRoot, 'NSE__AAA.json', { bars: indiaBars(1500) });

  await assert.rejects(() => buildIndiaHistorySnapshotPlan({
    root: historyRoot,
    cacheRepo,
    sourceRoot,
    snapshot: 'latest',
    snapshotId: 'latest',
    sourceCommit: 'test-commit',
  }), /outside the source repository/);
});
