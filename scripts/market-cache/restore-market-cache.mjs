import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertMarket,
  assertSafeRelativePath,
  assertSnapshot,
  defaultSourcePath,
  manifestPath,
  parseCliArgs,
  snapshotRoot,
} from './config.mjs';
import { loadManifest, validateManifest } from './validate-manifest.mjs';

function restorePlan({ manifest, snapshotPath, targetPath }) {
  return manifest.files.map((file) => ({
    op: 'restore',
    from: path.join(snapshotPath, file.path),
    to: path.join(targetPath, file.path),
  }));
}

export async function restoreMarketCache(options) {
  const market = assertMarket(options.market);
  const snapshot = options.snapshot ?? 'latest';
  const snapshotId = options.snapshotId ?? (snapshot === 'latest' ? 'latest' : undefined);
  assertSnapshot(snapshot, snapshotId);

  if (!options.cacheRepo) throw new Error('Missing required --cache-repo');

  const targetPath = path.resolve(options.target ?? defaultSourcePath(market));
  const cacheRepo = path.resolve(options.cacheRepo);
  const snapshotPath = snapshotRoot(cacheRepo, market, snapshot, snapshotId);
  const manifestFile = manifestPath(cacheRepo, market);
  const apply = options.apply === true;
  const manifest = await loadManifest(manifestFile);

  if (manifest.market !== market || manifest.snapshot_type !== snapshot || manifest.snapshot_id !== snapshotId) {
    throw new Error('Manifest does not match requested market/snapshot');
  }

  await validateManifest(manifest, snapshotPath);
  const plan = restorePlan({ manifest, snapshotPath, targetPath });

  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', plan }, null, 2));
    return { manifest, plan, applied: false };
  }

  for (const file of manifest.files) {
    const relativePath = assertSafeRelativePath(file.path);
    const target = path.join(targetPath, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(snapshotPath, relativePath), target);
  }
  console.log(JSON.stringify({ mode: 'apply', restored: manifest.file_count, target: targetPath }, null, 2));
  return { manifest, plan, applied: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    await restoreMarketCache({
      market: args.market,
      target: args.target,
      cacheRepo: args['cache-repo'],
      snapshot: args.snapshot,
      snapshotId: args['snapshot-id'],
      apply: args.apply === true,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
