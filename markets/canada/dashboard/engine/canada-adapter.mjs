export const FINAL_BUCKETS = [
  "TRADE_READY",
  "TRIGGER_READY",
  "EARLY_ENTRY_WATCH",
  "PULLBACK_WATCH",
  "RSNH_WATCH_ONLY",
  "NO_CHASE",
  "PROTECT_PROFIT_REVIEW",
  "REPAIR_WATCH",
  "AVOID_FRESH_LONG"
];

export const CANADA_PROFILE = {
  market: "CANADA",
  currency: "CAD",
  benchmark_primary: "^GSPTSE",
  benchmark_growth: "XIT.TO",
  benchmark_breadth: "XIC.TO",
  risk_on_proxies: ["XIC.TO", "XIU.TO", "XIT.TO", "XEG.TO", "SHOP.TO", "XFN.TO", "XMA.TO", "ZUT.TO", "XRE.TO", "ZIN.TO"],
  sector_proxy_map: {
    Financials: "XFN.TO",
    Energy: "XEG.TO",
    Technology: "XIT.TO",
    Materials: "XMA.TO",
    Industrials: "ZIN.TO",
    Utilities: "ZUT.TO",
    "Real Estate": "XRE.TO",
    Broad: "XIC.TO"
  },
  reference_basket_static_fallback: ["RY.TO", "TD.TO", "BMO.TO", "BNS.TO", "ENB.TO", "CNQ.TO", "CNR.TO", "CP.TO", "SHOP.TO", "TRI.TO"],
  liquidity_min_addv_local: 1_000_000,
  liquidity_ideal_addv_local: 5_000_000,
  liquidity_min_price: 5,
  liquidity_min_share_volume_20d: 100_000,
  yahoo_suffixes: {
    TSX: ".TO",
    TSXV: ".V"
  }
};

export const REQUIRED_CANDIDATE_COLUMNS = [
  "Rank",
  "Symbol",
  "User Note",
  "Theme",
  "AURORA Bucket",
  "Setup",
  "Price",
  "Score",
  "RS",
  "RRG",
  "RMV",
  "BasePivot / RMVP",
  "PBX",
  "VE2 Volume",
  "AXM",
  "Entry / Stop",
  "Liquidity",
  "Caution / Next"
];

const EXPLICIT_THEME_MAP = new Map(Object.entries({
  "RY.TO": "Canadian Banks", "TD.TO": "Canadian Banks", "BMO.TO": "Canadian Banks", "BNS.TO": "Canadian Banks", "CM.TO": "Canadian Banks", "NA.TO": "Canadian Banks",
  "MFC.TO": "Insurance / Asset Management", "SLF.TO": "Insurance / Asset Management", "BAM.TO": "Insurance / Asset Management", "BN.TO": "Insurance / Asset Management",
  "ENB.TO": "Pipelines / Midstream", "TRP.TO": "Pipelines / Midstream", "PPL.TO": "Pipelines / Midstream",
  "CNQ.TO": "Oil & Gas E&P", "SU.TO": "Oil & Gas E&P", "CVE.TO": "Oil & Gas E&P", "WCP.TO": "Oil & Gas E&P", "ARX.TO": "Oil & Gas E&P",
  "CCO.TO": "Uranium",
  "AEM.TO": "Gold Miners", "ABX.TO": "Gold Miners", "K.TO": "Gold Miners", "WPM.TO": "Silver Miners",
  "TECK-B.TO": "Copper / Base Metals", "FM.TO": "Copper / Base Metals", "NTR.TO": "Lithium / Battery Metals",
  "CNR.TO": "Rail / Logistics", "CP.TO": "Rail / Logistics", "TFII.TO": "Rail / Logistics",
  "SHOP.TO": "E-commerce / Digital Platforms", "CSU.TO": "Canadian Technology / Software", "DSG.TO": "Canadian Technology / Software", "OTEX.TO": "Canadian Technology / Software", "LSPD.TO": "Canadian Technology / Software", "GIB-A.TO": "Canadian Technology / Software",
  "BCE.TO": "Telecom", "T.TO": "Telecom", "RCI-B.TO": "Telecom",
  "FTS.TO": "Utilities", "EMA.TO": "Utilities", "AQN.TO": "Utilities", "BEPC.TO": "Renewables / Power Producers",
  "CAR-UN.TO": "REITs", "REI-UN.TO": "REITs",
  "WSP.TO": "Industrials", "CAE.TO": "Industrials", "TRI.TO": "Industrials",
  "ATD.TO": "Consumer Staples", "L.TO": "Consumer Staples", "MRU.TO": "Consumer Staples",
  "DOL.TO": "Consumer Discretionary", "CTC-A.TO": "Consumer Discretionary", "MG.TO": "Consumer Discretionary"
}));

const KEYWORD_THEMES = [
  ["bank", "Canadian Banks"],
  ["insurance", "Insurance / Asset Management"],
  ["asset", "Insurance / Asset Management"],
  ["pipeline", "Pipelines / Midstream"],
  ["energy", "Oil & Gas E&P"],
  ["resources", "Oil & Gas E&P"],
  ["cameco", "Uranium"],
  ["gold", "Gold Miners"],
  ["silver", "Silver Miners"],
  ["copper", "Copper / Base Metals"],
  ["mining", "Copper / Base Metals"],
  ["rail", "Rail / Logistics"],
  ["software", "Canadian Technology / Software"],
  ["systems", "Canadian Technology / Software"],
  ["commerce", "E-commerce / Digital Platforms"],
  ["telecom", "Telecom"],
  ["power", "Utilities"],
  ["renewable", "Renewables / Power Producers"],
  ["reit", "REITs"],
  ["apartment", "REITs"],
  ["consumer", "Consumer Discretionary"],
  ["staples", "Consumer Staples"]
];

export function validateYahooSymbol(symbol, exchange = "TSX") {
  if (exchange === "TSX") return symbol.endsWith(".TO");
  if (exchange === "TSXV") return symbol.endsWith(".V");
  if (exchange === "CSE" || exchange === "NEO") return symbol.includes(".") && !symbol.endsWith(".TO") && !symbol.endsWith(".V") ? "REVIEW" : false;
  return false;
}

export function mapCanadaTheme({ symbol, name = "", sector = "" }) {
  if (EXPLICIT_THEME_MAP.has(symbol)) return { theme: EXPLICIT_THEME_MAP.get(symbol), confidence: "HIGH", source: "EXPLICIT_CANADA_MAP" };
  const haystack = `${name} ${sector}`.toLowerCase();
  for (const [keyword, theme] of KEYWORD_THEMES) {
    if (haystack.includes(keyword)) return { theme, confidence: "MEDIUM", source: "KEYWORD_RULE" };
  }
  return { theme: "UNMAPPED_REVIEW", confidence: "LOW", source: "UNMAPPED_REVIEW" };
}

export function liquidityLabel({ addv20, avgVolume20, price }) {
  if (!Number.isFinite(addv20) || !Number.isFinite(avgVolume20) || !Number.isFinite(price)) return "LIQUIDITY_DATA_REPAIR";
  if (price < CANADA_PROFILE.liquidity_min_price || avgVolume20 < CANADA_PROFILE.liquidity_min_share_volume_20d || addv20 < CANADA_PROFILE.liquidity_min_addv_local) return "LIQUIDITY_THIN_CAUTION";
  if (addv20 >= CANADA_PROFILE.liquidity_ideal_addv_local) return "LIQUIDITY_IDEAL";
  return "LIQUIDITY_PASS";
}
