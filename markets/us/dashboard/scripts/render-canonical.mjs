import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSellExtensionWatchlistRows, renderSellExtensionWatchlistHtml } from "../../../../scripts/active-ledger/sell-extension-watchlist.mjs";
import { stampGeneratedAt } from "./dashboard-state.mjs";
import { writeUsDashboardJsonExport } from "./write-dashboard-json-export.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sellExtensionWatchlistRows = await loadSellExtensionWatchlistRows(resolve(root, "state/active-tracking-ledger.json"));
const statePath = resolve(root, "data/us-dashboard-state.json");
const state = stampGeneratedAt(JSON.parse(await readFile(statePath, "utf8")));
const output = resolve(root, "../AURORA_US_Dashboard.html");
const temp = `${output}.tmp`;
const stateTemp = `${statePath}.tmp`;
const shouldWriteJson = !process.argv.includes("--no-write-json");

const esc = value => String(value ?? "-").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (value, digits = 2, prefix = "") => Number.isFinite(value) ? `${prefix}${Number(value).toFixed(digits)}` : "-";
const money = value => fmt(value, 2, "$");
const bigMoney = value => Number.isFinite(value) ? `$${Math.round(value / 1e6).toLocaleString()}M` : "-";
const cls = value => /PASS|READY|STANDARD|VALID|CONFIRMED|LEADING|ACCELERATING|TRADE_ALLOWED|CYCLE_ON|UPTREND|ACTIONABLE|HIGH/.test(value) ? "good" : /WATCH|PULLBACK|EARLY|PARTIAL|DEVELOPING|SELECTIVE|TRANSITION|IMPROVING|CAUTION|RECONFIRMING|RALLY/.test(value) ? "warn" : /NO_CHASE|FAIL|AVOID|REJECT|REPAIR|PRESSURE|CORRECTION|DEFENSE|EXTREME|LAGGING/.test(value) ? "bad" : "info";
const badge = value => `<span class="status ${cls(String(value ?? ""))}">${esc(value)}</span>`;
const sectorRrgState = c => String(c.sector_rrg_state || c.sector_rrg_quadrant || c.sector_rotation_state || c.rrg_sector_state || c.stock_rrg_state || c.rrg_state || "UNKNOWN / NOT_CALCULATED").toUpperCase().replace("NOT_AVAILABLE", "NOT_CALCULATED");
const sectorRrgRead = state => ({
  LEADING: "Sector tailwind supports the setup.",
  IMPROVING: "Early sector rotation; constructive, but confirm stock-level RS/setup.",
  WEAKENING: "Be selective; sector momentum is fading.",
  LAGGING: "Lower probability unless stock-level RS/setup is exceptional.",
  UNKNOWN: "Sector context unavailable; do not infer.",
  NOT_CALCULATED: "Sector context unavailable; do not infer.",
  "UNKNOWN / NOT_CALCULATED": "Sector context unavailable; do not infer."
})[state] || "Sector context unavailable; do not infer.";
const sectorContextCell = c => {
  const state = sectorRrgState(c);
  return `Theme: ${esc(c.theme_primary || c.theme_cluster || c.theme || c.gics_sector || c.sector || "UNKNOWN")}<small>Sector: ${esc(c.gics_sector || c.sector || "UNKNOWN")}</small><small>Industry: ${esc(c.main_industry || c.sub_industry || c.industry || c.classification_status || "UNKNOWN")}</small><small>Sector RRG: ${esc(state)}</small><small>Read: ${esc(sectorRrgRead(state))}</small>`;
};

function stockRows(rows = [], { rank = true } = {}) {
  return rows.map((c, i) => `<tr>
    ${rank ? `<td>${c.rsle_rank || i + 1}</td>` : ""}
    <td><strong>${esc(c.ticker)}</strong><small>${esc(c.exchange)} · ${esc(c.universe_route || c.route || c.weekly_route || "US")}</small><small>${esc(c.gics_sector || c.sector)} · ${esc(c.main_industry || c.classification_status)}</small></td>
    <td>${sectorContextCell(c)}</td>
    <td>${badge(c.bucket || c.final_bucket || c.rsle_list_tier)}</td>
    <td>${badge(c.setup || c.rsle_setup_lane || "-")}<small>${esc(c.entry_permission || c.entry_risk_tier || "-")}</small></td>
    <td>${money(c.price)}<small>${fmt(c.day_pct ?? c.price_change_1d_pct)}%</small></td>
    <td>${fmt(c.weekly_watchlist_score ?? c.wwl ?? c.rsle_tactical_score)}<small>L ${fmt(c.rsle_leadership_score ?? c.rs_leadership_score)} · T ${fmt(c.rsle_tactical_score)}</small></td>
    <td>${fmt(c.rs_rating ?? c.rs_score_pct, 0)}<small>1W ${fmt(c.rs_1w_rating ?? c.rs_1w_relative, 0)} · 1M ${fmt(c.rs_1m_rating ?? c.rs_1m_relative, 0)} · 3M ${fmt(c.rs_3m_rating ?? c.rs_3m_relative, 0)}</small><small>${esc(c.rs21_state || c.rs_ema21 || c.rs21)} · ${esc(c.trifecta || c.rs_trifecta)}</small></td>
    <td>${esc(c.rrg?.quadrant || c.rrg_quadrant)}</td>
    <td>${fmt(c.rmv5)} / ${fmt(c.rmv15)} / ${fmt(c.rmv25)}<small>${c.compressed ? "compression" : esc(c.rmv_tight_label)}</small></td>
    <td>${money(c.pivot || c.trigger)}<small>${esc(c.basepivot_quality)} · ${esc(c.basepivot_state)}</small><small>RMVP ${money(c.rmvp)} · ${esc(c.rmvp_quality)}</small></td>
    <td>${esc(c.pbx_quality)}<small>${esc(c.pbx_ma_defense)} · ${esc(c.pbx_reversal)}</small></td>
    <td>${esc(c.ve2_label)}<small>Grade ${esc(c.ve2_grade)} · RVOL ${fmt(c.rvol)}x</small></td>
    <td>${esc(c.axm_label)}<small>${fmt(c.axm_atr)} ATR</small></td>
    <td>${money(c.entry_reference || c.trigger)}<small>Entry stop ${money(c.entry_stop || c.stop)} · ${fmt(c.entry_risk_pct ?? c.risk_pct)}%</small><small>Thesis ${money(c.thesis_stop)} · ${fmt(c.thesis_risk_pct)}%</small></td>
    <td>${bigMoney(c.avg_dollar_volume_20_usd_equiv || c.avg_dollar_volume_20)}<small>${esc(c.liquidity_label)}</small></td>
    <td>${esc(c.caution || (c.failed_gates || []).join(", ") || "none")}<small>${esc(c.next_tactical_condition || c.next_condition || c.next_promotion_condition)}</small></td>
    <td>${esc(c.user_note || c.note || c.pattern_note)}</td>
  </tr>`).join("");
}

function candidateTable(rows, id, title, note, opts = {}) {
  const body = stockRows(rows, opts);
  return `<h2 id="${esc(id)}">${esc(title)}</h2><p class="notice">${esc(note)}</p>${body ? `<div class="table-wrap"><table><thead><tr>${opts.rank === false ? "" : "<th>Rank</th>"}<th>Symbol</th><th>Sector / Theme</th><th>AURORA Bucket</th><th>Setup</th><th>Price</th><th>Score</th><th>RS</th><th>RRG</th><th>RMV</th><th>BasePivot / RMVP</th><th>PBX</th><th>VE2 Volume</th><th>AXM</th><th>Entry / Stop</th><th>Liquidity</th><th>Caution / Next</th><th>User Note</th></tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty">No qualified rows. No forced padding.</div>`}`;
}

function compactTable(title, id, rows = [], headers = [], accessors = [], note = "") {
  const body = (rows || []).map((row, index) => `<tr><td>${index + 1}</td>${accessors.map(fn => `<td>${fn(row)}</td>`).join("")}</tr>`).join("");
  return `<h2 id="${esc(id)}">${esc(title)}</h2>${note ? `<p class="notice">${esc(note)}</p>` : ""}${body ? `<div class="table-wrap"><table><thead><tr><th>Rank</th>${headers.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty">No qualified rows. No forced padding.</div>`}`;
}

function sellExtensionWatchlistHtml() {
  return renderSellExtensionWatchlistHtml(sellExtensionWatchlistRows, { escapeHtml: esc, formatMoney: money });
}

const finalBucketCopy = "TRADE_READY, TRIGGER_READY, EARLY_ENTRY_WATCH, PULLBACK_WATCH, RSNH_WATCH_ONLY, NO_CHASE, PROTECT_PROFIT_REVIEW, REPAIR_WATCH, AVOID_FRESH_LONG";
const sectorRrgCopy = "Sector context is a probability/tailwind guide. Leading or improving sectors usually support better odds. Weakening or lagging sectors require stronger stock-level RS, setup quality, and risk control. Sector RRG does not create or block AURORA trade buckets. LEADING = sector tailwind supports the setup. IMPROVING = early rotation; constructive but confirm stock-level RS/setup. WEAKENING = be selective; sector momentum is fading. LAGGING = lower probability unless stock-level RS/setup is exceptional. UNKNOWN / NOT_CALCULATED = sector data unavailable; do not infer. A lagging sector lowers probability but does not automatically reject a stock.";
const stockThemeCopy = "This table shows where AURORA candidates are clustering. It is not a buy table and not a trade signal. Weighted Presence = Weekly*3 + DailyTop*4 + RSLE*2 + Developing*1. Weekly = count from WEEKLY_UNIVERSE. Daily Top = count from DAILY_TOP_1_4. RSLE = count from AURORA-RSLE Top 20. Developing = count from Developing Watchlist. Symbols = representative stocks from that theme.";
const tableScrollCopy = "Wide tables are scrollable left/right and top/bottom. Headers remain visible while scrolling.";
const howToReadHtml = `<h2 id="guide">How to read this dashboard</h2><div class="table-wrap"><table><thead><tr><th>Concept</th><th>Plain-English guide</th></tr></thead><tbody>
<tr><td>Market Summary</td><td>Market Summary = whether the market environment supports fresh long trades.</td></tr>
<tr><td>Daily Top</td><td>Daily Top = conditional execution candidates, maximum four, never forced.</td></tr>
<tr><td>Weekly Universe</td><td>Weekly Universe = broader AURORA watchlist selected from full-universe discovery.</td></tr>
<tr><td>RSLE</td><td>RSLE = strongest relative-strength leaders with tactical entries or developing entries.</td></tr>
<tr><td>Sector / Theme</td><td>Sector / Theme = row-level theme, sector, industry, and sector-RRG read. ${sectorRrgCopy}</td></tr>
<tr><td>Table scrolling</td><td>${tableScrollCopy}</td></tr>
<tr><td>Sector RRG</td><td>Sector RRG = sector rotation strength. ${sectorRrgCopy}</td></tr>
<tr><td>Stock Theme Leadership</td><td>Stock Theme Leadership = clustering of shortlisted stocks, not a buy signal. ${stockThemeCopy} US examples: AI/Semis, Software, Cybersecurity, Biotech, Industrials, Consumer Platforms.</td></tr>
<tr><td>Stock row</td><td>Stock row = final decision comes from bucket + setup + RS + volume + risk + market permission.</td></tr>
<tr><td>AURORA Bucket / Setup</td><td>AURORA Bucket = final trade-readiness status. Setup = diagnostic setup lane explaining why the stock is being watched. Locked final buckets: ${finalBucketCopy}.</td></tr>
<tr><td>RS / RS21 / RSNH</td><td>RS means benchmark-relative strength, not RSI. RS21 = RS line versus its 21 EMA. RSNH = relative-strength line near or at new high. RS Trifecta = RS confirmation stack. Mansfield RS = longer-term trend-adjusted outperformance.</td></tr>
<tr><td>RRG / RMV</td><td>RRG shows rotation context. RMV shows reduced-move volatility/tightness context.</td></tr>
<tr><td>VE2 / PBX / BPX / BasePivot / RMVP / AXM</td><td>VE2 = volume quality and demand/supply evidence. PBX = pullback quality. BPX/BasePivot/RMVP = structure, trigger zones, support/retest zones. AXM = ATR-based extension and no-chase risk. None of these creates a standalone buy signal.</td></tr>
<tr><td>Entry / Stop</td><td>Entry / Stop shows the reference trigger, stop, and risk that still need market permission and price/volume acceptance.</td></tr>
<tr><td>Liquidity</td><td>Liquidity checks whether participation is sufficient before a setup can be actionable.</td></tr>
<tr><td>Caution / Next</td><td>Caution / Next explains what must happen before promotion or execution. It may include volume confirmation, trigger acceptance, tighter shelf, pullback reset, data repair, or no-chase reset.</td></tr>
</tbody></table></div>`;

const marketRows = [
  ["O'Neil-Style Market Cycle", state.market.oneil_market_cycle || state.market.market_state, `Mapped from ${state.market.aurora_mc2_state}`],
  ["AURORA-MC2 Cycle State", state.market.aurora_mc2_state, "Locked AURORA market-cycle label"],
  ["Final Market Permission", state.market.market_permission, state.market.dimmer_label],
  ["Market Dimmer", `${state.market.market_dimmer}/5`, state.market.reason],
  ["Three-System Market Confirmation", state.market.market_confirmation_state, `O'Neil: ${state.market.oneil_cycle_state || state.market.aurora_mc2_state}; Benchmark RS21: ${state.market.benchmark_rs21_state}; Benchmark Weinstein: ${state.market.benchmark_weinstein_stage}`],
  ["Benchmark MA Stack", state.market.benchmark_ma_stack, "SPY primary US benchmark plus QQQ/IWM/DIA context"],
  ["Breadth", `${state.market.breadth_ema21_count}/${state.market.breadth_denominator} above EMA21 = ${state.market.breadth_ema21_pct}%`, `${state.market.breadth_ema50_count}/${state.market.breadth_denominator} above EMA50 = ${state.market.breadth_ema50_pct}%`],
  ["RS Leadership Breadth", `${state.market.leadership_breadth_count}/${state.market.leadership_breadth_denominator} = ${state.market.leadership_breadth_pct}%`, "RS score, RS21 and Trifecta partial/pass evidence"],
  ["Distribution / Churn", `${state.market.distribution_churn_count_10d} churn days / ${state.market.failed_breakout_count_10d} failed breakouts`, "Used as MC2 dimmer pressure input"],
  ["Risk Proxy", state.market.risk_proxy_state, `Reference basket: ${state.market.reference_basket_state} (${state.market.reference_basket_detail})`],
  ["Cycle Age", `${state.market.cycle_age_sessions} sessions`, "Pending official follow-through-day enrichment"],
  ["Sector Evidence", state.market.sector_theme_evidence, "Sector/theme evidence from cached ETF RRG"],
  ["Dimmer Components", state.market.dimmer_components, "Unknown inputs stay conservative; no silent upgrade"]
].map(([a, b, c]) => `<tr><td>${esc(a)}</td><td><strong>${esc(b)}</strong></td><td>${esc(c)}</td></tr>`).join("");

const benchmarkRows = (state.benchmarks || []).map(x => `<tr><td><strong>${esc(x.symbol)}</strong></td><td>${money(x.close)}</td><td>${fmt(x.day)}%</td><td>${fmt(x.month)}%</td><td>${fmt(x.year)}%</td><td>${esc(x.ma_stack)}</td></tr>`).join("");
const rrgRows = (state.sector_rrg || []).map(x => `<tr><td><strong>${esc(x.sector)}</strong><small>${esc(x.symbol)}</small></td><td>${fmt(x.ratio)}</td><td>${fmt(x.momentum)}</td><td>${badge(x.quadrant)}</td><td>${Number(x.stock_count || 0).toLocaleString()}</td><td>${Number(x.leadership_count || 0).toLocaleString()}</td><td>${esc((x.representatives || []).join(", ") || "-")}</td><td>${fmt(x.ret1m)}%</td><td>${fmt(x.ret3m)}%</td><td>${fmt(x.ret6m)}%</td><td>${fmt(x.ret12m)}%</td></tr>`).join("");
const eventRows = (state.events || []).map(e => `<tr><td><strong>${esc(e.ticker)}</strong><small>${esc(e.exchange)}</small></td><td>${badge(e.lifecycle)}</td><td>${esc(e.event_type || "IPO_NEW_LISTING")}</td><td>${esc(e.event_source)}</td><td>${esc(e.event_date)}<small>${e.days_since_event} sessions</small></td><td>${money(e.price)}</td><td>${fmt(e.listing_day_move_pct)}%</td><td>${fmt(e.drift_pct)}%</td><td>${esc(e.rs21)}<small>high ${fmt(e.rs_high_proximity, 1)}%</small></td><td>${fmt(e.rmv5)} / ${fmt(e.rmv15)}</td><td>${esc(e.ve2)}</td><td>${money(e.avwap)}<small>HVC ${esc(e.hvc)}</small></td><td>${money(e.basepivot)}<small>${esc(e.rmvp)}</small></td><td>${money(e.official_trigger)}</td><td>${money(e.stop)}<small>${fmt(e.risk_pct)}%</small></td><td>${fmt(e.extension_pct)}%</td><td>${money(e.level_2r)} / ${money(e.level_3r)}</td></tr>`).join("");
const scannerRows = Object.entries(state.scanner_counts || {}).map(([name, count]) => `<tr><td><strong>${esc(name)}</strong></td><td>${Number(count).toLocaleString()}</td><td>${Number(state.run.calculated_symbols).toLocaleString()}</td><td>${esc(state.run.data_as_of)}</td><td>${esc(state.run.fallback_label)}</td></tr>`).join("");
const allCandidateRows = (sections.rejected_data_repair || []).map(c => `<tr data-route="${esc(c.universe_route || c.route)}" data-search="${esc(`${c.ticker || c.symbol} ${c.universe_route || c.route} ${c.bucket} ${c.gics_sector || ""} ${(c.scan_memberships || c.scans || []).join(" ")} ${(c.failed_gates || []).join(" ")} ${c.user_note || ""}`.toLowerCase())}"><td><strong>${esc(c.ticker || c.symbol)}</strong><small>${esc(c.exchange)}</small></td><td>${esc(c.gics_sector)}<small>${esc(c.main_industry || c.classification_status)}</small></td><td>${badge(c.universe_route || c.route)}</td><td>${badge(c.bucket)}</td><td>${money(c.price)}</td><td>${esc(c.stage)}</td><td>${esc(c.rs_trifecta)} / ${esc(c.rs21)}</td><td>${fmt(c.rmv15)}</td><td>${fmt(c.entry_risk_pct ?? c.risk_pct)}%</td><td>${fmt(c.thesis_risk_pct)}%</td><td>${fmt(c.axm_atr)} ATR</td><td>${esc(c.pattern_proxy)}</td><td>${esc((c.scan_memberships || c.scans || []).join(", ") || "NONE")}</td><td>${esc((c.failed_gates || []).join(", ") || "NONE")}</td><td>${esc(c.next_condition)}</td><td>${esc(c.user_note || c.pattern_note)}</td></tr>`).join("");
const hierarchyTable = compactTable("Industry Group / Industry / Sub-Industry RRG", "industry-rrg", [...(sections.industry_group_rrg || []), ...(sections.industry_rrg || []), ...(sections.sub_industry_rrg || [])], ["Level", "Name", "Denominator", "Valid RRG", "Confidence", "Ratio", "Momentum", "Symbols"], [
  row => esc(row.level),
  row => esc(row.name),
  row => Number(row.denominator || 0).toLocaleString(),
  row => Number(row.valid_rrg_denominator || 0).toLocaleString(),
  row => badge(row.confidence),
  row => fmt(row.rrg_ratio),
  row => fmt(row.rrg_momentum),
  row => esc(row.symbols)
], "Classification hierarchy RRG with explicit denominator confidence.");
const radarTable = compactTable("AURORA_RADAR_UNIVERSE", "radar", sections.aurora_radar_universe || [], ["Symbol", "Reason", "Memberships", "Gate", "Next", "Confidence"], [
  row => `<strong>${esc(row.symbol)}</strong><small>${esc(row.company_name || row.name || "")}</small>`,
  row => esc(row.radar_reason),
  row => esc((row.scan_memberships || []).join(", ")),
  row => esc(row.current_gate),
  row => esc(row.next_condition),
  row => esc(row.classification_confidence)
], "Names-only visibility layer. Radar rows do not expand Weekly Universe, Weekly Focus or Daily Top.");
const retentionTable = compactTable("STRONG_RS_RETENTION", "retention", sections.strong_rs_retention || [], ["Symbol", "Status", "Reason", "Score", "Gate", "Next"], [
  row => `<strong>${esc(row.symbol || row.ticker)}</strong><small>${esc(row.company_name || row.name || "")}</small>`,
  row => esc(row.strong_rs_retention_status),
  row => esc(row.retention_reason),
  row => fmt(row.rs_retention_score, 0),
  row => esc(row.current_gate),
  row => esc(row.next_condition)
], "Radar-only retention for strong RS leaders waiting for cleaner trigger, risk, pullback or repair.");

const rsleTop20 = state.rs_leadership?.top20_tactical || state.rs_leadership?.top20 || [];
const rsleDeveloping = state.rs_leadership?.developing_21_40 || [];
const developing20 = state.developing_watchlist_20 || state.near_watchlist || [];
const sections = state.sections || {};
const nextHoliday = state.market_calendar?.next_holiday;
const nextHolidayDate = nextHoliday?.date || "NONE";
const nextHolidayLabel = nextHoliday?.name || "No listed upcoming holiday";

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AURORA US Unified Dashboard</title><style>
:root{--ink:#17201c;--muted:#66716b;--paper:#f7f8f5;--panel:#fff;--line:#d9ddd7;--green:#146b45;--greenbg:#e8f4ed;--amber:#895b00;--amberbg:#fff3d4;--red:#9b2f2f;--redbg:#fae9e7;--blue:#195a78;--bluebg:#e6f2f7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 Inter,Arial,sans-serif}header.hero{background:#153f2d;color:white;padding:22px 28px;border-bottom:4px solid #d8ad42}.hero h1{margin:0;font-size:26px}.hero p{margin:5px 0 0;color:#deebe3}.tabs,.nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.tabs button,.nav a{color:white;text-decoration:none;border:1px solid #72917f;background:transparent;padding:6px 10px;border-radius:4px;font:inherit;cursor:pointer}.tabs button.active{background:white;color:#153f2d}.wrap{padding:20px 28px 42px}.workspace.hidden{display:none}.summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.metric{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:12px;overflow-wrap:anywhere}.metric b{display:block;font-size:17px;margin-top:4px;line-height:1.25}.metric small,td small{display:block;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}h2{font-size:19px;margin:28px 0 10px}.notice{background:var(--amberbg);border-left:4px solid #c38b16;padding:10px 12px;border-radius:4px}.goodnote{background:var(--greenbg);border-left:4px solid var(--green);padding:10px 12px;border-radius:4px}.empty{background:#fff;border:1px dashed #aeb8b2;border-radius:6px;padding:24px}.table-wrap{overflow-x:auto;overflow-y:auto;max-height:70vh;position:relative;border:1px solid var(--line);background:white;border-radius:6px}table{border-collapse:collapse;width:100%;min-width:1560px}th,td{text-align:left;vertical-align:top;padding:8px 9px;border-bottom:1px solid var(--line);font-size:12px}th{background:#edf1ec;position:sticky;top:0;z-index:2;white-space:nowrap}.status{display:inline-block;padding:3px 6px;border-radius:4px;font-size:11px;font-weight:700;background:var(--bluebg);color:var(--blue);white-space:nowrap}.good{color:var(--green);background:var(--greenbg)}.warn{color:var(--amber);background:var(--amberbg)}.bad{color:var(--red);background:var(--redbg)}.info{color:var(--blue);background:var(--bluebg)}input,select{padding:8px;border:1px solid var(--line);border-radius:4px;min-width:220px}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.foot{color:var(--muted);margin-top:18px}@media(max-width:900px){.summary{grid-template-columns:1fr 1fr}.wrap{padding:16px}header.hero{padding:18px}table{min-width:1280px}}
</style></head><body><header class="hero"><h1>AURORA US Unified Dashboard</h1><p>Completed session ${esc(state.run.data_as_of)} · one stable HTML · Core AURORA + IPO/PEAD/EP/HVE Events · ${esc(state.run.fallback_label)}</p><div class="tabs"><button class="active" data-workspace="core">Core AURORA</button><button data-workspace="events">IPO / PEAD / EP / HVE Events</button></div><nav class="nav"><a href="#market">Market</a><a href="#guide">Guide</a><a href="#weekly">Weekly Universe</a><a href="#focus">Focus</a><a href="#top">Daily Top</a><a href="#rsle">RSLE Top 20</a><a href="#developing">Developing 20</a><a href="#events-section">Events</a><a href="#industry-rrg">Industry RRG</a><a href="#radar">Radar</a><a href="#retention">Strong RS Retention</a><a href="#rshigh">RS21/RSNH</a><a href="#myh">MYH</a><a href="#myh-retest">MYH Retest</a><a href="#ma10">10EMA Respect</a><a href="#ma21">21EMA Respect</a><a href="#ma50">50SMA Respect</a><a href="#pullbacks">PBX</a><a href="#compression">Compression</a><a href="#basepivots">BasePivot</a><a href="#rmvp">RMVP</a><a href="#ve2">VE2</a><a href="#rrg">RRG</a><a href="#risk">No-Chase</a><a href="#sell-extension">Sell / Extension</a><a href="#rejected">Rejected</a><a href="#provenance">Provenance</a></nav></header><main class="wrap">
<section id="core" class="workspace"><section class="summary"><div class="metric">Run state<b>${esc(state.run.status)}</b><small>${esc(state.run.universe_status)}</small></div><div class="metric">Session<b>${esc(state.run.data_as_of)}</b><small>latest completed bar</small></div><div class="metric">Generated<b>${esc(state.generated_at)}</b><small>canonical render timestamp</small></div><div class="metric">Next NYSE Holiday<b>${esc(nextHolidayDate)}</b><small>${esc(nextHolidayLabel)}</small></div><div class="metric">Market Cycle<b>${esc(state.market.oneil_market_cycle || state.market.market_state)}</b><small>${esc(state.market.aurora_mc2_state)}</small></div><div class="metric">Daily Top<b>${(state.daily_top || []).length}</b><small>maximum four, no padding</small></div><div class="metric">Market Permission<b>${esc(state.market.market_permission)}</b><small>${esc(state.market.dimmer_label)}</small></div></section>
<h2 id="market">Market Summary Strength Stack</h2><p class="goodnote">AURORA-MC2 plus O'Neil-style market label. Unknown inputs stay conservative; no separate dashboard or task is created.</p><div class="table-wrap"><table><thead><tr><th>Field</th><th>Value</th><th>Meaning</th></tr></thead><tbody>${marketRows}</tbody></table></div>
${howToReadHtml}
<h2>Benchmarks</h2><div class="table-wrap"><table><thead><tr><th>Proxy</th><th>Close</th><th>Day</th><th>1M</th><th>1Y</th><th>MA stack</th></tr></thead><tbody>${benchmarkRows}</tbody></table></div>
${candidateTable(state.core, "weekly", "WEEKLY_UNIVERSE", "Rolling 15-20 stock AURORA weekly basket from the full local scan. Separate from RSLE. No forced padding.")}
${candidateTable(state.weekly_focus, "focus", "WEEKLY_FOCUS", "Execution funnel candidates selected only from WEEKLY_UNIVERSE.")}
${candidateTable(state.daily_top, "top", "DAILY_TOP_1_4 Conditional Trade Plans", "Maximum four from WEEKLY_FOCUS only. Trade plan includes trigger, entry stop/risk, thesis stop/risk, permission and note.")}
${candidateTable(rsleTop20, "rsle", "AURORA-RSLE Top 20 Tactical", "Separate RS leadership entry list using v0.3 leadership score plus tactical readiness. Does not consume the Core tracking cap.")}
${candidateTable(rsleDeveloping, "rsledev", "AURORA-RSLE Developing 21-40", "Emerging leaders awaiting tighter geometry, confirmation, market permission or data repair.")}
${candidateTable(developing20, "developing", "Developing Watchlist 20", "Next 20 constructive candidates from the full-universe scan. Rejection blocks promotion, not discovery.")}
<h2 id="events-section">IPO / PEAD / EP / HVE Event Workspace</h2><p class="notice">The persistent event registry is in Workspace 2. Core promotion still requires EOD acceptance, RS confirmation, VE2, BasePivot/RMVP, AXM and a clear executable stop.</p>
${hierarchyTable}
${radarTable}
${retentionTable}
${candidateTable(sections.rs21_rsnh, "rshigh", "RS21 / RSNH", "RS line above/reclaiming EMA21 and near/new RS high evidence.")}
${candidateTable(sections.myh_approaching, "myh", "AURORA-MYH Approaching / Multi-Year High", "Approaching multi-year high is a leadership radar lane, not a standalone buy signal.")}
${candidateTable(sections.myh_breakout_retest, "myh-retest", "AURORA-MYH Breakout Retest", "Prior MYH breakout now retesting a valid support anchor. Radar/watchlist only unless normal AURORA gates promote it.")}
${candidateTable(sections.ma10_respect, "ma10", "Strong RS 10EMA Respect Watchlist", "Tracks high-momentum leaders repeatedly respecting 10EMA. Watchlist only.")}
${candidateTable(sections.ma21_respect, "ma21", "Strong RS 21EMA Respect Watchlist", "Tracks strong RS leaders defending or reclaiming 21EMA. Watchlist only.")}
${candidateTable(sections.ma50_respect, "ma50", "Strong RS 50SMA Respect Watchlist", "Tracks deeper structural resets in strong RS stocks. Watchlist only.")}
${candidateTable(sections.pbx_pullback, "pullbacks", "PBX Pullback", "Pullback quality layer. PBX grades the pullback; it is not a standalone buy signal.")}
${candidateTable(sections.compression_vcp, "compression", "Compression / VCP", "RMV contraction and VCP-style shortlist context only.")}
${candidateTable(sections.basepivot_patterns, "basepivots", "BasePivot / Patterns", "Shortlist-only pattern context: base_stage_count, base_stage_risk, pattern_proxy and pattern_note.")}
${candidateTable(sections.rmvp_early_entry, "rmvp", "RMVP / Early Entry", "BPX/BasePivot/RMVP identify structure. VE2 validates fuel and AXM guards extension.")}
${candidateTable(sections.ve2_volume_signature, "ve2", "VE2 Volume Signature", "VE2 is a conviction layer, not a standalone buy signal.")}
<h2 id="rrg">Sector and Theme RRG</h2><p class="notice">${sectorRrgCopy}</p><p class="notice">${stockThemeCopy}</p><div class="table-wrap"><table><thead><tr><th>Sector</th><th>RS Ratio</th><th>Momentum</th><th>Quadrant</th><th>Mapped stocks</th><th>RS leaders</th><th>Representatives</th><th>1M rel.</th><th>3M rel.</th><th>6M rel.</th><th>12M rel.</th></tr></thead><tbody>${rrgRows}</tbody></table></div>
<h2 id="rrglegend">RRG Legend</h2><div class="table-wrap"><table><tbody><tr><th>LEADING</th><td>Sector is outperforming and momentum is positive.</td></tr><tr><th>IMPROVING</th><td>Sector is strengthening and may be rotating into leadership.</td></tr><tr><th>WEAKENING</th><td>Sector is still relatively strong but momentum is fading.</td></tr><tr><th>LAGGING</th><td>Sector is weak versus benchmark.</td></tr></tbody></table></div>
${candidateTable(sections.no_chase_risk, "risk", "No-Chase / Risk", "Extension, wide entry risk and other caution lanes. Wide thesis risk is context unless structural failure occurs.")}
${sellExtensionWatchlistHtml()}
<h2 id="rejected">Rejected / Data Repair</h2><p class="notice">Full-universe discovery is preserved. Exact failed gates and next promotion condition remain visible.</p><div class="controls"><input id="candidateSearch" type="search" placeholder="Search ticker, sector, scanner, failed gate or user note"><select id="candidateRoute"><option value="">All routes</option><option>WEEKLY_UNIVERSE</option><option>NEAR_WATCHLIST</option><option>SCANNER_CANDIDATE</option><option>REJECTED</option><option>DATA_REPAIR</option></select><span id="candidateVisible"></span></div><div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Sector / Industry</th><th>Route</th><th>Bucket</th><th>Price</th><th>Stage</th><th>RS</th><th>RMV15</th><th>Entry risk</th><th>Thesis risk</th><th>AXM</th><th>Pattern</th><th>Scans</th><th>Failed gates</th><th>Next</th><th>User Note</th></tr></thead><tbody id="allCandidates">${allCandidateRows}</tbody></table></div>
<h2>Scanner Matrix Summary</h2><div class="table-wrap"><table><thead><tr><th>Scanner</th><th>Matches</th><th>Valid denominator</th><th>Data date</th><th>Route</th></tr></thead><tbody>${scannerRows}</tbody></table></div>
<h2 id="provenance">Provenance</h2><div class="table-wrap"><table><tbody><tr><th>Provider route</th><td>${esc(state.provenance.provider_route)}</td></tr><tr><th>Provider / endpoint</th><td>${esc(state.provenance.provider)} · ${esc(state.provenance.endpoint)}</td></tr><tr><th>Data date / currency</th><td>${esc(state.provenance.data_date)} · ${esc(state.provenance.currency)}</td></tr><tr><th>Adjustment / fallback</th><td>${esc(state.provenance.adjustment_status)} · ${esc(state.provenance.fallback_label)}</td></tr><tr><th>Cache policy</th><td>${esc(state.provenance.cache_policy)}</td></tr><tr><th>Missing enrichment</th><td>${esc((state.provenance.missing || []).join(", "))}</td></tr></tbody></table></div><p class="foot">Decision-support only. Confirm provider coverage, corporate actions, next-session price/volume behavior and risk before acting.</p></section>
<section id="events" class="workspace hidden"><section class="summary"><div class="metric">Registry<b>${Number(state.event_registry_count || 0).toLocaleString()}</b><small>persistent event candidates</small></div><div class="metric">Displayed<b>${(state.events || []).length}</b><small>top rows</small></div><div class="metric">Lifecycle<b>NEW → ARCHIVED</b><small>IPO / PEAD / EP / HVE</small></div><div class="metric">Verification<b>REQUIRED</b><small>SEC, exchange, issuer IR</small></div><div class="metric">Promotion<b>Core gates required</b><small>RS + VE2 + structure + AXM + stop</small></div></section><h2>IPO / PEAD / EP / HVE Registry</h2><p class="notice">OHLCV can flag HVE and new-listing behavior, but PEAD/EP require official event source/date before promotion.</p><div class="table-wrap"><table><thead><tr><th>Stock</th><th>Lifecycle</th><th>Event type</th><th>Event source</th><th>Event date / age</th><th>Price</th><th>Gap/listing</th><th>Drift</th><th>RS</th><th>RMV</th><th>VE2</th><th>AVWAP/HVC</th><th>BasePivot/RMVP</th><th>Trigger</th><th>Stop/Risk</th><th>Extension</th><th>2R/3R</th></tr></thead><tbody>${eventRows}</tbody></table></div></section>
</main><script>document.querySelectorAll('[data-workspace]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-workspace]').forEach(x=>x.classList.remove('active'));button.classList.add('active');document.getElementById('core').classList.toggle('hidden',button.dataset.workspace!=='core');document.getElementById('events').classList.toggle('hidden',button.dataset.workspace!=='events')}));const search=document.getElementById('candidateSearch'),route=document.getElementById('candidateRoute'),rows=[...document.querySelectorAll('#allCandidates tr')],visible=document.getElementById('candidateVisible');function filterCandidates(){const q=search.value.trim().toLowerCase(),r=route.value;let count=0;for(const row of rows){const show=(!q||row.dataset.search.includes(q))&&(!r||row.dataset.route===r);row.hidden=!show;if(show)count++}visible.textContent=count.toLocaleString()+' visible'}if(search){search.addEventListener('input',filterCandidates);route.addEventListener('change',filterCandidates);filterCandidates()}</script></body></html>`;

await writeFile(temp, html, "utf8");
await rename(temp, output);
await writeFile(stateTemp, JSON.stringify(state), "utf8");
await rename(stateTemp, statePath);
if (shouldWriteJson) {
  await writeUsDashboardJsonExport({
    outputDir: resolve(root, "data"),
    scan: state,
    generatedAt: state.generated_at
  });
}
console.log(output);
