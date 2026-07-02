import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { currentSourceCommit } from './build-manifest.mjs';
import { assertSnapshot, shouldIncludeCacheFile, snapshotRoot, manifestPath } from './config.mjs';
import { hashFile } from './hash-file.mjs';
import { validateBackupRoot } from '../market-data-backup/validate-backup-paths.mjs';

export const INDIA_HISTORY_THRESHOLDS = Object.freeze({
  preferred: 1500,
  fiveYear: 1260,
  threeYear: 756,
  twoYear: 504,
});

async function walkJsonFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkJsonFiles(root, fullPath));
    } else if (entry.isFile()) {
      const relativePath = path.relative(root, fullPath).replaceAll('\\', '/');
      if (entry.name.endsWith('.json') && shouldIncludeCacheFile(relativePath)) {
        files.push({ fullPath, relativePath });
      }
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}

function validBar(row) {
  if (!row || typeof row !== 'object') return false;
  const open = Number(row.adjusted_open ?? row.open);
  const high = Number(row.adjusted_high ?? row.high);
  const low = Number(row.adjusted_low ?? row.low);
  const close = Number(row.adjusted_close ?? row.close);
  const volume = Number(row.adjusted_volume ?? row.volume);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ''))) return false;
  if (![open, high, low, close, volume].every(Number.isFinite)) return false;
  return low <= high && open >= low && open <= high && close >= low && close <= high && volume >= 0;
}

function symbolFromPath(relativePath) {
  return path.posix.basename(relativePath, '.json').replace(/^(NSE|BSE)__/, '');
}

function inspectSymbolFormat(record, relativePath) {
  const file = path.posix.basename(relativePath);
  const symbol = String(record.symbol || symbolFromPath(relativePath));
  return {
    exchange_prefixed_plain_file: /^(NSE|BSE)__[^.]+\.json$/.test(file),
    dot_ns_bo_suffix: /\.(NS|BO)$/i.test(symbol) || /\.(NS|BO)\.json$/i.test(file),
    series_suffix_symbol: /-(EQ|BE|BZ|BL|SM|ST|RE|IV|RR)$/i.test(symbol),
    be_bz_bl_series: ['BE', 'BZ', 'BL'].includes(String(record.series || '').toUpperCase()),
    sme_series: ['SM', 'ST', 'M', 'MT', 'MS'].includes(String(record.series || '').toUpperCase()),
  };
}

export function analyzeIndiaHistoryRecord(record, relativePath = 'UNKNOWN.json') {
  const bars = Array.isArray(record?.bars) ? record.bars : [];
  const errors = [];
  const providers = new Set();
  if (record?.provider) providers.add(String(record.provider));

  let previousDate = null;
  const seenDates = new Set();
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const date = String(bar?.date || '');
    const barProvider = bar?.provider || bar?.source_provider;
    if (barProvider) providers.add(String(barProvider));
    if (!validBar(bar)) errors.push(`${relativePath}:bar[${index}]:INVALID_OHLCV`);
    if (seenDates.has(date)) errors.push(`${relativePath}:bar[${index}]:DUPLICATE_DATE`);
    if (previousDate && date < previousDate) errors.push(`${relativePath}:bar[${index}]:UNSORTED_DATE`);
    seenDates.add(date);
    previousDate = date;
  }

  if (providers.size > 1) errors.push(`${relativePath}:MIXED_PROVIDER_SERIES`);
  if (bars.length === 0) errors.push(`${relativePath}:NO_USABLE_HISTORY`);

  const symbol = String(record?.symbol || symbolFromPath(relativePath));
  const exchange = String(record?.exchange || relativePath.split('__')[0] || '').toUpperCase();
  const rowCount = bars.length;

  return {
    relative_path: relativePath,
    exchange,
    symbol,
    provider: record?.provider || null,
    series: record?.series || null,
    first_date: bars[0]?.date || null,
    last_date: bars.at(-1)?.date || record?.data_as_of || null,
    row_count: rowCount,
    eligible_1500: rowCount >= INDIA_HISTORY_THRESHOLDS.preferred,
    eligible_5y: rowCount >= INDIA_HISTORY_THRESHOLDS.fiveYear,
    eligible_3y: rowCount >= INDIA_HISTORY_THRESHOLDS.threeYear,
    eligible_2y: rowCount >= INDIA_HISTORY_THRESHOLDS.twoYear,
    symbol_format: inspectSymbolFormat(record || {}, relativePath),
    errors,
  };
}

export function summarizeIndiaHistory(records) {
  const sortedDates = records.flatMap((record) => [record.first_date, record.last_date]).filter(Boolean).sort();
  const rowCounts = records.map((record) => record.row_count);
  const format = {
    exchange_prefixed_plain_files: records.filter((record) => record.symbol_format.exchange_prefixed_plain_file).length,
    dot_ns_bo_suffix: records.filter((record) => record.symbol_format.dot_ns_bo_suffix).length,
    series_suffix_symbols: records.filter((record) => record.symbol_format.series_suffix_symbol).length,
    be_bz_bl_series: records.filter((record) => record.symbol_format.be_bz_bl_series).length,
    sme_series: records.filter((record) => record.symbol_format.sme_series).length,
  };
  return {
    symbols: records.length,
    earliest_date: sortedDates[0] || null,
    latest_date: sortedDates.at(-1) || null,
    min_bars: rowCounts.length ? Math.min(...rowCounts) : null,
    max_bars: rowCounts.length ? Math.max(...rowCounts) : null,
    symbols_ge_1500_bars: records.filter((record) => record.eligible_1500).length,
    symbols_ge_5y: records.filter((record) => record.eligible_5y).length,
    symbols_ge_3y: records.filter((record) => record.eligible_3y).length,
    symbols_ge_2y: records.filter((record) => record.eligible_2y).length,
    symbols_lt_2y: records.filter((record) => record.row_count > 0 && !record.eligible_2y).length,
    symbols_no_usable_history: records.filter((record) => record.row_count === 0).length,
    invalid_symbols: records.filter((record) => record.errors.length > 0).length,
    symbol_format: format,
  };
}

export async function auditIndiaHistoryCoverage(root) {
  const records = [];
  for (const file of await walkJsonFiles(root)) {
    const record = JSON.parse(await readFile(file.fullPath, 'utf8'));
    records.push(analyzeIndiaHistoryRecord(record, file.relativePath));
  }
  return {
    root: root.replaceAll('\\', '/'),
    coverage: summarizeIndiaHistory(records),
    errors: records.flatMap((record) => record.errors),
    records,
  };
}

export async function validateIndiaHistoryPackage(root) {
  const result = await auditIndiaHistoryCoverage(root);
  return {
    ok: result.errors.length === 0,
    ...result,
  };
}

function assertExternalRoot(candidateRoot, sourceRoot) {
  const relative = path.relative(path.resolve(sourceRoot), path.resolve(candidateRoot));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('India history package root must be outside the source repository');
  }
}

export async function buildIndiaHistorySnapshotPlan({
  root,
  cacheRepo,
  snapshot = 'latest',
  snapshotId = 'latest',
  sourceRoot = process.cwd(),
  sourceCommit = currentSourceCommit(sourceRoot),
}) {
  assertSnapshot(snapshot, snapshotId);
  assertExternalRoot(root, sourceRoot);
  const backupRootValidation = validateBackupRoot(cacheRepo, { sourceRoot });
  if (!backupRootValidation.ok) {
    throw new Error(`Invalid cache repo root: ${backupRootValidation.reason}`);
  }

  const validation = await validateIndiaHistoryPackage(root);
  if (!validation.ok) {
    throw new Error(`India history package validation failed: ${validation.errors.slice(0, 5).join('; ')}`);
  }

  const snapshotPath = snapshotRoot(cacheRepo, 'india', snapshot, snapshotId);
  const manifestFile = manifestPath(cacheRepo, 'india');
  const files = [];
  for (const file of await walkJsonFiles(root)) {
    const fileStats = await stat(file.fullPath);
    files.push({
      path: file.relativePath,
      bytes: fileStats.size,
      sha256: await hashFile(file.fullPath),
    });
  }

  const manifest = {
    schema_version: 'india-history-1.0',
    market: 'india',
    snapshot_type: snapshot,
    snapshot_id: snapshotId,
    created_at: new Date().toISOString(),
    source_repo: 'aurora-dashboards',
    source_commit: sourceCommit,
    source_cache_path: root.replaceAll('\\', '/'),
    data_as_of: validation.coverage.latest_date,
    coverage: validation.coverage,
    file_count: files.length,
    total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    warnings: [],
  };

  return {
    mode: 'dry-run',
    applied: false,
    validation: validation.coverage,
    manifest,
    plan: [
      ...files.map((file) => ({
        op: 'copy',
        from: path.join(root, file.path),
        to: path.join(snapshotPath, file.path),
      })),
      { op: 'write-manifest', to: manifestFile },
    ],
  };
}
