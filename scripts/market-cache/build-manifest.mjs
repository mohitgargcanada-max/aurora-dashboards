import { execFileSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertMarket, assertSnapshot, shouldIncludeCacheFile } from './config.mjs';
import { hashFile } from './hash-file.mjs';

async function walkFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, fullPath));
    } else if (entry.isFile()) {
      const relativePath = path.relative(root, fullPath).replaceAll('\\', '/');
      if (shouldIncludeCacheFile(relativePath)) {
        files.push({ fullPath, relativePath });
      }
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function currentSourceCommit(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return 'UNKNOWN';
  }
}

export async function buildManifest({
  market,
  snapshot,
  snapshotId,
  sourceCachePath,
  sourceCommit = currentSourceCommit(),
  createdAt = new Date().toISOString(),
}) {
  assertMarket(market);
  assertSnapshot(snapshot, snapshotId);

  const sourceStats = await stat(sourceCachePath);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Source cache path is not a directory: ${sourceCachePath}`);
  }

  const files = [];
  for (const file of await walkFiles(sourceCachePath)) {
    const fileStats = await stat(file.fullPath);
    files.push({
      path: file.relativePath,
      bytes: fileStats.size,
      sha256: await hashFile(file.fullPath),
    });
  }

  return {
    schema_version: '1.0',
    market,
    snapshot_type: snapshot,
    snapshot_id: snapshotId,
    created_at: createdAt,
    source_repo: 'aurora-dashboards',
    source_commit: sourceCommit,
    data_as_of: null,
    source_cache_path: sourceCachePath.replaceAll('\\', '/'),
    file_count: files.length,
    total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    warnings: [],
  };
}
