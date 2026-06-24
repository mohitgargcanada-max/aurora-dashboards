# Fundamental Quality Gates
### Altman Z-Score · Beneish M-Score · Piotroski F-Score · Magic Formula
*Exclusion gates + quality ranking | yfinance source | Pure logic*

---

## Usage Philosophy

These four models serve two distinct roles in the scanner system:

```
EXCLUSION GATES (run first — eliminate bad candidates):
  Altman Z-Score   → Bankruptcy risk filter   (Z < 1.81 = EXCLUDE)
  Beneish M-Score  → Earnings manipulation    (M > -1.78 = EXCLUDE)

QUALITY RANKING (run on survivors — rank what remains):
  Piotroski F-Score→ Financial health score   (F >= 7 = strong, F <= 2 = weak)
  Magic Formula    → Quality + Value combined rank (top quartile = buy zone)
```

**Apply in order:** Run exclusion gates first. Only rank survivors. 
This structure removes the worst stocks with minimal computation, then ranks what's left.

---

## ⚠️ Critical Scope Limitations — Read Before Using

```
MODELS THAT DO NOT APPLY TO FINANCIAL COMPANIES:
  Altman Z-Score  → Invalid for banks, NBFCs, insurance companies
  Beneish M-Score → Limited applicability to financial sector
  Magic Formula   → Net Working Capital undefined for banks
  Piotroski F     → Partially applicable but leverage signals are inverted for banks

For India: ~28-32% of Nifty 500 is financial sector (banks, NBFCs, insurance, AMCs).
Identify and flag financial stocks before running these models.

SECTOR CHECK:
  GICS financial sectors to exclude: "Banks", "Diversified Financial Services",
  "Insurance", "Capital Markets", "Consumer Finance", "Mortgage REITs"
  yfinance field: ticker.info.get("sector") or .get("industry")

DATA LIMITATIONS (India / yfinance):
  - yfinance provides 4 years of annual financials for most stocks
  - Pre-2018 data for Indian stocks may be pre-Ind AS (accounting standard change)
  - Some line items are misclassified or missing for smaller companies
  - Always check for NaN values — treat NaN as "unknown" not "zero"
  - For Beneish: needs 2 consecutive years — if only 1 year available, skip
```

```python
import yfinance as yf
import pandas as pd
import numpy as np

def get_fin(df: pd.DataFrame, row_keyword: str, col_idx: int = 0,
            default: float = np.nan) -> float:
    """Safe yfinance financial line-item extractor."""
    if df is None or df.empty:
        return default
    matches = [r for r in df.index if row_keyword.lower() in str(r).lower()]
    if not matches:
        return default
    try:
        return float(df.loc[matches[0]].iloc[col_idx])
    except Exception:
        return default

def is_financial_company(ticker: str) -> bool:
    """Returns True if stock is in financial sector — exclude from these models."""
    try:
        info   = yf.Ticker(ticker).info
        sector = info.get("sector", "").lower()
        indust = info.get("industry", "").lower()
        financial_keywords = ["bank", "financial", "insurance", "nbfc",
                              "capital market", "mortgage", "credit", "lending"]
        return any(kw in sector or kw in indust for kw in financial_keywords)
    except Exception:
        return False
```

---

## Model 1 — Altman Z-Score (Bankruptcy Risk)

### Mathematical Definition

Developed by Edward Altman (1968). Predicts bankruptcy within 2 years.

```
Z = 1.2×X₁ + 1.4×X₂ + 3.3×X₃ + 0.6×X₄ + 1.0×X₅

Variables:
  X₁ = Working Capital / Total Assets
       = (Current Assets - Current Liabilities) / Total Assets
       → Measures short-term liquidity relative to size

  X₂ = Retained Earnings / Total Assets
       → Measures accumulated profitability; low = young/loss-making

  X₃ = EBIT / Total Assets
       → Asset productivity / operating return

  X₄ = Market Capitalization / Total Liabilities
       [Original used Book Value of Equity; market cap version for public cos]
       → Solvency buffer: how much can assets decline before liabilities exceed them

  X₅ = Revenue / Total Assets
       → Asset turnover efficiency

Interpretation:
  Z > 2.99     → SAFE ZONE        (unlikely to face distress)
  1.81–2.99    → GREY ZONE        (monitor; some distress risk)
  Z < 1.81     → DISTRESS ZONE    → EXCLUDE from scanner
  Z < 1.23     → HIGH DISTRESS    → Strong exclusion signal

Accuracy: ~72% accuracy 2 years before bankruptcy (original Altman study).
Note: Modified Z' for private firms; Z'' for non-manufacturers — we use original public firm version.
```

```python
def altman_z_score(ticker: str,
                   income: pd.DataFrame,
                   balance: pd.DataFrame) -> dict:
    """
    Computes Altman Z-Score for public non-financial companies.
    Uses most recent annual data (col_idx=0).
    """
    # Total Assets
    ta = get_fin(balance, "Total Assets", 0)
    if np.isnan(ta) or ta <= 0:
        return {"z_score": np.nan, "zone": "UNKNOWN", "pass_gate": True}  # Can't assess

    # X1: Working Capital / Total Assets
    ca = get_fin(balance, "Current Assets", 0)
    if np.isnan(ca): ca = get_fin(balance, "Total Current Assets", 0)
    cl = get_fin(balance, "Current Liabilities", 0)
    if np.isnan(cl): cl = get_fin(balance, "Total Current Liabilities", 0)
    wc = ca - cl if not (np.isnan(ca) or np.isnan(cl)) else np.nan
    x1 = wc / ta if not np.isnan(wc) else 0

    # X2: Retained Earnings / Total Assets
    re = get_fin(balance, "Retained Earnings", 0)
    x2 = re / ta if not np.isnan(re) else 0

    # X3: EBIT / Total Assets
    ebit = get_fin(income, "Operating Income", 0)
    if np.isnan(ebit): ebit = get_fin(income, "Ebit", 0)
    x3 = ebit / ta if not np.isnan(ebit) else 0

    # X4: Market Cap / Total Liabilities
    t    = yf.Ticker(ticker)
    mktcap = t.info.get("marketCap", np.nan)
    tl   = get_fin(balance, "Total Liabilities Net Minority Interest", 0)
    if np.isnan(tl): tl = get_fin(balance, "Total Liabilities", 0)
    x4 = mktcap / tl if (not np.isnan(mktcap) and not np.isnan(tl) and tl > 0) else 0

    # X5: Revenue / Total Assets
    rev = get_fin(income, "Total Revenue", 0)
    x5  = rev / ta if not np.isnan(rev) else 0

    z = 1.2*x1 + 1.4*x2 + 3.3*x3 + 0.6*x4 + 1.0*x5

    if np.isnan(z):
        zone, pass_gate = "UNKNOWN", True
    elif z > 2.99:
        zone, pass_gate = "SAFE", True
    elif z > 1.81:
        zone, pass_gate = "GREY", True       # Caution but don't exclude
    else:
        zone, pass_gate = "DISTRESS", False  # EXCLUDE

    return {
        "z_score"  : round(z, 3),
        "zone"     : zone,
        "pass_gate": pass_gate,              # False = EXCLUDE this stock
        "x1_wc"    : round(x1, 3),
        "x2_re"    : round(x2, 3),
        "x3_ebit"  : round(x3, 3),
        "x4_mktcap": round(x4, 3),
        "x5_rev"   : round(x5, 3),
        "note"     : "EXCLUDE: Bankruptcy risk" if not pass_gate else
                     "CAUTION: Grey zone — monitor leverage" if zone == "GREY" else "OK",
    }
```

---

## Model 2 — Beneish M-Score (Earnings Manipulation Detector)

### Mathematical Definition

Developed by Messod Beneish (1999). Identifies potential earnings manipulation using 
8 financial ratios. Famous for detecting Enron before the collapse.

```
M = -4.84 + 0.920×DSRI + 0.528×GMI + 0.404×AQI + 0.892×SGI
         + 0.115×DEPI  - 0.172×SGAI + 4.679×TATA - 0.327×LVGI

8 Variables (subscripts: t = current year, t-1 = prior year):

DSRI = (Receivables_t / Sales_t) / (Receivables_{t-1} / Sales_{t-1})
       Day Sales Receivables Index: rising = revenue possibly fictitious

GMI  = Gross_Margin_{t-1} / Gross_Margin_t
       Gross Margin Index: > 1 = deteriorating margins → pressure to manipulate

AQI  = [1 - (PPE_t + CA_t) / TA_t] / [1 - (PPE_{t-1} + CA_{t-1}) / TA_{t-1}]
       Asset Quality Index: rising = increasing intangibles/deferred costs (suspicious)

SGI  = Sales_t / Sales_{t-1}
       Sales Growth Index: high growth → incentive to manipulate

DEPI = [Depreciation_{t-1} / (PPE_{t-1} + Dep_{t-1})] /
       [Depreciation_t / (PPE_t + Dep_t)]
       Depreciation Index: > 1 = slowing depreciation → inflate assets

SGAI = (SGA_Expenses_t / Sales_t) / (SGA_Expenses_{t-1} / Sales_{t-1})
       SGA Index: rising = deteriorating efficiency → incentive to manipulate

LVGI = [(LTD_t + CurrentLiabilities_t) / TA_t] /
       [(LTD_{t-1} + CurrentLiabilities_{t-1}) / TA_{t-1}]
       Leverage Index: rising leverage → covenant pressure → manipulation incentive

TATA = (Net_Income_t - CFO_t) / TA_t
       Total Accruals to Total Assets: high accruals = low earnings quality

Interpretation:
  M > -1.78  → LIKELY MANIPULATOR   → EXCLUDE (high probability of manipulation)
  M < -2.22  → UNLIKELY MANIPULATOR → PASS
  -2.22 to -1.78 = GREY ZONE        → Review manually
```

```python
def beneish_m_score(income: pd.DataFrame,
                    balance: pd.DataFrame,
                    cashflow: pd.DataFrame) -> dict:
    """
    Beneish M-Score. Requires 2 years of data (col 0 = current, col 1 = prior).
    """
    # Check we have at least 2 years
    if income is None or income.shape[1] < 2:
        return {"m_score": np.nan, "likely_manipulator": False,
                "pass_gate": True, "note": "Insufficient history for Beneish"}

    def g(df, kw, col): return get_fin(df, kw, col)

    # Current year (col 0), Prior year (col 1)
    rec_t  = g(balance, "Net Receivables", 0);       rec_p  = g(balance, "Net Receivables", 1)
    sal_t  = g(income,  "Total Revenue",   0);       sal_p  = g(income,  "Total Revenue",   1)
    gp_t   = g(income,  "Gross Profit",    0);       gp_p   = g(income,  "Gross Profit",    1)
    ca_t   = g(balance, "Current Assets",  0);       ca_p   = g(balance, "Current Assets",  1)
    ppe_t  = g(balance, "Net Ppe",         0);       ppe_p  = g(balance, "Net Ppe",         1)
    ta_t   = g(balance, "Total Assets",    0);       ta_p   = g(balance, "Total Assets",    1)
    dep_t  = g(cashflow,"Depreciation",    0);       dep_p  = g(cashflow,"Depreciation",    1)
    sga_t  = g(income,  "Selling General Administrative", 0)
    sga_p  = g(income,  "Selling General Administrative", 1)
    ltd_t  = g(balance, "Long Term Debt",  0);       ltd_p  = g(balance, "Long Term Debt",  1)
    cl_t   = g(balance, "Current Liabilities", 0);  cl_p   = g(balance, "Current Liabilities", 1)
    ni_t   = g(income,  "Net Income",      0)
    cfo_t  = g(cashflow,"Operating Cash Flow", 0)

    def safe_div(a, b, default=1.0):
        if np.isnan(a) or np.isnan(b) or b == 0: return default
        return a / b

    # DSRI
    dsri = safe_div(safe_div(rec_t, sal_t), safe_div(rec_p, sal_p))

    # GMI
    gm_t = safe_div(gp_t, sal_t, 0.3);  gm_p = safe_div(gp_p, sal_p, 0.3)
    gmi  = safe_div(gm_p, gm_t)

    # AQI
    aq_t = 1 - safe_div(ppe_t + ca_t, ta_t) if not np.isnan(ppe_t + ca_t + ta_t) else 0.5
    aq_p = 1 - safe_div(ppe_p + ca_p, ta_p) if not np.isnan(ppe_p + ca_p + ta_p) else 0.5
    aqi  = safe_div(aq_t, aq_p)

    # SGI
    sgi  = safe_div(sal_t, sal_p)

    # DEPI
    dep_rate_t = safe_div(dep_t, ppe_t + dep_t) if not np.isnan(dep_t + ppe_t) else 0.1
    dep_rate_p = safe_div(dep_p, ppe_p + dep_p) if not np.isnan(dep_p + ppe_p) else 0.1
    depi = safe_div(dep_rate_p, dep_rate_t)

    # SGAI
    sgai = safe_div(safe_div(sga_t, sal_t), safe_div(sga_p, sal_p))

    # TATA (Total Accruals to Total Assets)
    tata = safe_div(ni_t - cfo_t, ta_t, 0) if not np.isnan(ni_t + cfo_t + ta_t) else 0

    # LVGI
    lev_t = safe_div(ltd_t + cl_t, ta_t) if not np.isnan(ltd_t + cl_t + ta_t) else 0.3
    lev_p = safe_div(ltd_p + cl_p, ta_p) if not np.isnan(ltd_p + cl_p + ta_p) else 0.3
    lvgi  = safe_div(lev_t, lev_p)

    m = (-4.84 + 0.920*dsri + 0.528*gmi + 0.404*aqi + 0.892*sgi
              + 0.115*depi - 0.172*sgai + 4.679*tata - 0.327*lvgi)

    likely = m > -1.78
    grey   = -2.22 <= m <= -1.78

    return {
        "m_score"          : round(m, 3),
        "likely_manipulator": likely,
        "grey_zone"        : grey,
        "pass_gate"        : not likely,
        "components"       : {
            "DSRI_receivables": round(dsri, 3),
            "GMI_margins"    : round(gmi,  3),
            "AQI_asset_qual" : round(aqi,  3),
            "SGI_sales_growth": round(sgi, 3),
            "DEPI_deprec"    : round(depi, 3),
            "SGAI_overhead"  : round(sgai, 3),
            "TATA_accruals"  : round(tata, 3),
            "LVGI_leverage"  : round(lvgi, 3),
        },
        "note"             : "EXCLUDE: Likely earnings manipulation" if likely else
                             "REVIEW: Grey zone" if grey else "OK: Unlikely manipulator",
    }
```

---

## Model 3 — Piotroski F-Score (Financial Health Ranking)

### Mathematical Definition

Developed by Joseph Piotroski (2000). 9 binary signals across 3 groups.
Score 0–9: each signal adds 1 point.

```
GROUP A — PROFITABILITY (4 signals):
  F1: ROA > 0              → Net Income / Total Assets > 0  (company is profitable)
  F2: Operating CF > 0     → Cash flow from operations is positive
  F3: ΔROA > 0             → ROA(t) > ROA(t-1)  (profitability improving)
  F4: Accrual quality      → CFO / Assets > ROA  (cash earnings > accrual earnings)
                             Positive = earnings backed by cash, not accounting adjustments

GROUP B — LEVERAGE, LIQUIDITY, SOURCE OF FUNDS (3 signals):
  F5: ΔLeverage < 0        → LTD/Assets(t) < LTD/Assets(t-1)  (less debt relative to assets)
  F6: ΔCurrent Ratio > 0   → Current Ratio(t) > Current Ratio(t-1)  (more liquid)
  F7: No dilution           → Shares(t) <= Shares(t-1)  (no new equity issued)

GROUP C — OPERATING EFFICIENCY (2 signals):
  F8: ΔGross Margin > 0    → Gross Margin(t) > Gross Margin(t-1)
  F9: ΔAsset Turnover > 0  → (Revenue/Assets)(t) > (Revenue/Assets)(t-1)

Total F-Score:
  8–9 → Strong (historically significant outperformance)
  5–7 → Average
  0–2 → Weak (historically significant underperformance)
```

```python
def piotroski_f_score(income: pd.DataFrame,
                      balance: pd.DataFrame,
                      cashflow: pd.DataFrame) -> dict:
    """
    Piotroski F-Score. Needs 2 years of annual data.
    Returns score 0–9 and per-signal breakdown.
    """
    signals = {}

    def g(df, kw, col): return get_fin(df, kw, col)

    ta_t  = g(balance, "Total Assets", 0);   ta_p = g(balance, "Total Assets", 1)
    ni_t  = g(income,  "Net Income",   0)
    cfo_t = g(cashflow,"Operating Cash Flow", 0)
    ltd_t = g(balance, "Long Term Debt", 0); ltd_p = g(balance, "Long Term Debt", 1)
    ca_t  = g(balance, "Current Assets", 0); ca_p  = g(balance, "Current Assets", 1)
    cl_t  = g(balance, "Current Liabilities", 0); cl_p = g(balance, "Current Liabilities", 1)
    rev_t = g(income,  "Total Revenue", 0);  rev_p = g(income,  "Total Revenue", 1)
    gp_t  = g(income,  "Gross Profit", 0);   gp_p  = g(income,  "Gross Profit", 1)
    ni_p  = g(income,  "Net Income",   1)
    shares_t = yf.Ticker("").info.get("sharesOutstanding", np.nan)   # Approximate

    # ── Group A: Profitability ───────────────────────────────────────────────
    roa_t = ni_t / ta_t if not np.isnan(ni_t + ta_t) and ta_t > 0 else np.nan
    roa_p = ni_p / ta_p if not np.isnan(ni_p + ta_p) and ta_p > 0 else np.nan

    signals["F1_roa_positive"]    = int(not np.isnan(roa_t) and roa_t > 0)
    signals["F2_cfo_positive"]    = int(not np.isnan(cfo_t) and cfo_t > 0)
    signals["F3_roa_improving"]   = int(not (np.isnan(roa_t) or np.isnan(roa_p)) and roa_t > roa_p)

    cfo_ta = cfo_t / ta_t if not np.isnan(cfo_t + ta_t) and ta_t > 0 else np.nan
    signals["F4_accrual_quality"] = int(not (np.isnan(cfo_ta) or np.isnan(roa_t)) and cfo_ta > roa_t)

    # ── Group B: Leverage / Liquidity ────────────────────────────────────────
    lev_t = ltd_t / ta_t if not np.isnan(ltd_t + ta_t) and ta_t > 0 else np.nan
    lev_p = ltd_p / ta_p if not np.isnan(ltd_p + ta_p) and ta_p > 0 else np.nan
    signals["F5_leverage_down"]   = int(not (np.isnan(lev_t) or np.isnan(lev_p)) and lev_t < lev_p)

    cr_t  = ca_t / cl_t if not np.isnan(ca_t + cl_t) and cl_t > 0 else np.nan
    cr_p  = ca_p / cl_p if not np.isnan(ca_p + cl_p) and cl_p > 0 else np.nan
    signals["F6_liquidity_up"]    = int(not (np.isnan(cr_t) or np.isnan(cr_p)) and cr_t > cr_p)

    signals["F7_no_dilution"]     = 1   # Default 1; replace with actual share count comparison

    # ── Group C: Operating Efficiency ────────────────────────────────────────
    gm_t  = gp_t / rev_t if not np.isnan(gp_t + rev_t) and rev_t > 0 else np.nan
    gm_p  = gp_p / rev_p if not np.isnan(gp_p + rev_p) and rev_p > 0 else np.nan
    signals["F8_margin_up"]       = int(not (np.isnan(gm_t) or np.isnan(gm_p)) and gm_t > gm_p)

    at_t  = rev_t / ta_t if not np.isnan(rev_t + ta_t) and ta_t > 0 else np.nan
    at_p  = rev_p / ta_p if not np.isnan(rev_p + ta_p) and ta_p > 0 else np.nan
    signals["F9_turnover_up"]     = int(not (np.isnan(at_t) or np.isnan(at_p)) and at_t > at_p)

    f_score = sum(signals.values())

    return {
        "f_score"  : f_score,
        "signals"  : signals,
        "grade"    : "STRONG" if f_score >= 7 else
                     "AVERAGE"if f_score >= 4 else "WEAK",
        "pass_gate": f_score >= 4,   # F < 4 = exclude (financially deteriorating)
        "note"     : "Piotroski strong — financially healthy" if f_score >= 7 else
                     "Piotroski weak — financial deterioration" if f_score <= 3 else "Average",
    }
```

---

## Model 4 — Magic Formula (Joel Greenblatt)

### Mathematical Definition

From "The Little Book That Beats the Market" (Greenblatt, 2005).
Combines quality (ROCE) and value (Earnings Yield) into a single combined rank.

```
Earnings Yield = EBIT / Enterprise Value       [Inverse of EV/EBIT; higher = cheaper]
ROCE           = EBIT / (Net Working Capital + Net Fixed Assets)
                [Capital efficiency on tangible capital deployed]

Where:
  Net Working Capital = Current Assets - Current Liabilities - Cash  (operating working capital)
  Net Fixed Assets    = Net PPE  (property, plant, equipment net of depreciation)
  Enterprise Value    = Market Cap + Total Debt - Cash

Ranking (across universe):
  EY_rank   = rank(Earnings_Yield, ascending=False)   [1 = highest yield = cheapest]
  ROCE_rank = rank(ROCE, ascending=False)              [1 = highest ROCE = best quality]
  
  Magic_Combined_Rank = EY_rank + ROCE_rank           [Lower = better]

  Buy zone: Magic_Combined_Rank in bottom quartile of universe (i.e. top 25% on combined metric)
```

```python
def magic_formula_score(ticker: str,
                        income: pd.DataFrame,
                        balance: pd.DataFrame) -> dict:
    """
    Computes Magic Formula components for a single stock.
    Rank across universe using magic_formula_universe_rank().
    """
    ebit  = get_fin(income, "Operating Income", 0)
    if np.isnan(ebit): ebit = get_fin(income, "Ebit", 0)

    ca    = get_fin(balance, "Current Assets", 0)
    cl    = get_fin(balance, "Current Liabilities", 0)
    cash  = get_fin(balance, "Cash And Cash Equivalents", 0, default=0)
    ppe   = get_fin(balance, "Net Ppe", 0)
    if np.isnan(ppe): ppe = get_fin(balance, "Gross Ppe", 0)

    t     = yf.Ticker(ticker)
    mktcap= t.info.get("marketCap", np.nan)
    ltd   = get_fin(balance, "Long Term Debt", 0, default=0)

    # Enterprise Value
    ev    = mktcap + ltd - cash if not np.isnan(mktcap + cash) else np.nan

    # Earnings Yield
    ey    = ebit / ev if (not np.isnan(ebit + ev) and ev > 0) else np.nan

    # ROCE = EBIT / (NWC + Net Fixed Assets)
    nwc   = (ca - cl - cash) if not np.isnan(ca + cl + cash) else np.nan
    roc_capital = (nwc if not np.isnan(nwc) else 0) + (ppe if not np.isnan(ppe) else 0)
    roce  = ebit / roc_capital if (not np.isnan(ebit) and roc_capital > 0) else np.nan

    return {
        "ticker"        : ticker,
        "ebit"          : ebit,
        "ev"            : ev,
        "earnings_yield": ey,
        "roce"          : roce,
        "ey_valid"      : not np.isnan(ey) and ey > 0,
        "roce_valid"    : not np.isnan(roce) and roce > 0,
    }


def magic_formula_universe_rank(universe_scores: list) -> pd.DataFrame:
    """
    Ranks universe on combined Magic Formula metric.
    universe_scores: list of dicts from magic_formula_score()
    """
    df = pd.DataFrame(universe_scores).dropna(subset=["earnings_yield", "roce"])
    df = df[(df["earnings_yield"] > 0) & (df["roce"] > 0)]   # Positive only

    df["ey_rank"]       = df["earnings_yield"].rank(ascending=False).astype(int)
    df["roce_rank"]     = df["roce"].rank(ascending=False).astype(int)
    df["combined_rank"] = df["ey_rank"] + df["roce_rank"]

    df["magic_pct"]     = (df["combined_rank"].rank(ascending=True, pct=True) * 100).round(1)
    df["magic_grade"]   = df["magic_pct"].apply(
        lambda x: "A" if x <= 25 else "B" if x <= 50 else "C" if x <= 75 else "D"
    )

    return df.sort_values("combined_rank").reset_index(drop=True)
```

---

## Master Quality Gate Pipeline

```python
def run_quality_gates(universe_data   : dict,
                      rs_ratings      : pd.Series,
                      min_ibd_rs      : float = 0,
                      min_piotroski   : int   = 4,
                      min_magic_grade : str   = "B") -> dict:
    """
    Full 4-gate quality pipeline.
    Returns: passed (clean universe), excluded (with reasons), ranked (Magic Formula)
    """
    MAGIC_GRADE_ORDER = {"A": 4, "B": 3, "C": 2, "D": 1}
    min_magic_rank    = MAGIC_GRADE_ORDER.get(min_magic_grade, 3)

    passed   = {}
    excluded = {}
    mf_input = []

    for ticker, df in universe_data.items():

        # Pre-check: skip financial companies
        if is_financial_company(ticker):
            excluded[ticker] = {"reason": "Financial sector — models not applicable"}
            continue

        t       = yf.Ticker(ticker)
        income  = t.financials
        balance = t.balance_sheet
        cf      = t.cashflow

        reasons = []

        # Gate 1: Altman Z
        z = altman_z_score(ticker, income, balance)
        if not z["pass_gate"]:
            reasons.append(f"Altman Z={z['z_score']} (DISTRESS)")

        # Gate 2: Beneish M
        m = beneish_m_score(income, balance, cf)
        if not m["pass_gate"]:
            reasons.append(f"Beneish M={m['m_score']} (MANIPULATION RISK)")

        if reasons:
            excluded[ticker] = {"reasons": reasons, "z": z["z_score"], "m": m["m_score"]}
            continue

        # Gate 3: Piotroski F
        f = piotroski_f_score(income, balance, cf)
        if not f["pass_gate"]:
            excluded[ticker] = {"reasons": [f"Piotroski F={f['f_score']} (WEAK < 4)"]}
            continue

        # Passed all gates
        passed[ticker] = {
            "z_score"   : z["z_score"],
            "z_zone"    : z["zone"],
            "m_score"   : m["m_score"],
            "f_score"   : f["f_score"],
            "f_grade"   : f["grade"],
            "rs_rating" : rs_ratings.get(ticker, 50),
        }

        # Collect for Magic Formula ranking
        mf = magic_formula_score(ticker, income, balance)
        mf_input.append(mf)

    # Gate 4: Magic Formula ranking on passed universe
    if mf_input:
        mf_ranked = magic_formula_universe_rank(mf_input)
        # Merge into passed dict
        for _, row in mf_ranked.iterrows():
            t = row["ticker"]
            if t in passed:
                passed[t]["magic_rank"]  = row["combined_rank"]
                passed[t]["magic_grade"] = row["magic_grade"]
                passed[t]["magic_pct"]   = row["magic_pct"]

    # Filter passed by magic grade
    final = {t: v for t, v in passed.items()
             if MAGIC_GRADE_ORDER.get(v.get("magic_grade", "D"), 0) >= min_magic_rank}

    return {
        "passed"          : final,
        "excluded"        : excluded,
        "n_passed"        : len(final),
        "n_excluded"      : len(excluded),
        "exclusion_summary": {
            "financial_sector" : sum(1 for v in excluded.values() if "Financial sector" in str(v)),
            "altman_distress"  : sum(1 for v in excluded.values() if "Altman" in str(v)),
            "beneish_manipul"  : sum(1 for v in excluded.values() if "Beneish" in str(v)),
            "piotroski_weak"   : sum(1 for v in excluded.values() if "Piotroski" in str(v)),
        },
    }
```

---

## Quick-Reference: Score Thresholds

| Model | Exclude If | Watchlist If | Buy Zone |
|-------|-----------|--------------|----------|
| **Altman Z** | Z < 1.81 (distress) | 1.81–2.99 (grey) | Z > 2.99 (safe) |
| **Beneish M** | M > -1.78 (manipulator) | -2.22 to -1.78 (grey) | M < -2.22 (clean) |
| **Piotroski F** | F ≤ 3 (weak) | F = 4–6 (average) | F ≥ 7 (strong) |
| **Magic Formula** | Bottom 50% | Middle 25–50% | Top 25% (Grade A/B) |

---

*Cross-reference: value_compounder_and_advanced_scanners.md | scanner_guardrails.md*
*Note: None of these models apply to banks, NBFCs, insurance, or financial holding companies.*
