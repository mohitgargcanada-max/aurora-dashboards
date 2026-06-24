import { smokeState } from "./smoke-data.js";
import { collectHistory, publicConnectivity } from "./data-sources.js";

const TABS = [
  ["market", "Market State"], ["weekly", "Weekly Universe"], ["top", "Top Entries"],
  ["discovery", "New Discovery"], ["ipo", "IPO"], ["event", "PEAD/Event"],
  ["nonindex", "Non-Index Leaders"], ["rs", "RS21/RSNH"], ["rmvp", "RMVP/Early Entry"],
  ["pullbacks", "Pullbacks"], ["compression", "Compression"], ["patterns", "BasePivot/Patterns"],
  ["avwap", "AVWAP/HVC"], ["ve2", "VE2"], ["sector", "Sector Rotation"],
  ["squat", "Squat/Retest"], ["risk", "No-Chase/Risk"], ["all", "All Candidates"],
  ["cautions", "Cautions"],
];

const TAB_FILTERS = {
  weekly: c => c.weekly_tier && c.weekly_tier !== "NOT_WEEKLY_LIST",
  top: c => /^DAILY_TOP/.test(c.execution_tier || ""),
  discovery: c => (c.source_scan_ids || []).includes("NEW_DISCOVERY"),
  ipo: c => (c.source_scan_ids || []).includes("IPO"),
  event: c => (c.source_scan_ids || []).some(x => ["PEAD", "EP", "CATALYST"].includes(x)),
  nonindex: c => (c.source_scan_ids || []).includes("NON_INDEX"),
  rs: c => c.rsnh_status || /RS/.test(c.rs_trifecta_label || ""),
  rmvp: c => c.rmvp_price || c.rmv_pivot_price,
  pullbacks: c => c.final_bucket === "PULLBACK_WATCH",
  compression: c => /TIGHT|ZERO/.test(c.rmv_tight_label || ""),
  patterns: c => c.basepivot_price || c.pattern_label,
  avwap: c => c.avwap_level || c.hvc_level,
  ve2: c => c.ve2_signature,
  sector: c => c.theme_primary || c.gics_sector,
  squat: c => c.squat_label,
  risk: c => ["NO_CHASE", "AVOID_FRESH_LONG", "REPAIR_WATCH"].includes(c.final_bucket),
  all: () => true,
};

const EMPTY_STATE = {
  run: null,
  market: {
    cycle: "UNKNOWN", permission: "UNKNOWN", dimmer: null, leadership: "UNKNOWN",
    breadth: "UNKNOWN", concentration: "UNKNOWN", reference_basket: "UNKNOWN",
  },
  candidates: [],
  lanes: [
    ["Security master", "UNKNOWN", "Nasdaq Trader / official exchange files"],
    ["OHLCV", "UNKNOWN", "Yahoo Finance; EODHD fallback"],
    ["Filings / facts", "UNKNOWN", "SEC EDGAR + issuer filings; Yahoo enrichment"],
    ["Constituents", "PARTIAL", "Official files where available; benchmark proxy otherwise"],
    ["Risk / macro", "UNKNOWN", "CBOE + FRED"],
    ["EODHD fallback", "PARTIAL", "Symbols + EOD authenticated; fundamentals not entitled"],
  ],
};

function esc(value) {
  return String(value ?? "-").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

function badge(value) {
  const v = value == null ? "UNKNOWN" : String(value);
  const kind = /CALCULATED|TRADE_READY|TRIGGER_READY|ALLOWED|CONFIRM|STRONG|PASS/.test(v) ? "ok" :
    /PARTIAL|WATCH|SELECTIVE|TIGHT|REPAIR|CAUTION/.test(v) ? "warn" :
    /FAIL|AVOID|DEFENSE|HARD|DAMAGE|NO_CHASE/.test(v) ? "bad" : "muted";
  return `<span class="badge ${kind}">${esc(v)}</span>`;
}

async function readState(env, mode) {
  if (!env.DB) return smokeState;
  try {
    const run = await env.DB.prepare(
      "SELECT * FROM scan_runs WHERE run_type = ? AND status = 'COMPLETED' ORDER BY asof_eod_date DESC, completed_at DESC LIMIT 1"
    ).bind(mode === "weekly" ? "SUNDAY_WWL" : "WEEKDAY_MORNING").first();
    if (!run) return smokeState;
    const rows = await env.DB.prepare("SELECT payload_json FROM candidate_snapshots WHERE run_id = ? ORDER BY rank ASC").bind(run.id).all();
    const candidates = (rows.results || []).map(r => JSON.parse(r.payload_json));
    return {
      run,
      market: run.market_json ? JSON.parse(run.market_json) : EMPTY_STATE.market,
      candidates,
      lanes: run.lanes_json ? JSON.parse(run.lanes_json) : EMPTY_STATE.lanes,
    };
  } catch (error) {
    return {...EMPTY_STATE, error: error.message};
  }
}

function topCards(candidates) {
  const top = candidates.filter(TAB_FILTERS.top).slice(0, 4);
  if (!top.length) return `<div class="empty"><strong>No DAILY_TOP_1_4 was produced.</strong><span>AURORA never pads this list. It may remain empty until a completed EOD run has market permission, score, risk and data coverage.</span></div>`;
  return `<div class="top-grid">${top.map(c => `<article class="entry-card">
    <div class="entry-kicker">${esc(c.execution_tier)} · ${esc(c.source_lane)}</div>
    <div class="ticker-line"><h3>${esc(c.ticker)}</h3><strong>$${esc(c.price)}</strong></div>
    <div class="entry-metrics"><span>Next entry<b>$${esc(c.next_session_entry)}</b></span><span>Trigger<b>$${esc(c.trigger_price)}</b></span><span>Stop<b>$${esc(c.initial_stop)}</b></span><span>Risk<b>${esc(c.risk_pct)}%</b></span><span>2R / 3R<b>$${esc(c.level_2r)} / $${esc(c.level_3r)}</b></span><span>RMV<b>${esc(c.rmv_value)}</b></span></div>
    <p>${esc(c.conviction)}</p>
  </article>`).join("")}</div>`;
}

function candidateTable(rows) {
  if (!rows.length) return `<div class="empty"><strong>No candidates in this view.</strong><span>The dashboard is ready, but no completed US scan has populated this lane.</span></div>`;
  return `<div class="table-shell"><table><thead><tr><th>#</th><th>Stock</th><th>Price</th><th>Membership</th><th>Source lane</th><th>RS</th><th>RMV</th><th>VE2</th><th>BasePivot / RMVP</th><th>Next entry / trigger</th><th>Stop / risk</th><th>2R / 3R</th><th>Extension</th><th>Conviction</th></tr></thead><tbody>${rows.map((c,i) => `<tr>
    <td>${esc(c.rank || i + 1)}</td><td><b>${esc(c.ticker)}</b><small>${badge(c.final_bucket)}</small></td><td>$${esc(c.price)}<small>${c.day_change_pct == null ? "-" : `${c.day_change_pct >= 0 ? "+" : ""}${esc(c.day_change_pct.toFixed(2))}%`}</small></td>
    <td>${esc((c.index_membership || []).join(", "))}</td><td>${esc(c.source_lane)}</td><td>${esc(c.rs_trifecta_label)}<small>${esc(c.rsnh_status)}</small></td>
    <td>${esc(c.rmv_value)}<small>${esc(c.rmv_tight_label)}</small></td><td>${esc(c.ve2_signature)}</td><td>${esc(c.basepivot_price)} / ${esc(c.rmvp_price)}</td>
    <td>$${esc(c.next_session_entry)} / $${esc(c.trigger_price)}</td><td>$${esc(c.initial_stop)} / ${esc(c.risk_pct)}%</td>
    <td>$${esc(c.level_2r)} / $${esc(c.level_3r)}</td><td>${esc(c.px_label)}<small>${esc(c.axm21_label)}</small></td><td class="wrap">${esc(c.conviction)}</td>
  </tr>`).join("")}</tbody></table></div>`;
}

function sourceMatrix(lanes) {
  return `<div class="source-grid">${lanes.map(([name,status,provider]) => `<div class="source-row"><div><strong>${esc(name)}</strong><span>${esc(provider)}</span></div>${badge(status)}</div>`).join("")}</div>`;
}

function marketPanel(state) {
  const m = state.market;
  const quoteSmoke = state.run?.status === "COMPLETED_QUOTE_SMOKE";
  const benchmark = m.benchmark_snapshot ? `<div class="benchmark-strip">${Object.entries(m.benchmark_snapshot).map(([symbol, value]) => `<div><b>${esc(symbol)}</b><span>$${esc(value.price)}</span><strong class="${value.change_pct >= 0 ? "up" : "down"}">${value.change_pct >= 0 ? "+" : ""}${esc(value.change_pct.toFixed(2))}%</strong></div>`).join("")}</div>` : "";
  return `<section class="panel-grid">
    <article class="panel span-7"><div class="panel-head"><div><span class="eyebrow">Run readiness</span><h2>${state.run ? esc(state.run.status) : "Awaiting first completed scan"}</h2></div>${badge(state.run ? "CALCULATED" : "UNKNOWN")}</div>
      <p class="lede">${quoteSmoke ? "The free EOD quote lane completed for six benchmarks and 29 liquid US equities. Historical bars were unavailable, so market permission and every setup/entry calculation correctly remain UNKNOWN." : "The application has no completed US EOD dataset yet. Market conclusions and stock rows remain UNKNOWN until source lanes are fetched, reconciled and calculated."}</p>
      <div class="market-kpis"><div><span>MC2 cycle</span><b>${esc(m.cycle)}</b></div><div><span>Permission</span><b>${esc(m.permission)}</b></div><div><span>Dimmer</span><b>${m.dimmer == null ? "- / 5" : esc(m.dimmer) + " / 5"}</b></div><div><span>Leadership</span><b>${esc(m.leadership)}</b></div></div>
      ${benchmark}
    </article>
    <article class="panel span-5"><div class="panel-head"><div><span class="eyebrow">Source precedence</span><h2>Lane status</h2></div><span class="asof">Provider + as-of required</span></div>${sourceMatrix(state.lanes)}</article>
    <article class="panel span-12"><div class="panel-head"><div><span class="eyebrow">Two-run workflow</span><h2>Discovery stays weekly; execution re-ranks daily</h2></div><span class="asof">America/New_York</span></div>
      <div class="workflow"><div><b>Sunday · 09:00</b><strong>SUNDAY_WWL</strong><span>Cheap-scan active Nasdaq, NYSE and NYSE American common stocks. Enrich shortlisted names. Persist 15–20 when quality permits.</span></div><i></i><div><b>Weekdays · 09:00</b><strong>WEEKDAY_MORNING</strong><span>Refresh completed EOD bars, apply removals, rank WEEKLY_FOCUS and select zero to four DAILY_TOP candidates, ideally one.</span></div><i></i><div><b>Outside exception</b><strong>IPO / PEAD / catalyst</strong><span>Promotion only after EOD acceptance, RS confirmation, constructive VE2, valid BasePivot/RMVP and visible structural stop.</span></div></div>
    </article>
  </section>`;
}

function cautionsPanel() {
  return `<section class="panel-grid">
    <article class="panel span-7"><span class="eyebrow">Implementation locks</span><h2>Known specification boundaries</h2>
      <ul class="caution-list"><li><b>AXM states:</b> formulas are locked, but numeric label cutoffs are absent. Calculate ATR-unit distances; expose labels as PARTIAL until thresholds are approved.</li><li><b>PBX:</b> depth and duration buckets are locked; institutional-defense and reversal-quality formulas are unspecified and must remain PARTIAL.</li><li><b>HTF ADR labels:</b> the addendum names acceptable/loose states but provides no numeric ADR-unit boundary.</li><li><b>EOD boundary:</b> premarket, 9:35 run rate, session VWAP, intraday LOD and live order logic remain outside AURORA v2.18.2.</li></ul>
    </article>
    <article class="panel span-5"><span class="eyebrow">EODHD</span><h2>Fallback by lane</h2><p>The connector is authenticated for US symbols and historical EOD prices. Fundamentals are not entitled, so SEC and issuer filings remain primary with Yahoo Finance as secondary enrichment.</p><div class="endpoint-list"><span>Symbols: CALCULATED smoke test</span><span>EOD OHLCV: CALCULATED smoke test</span><span>Fundamentals: UNKNOWN (403 entitlement)</span><span>Credentials never appear in source, logs or output</span></div></article>
    <article class="panel span-12"><span class="eyebrow">Promotion guard</span><h2>Visibility is not promotion</h2><p>Incomplete fundamentals, low liquidity and wide risk remain visible with cautions. Structural damage, Stage 4, AURORA-X X3/X4 and the locked hard overrides prevent fresh-entry promotion. Missing average dollar volume prevents DAILY_TOP_1_4, but does not erase the row.</p></article>
  </section>`;
}

function page(mode, state) {
  const isWeekly = mode === "weekly";
  const title = isWeekly ? "Weekly Broad Scan" : "Morning Re-Rank";
  const count = state.candidates.length;
  const tabs = TABS.map(([id,label],i) => `<button class="tab ${i === 0 ? "active" : ""}" data-tab="${id}">${label}</button>`).join("");
  const data = JSON.stringify(state.candidates).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AURORA US · ${title}</title><style>
  :root{--ink:#15211b;--muted:#69736d;--line:#dce2de;--paper:#f4f6f4;--white:#fff;--green:#0b6b43;--green2:#e7f3ec;--amber:#916006;--amber2:#fff4d7;--red:#a53d34;--red2:#fceceb;--blue:#275d73;--nav:#101c17}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:13px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}button{font:inherit}header{background:var(--nav);color:#fff;padding:18px 24px 16px}.head{max-width:1540px;margin:auto;display:grid;grid-template-columns:1fr auto;gap:20px;align-items:end}.brand{display:flex;align-items:center;gap:13px}.mark{width:34px;height:34px;border:1px solid #5f7f70;border-radius:7px;display:grid;place-items:center;font-weight:900;letter-spacing:1px;color:#b6edcf}.brand h1{font-size:20px;margin:0;letter-spacing:0}.brand p{margin:2px 0 0;color:#adc0b6}.mode-switch{display:flex;background:#21322b;border:1px solid #40564c;border-radius:7px;padding:3px}.mode-switch a{color:#b9c8c0;text-decoration:none;padding:7px 11px;border-radius:5px;font-weight:700}.mode-switch a.active{background:#f6faf7;color:#122019}.meta{max-width:1540px;margin:14px auto 0;display:flex;gap:8px;flex-wrap:wrap}.meta span{border:1px solid #3c5147;border-radius:5px;padding:4px 8px;color:#c5d2cb}.meta .accent{background:#153c2d;border-color:#236342;color:#baf0d0}.tabs-wrap{background:var(--white);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:4}.tabs{max-width:1540px;margin:auto;display:flex;overflow:auto;padding:0 18px;scrollbar-width:thin}.tab{border:0;border-bottom:3px solid transparent;background:transparent;color:#5d6962;padding:12px 10px;white-space:nowrap;cursor:pointer}.tab.active{color:var(--ink);border-bottom-color:var(--green);font-weight:800}main{max-width:1540px;margin:0 auto;padding:20px 24px 56px}.view-head{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-bottom:14px}.view-head h2{margin:0;font-size:22px;letter-spacing:0}.view-head p{margin:3px 0 0;color:var(--muted)}.badge{display:inline-flex;align-items:center;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:800;letter-spacing:.03em}.badge.ok{color:var(--green);background:var(--green2)}.badge.warn{color:var(--amber);background:var(--amber2)}.badge.bad{color:var(--red);background:var(--red2)}.badge.muted{color:#58635d;background:#e9edeb}.panel-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px}.panel{background:#fff;border:1px solid var(--line);border-radius:8px;padding:17px}.span-5{grid-column:span 5}.span-7{grid-column:span 7}.span-12{grid-column:span 12}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.eyebrow{display:block;color:var(--green);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.panel h2{font-size:17px;margin:3px 0 11px}.lede{max-width:760px;color:#48534d}.asof{color:var(--muted);font-size:11px}.market-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin-top:16px}.market-kpis div{background:#fff;padding:11px}.market-kpis span,.entry-metrics span{display:block;color:var(--muted);font-size:10px;text-transform:uppercase}.market-kpis b{display:block;margin-top:4px;font-size:13px}.source-grid{display:grid;gap:1px;background:var(--line);border:1px solid var(--line)}.source-row{display:flex;background:#fff;justify-content:space-between;align-items:center;padding:8px}.source-row span{display:block;color:var(--muted);font-size:11px}.workflow{display:grid;grid-template-columns:1fr 24px 1fr 24px 1fr;align-items:center}.workflow>div{border-left:3px solid var(--green);padding:6px 10px}.workflow b,.workflow strong,.workflow span{display:block}.workflow b{font-size:11px;color:var(--green)}.workflow strong{font-size:14px;margin:2px 0}.workflow span{color:var(--muted)}.workflow i{height:1px;background:var(--line)}.top-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.entry-card{background:#fff;border:1px solid var(--line);border-top:3px solid var(--green);border-radius:7px;padding:14px}.entry-kicker{font-size:10px;color:var(--green);font-weight:800}.ticker-line{display:flex;justify-content:space-between;align-items:center}.ticker-line h3{font-size:18px;margin:8px 0}.ticker-line strong{font-size:18px}.entry-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;border-top:1px solid var(--line);padding-top:10px}.entry-metrics b{display:block;color:var(--ink);font-size:12px;margin-top:2px}.entry-card p{color:#4f5b54}.empty{border:1px dashed #b7c0ba;background:#fff;padding:30px;border-radius:8px;display:grid;place-items:center;text-align:center;min-height:150px}.empty strong{font-size:16px}.empty span{color:var(--muted);max-width:620px;margin-top:4px}.table-shell{overflow:auto;border:1px solid var(--line);border-radius:7px;background:#fff}table{border-collapse:collapse;width:100%;min-width:1500px}th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap;vertical-align:top}th{position:sticky;top:0;background:#edf1ee;color:#58635d;font-size:10px;text-transform:uppercase}td small{display:block;margin-top:3px;color:var(--muted)}td.wrap{white-space:normal;min-width:230px}.caution-list{margin:0;padding-left:18px}.caution-list li{margin:8px 0}.endpoint-list{display:grid;gap:6px;margin-top:13px}.endpoint-list span{background:var(--paper);border-left:3px solid var(--blue);padding:7px 9px}code{background:#edf1ee;padding:2px 4px;border-radius:3px}.footnote{margin-top:18px;color:var(--muted);font-size:11px}@media(max-width:1000px){.span-5,.span-7{grid-column:span 12}.top-grid{grid-template-columns:1fr 1fr}.workflow{grid-template-columns:1fr}.workflow i{height:16px;width:1px;margin-left:16px}.head{grid-template-columns:1fr}.mode-switch{justify-self:start}}@media(max-width:620px){header{padding:15px}.head{gap:12px}.brand{align-items:start}.mark{flex:0 0 auto}.mode-switch{width:100%}.mode-switch a{flex:1;text-align:center}.meta{margin-top:10px}.meta span:nth-child(n+4){display:none}main{padding:16px 12px 44px}.view-head{align-items:start;flex-direction:column}.panel{padding:14px}.market-kpis{grid-template-columns:1fr 1fr}.top-grid{grid-template-columns:1fr}.tabs{padding:0 6px}.tab{padding:11px 8px}}
  .benchmark-strip{display:grid;grid-template-columns:repeat(6,1fr);border:1px solid var(--line);border-top:0}.benchmark-strip div{display:grid;grid-template-columns:auto 1fr;gap:1px 7px;padding:8px;border-right:1px solid var(--line)}.benchmark-strip div:last-child{border-right:0}.benchmark-strip span{color:var(--muted)}.benchmark-strip strong{grid-column:1/-1;font-size:11px}.up{color:var(--green)}.down{color:var(--red)}@media(max-width:1000px){.benchmark-strip{grid-template-columns:repeat(3,1fr)}}@media(max-width:620px){.benchmark-strip{grid-template-columns:1fr 1fr}}
  </style></head><body><header><div class="head"><div class="brand"><div class="mark">AU</div><div><h1>AURORA US Market Dashboard</h1><p>v2.18.2 · ${title} · EOD decision support</p></div></div><nav class="mode-switch"><a href="/weekly" class="${isWeekly ? "active" : ""}">Sunday Weekly</a><a href="/morning" class="${!isWeekly ? "active" : ""}">Weekday Morning</a></nav></div><div class="meta"><span class="accent">${state.run ? esc(state.run.status) : "NO COMPLETED RUN"}</span><span>As of ${state.run ? esc(state.run.asof_eod_date) : "awaiting EOD data"}</span><span>${count} candidates</span><span>Schedule 09:00 America/New_York</span><span>EODHD fallback: SYMBOLS + EOD</span></div></header>
  <div class="tabs-wrap"><nav class="tabs">${tabs}</nav></div><main><div class="view-head"><div><h2 id="view-title">Market State</h2><p id="view-sub">Source readiness, market permission and scheduled workflow</p></div><div>${badge(state.run ? "CALCULATED" : "UNKNOWN")}</div></div><div id="content">${marketPanel(state)}</div><p class="footnote">AURORA is EOD-only. Prices and levels are alerts for next-session review, not live orders or personalized position sizing.</p></main>
  <script>const candidates=${data};const marketHTML=${JSON.stringify(marketPanel(state))};const cautionsHTML=${JSON.stringify(cautionsPanel())};const topHTML=${JSON.stringify(topCards(state.candidates))};const filters=${JSON.stringify(Object.keys(TAB_FILTERS))};
  function e(v){return String(v??'-').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))}function table(rows){if(!rows.length)return '<div class="empty"><strong>No candidates in this view.</strong><span>The dashboard is ready, but no completed US scan has populated this lane.</span></div>';return '<div class="table-shell"><table><thead><tr><th>#</th><th>Stock</th><th>Price</th><th>Membership</th><th>Source lane</th><th>RS</th><th>RMV</th><th>VE2</th><th>BasePivot / RMVP</th><th>Next entry / trigger</th><th>Stop / risk</th><th>2R / 3R</th><th>Extension</th><th>Conviction</th></tr></thead><tbody>'+rows.map((c,i)=>'<tr><td>'+e(c.rank||i+1)+'</td><td><b>'+e(c.ticker)+'</b><small>'+e(c.final_bucket)+'</small></td><td>$'+e(c.price)+'<small>'+(c.day_change_pct==null?'-':(c.day_change_pct>=0?'+':'')+e(c.day_change_pct.toFixed(2))+'%')+'</small></td><td>'+e((c.index_membership||[]).join(', '))+'</td><td>'+e(c.source_lane)+'</td><td>'+e(c.rs_trifecta_label)+'<small>'+e(c.rsnh_status)+'</small></td><td>'+e(c.rmv_value)+'<small>'+e(c.rmv_tight_label)+'</small></td><td>'+e(c.ve2_signature)+'</td><td>'+e(c.basepivot_price)+' / '+e(c.rmvp_price)+'</td><td>$'+e(c.next_session_entry)+' / $'+e(c.trigger_price)+'</td><td>$'+e(c.initial_stop)+' / '+e(c.risk_pct)+'%</td><td>$'+e(c.level_2r)+' / $'+e(c.level_3r)+'</td><td>'+e(c.px_label)+'<small>'+e(c.axm21_label)+'</small></td><td class="wrap">'+e(c.conviction)+'</td></tr>').join('')+'</tbody></table></div>'}
  const predicates={weekly:c=>c.weekly_tier&&c.weekly_tier!=='NOT_WEEKLY_LIST',top:c=>/^DAILY_TOP/.test(c.execution_tier||''),discovery:c=>(c.source_scan_ids||[]).includes('NEW_DISCOVERY'),ipo:c=>(c.source_scan_ids||[]).includes('IPO'),event:c=>(c.source_scan_ids||[]).some(x=>['PEAD','EP','CATALYST'].includes(x)),nonindex:c=>(c.source_scan_ids||[]).includes('NON_INDEX'),rs:c=>c.rsnh_status||/RS/.test(c.rs_trifecta_label||''),rmvp:c=>c.rmvp_price||c.rmv_pivot_price,pullbacks:c=>c.final_bucket==='PULLBACK_WATCH',compression:c=>/TIGHT|ZERO/.test(c.rmv_tight_label||''),patterns:c=>c.basepivot_price||c.pattern_label,avwap:c=>c.avwap_level||c.hvc_level,ve2:c=>c.ve2_signature,sector:c=>c.theme_primary||c.gics_sector,squat:c=>c.squat_label,risk:c=>['NO_CHASE','AVOID_FRESH_LONG','REPAIR_WATCH'].includes(c.final_bucket),all:()=>true};
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');const id=b.dataset.tab;document.getElementById('view-title').textContent=b.textContent;document.getElementById('view-sub').textContent=id==='market'?'Source readiness, market permission and scheduled workflow':id==='cautions'?'Data gaps, hard locks and secure fallback status':'Completed EOD candidates mapped to this AURORA lane';document.getElementById('content').innerHTML=id==='market'?marketHTML:id==='cautions'?cautionsHTML:id==='top'?topHTML:table(candidates.filter(predicates[id]||(()=>true))) }));</script></body></html>`;
}

async function queueRun(request, env) {
  const supplied = request.headers.get("authorization") || "";
  if (!env.AUTOMATION_BEARER_TOKEN || supplied !== `Bearer ${env.AUTOMATION_BEARER_TOKEN}`) return new Response("Unauthorized", {status: 401});
  if (!env.DB) return Response.json({error: "D1 binding DB is unavailable"}, {status: 503});
  const body = await request.json().catch(() => ({}));
  const runType = body.run_type === "SUNDAY_WWL" ? "SUNDAY_WWL" : "WEEKDAY_MORNING";
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO scan_runs (id, run_type, status, requested_at) VALUES (?, ?, 'QUEUED', datetime('now'))").bind(id, runType).run();
  return Response.json({id, run_type: runType, status: "QUEUED"}, {status: 202});
}

function authorized(request, env) {
  const supplied = request.headers.get("authorization") || "";
  return Boolean(env.AUTOMATION_BEARER_TOKEN && supplied === `Bearer ${env.AUTOMATION_BEARER_TOKEN}`);
}

async function connectivityCheck(request, env) {
  if (!authorized(request, env)) return new Response("Unauthorized", {status:401});
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "AAPL").toUpperCase();
  const expectedSession = url.searchParams.get("expected_session");
  if (!/^[A-Z0-9.-]{1,10}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(expectedSession || "")) {
    return Response.json({error:"symbol and expected_session=YYYY-MM-DD are required"}, {status:400});
  }
  const end = new Date(`${expectedSession}T00:00:00Z`);
  const start = new Date(end.getTime() - 400 * 86_400_000).toISOString().slice(0,10);
  try {
    const result = await collectHistory({
      symbol,
      eodhdSymbol:`${symbol}.US`,
      startDate:start,
      endDate:expectedSession,
      expectedSession,
      expectedCurrency:"USD",
      minimumBars:200,
      eodhdToken:env.EODHD_API_TOKEN
    });
    return Response.json(publicConnectivity(result), {headers:{"cache-control":"no-store"}});
  } catch (error) {
    return Response.json({ok:false,code:error.code || "CONNECTIVITY_FAILED",error:error.message,details:error.details || {}}, {status:502,headers:{"cache-control":"no-store"}});
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return Response.redirect(new URL("/morning", url), 302);
    if (url.pathname === "/api/run" && request.method === "POST") return queueRun(request, env);
    if (url.pathname === "/api/connectivity" && request.method === "GET") return connectivityCheck(request, env);
    if (url.pathname === "/api/status") {
      const mode = url.searchParams.get("mode") === "weekly" ? "weekly" : "morning";
      return Response.json(await readState(env, mode));
    }
    if (!["/weekly", "/morning"].includes(url.pathname)) return new Response("Not found", {status: 404});
    const mode = url.pathname.slice(1);
    return new Response(page(mode, await readState(env, mode)), {headers: {"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
  },
  async scheduled(controller, env) {
    if (!env.DB) return;
    const local = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",weekday:"short",hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date(controller.scheduledTime));
    const parts = Object.fromEntries(local.map(p => [p.type, p.value]));
    if (parts.hour !== "09") return;
    const runType = parts.weekday === "Sun" ? "SUNDAY_WWL" : ["Mon","Tue","Wed","Thu","Fri"].includes(parts.weekday) ? "WEEKDAY_MORNING" : null;
    if (!runType) return;
    await env.DB.prepare("INSERT INTO scan_runs (id, run_type, status, requested_at) VALUES (?, ?, 'QUEUED', datetime('now'))").bind(crypto.randomUUID(), runType).run();
  },
};
