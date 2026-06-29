import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMarket, assertSafeRelativePath, assertSnapshot } from './config.mjs';
import { hashFile } from './hash-file.mjs';

const REQUIRED_FIELDS = [
  'schema_version',
  'market',
  'snapshot_type',
  'snapshot_id',
  'created_at',
  'source_repo',
  'source_commit',
  'data_as_of',
  'source_cache_path',
  'file_count',
  'total_bytes',
  'files',
  'warnings',
];

export async function loadManifest(manifestFile) {
  return JSON.parse(await readFile(manifestFile, 'utf8'));
}

export async function validateManifest(manifest, snapshotPath) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in manifest)) errors.push(`Missing required field: ${field}`);
  }

  try {
    assertMarket(manifest.market);
    assertSnapshot(manifest.snapshot_type, manifest.snapshot_id);
  } catch (error) {
    errors.push(error.message);
  }

  if (manifest.schema_version !== '1.0') errors.push('Unsupported schema_version');
  if (manifest.source_repo !== 'aurora-dashboards') errors.push('source_repo must be aurora-dashboards');
  if (!Array.isArray(manifest.files)) errors.push('files must be an array');
  if (!Array.isArray(manifest.warnings)) errors.push('warnings must be an array');

  let totalBytes = 0;
  if (Array.isArray(manifest.files)) {
    for (const file of manifest.files) {
      try {
        const relativePath = assertSafeRelativePath(file.path);
        const filePath = path.join(snapshotPath, relativePath);
        const fileStats = await stat(filePath);
        if (!fileStats.isFile()) errors.push(`Not a file: ${relativePath}`);
        if (fileStats.size !== file.bytes) errors.push(`Byte mismatch: ${relativePath}`);
        const actualHash = await hashFile(filePath);
        if (actualHash !== file.sha256) errors.push(`SHA256 mismatch: ${relativePath}`);
        totalBytes += fileStats.size;
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  if (Array.isArray(manifest.files) && manifest.file_count !== manifest.files.length) {
    errors.push('file_count does not match files length');
  }
  if (manifest.total_bytes !== totalBytes) {
    errors.push('total_bytes does not match files');
  }

  if (errors.length > 0) {
    const error = new Error(`Manifest validation failed:\n${errors.join('\n')}`);
    error.errors = errors;
    throw error;
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , manifestFile, snapshotPath] = process.argv;
    if (!manifestFile || !snapshotPath) {
      throw new Error('Usage: node scripts/market-cache/validate-manifest.mjs <manifest-file> <snapshot-path>');
    }
    await validateManifest(await loadManifest(manifestFile), snapshotPath);
    console.log('MANIFEST_VALID');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
