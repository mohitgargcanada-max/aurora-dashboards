import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backupMarketCache } from '../backup-market-cache.mjs';
import { assertMarket, defaultSourcePath } from '../config.mjs';
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
  await mkdir(path.join(root, '.git'), { recursive: true });
  await writeFile(path.join(root, 'AAA.json'), '{"close":101}\n');
  await writeFile(path.join(root, 'nested', 'BBB.csv'), 'date,close\n2026-06-26,5\n');
  await writeFile(path.join(root, 'dashboard', 'data', 'scan.json'), '{"generated":true}\n');
  await writeFile(path.join(root, 'AURORA_US_Dashboard.html'), '<html></html>\n');
  await writeFile(path.join(root, '.DS_Store'), 'junk\n');
  await writeFile(path.join(root, '.git', 'config'), 'junk\n');
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

test('backup apply creates manifest, copies files, and excludes generated artifacts', async (t) => {
  const root = await tempDir(t);
  const source = path.join(root, 'source');
  const cacheRepo = path.join(root, 'aurora-market-cache');
  await mkdir(source, { recursive: true });
  await writeFixtureCache(source);

  const result = await backupMarketCache({
    market: 'india',
    source,
    cacheRepo,
    snapshot: 'weekly',
    snapshotId: '2026-26',
    apply: true,
  });

  const snapshot = path.join(cacheRepo, 'india', 'weekly', '2026-26');
  const manifestFile = path.join(cacheRepo, 'manifests', 'india-cache-manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));

  assert.equal(result.applied, true);
  assert.equal(manifest.market, 'india');
  assert.deepEqual(manifest.files.map((file) => file.path), ['AAA.json', 'nested/BBB.csv']);
  assert.equal(await exists(path.join(snapshot, 'AAA.json')), true);
  assert.equal(await exists(path.join(snapshot, 'nested', 'BBB.csv')), true);
  assert.equal(await exists(path.join(snapshot, 'dashboard', 'data', 'scan.json')), false);
  assert.equal(await exists(path.join(snapshot, 'AURORA_US_Dashboard.html')), false);
});

test('restore dry-run writes nothing', async (t) => {
  const root = await tempDir(t);
  const source = path.join(root, 'source');
  const cacheRepo = path.join(root, 'aurora-market-cache');
  const target = path.join(root, 'target');
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFixtureCache(source);
  await backupMarketCache({ market: 'canada', source, cacheRepo, snapshot: 'latest', snapshotId: 'latest', apply: true });

  const result = await restoreMarketCache({
    market: 'canada',
    target,
    cacheRepo,
    snapshot: 'latest',
    snapshotId: 'latest',
  });

  assert.equal(result.applied, false);
  assert.equal(await exists(path.join(target, 'AAA.json')), false);
});

test('restore apply restores files', async (t) => {
  const root = await tempDir(t);
  const source = path.join(root, 'source');
  const cacheRepo = path.join(root, 'aurora-market-cache');
  const target = path.join(root, 'target');
  await mkdir(source, { recursive: true });
  await writeFixtureCache(source);
  await backupMarketCache({ market: 'us', source, cacheRepo, snapshot: 'latest', snapshotId: 'latest', apply: true });

  const result = await restoreMarketCache({
    market: 'us',
    target,
    cacheRepo,
    snapshot: 'latest',
    snapshotId: 'latest',
    apply: true,
  });

  assert.equal(result.applied, true);
  assert.equal(await readFile(path.join(target, 'AAA.json'), 'utf8'), '{"close":101}\n');
  assert.equal(await readFile(path.join(target, 'nested', 'BBB.csv'), 'utf8'), 'date,close\n2026-06-26,5\n');
});

test('checksum mismatch fails validation', async (t) => {
  const root = await tempDir(t);
  const source = path.join(root, 'source');
  const cacheRepo = path.join(root, 'aurora-market-cache');
  await mkdir(source, { recursive: true });
  await writeFixtureCache(source);
  await backupMarketCache({ market: 'us', source, cacheRepo, snapshot: 'latest', snapshotId: 'latest', apply: true });

  const snapshot = path.join(cacheRepo, 'us', 'latest');
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
