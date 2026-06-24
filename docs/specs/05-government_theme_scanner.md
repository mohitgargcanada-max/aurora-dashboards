# Government Buying & Theme Scanner
### Options A (Shareholding) · B (Theme/Scheme) · C (Composite)
*India · US · Canada | yfinance + public data sources*

---

> ## ⚠️ CRITICAL DATA RELIABILITY WARNING — INDIA (Option A)
>
> **yfinance is NOT a reliable source for India government/LIC shareholding data.**
> The following specific failures are documented and recurrent:
>
> | Failure Mode | Impact | Severity |
> |---|---|---|
> | **LIC not separately identified** | `institutionalHolders` aggregates LIC into "Other" or omits it entirely | HIGH |
> | **Shareholding data is stale** | yfinance updates India institutional holder data infrequently — often 1–3 quarters behind | HIGH |
> | **% Out values wrong** | `heldPercentInstitutions` for `.NS` stocks frequently shows US-market denominator logic, producing wrong % | HIGH |
> | **Category mismatch** | yfinance uses US holder classifications (hedge fund, mutual fund) — does not map to India's Promoter / DII / FII / Public categories | MEDIUM |
> | **PSU promoter not detected** | Government as promoter (e.g. ONGC, NTPC, BEL) does not show in `institutionalHolders` — it appears in `majorHolders` under "% Held by Insiders" which yfinance does not reliably populate for India | HIGH |
>
> **What to use instead (India Option A):**
>
> 1. **BSE Shareholding Pattern** (most reliable, quarterly):
>    - URL: `https://www.bseindia.com/corporates/Shholding.aspx`
>    - Download quarterly CSV per stock → parse `Category` column for "Insurance Companies" (LIC) and "Central/State Government"
>    - Available with ~21-day lag post quarter end (Q4 results by June 21, Q1 by Sept 21, etc.)
>
> 2. **NSE Shareholding API** (machine-readable):
>    - `https://www.nseindia.com/api/corporate-share-holdings-master?index={symbol}`
>    - Returns structured JSON with promoter, DII, FII, public breakdown
>    - Requires session cookie from NSE website (use `requests.Session` with headers)
>
> 3. **jugaad-data library** (Python):
>    - `from jugaad_data.nse import NSELive` — provides shareholding data for NSE stocks
>    - More reliable than yfinance for Indian institutional classification
>
> 4. **Tijori Finance / Trendlyne API** (paid, most reliable):
>    - Provides clean LIC holding %, promoter pledging, quarterly change — production-grade
>
> **Bottom line:** Use Option B (Theme filter) + Option C (Composite) with confidence via yfinance.
> For Option A (shareholding tracker) in India: **do not rely on yfinance** — use BSE CSV or NSE API.
> The logic and formulas in Option A are correct; only the data source needs replacing.

---

## Architecture Overview

```
Option A — Shareholding Tracker    : WHO is buying (government entities increasing stake)
Option B — Theme/Scheme Filter     : WHAT they're buying (policy-backed sectors/companies)
Option C — Composite (A ∩ B)       : Stocks with BOTH government theme + confirmed buying
                                     → Highest conviction; intersection of policy + action
```

---

## Option A — Shareholding Tracker

### A.1 India: LIC / Government Institutions

**Data reality with yfinance:** `yf.Ticker().info` returns `institutionalHolders` and
`majorHolders` but LIC is often not separately labelled in yfinance for Indian stocks.
**Best approach for India:** Quarterly shareholding disclosures (BSE/NSE CSV downloads) — 
parsed manually or via jugaad-data. Logic below is correct regardless of source.

**Mathematical Definition:**
```
Govt_Holding_Change(Q) = Govt_Holding_Pct(Q) - Govt_Holding_Pct(Q-1)

Signal = Govt_Holding_Change(Q) > +0.50%     [Government increased stake by ≥ 0.5% in quarter]
       AND Govt_Holding_Pct(Q)   > 2.0%      [Meaningful absolute stake]
       AND Price_Return(Q)        > -5%       [Not buying a falling knife — price holding]

Tier 1 (LIC buying):    LIC_Holding_Change > 0.50%
Tier 2 (EPFO/ETFs):     ETF basket stocks with increasing DII allocation
Tier 3 (PSU direct):    Government promoter increasing stake via preferential allotment
```

```python
import yfinance as yf
import pandas as pd
import numpy as np

# ── yfinance approach (US/global — institutional holders) ──────────────────
def get_institutional_holders_yf(ticker: str) -> pd.DataFrame:
    """
    Works well for US stocks.
    For India (.NS), results are partial — use BSE shareholding CSV for precision.
    """
    t = yf.Ticker(ticker)
    ih = t.institutional_holders   # DataFrame: Holder, Shares, Date Reported, % Out, Value
    return ih if ih is not None else pd.DataFrame()


def govt_entity_holdings(ticker: str,
                          govt_keywords: list = None) -> dict:
    """
    Filters institutional holders for government-linked entities.
    govt_keywords: list of keywords to match government bodies.
    """
    if govt_keywords is None:
        govt_keywords = [
            # India
            "LIC", "LIFE INSURANCE CORPORATION", "EPFO", "NPS TRUST",
            "SBI MUTUAL", "UTI", "NATIONAL INSURANCE",
            # US
            "NORWAY", "NORGES", "GOVERNMENT PENSION", "SOVEREIGN",
            "TEMASEK", "GIC", "ADIA", "KUWAIT INVESTMENT",
            "CALPERS", "CALSTRS",                               # US state pension
            # Canada
            "CAISSE", "CPPIB", "OMERS", "ALBERTA",
            "BCIM", "TEACHERS",
        ]

    holders = get_institutional_holders_yf(ticker)
    if holders.empty:
        return {"available": False}

    holders['is_govt'] = holders['Holder'].str.upper().apply(
        lambda h: any(kw in h for kw in [k.upper() for k in govt_keywords])
    )
    govt_holders = holders[holders['is_govt']]

    return {
        "available"   : True,
        "govt_holders": govt_holders[['Holder', '% Out', 'Value']].to_dict('records'),
        "total_govt_pct": govt_holders['% Out'].sum() if '% Out' in govt_holders else 0,
        "n_govt_holders": len(govt_holders),
    }


# ── India: Parse BSE Shareholding CSV (quarterly) ─────────────────────────
def parse_bse_shareholding(filepath: str) -> pd.DataFrame:
    """
    BSE publishes quarterly shareholding data per company.
    Download from: https://www.bseindia.com/corporates/Shholding.aspx
    Columns include: Category, No. of shareholders, Total shares, % of total shares
    """
    df = pd.read_csv(filepath, encoding='latin-1')
    return df


def india_shareholding_change(q_current: dict, q_prior: dict,
                               track_categories: list = None) -> dict:
    """
    q_current / q_prior: {category: pct_holding} dicts from BSE data
    track_categories: government entity categories to track
    """
    if track_categories is None:
        track_categories = [
            "Insurance Companies",           # Includes LIC
            "Central Government",
            "State Government(s)",
            "Bodies Corporate - Central Govt",
            "Provident Funds / Pension Funds",  # EPFO
            "Mutual Funds / UTI",            # Includes SBI MF, UTI (quasi-govt)
        ]

    results = {}
    for cat in track_categories:
        curr = q_current.get(cat, 0.0)
        prev = q_prior.get(cat, 0.0)
        results[cat] = {
            "current_pct": curr,
            "prior_pct"  : prev,
            "change"     : curr - prev,
            "increasing" : curr > prev + 0.25,   # > 0.25% increase = meaningful
        }

    total_govt_curr  = sum(q_current.get(c, 0) for c in track_categories)
    total_govt_prior = sum(q_prior.get(c, 0) for c in track_categories)

    return {
        "categories"         : results,
        "total_govt_pct"     : total_govt_curr,
        "total_govt_change"  : total_govt_curr - total_govt_prior,
        "any_increasing"     : any(r["increasing"] for r in results.values()),
        "signal"             : (total_govt_curr - total_govt_prior) > 0.5,  # +0.5% total govt
    }
```

### A.2 US: 13F Government / Sovereign Wealth Holdings

```python
# 13F filings: Filed quarterly with SEC for all institutions > $100M AUM
# SEC EDGAR API: https://data.sec.gov/submissions/CIK{cik}.json
# Sovereign wealth fund CIKs (public):
#   Norway NBIM: CIK 0001045810
#   Singapore GIC: CIK 0001638217
#   CalPERS: CIK 0001369568

import requests

SOVEREIGN_FUND_CIKS = {
    "Norges_Bank_NBIM"     : "0001045810",
    "GIC_Singapore"        : "0001638217",
    "CalPERS"              : "0001369568",
    "CalSTRS"              : "0001480209",
    "Canada_CPPIB"         : "0001534773",
}

def fetch_13f_holdings(cik: str, recent_n: int = 1) -> pd.DataFrame:
    """
    Fetches recent 13F holdings for a given institutional filer CIK.
    Returns DataFrame of holdings: {name, cusip, shares, value}
    """
    url  = f"https://data.sec.gov/submissions/CIK{cik}.json"
    resp = requests.get(url, headers={"User-Agent": "scanner@example.com"})
    if resp.status_code != 200:
        return pd.DataFrame()

    meta    = resp.json()
    filings = pd.DataFrame(meta.get('filings', {}).get('recent', {}))
    f13     = filings[filings['form'] == '13F-HR'].head(recent_n)

    holdings_all = []
    for _, row in f13.iterrows():
        acc = row['accessionNumber'].replace('-', '')
        h_url = f"https://data.sec.gov/Archives/edgar/full-index/{row['filingDate'][:4]}/"\
                f"QTR{((int(row['filingDate'][5:7])-1)//3)+1}/company.idx"
        # Simplified: in practice, parse the XML holdings file
        # holdings_all.append(...)

    return pd.DataFrame(holdings_all)


def us_govt_buying_screen(universe_tickers: list,
                           sovereign_holdings: dict) -> pd.DataFrame:
    """
    Cross-reference universe tickers with sovereign fund holdings.
    sovereign_holdings: {fund_name: [ticker_list]}
    """
    results = []
    for ticker in universe_tickers:
        funds_holding = [f for f, tickers in sovereign_holdings.items()
                         if ticker in tickers]
        if funds_holding:
            results.append({
                "ticker"       : ticker,
                "govt_holders" : funds_holding,
                "n_funds"      : len(funds_holding),
                "signal"       : len(funds_holding) >= 1,
            })
    return pd.DataFrame(results).sort_values("n_funds", ascending=False)
```

---

## Option B — Theme / Government Scheme Scanner

### B.1 India — Government Schemes & PLI Universe

```python
# ── India Policy Theme Classification ──────────────────────────────────────

INDIA_GOVT_THEMES = {

    "PLI_Electronics_Mobile": {
        "description" : "Production Linked Incentive — Mobile & Electronics",
        "budget_cr"   : 41_000,
        "duration"    : "FY21-FY29",
        "proxy_tickers": ["DIXON", "AMBER", "KAYNES", "SYRMA", "PGEL",
                           "ELIN", "IDEAFORGE"],
        "sectors"     : ["Electronic Equipment", "Consumer Electronics"],
        "keywords"    : ["electronics manufacturing", "EMS", "mobile phone",
                         "PCB", "semiconductor assembly"],
    },

    "PLI_Pharma_API": {
        "description" : "PLI — Bulk Drugs, APIs & Medical Devices",
        "budget_cr"   : 15_000,
        "proxy_tickers": ["DIVI", "LAURUS", "SOLARA", "GRANULES",
                          "SEQUENT", "SUVEN"],
        "sectors"     : ["Pharmaceuticals", "Chemicals"],
    },

    "PLI_Specialty_Steel": {
        "description" : "PLI — Specialty Steel",
        "budget_cr"   : 6_322,
        "proxy_tickers": ["SAIL", "TATASTEEL", "JSW", "JINDALSAW",
                          "RATNAMANI", "MAHINDRACIE"],
        "sectors"     : ["Steel", "Metals"],
    },

    "PLI_Textile": {
        "description" : "PLI — Man-made Fibre & Technical Textiles",
        "budget_cr"   : 10_683,
        "proxy_tickers": ["PAGEIND", "KPR", "ARVIND", "RUPA", "TRIDENT",
                          "VARDHMAN"],
        "sectors"     : ["Textiles"],
    },

    "PLI_Auto_EV": {
        "description" : "PLI — Advanced Automotive Technology (EV & components)",
        "budget_cr"   : 25_938,
        "proxy_tickers": ["TATAMOTORS", "MAHINDRA", "OLECTRA", "CEAT",
                          "MOTHERSON", "SUPRAJIT", "MINDA"],
        "sectors"     : ["Automobiles", "Auto Ancillaries"],
    },

    "PLI_Solar_PV": {
        "description" : "PLI — Solar PV Modules",
        "budget_cr"   : 4_500,
        "proxy_tickers": ["WAAREE", "PREMIERENRG", "ADANIGREEN",
                          "TATAPOWER", "WEBSOL"],
        "sectors"     : ["Power", "Renewable Energy"],
    },

    "PLI_ACC_Battery": {
        "description" : "PLI — Advanced Chemistry Cell Battery",
        "budget_cr"   : 18_100,
        "proxy_tickers": ["TATACHEM", "EXIDEIND", "AMARARAJA",
                          "GREENENERGY"],
        "sectors"     : ["Electrical Equipment", "Batteries"],
    },

    "PLI_Food_Processing": {
        "description" : "PLI — Food Processing",
        "budget_cr"   : 10_900,
        "proxy_tickers": ["BRITANNIA", "NESTLEIND", "VARUN", "HERITAGE",
                          "PRATAAP", "BIKAJI"],
        "sectors"     : ["FMCG", "Food & Beverages"],
    },

    "PLI_WhiteGoods": {
        "description" : "PLI — White Goods (AC & LED)",
        "budget_cr"   : 6_238,
        "proxy_tickers": ["VOLTAS", "HAVELLS", "BLUESTAR", "LLOYD",
                          "CROMPTON"],
        "sectors"     : ["Consumer Durables"],
    },

    "Defence_Indigenisation": {
        "description" : "Ministry of Defence — Positive Indigenisation Lists (PIL)",
        "note"        : "3 PIL lists published; items reserved for domestic procurement",
        "proxy_tickers": ["HAL", "BEL", "MTAR", "PARASDEF", "DATAPATT",
                          "BEML", "BHARATFORG", "ASTRA", "COCHINSHIP",
                          "GRSE", "MAZAGON", "BHEL", "ELCOM"],
        "sectors"     : ["Defence", "Aerospace"],
        "tailwind"    : "Defence budget ~2.4% GDP; domestic procurement mandate",
    },

    "Railways_Modernisation": {
        "description" : "Indian Railways — ₹2.4 lakh Cr capex (FY24 budget)",
        "proxy_tickers": ["IRFC", "RVNL", "IRCON", "RAILTEL", "TITAGARH",
                          "TEXMACO", "BEML", "KERNEX", "HBLPOWER"],
        "sectors"     : ["Railways", "Infrastructure"],
    },

    "National_Infrastructure_Pipeline": {
        "description" : "NIP — ₹111 lakh Cr infra investment by FY25",
        "proxy_tickers": ["L&T", "IRB", "PNCINFRA", "KNR", "HGINFRA",
                          "GPPL", "ASHOKA", "GR", "POLYCAB"],
        "sectors"     : ["Infrastructure", "Construction", "Cables"],
    },

    "Semiconductor_Mission": {
        "description" : "India Semiconductor Mission — ₹76,000 Cr incentives",
        "proxy_tickers": ["TATAELXSI", "CGPOWER", "RUTTONSHA",
                          "KELLTON", "KAYNES"],
        "sectors"     : ["Semiconductors", "Electronic Equipment"],
        "note"        : "Most beneficiaries are global (TSMC, Micron); Indian proxies limited",
    },

    "Jal_Jeevan_Mission": {
        "description" : "Universal household water supply — ₹3.6 lakh Cr",
        "proxy_tickers": ["FINPIPE", "APLAPOLLO", "SUPREME", "ASTRAL",
                          "PRINCEPIPE", "VGUARD"],
        "sectors"     : ["Pipes & Fittings"],
    },

    "Atmanirbhar_Bharat_General": {
        "description" : "Broad import-substitution theme",
        "proxy_tickers": ["DIXON", "HAL", "BHARATFORG", "KIRLOSKAR",
                          "THERMAX", "CUMMINSIND"],
        "sectors"     : ["Capital Goods", "Defence", "Engineering"],
    },
}


def classify_india_theme(ticker: str) -> list:
    """Returns all themes a ticker belongs to."""
    themes = []
    for theme, data in INDIA_GOVT_THEMES.items():
        if ticker.upper() in [t.upper() for t in data.get("proxy_tickers", [])]:
            themes.append(theme)
    return themes


def india_theme_universe(themes: list = None) -> list:
    """Returns all tickers in specified themes (or all themes if None)."""
    target = themes if themes else list(INDIA_GOVT_THEMES.keys())
    universe = set()
    for t in target:
        universe.update(INDIA_GOVT_THEMES.get(t, {}).get("proxy_tickers", []))
    return list(universe)
```

### B.2 US — Government-Backed Themes

```python
US_GOVT_THEMES = {

    "CHIPS_Act": {
        "description" : "CHIPS and Science Act — $52.7B for semiconductor manufacturing",
        "legislation" : "Signed Aug 2022",
        "proxy_tickers": ["INTC", "TSM", "MU", "AMAT", "LRCX", "KLAC",
                          "ONTO", "ACLS", "FORM"],
        "sectors"     : ["Semiconductors", "Semiconductor Equipment"],
    },

    "IRA_Clean_Energy": {
        "description" : "Inflation Reduction Act — $369B clean energy incentives",
        "proxy_tickers": ["FSLR", "ENPH", "SEDG", "NEE", "CEG", "VST",
                          "ARRY", "SHLS", "CWEN", "RUN"],
        "sectors"     : ["Solar", "Wind", "Energy Storage", "Clean Energy"],
    },

    "IRA_EV_Battery": {
        "description" : "IRA EV tax credits + domestic battery production",
        "proxy_tickers": ["TSLA", "GM", "F", "ALB", "SQM", "LTHM",
                          "MP", "PLTM", "WOLF"],
        "sectors"     : ["EVs", "Lithium", "Battery Materials"],
    },

    "Infrastructure_IIJA": {
        "description" : "Infrastructure Investment & Jobs Act — $1.2T",
        "proxy_tickers": ["VMC", "MLM", "EXP", "URI", "CAT", "PWR",
                          "PRIM", "ACM", "J"],
        "sectors"     : ["Materials", "Construction", "Engineering"],
    },

    "US_Defence": {
        "description" : "DoD budget ~$858B FY24; domestic defence contractors",
        "proxy_tickers": ["LMT", "RTX", "NOC", "GD", "BA", "L3H",
                          "AXON", "KTOS", "HCAI", "CACI"],
        "sectors"     : ["Aerospace & Defence"],
    },

    "Healthcare_Medicare_Medicaid": {
        "description" : "Government healthcare spend — largest payor in US",
        "proxy_tickers": ["HCA", "UNH", "ELV", "CVS", "CI",
                          "DGX", "LH"],
        "sectors"     : ["Managed Care", "Healthcare"],
    },

    "Critical_Minerals": {
        "description" : "DoD and DoE critical mineral supply chain security",
        "proxy_tickers": ["MP", "NEM", "FCX", "VALE", "AA",
                          "NOVAGOLD", "LITHIUM"],
        "sectors"     : ["Mining", "Materials"],
    },
}
```

### B.3 Canada — Government-Backed Themes

```python
CANADA_GOVT_THEMES = {

    "Critical_Minerals_Canada": {
        "description" : "Federal Critical Minerals Strategy — battery metals focus",
        "proxy_tickers_TSX": ["SHOP", "SJ", "LITH", "NILI", "CVE",
                               "FM", "TECK", "HBM", "ERO"],
        "sectors"     : ["Mining", "Battery Materials", "Lithium"],
        "note"        : "Cobalt, lithium, nickel, graphite — Canada has large reserves",
    },

    "Clean_Technology_Canada": {
        "description" : "Clean Growth Fund + Strategic Innovation Fund",
        "proxy_tickers_TSX": ["BLX", "CPX", "INE", "ENGH", "AQN",
                               "BEP.UN", "BEPC"],
        "sectors"     : ["Renewable Energy", "Clean Technology"],
    },

    "Defence_Canada": {
        "description" : "RCAF fighter replacement (F-35), frigate program, NORAD",
        "proxy_tickers_TSX": ["MDA", "CAE", "BBD.B", "HRX"],
        "sectors"     : ["Aerospace & Defence"],
    },

    "Housing_Canada": {
        "description" : "Federal housing accelerator fund — $4B",
        "proxy_tickers_TSX": ["SRU.UN", "REI.UN", "IFC", "EQB"],
        "sectors"     : ["Real Estate", "Mortgage"],
    },
}
```

### B.4 Theme Scanner with Technical Filter

```python
def theme_technical_scanner(theme_universe: list,
                              market: str = "india",
                              min_rs: float = 65.0) -> pd.DataFrame:
    """
    Takes a theme universe list → fetches OHLCV → applies technical filter.
    Returns stocks in a government theme that are also technically constructive.
    """
    suffix = {"india": ".NS", "us": "", "canada": ".TO"}.get(market, ".NS")
    benchmark_map = {
        "india" : "^CNX500",
        "us"    : "SPY",
        "canada": "^GSPTSE",
    }

    bm_close  = yf.download(benchmark_map[market], period="2y",
                             auto_adjust=True, progress=False)['Close']
    regime    = market_regime(bm_close)

    results = []
    for ticker in theme_universe:
        sym = ticker + suffix if not ticker.endswith(suffix) else ticker
        df  = yf.download(sym, period="2y", auto_adjust=True, progress=False,
                           multi_level_column=False)
        df  = df[['Open','High','Low','Close','Volume']].dropna()

        if len(df) < 200:
            continue

        close    = df['Close']
        sma50    = close.rolling(50).mean()
        sma150   = close.rolling(150).mean()
        sma200   = close.rolling(200).mean()

        # Technical quality checks
        above_sma50   = close.iloc[-1] > sma50.iloc[-1]
        above_sma200  = close.iloc[-1] > sma200.iloc[-1]
        stage2_proxy  = (close.iloc[-1] > sma150.iloc[-1] > sma200.iloc[-1])
        near_52w_high = close.iloc[-1] >= df['High'].iloc[-252:].max() * 0.85

        # Volume trend
        vol_10  = df['Volume'].iloc[-10:].mean()
        vol_50  = df['Volume'].iloc[-50:].mean()

        raw_rs = compute_raw_rs(close)   # From framework

        results.append({
            "ticker"        : ticker,
            "close"         : round(close.iloc[-1], 2),
            "above_sma50"   : above_sma50,
            "above_sma200"  : above_sma200,
            "stage2"        : stage2_proxy,
            "near_52w_high" : near_52w_high,
            "vol_10_vs_50"  : round(vol_10 / vol_50, 2),
            "raw_rs"        : raw_rs,
            "regime"        : regime,
            "technical_grade": "A" if (stage2_proxy and near_52w_high) else
                               "B" if (above_sma200 and above_sma50)   else
                               "C",
        })

    df_out = pd.DataFrame(results)

    # Rank raw RS within this theme universe
    if not df_out.empty:
        df_out['theme_rs_rank'] = df_out['raw_rs'].rank(ascending=False).astype(int)

    return df_out.sort_values("raw_rs", ascending=False)
```

---

## Option C — Composite Scanner (Theme ∩ Government Buying)

```python
def composite_govt_scanner(market: str = "india",
                             themes: list = None,
                             min_govt_pct: float = 2.0,
                             min_govt_change: float = 0.25) -> pd.DataFrame:
    """
    Option C: Stocks that are BOTH in a government theme AND have government
    entities increasing their holding. Highest conviction intersection.

    Logic flow:
      Step 1 → Build theme universe (Option B)
      Step 2 → Filter by shareholding increase (Option A)
      Step 3 → Apply technical quality filter
      Step 4 → Score and rank
    """
    # Step 1: Theme universe
    if market == "india":
        theme_tickers = india_theme_universe(themes)
    elif market == "us":
        theme_tickers = []
        for t_data in US_GOVT_THEMES.values():
            theme_tickers.extend(t_data.get("proxy_tickers", []))
    else:
        theme_tickers = []
        for t_data in CANADA_GOVT_THEMES.values():
            theme_tickers.extend(t_data.get("proxy_tickers_TSX", []))

    # Step 2: Shareholding filter (yfinance institutional holders)
    govt_confirmed = []
    for ticker in theme_tickers:
        holding = govt_entity_holdings(ticker)
        if holding.get("available") and holding.get("total_govt_pct", 0) >= min_govt_pct:
            govt_confirmed.append({
                "ticker"        : ticker,
                "govt_pct"      : holding["total_govt_pct"],
                "govt_holders"  : [h["Holder"] for h in holding.get("govt_holders", [])],
            })

    if not govt_confirmed:
        print("[WARN] No government holders found via yfinance. "
              "Use BSE shareholding CSV for India precision.")
        # Fall back to theme-only (Option B)
        return theme_technical_scanner(theme_tickers, market)

    confirmed_tickers = [r["ticker"] for r in govt_confirmed]

    # Step 3: Technical filter on confirmed tickers
    tech_df = theme_technical_scanner(confirmed_tickers, market)

    # Step 4: Merge and score
    govt_df = pd.DataFrame(govt_confirmed).set_index("ticker")
    final   = tech_df.set_index("ticker").join(govt_df, how="left").reset_index()

    # Composite score: technical grade + govt holding weight
    def composite_score(row):
        tech  = {"A": 3, "B": 2, "C": 1}.get(row.get("technical_grade", "C"), 1)
        govt  = min(3, row.get("govt_pct", 0) / 5)   # Cap at 15% holding = max score
        stage = 2 if row.get("stage2") else 0
        high  = 1 if row.get("near_52w_high") else 0
        return tech + govt + stage + high

    final["composite_score"] = final.apply(composite_score, axis=1)
    final["themes"]          = final["ticker"].apply(
        lambda t: classify_india_theme(t) if market == "india" else []
    )

    return final.sort_values("composite_score", ascending=False)
```

---

## Guardrails — Government Theme Scanner

```
✅ REQUIRE:
  - Theme stock must ALSO be technically constructive (above SMA200 minimum)
  - Government theme should have active policy spending (not just announced)
  - Stock must have adequate liquidity — many PSU/theme stocks are illiquid
  - For India: check if PLI award is actually received (not just applied)

❌ REJECT if:
  - PSU stocks where government is SELLING stake (disinvestment target)
    → This is the OPPOSITE signal — supply overhang
  - Theme announced but budget not yet allocated or delayed
  - Company is in a theme but derives < 20% revenue from that theme
  - Government is only holding via index ETFs (passive, not active conviction)

⚠️ INDIA-SPECIFIC RISKS:
  - PSU stocks: government can exercise pricing power, affecting margins
  - PLI scheme: disbursement often delayed; revenue recognition risk
  - Defence: long order-to-revenue cycles (3-7 years) — patience required
  - Government disinvestment calendar: check if stock is on disinvestment list
    (BPCL, LIC partial sale, etc.) — creates persistent selling pressure

⚠️ WATCH:
  - Budget season (Feb 1 India): sector allocations shift themes rapidly
  - Election manifestos: pre-election spending = theme acceleration
  - Post-election: winning party's priorities determine new theme leadership
  - US IRA: subject to political reversal risk — hedge accordingly
```

---

## Data Source Map

| Data Needed | India Source | US Source | Canada Source |
|-------------|-------------|-----------|---------------|
| Theme universe | INDIA_GOVT_THEMES dict (this file) | US_GOVT_THEMES dict | CANADA_GOVT_THEMES dict |
| Shareholding QoQ | BSE shareholding CSV (quarterly) | SEC 13F via EDGAR API | SEDI filings (sedar.com) |
| LIC holding | BSE shareholding category "Insurance" | N/A | N/A |
| Govt entity check (approx) | `yf.institutional_holders` (partial) | `yf.institutional_holders` | `yf.institutional_holders` |
| OHLCV | yfinance (.NS suffix) | yfinance | yfinance (.TO suffix) |
| PLI beneficiary list | Ministry of Commerce press releases | whitehouse.gov / congress.gov | ic.gc.ca |

*Cross-reference: scanner_guardrails.md | india_scanner_examples.md*
