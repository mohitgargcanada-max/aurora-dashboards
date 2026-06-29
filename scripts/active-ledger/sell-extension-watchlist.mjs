import { readFile } from 'node:fs/promises';
import {
  DIAGNOSTIC_BUCKET_LABELS,
  FINAL_BUCKETS,
  validateActiveTrackingLedger,
} from './validate-active-tracking-ledger.mjs';

export const SELL_EXTENSION_WATCHLIST_COLUMNS = Object.freeze([
  'Symbol',
  'Original List',
  'First Published',
  'Entry Reference',
  'Latest Close',
  'Gain/Loss from Entry',
  'AXM10 / AXM21 / AXM50',
  'Distance from 21EMA / 50SMA',
  'PX Label',
  'AURORA-X State',
  'VE2 Risk',
  'Sell / Extension Reason',
  'Caution Note',
  'Next Action',
  'Lifecycle Status',
]);

export const REVIEW_LIFECYCLE_STATUSES = Object.freeze([
  'EXTENDED_REVIEW',
  'PROTECT_PROFIT_REVIEW',
  'SELL_RISK_REVIEW',
  'DATA_REPAIR',
]);

export const REVIEW_EXTENSION_STATUSES = Object.freeze([
  'EXTENDED_REVIEW',
  'NO_CHASE_REVIEW',
  'PROTECT_PROFIT_REVIEW',
  'SELL_RISK_REVIEW',
  'RESET_REQUIRED',
  'DATA_REPAIR',
]);

export const REVIEW_REASON_LABELS = Object.freeze([
  'AXM21_HOT',
  'AXM21_EXTREME',
  'AXM50_VERY_EXTENDED',
  'AXM50_EXTREME',
  'PX_NO_CHASE',
  'PX_HARD_WARNING',
  'VE2_CLIMAX_VOLUME_WARNING',
  'AURORA_X2_SELL_RISK_REVIEW',
  'AURORA_X3_HARD_BLOCK',
  '21EMA_BREAK_WARNING',
  '50SMA_SERIOUS_WARNING',
  'FAILED_BREAKOUT',
  'THESIS_STOP_BREACH',
  'FOMO_3_HOT',
  'FOMO_4_EUPHORIC',
  'FOMO_5_CLIMAX_RISK',
]);

const FOMO_CONTEXT_LABELS = new Set(['FOMO_3_HOT', 'FOMO_4_EUPHORIC', 'FOMO_5_CLIMAX_RISK']);
const REVIEW_REASONS = new Set(REVIEW_REASON_LABELS);

function fallbackEscape(value) {
  return String(value ?? '—').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function text(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function noteToText(note) {
  if (typeof note === 'string') return note;
  if (note === null || note === undefined) return '';
  return JSON.stringify(note);
}

function noteText(notes) {
  return Array.isArray(notes) ? notes.map(noteToText).filter(Boolean).join(' · ') : '';
}

function reviewReasons(entry, notesText) {
  const candidates = [
    entry.latest_axm21_label,
    entry.latest_axm50_label,
    entry.latest_px_label,
    entry.latest_aurora_x_state,
    entry.latest_market_fomo_label,
    ...notesText.split(/[^A-Z0-9_]+/),
  ];
  return [...new Set(candidates.filter(label => REVIEW_REASONS.has(label)))];
}

function gainLossPct(entryReference, latestClose) {
  if (!Number.isFinite(entryReference) || !Number.isFinite(latestClose) || entryReference === 0) return null;
  return (latestClose / entryReference - 1) * 100;
}

function nextAction(entry) {
  if (entry.lifecycle_status === 'DATA_REPAIR' || entry.extension_status === 'DATA_REPAIR') {
    return 'Review data quality before lifecycle changes.';
  }
  if (entry.lifecycle_status === 'SELL_RISK_REVIEW' || entry.extension_status === 'SELL_RISK_REVIEW') {
    return 'Review risk evidence; no automatic action.';
  }
  if (entry.lifecycle_status === 'PROTECT_PROFIT_REVIEW' || entry.extension_status === 'PROTECT_PROFIT_REVIEW') {
    return 'Review profit-protection context; no automatic action.';
  }
  if (entry.extension_status === 'RESET_REQUIRED') {
    return 'Wait for reset evidence before lifecycle changes.';
  }
  return 'Review extension context; no automatic action.';
}

function cautionNote(entry, notes, reasons) {
  const parts = [];
  if (notes) parts.push(notes);
  if (FOMO_CONTEXT_LABELS.has(entry.latest_market_fomo_label)) {
    parts.push(`FOMO context: ${entry.latest_market_fomo_label}`);
  }
  if (Number.isFinite(entry.latest_market_fomo_score)) {
    parts.push(`FOMO score context: ${entry.latest_market_fomo_score}`);
  }
  if (!parts.length && reasons.length) parts.push(`Review labels: ${reasons.join(', ')}`);
  if (!parts.length) parts.push(`${entry.extension_status} / ${entry.lifecycle_status}`);
  return parts.join(' · ');
}

function extensionReason(entry, reasons) {
  return [entry.extension_status, ...reasons].filter(Boolean).join(' · ');
}

function ve2Risk(reasons) {
  return reasons.find(reason => reason.startsWith('VE2_')) ?? '—';
}

function shouldIncludeEntry(entry) {
  if (entry.lifecycle_status === 'EXITED') return false;
  if (REVIEW_LIFECYCLE_STATUSES.includes(entry.lifecycle_status)) return true;
  if (REVIEW_EXTENSION_STATUSES.includes(entry.extension_status)) return true;
  return false;
}

export async function loadActiveTrackingLedger(filePath) {
  const ledger = JSON.parse(await readFile(filePath, 'utf8'));
  validateActiveTrackingLedger(ledger);
  return ledger;
}

export function normalizeSellExtensionRows(ledger) {
  validateActiveTrackingLedger(ledger);
  return ledger.entries.filter(shouldIncludeEntry).map(entry => {
    const notes = noteText(entry.notes);
    const reasons = reviewReasons(entry, notes);
    return {
      symbol: text(entry.symbol),
      originalList: text(entry.first_published_list),
      firstPublished: text(entry.first_published_date),
      entryReference: entry.entry_reference,
      latestClose: entry.latest_close,
      gainLossPct: gainLossPct(entry.entry_reference, entry.latest_close),
      axmStack: `— / ${text(entry.latest_axm21_label)} / ${text(entry.latest_axm50_label)}`,
      distanceFromAverages: '—',
      pxLabel: text(entry.latest_px_label),
      auroraXState: text(entry.latest_aurora_x_state),
      ve2Risk: ve2Risk(reasons),
      sellExtensionReason: extensionReason(entry, reasons),
      cautionNote: cautionNote(entry, notes, reasons),
      nextAction: nextAction(entry),
      lifecycleStatus: text(entry.lifecycle_status),
    };
  });
}

export async function loadSellExtensionWatchlistRows(filePath) {
  return normalizeSellExtensionRows(await loadActiveTrackingLedger(filePath));
}

function defaultFormatMoney(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : '—';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Number(value).toFixed(2)}%` : '—';
}

function renderCell(value, escapeHtml) {
  return `<td>${escapeHtml(text(value))}</td>`;
}

export function renderSellExtensionWatchlistHtml(rows = [], options = {}) {
  const escapeHtml = options.escapeHtml ?? fallbackEscape;
  const formatMoney = options.formatMoney ?? defaultFormatMoney;
  const body = rows.length
    ? rows.map(row => `<tr>${[
      row.symbol,
      row.originalList,
      row.firstPublished,
      formatMoney(row.entryReference),
      formatMoney(row.latestClose),
      formatPercent(row.gainLossPct),
      row.axmStack,
      row.distanceFromAverages,
      row.pxLabel,
      row.auroraXState,
      row.ve2Risk,
      row.sellExtensionReason,
      row.cautionNote,
      row.nextAction,
      row.lifecycleStatus,
    ].map(value => renderCell(value, escapeHtml)).join('')}</tr>`).join('')
    : `<tr><td colspan="${SELL_EXTENSION_WATCHLIST_COLUMNS.length}">No entries yet. Names will appear here only after they are already tracked and trigger extension/sell-risk review evidence.</td></tr>`;

  return `<h2 id="sell-extension">AURORA Sell / Extension Watchlist</h2><p class="notice">No tracked names currently require sell / extension review.</p><p class="notice">Extension alone is not a sell signal. This section is a review/caution area for previously tracked names when AXM/PX/AURORA-X/VE2/MA-break/failed-breakout/thesis-stop evidence appears.</p><p class="notice">Market FOMO / ATR Heat is context-only. It may add caution notes in future, but it does not block candidates, change ranking, create sell signals, or alter AURORA buckets.</p><div class="table-wrap"><table><thead><tr>${SELL_EXTENSION_WATCHLIST_COLUMNS.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function assertReviewReasonsAreNotFinalBuckets() {
  const finalBuckets = new Set(FINAL_BUCKETS);
  const overlap = REVIEW_REASON_LABELS.filter(label => finalBuckets.has(label));
  if (overlap.length) throw new Error(`Review reason labels must not be final buckets: ${overlap.join(', ')}`);
  const diagnosticOverlap = REVIEW_REASON_LABELS.filter(label => DIAGNOSTIC_BUCKET_LABELS.includes(label) && finalBuckets.has(label));
  if (diagnosticOverlap.length) throw new Error(`Diagnostic labels must not be final buckets: ${diagnosticOverlap.join(', ')}`);
  return true;
}
