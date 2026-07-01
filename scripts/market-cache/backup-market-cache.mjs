import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, currentSourceCommit } from './build-manifest.mjs';
import {
  assertMarket,
  assertSnapshot,
  defaultSourcePath,
  manifestPath,
  parseCliArgs,
  snapshotRoot,
} from './config.mjs';
import { validateBackupRoot } from '../market-data-backup/validate-backup-paths.mjs';

function backupPlan({ manifest, sourceCachePath, snapshotPath, manifestFile }) {
  return [
    ...manifest.files.map((file) => ({
      op: 'copy',
      from: path.join(sourceCachePath, file.path),
      to: path.join(snapshotPath, file.path),
    })),
    { op: 'write-manifest', to: manifestFile },
  ];
}

export async function backupMarketCache(options) {
  const market = assertMarket(options.market);
  const snapshot = options.snapshot ?? 'latest';
  const snapshotId = options.snapshotId ?? (snapshot === 'latest' ? 'latest' : undefined);
  assertSnapshot(snapshot, snapshotId);

  if (!options.cacheRepo) throw new Error('Missing required --cache-repo');

  const sourceRoot = path.resolve(options.sourceRoot ?? process.cwd());
  const sourceCachePath = path.resolve(options.source ?? defaultSourcePath(market));
  const cacheRepo = path.resolve(options.cacheRepo);
  const backupRootValidation = validateBackupRoot(cacheRepo, { sourceRoot });
  if (!backupRootValidation.ok) {
    throw new Error(`Invalid cache repo root: ${backupRootValidation.reason}`);
  }
  const snapshotPath = snapshotRoot(cacheRepo, market, snapshot, snapshotId);
  const manifestFile = manifestPath(cacheRepo, market);
  const apply = options.apply === true;
  const manifest = await buildManifest({
    market,
    snapshot,
    snapshotId,
    sourceCachePath,
    sourceCommit: currentSourceCommit(),
  });
  const plan = backupPlan({ manifest, sourceCachePath, snapshotPath, manifestFile });

  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', plan }, null, 2));
    return { manifest, plan, applied: false };
  }

  for (const file of manifest.files) {
    const target = path.join(snapshotPath, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(sourceCachePath, file.path), target);
  }
  await mkdir(path.dirname(manifestFile), { recursive: true });
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ mode: 'apply', copied: manifest.file_count, manifest: manifestFile }, null, 2));
  return { manifest, plan, applied: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    await backupMarketCache({
      market: args.market,
      source: args.source,
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
