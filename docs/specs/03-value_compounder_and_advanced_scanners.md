# Value Compounder Fundamental Scanner + Advanced Scanners Addendum
### Pure Logic | yfinance as Data Source | No Real-Time Data Required

---

## PART 1 — Value Compounder Fundamental Scanner

### Philosophy

A **value compounder** is a business that:
1. Earns a high return on the capital it deploys (ROCE / ROIC > cost of capital)
2. Can reinvest that capital at similarly high rates (large reinvestment runway)
3. Does so consistently over many years (not a one-cycle wonder)
4. Is available at a price that doesn't fully discount future compounding

This is distinct from pure growth investing — the emphasis is on **quality of earnings** and **capital efficiency**, not just headline growth rates.

---

### yfinance Data Availability Map

```python
import yfinance as yf
import pandas as pd
import numpy as np

def fetch_fundamental_data(ticker: str) -> dict:
    """
    Fetches all available fundamental data from yfinance.
    Returns structured dict of financials for ratio computation.
    """
    t = yf.Ticker(ticker)

    # Income Statement (annual, last 4 years)
    income     = t.financials          # Columns: dates; Rows: line items
    income_q   = t.quarterly_financials

    # Balance Sheet
    balance    = t.balance_sheet
    balance_q  = t.quarterly_balance_sheet

    # Cash Flow
    cashflow   = t.cashflow
    cashflow_q = t.quarterly_cashflow

    # Summary info
    info       = t.info

    return {
        "income"      : income,
        "income_q"    : income_q,
        "balance"     : balance,
        "balance_q"   : balance_q,
        "cashflow"    : cashflow,
        "cashflow_q"  : cashflow_q,
        "info"        : info,
    }


# ── Safe helper: get a value from financial DataFrame ─────────────────────
def get_fin(df: pd.DataFrame, row_name: str, col_idx: int = 0,
            default: float = np.nan) -> float:
    """Safely extract a value from yfinance financials DataFrame."""
    if df is None or df.empty:
        return default
    matches = [r for r in df.index if row_name.lower() in r.lower()]
    if not matches:
        return default
    try:
        return float(df.loc[matches[0]].iloc[col_idx])
    except Exception:
        return default
```

---

### Core Ratio Computations

```python
def compute_fundamental_ratios(ticker: str) -> dict:
    """
    Computes all value compounder ratios from yfinance data.
    All math is documented inline.
    """
    data   = fetch_fundamental_data(ticker)
    info   = data["info"]
    inc    = data["income"]
    bal    = data["balance"]
    cf     = data["cashflow"]

    ratios = {"ticker": ticker}

    # ── PROFITABILITY RATIOS ─────────────────────────────────────────────────

    # 1. Gross Margin = (Revenue - COGS) / Revenue
    revenue  = get_fin(inc, "Total Revenue", 0)
    cogs     = get_fin(inc, "Cost Of Revenue", 0)
    gross_profit = revenue - cogs if not np.isnan(cogs) else get_fin(inc, "Gross Profit", 0)
    ratios["gross_margin"] = gross_profit / revenue if revenue > 0 else np.nan

    # 2. Operating Margin = Operating Income / Revenue
    ebit     = get_fin(inc, "Operating Income", 0)
    ratios["operating_margin"] = ebit / revenue if revenue > 0 else np.nan

    # 3. Net Margin = Net Income / Revenue
    net_inc  = get_fin(inc, "Net Income", 0)
    ratios["net_margin"] = net_inc / revenue if revenue > 0 else np.nan

    # ── CAPITAL EFFICIENCY ───────────────────────────────────────────────────

    # 4. ROCE = EBIT / Capital Employed
    #    Capital Employed = Total Assets - Current Liabilities
    total_assets = get_fin(bal, "Total Assets", 0)
    curr_liab    = get_fin(bal, "Current Liabilities", 0)
    if np.isnan(curr_liab):
        curr_liab = get_fin(bal, "Total Current Liabilities", 0)
    capital_employed = total_assets - curr_liab
    ratios["roce"] = ebit / capital_employed if capital_employed > 0 else np.nan

    # 5. ROE = Net Income / Shareholders' Equity
    equity   = get_fin(bal, "Stockholders Equity", 0)
    if np.isnan(equity):
        equity = get_fin(bal, "Total Equity", 0)
    ratios["roe"] = net_inc / equity if equity > 0 else np.nan

    # 6. ROIC = NOPAT / Invested Capital
    #    NOPAT = EBIT × (1 - Tax Rate)
    #    Invested Capital = Total Equity + Long-term Debt - Cash
    tax_provision = get_fin(inc, "Tax Provision", 0)
    tax_rate = tax_provision / ebit if (ebit > 0 and not np.isnan(tax_provision)) else 0.25
    nopat    = ebit * (1 - tax_rate)
    lt_debt  = get_fin(bal, "Long Term Debt", 0)
    if np.isnan(lt_debt): lt_debt = 0
    cash     = get_fin(bal, "Cash And Cash Equivalents", 0)
    if np.isnan(cash): cash = 0
    invested_capital = equity + lt_debt - cash
    ratios["roic"] = nopat / invested_capital if invested_capital > 0 else np.nan

    # ── GROWTH METRICS ───────────────────────────────────────────────────────

    def cagr(values: list) -> float:
        """CAGR from list of annual values [oldest, ..., newest]."""
        clean = [v for v in values if not np.isnan(v) and v > 0]
        if len(clean) < 2:
            return np.nan
        n = len(clean) - 1
        return (clean[-1] / clean[0]) ** (1 / n) - 1

    # 7. Revenue CAGR (available years from yfinance, typically 4)
    rev_vals = [get_fin(inc, "Total Revenue", i) for i in range(3, -1, -1)]  # oldest→newest
    ratios["revenue_cagr"] = cagr(rev_vals)

    # 8. EPS CAGR
    eps_vals = [info.get("trailingEps", np.nan)]   # Current
    # Historical EPS less reliable in yfinance — use quarterly earnings
    qe = data.get("income_q")
    if qe is not None and not qe.empty:
        hist_ni  = [get_fin(inc, "Net Income", i) for i in range(3, -1, -1)]
        # EPS approximation: Net Income / shares outstanding
        shares   = info.get("sharesOutstanding", np.nan)
        eps_list = [ni / shares for ni in hist_ni if not np.isnan(ni) and shares]
        ratios["eps_cagr"] = cagr(eps_list) if len(eps_list) >= 2 else np.nan
    else:
        ratios["eps_cagr"] = np.nan

    # 9. FCF Growth CAGR
    #    FCF = Operating Cash Flow - Capital Expenditure
    def get_fcf(col_idx: int) -> float:
        op_cf = get_fin(cf, "Operating Cash Flow", col_idx)
        capex = get_fin(cf, "Capital Expenditure", col_idx)   # Usually negative
        if np.isnan(op_cf): return np.nan
        capex = 0 if np.isnan(capex) else abs(capex)
        return op_cf - capex

    fcf_vals = [get_fcf(i) for i in range(3, -1, -1)]
    ratios["fcf_cagr"] = cagr(fcf_vals)
    ratios["fcf_ttm"]  = get_fcf(0)

    # 10. FCF Margin = FCF_TTM / Revenue_TTM
    ratios["fcf_margin"] = ratios["fcf_ttm"] / revenue if (revenue > 0 and not np.isnan(ratios["fcf_ttm"])) else np.nan

    # ── BALANCE SHEET HEALTH ─────────────────────────────────────────────────

    # 11. Debt-to-Equity = Total Debt / Equity
    total_debt = lt_debt + get_fin(bal, "Short Long Term Debt", 0, default=0)
    ratios["debt_to_equity"] = total_debt / equity if equity > 0 else np.nan

    # 12. Interest Coverage = EBIT / Interest Expense
    interest = get_fin(inc, "Interest Expense", 0)
    if np.isnan(interest): interest = 0
    ratios["interest_coverage"] = ebit / abs(interest) if interest != 0 else 999

    # 13. Current Ratio = Current Assets / Current Liabilities
    curr_assets = get_fin(bal, "Current Assets", 0)
    if np.isnan(curr_assets): curr_assets = get_fin(bal, "Total Current Assets", 0)
    ratios["current_ratio"] = curr_assets / curr_liab if (curr_liab > 0 and not np.isnan(curr_liab)) else np.nan

    # ── VALUATION ────────────────────────────────────────────────────────────

    # 14. PEG = P/E ÷ EPS Growth Rate
    pe   = info.get("trailingPE", np.nan)
    eps_g = ratios["eps_cagr"]
    ratios["peg"] = (pe / (eps_g * 100)) if (pe and eps_g and eps_g > 0) else np.nan

    # 15. P/FCF = Market Cap / FCF_TTM
    mktcap = info.get("marketCap", np.nan)
    ratios["p_fcf"] = mktcap / ratios["fcf_ttm"] if (mktcap and ratios["fcf_ttm"] and ratios["fcf_ttm"] > 0) else np.nan

    # 16. EV/EBITDA
    ev     = info.get("enterpriseValue", np.nan)
    ebitda = info.get("ebitda", np.nan)
    if np.isnan(ebitda): ebitda = get_fin(inc, "Ebitda", 0)
    ratios["ev_ebitda"] = ev / ebitda if (ev and ebitda and ebitda > 0) else np.nan

    # 17. Price / Book = Market Cap / Book Value
    bvps   = info.get("bookValue", np.nan)
    price  = info.get("currentPrice", np.nan)
    ratios["price_to_book"] = price / bvps if (price and bvps and bvps > 0) else np.nan

    # ── QUALITY / CONSISTENCY CHECKS ────────────────────────────────────────

    # 18. Earnings consistency: positive EPS in all 4 available years?
    ni_vals  = [get_fin(inc, "Net Income", i) for i in range(4)]
    ratios["earnings_consistent"] = all(v > 0 for v in ni_vals if not np.isnan(v))

    # 19. Revenue consistency: growing or flat in 3 of 4 years
    rev_changes = [rev_vals[i+1] - rev_vals[i] for i in range(len(rev_vals)-1)
                   if not np.isnan(rev_vals[i]) and not np.isnan(rev_vals[i+1])]
    ratios["revenue_consistent"] = sum(1 for c in rev_changes if c > 0) >= 2

    # 20. FCF Positive: FCF > 0 in all available years
    fcf_all = [get_fcf(i) for i in range(4)]
    ratios["fcf_positive_all"] = all(v > 0 for v in fcf_all if not np.isnan(v))

    # ── INDIA SPECIFIC ───────────────────────────────────────────────────────
    # Promoter holding (if available via yfinance info)
    ratios["promoter_holding"]    = info.get("heldPercentInsiders", np.nan)  # Proxy
    ratios["institutional_pct"]   = info.get("heldPercentInstitutions", np.nan)

    return ratios
```

---

### Value Compounder Scoring System

```python
def value_compounder_score(ratios: dict) -> dict:
    """
    Scores a stock on value compounder criteria. 0–100.
    Each criterion contributes points if met.
    """
    score   = 0
    detail  = {}
    max_pts = 0

    def check(name: str, condition: bool, pts: int, note: str = ""):
        nonlocal score, max_pts
        max_pts += pts
        if condition:
            score += pts
        detail[name] = {"pass": condition, "pts": pts if condition else 0, "note": note}

    # ── CAPITAL EFFICIENCY (35 pts) ──────────────────────────────────────────
    roce = ratios.get("roce", np.nan)
    check("ROCE > 15%",    not np.isnan(roce) and roce > 0.15,  10, f"ROCE={roce:.1%}" if not np.isnan(roce) else "N/A")
    check("ROCE > 20%",    not np.isnan(roce) and roce > 0.20,   5, "Bonus for elite ROCE")
    roe  = ratios.get("roe", np.nan)
    check("ROE > 15%",     not np.isnan(roe) and roe > 0.15,    10, f"ROE={roe:.1%}" if not np.isnan(roe) else "N/A")
    roic = ratios.get("roic", np.nan)
    check("ROIC > 12%",    not np.isnan(roic) and roic > 0.12,  10, f"ROIC={roic:.1%}" if not np.isnan(roic) else "N/A")

    # ── GROWTH QUALITY (25 pts) ──────────────────────────────────────────────
    rev_cagr = ratios.get("revenue_cagr", np.nan)
    check("Revenue CAGR > 12%",  not np.isnan(rev_cagr) and rev_cagr > 0.12,  8, f"RevCAGR={rev_cagr:.1%}" if not np.isnan(rev_cagr) else "N/A")
    check("Revenue CAGR > 20%",  not np.isnan(rev_cagr) and rev_cagr > 0.20,  4, "Bonus: high-growth")
    eps_cagr = ratios.get("eps_cagr", np.nan)
    check("EPS CAGR > 15%",      not np.isnan(eps_cagr) and eps_cagr > 0.15,  8, f"EPScagr={eps_cagr:.1%}" if not np.isnan(eps_cagr) else "N/A")
    check("Revenue consistent",  ratios.get("revenue_consistent", False),       5, "Revenue grew 3 of 4 years")

    # ── FCF QUALITY (20 pts) ─────────────────────────────────────────────────
    fcf_m = ratios.get("fcf_margin", np.nan)
    check("FCF Margin > 8%",     not np.isnan(fcf_m) and fcf_m > 0.08,         8, f"FCFmargin={fcf_m:.1%}" if not np.isnan(fcf_m) else "N/A")
    check("FCF positive all yrs",ratios.get("fcf_positive_all", False),          7, "No FCF-negative years")
    fcf_cagr = ratios.get("fcf_cagr", np.nan)
    check("FCF CAGR > 10%",      not np.isnan(fcf_cagr) and fcf_cagr > 0.10,   5, f"FCFcagr={fcf_cagr:.1%}" if not np.isnan(fcf_cagr) else "N/A")

    # ── BALANCE SHEET (10 pts) ───────────────────────────────────────────────
    de = ratios.get("debt_to_equity", np.nan)
    check("D/E < 0.5",           not np.isnan(de) and de < 0.5,                 5, f"D/E={de:.2f}" if not np.isnan(de) else "N/A")
    ic = ratios.get("interest_coverage", np.nan)
    check("Interest Coverage > 5x", not np.isnan(ic) and ic > 5,                5, f"IC={ic:.1f}x" if not np.isnan(ic) else "N/A")

    # ── VALUATION (10 pts) ───────────────────────────────────────────────────
    peg = ratios.get("peg", np.nan)
    check("PEG < 1.5",           not np.isnan(peg) and 0 < peg < 1.5,          5, f"PEG={peg:.2f}" if not np.isnan(peg) else "N/A")
    p_fcf = ratios.get("p_fcf", np.nan)
    check("P/FCF < 30",          not np.isnan(p_fcf) and p_fcf < 30,            5, f"P/FCF={p_fcf:.1f}" if not np.isnan(p_fcf) else "N/A")

    # ── EARNINGS CONSISTENCY (bonus, 5 pts) ─────────────────────────────────
    check("Earnings consistent", ratios.get("earnings_consistent", False),       5, "Positive EPS all 4 yrs")

    normalized_score = (score / max_pts) * 100 if max_pts > 0 else 0

    grade = "A+" if normalized_score >= 80 else \
            "A"  if normalized_score >= 70 else \
            "B+" if normalized_score >= 60 else \
            "B"  if normalized_score >= 50 else "C"

    return {
        "ticker"           : ratios["ticker"],
        "score_raw"        : score,
        "score_max"        : max_pts,
        "score_pct"        : round(normalized_score, 1),
        "grade"            : grade,
        "detail"           : detail,
        "key_metrics"      : {
            "roce"         : ratios.get("roce"),
            "roe"          : ratios.get("roe"),
            "roic"         : ratios.get("roic"),
            "revenue_cagr" : ratios.get("revenue_cagr"),
            "eps_cagr"     : ratios.get("eps_cagr"),
            "fcf_margin"   : ratios.get("fcf_margin"),
            "d_e"          : ratios.get("debt_to_equity"),
            "peg"          : ratios.get("peg"),
        },
        "action"           : "DEEP DIVE" if grade in ["A+","A"] else
                             "MONITOR"   if grade == "B+"        else "SKIP",
    }
```

### Value Compounder Universe Scanner

```python
def run_value_compounder_scan(tickers: list, min_score: float = 60.0) -> pd.DataFrame:
    """Scan universe for value compounders. Slow — yfinance rate limits apply."""
    import time
    results = []
    for ticker in tickers:
        try:
            ratios = compute_fundamental_ratios(ticker)
            scored = value_compounder_score(ratios)
            if scored["score_pct"] >= min_score:
                results.append(scored)
            time.sleep(0.5)   # Rate limit: yfinance throttles bulk requests
        except Exception as e:
            print(f"[WARN] {ticker}: {e}")

    df = pd.DataFrame([{
        "ticker"  : r["ticker"],
        "grade"   : r["grade"],
        "score"   : r["score_pct"],
        "roce"    : r["key_metrics"]["roce"],
        "roe"     : r["key_metrics"]["roe"],
        "rev_cagr": r["key_metrics"]["revenue_cagr"],
        "eps_cagr": r["key_metrics"]["eps_cagr"],
        "fcf_mgn" : r["key_metrics"]["fcf_margin"],
        "d_e"     : r["key_metrics"]["d_e"],
        "peg"     : r["key_metrics"]["peg"],
        "action"  : r["action"],
    } for r in results])

    return df.sort_values("score", ascending=False)
```

---

## PART 2 — Advanced Scanners Addendum

*Scanners not in the original framework — critical additions for a complete system.*

---

### A1 — CANSLIM Composite Scorer

```python
def canslim_score(df: pd.DataFrame, ticker: str,
                  rs_rating: float, market_regime: str) -> dict:
    """
    IBD's CANSLIM system scored 0–7.
    C=1, A=1, N=1, S=1, L=1, I=1, M=1
    Score 6–7 = A, 5 = B+, 4 = B, <4 = skip
    """
    t    = yf.Ticker(ticker)
    info = t.info
    inc  = t.financials
    score_map = {}

    # C — Current quarterly EPS growth >= 25% YoY
    qe = t.quarterly_earnings
    if qe is not None and len(qe) >= 4:
        curr_eps = qe['Earnings'].iloc[-1]
        yoy_eps  = qe['Earnings'].iloc[-5] if len(qe) >= 5 else qe['Earnings'].iloc[0]
        c_growth = (curr_eps - yoy_eps) / abs(yoy_eps) if yoy_eps != 0 else 0
        score_map["C"] = c_growth >= 0.25
    else:
        score_map["C"] = False

    # A — Annual EPS CAGR >= 25% for 3 years
    ni_vals = [get_fin(inc, "Net Income", i) for i in range(3, -1, -1)]
    shares  = info.get("sharesOutstanding", 1)
    eps_ann = [v / shares for v in ni_vals if not np.isnan(v) and shares > 0]
    a_cagr  = cagr(eps_ann) if len(eps_ann) >= 2 else np.nan
    score_map["A"] = not np.isnan(a_cagr) and a_cagr >= 0.25

    # N — New product/high: stock near 52-week high (proxy)
    high_52w = df['High'].iloc[-252:].max()
    score_map["N"] = df['Close'].iloc[-1] >= high_52w * 0.92

    # S — Supply/Demand: volume expanding on up days recently
    up_days  = df[df['Close'] > df['Close'].shift(1)].iloc[-20:]
    dn_days  = df[df['Close'] < df['Close'].shift(1)].iloc[-20:]
    score_map["S"] = (up_days['Volume'].mean() > dn_days['Volume'].mean()
                      if len(up_days) > 0 and len(dn_days) > 0 else False)

    # L — Leader: RS Rating >= 80
    score_map["L"] = rs_rating >= 80

    # I — Institutional Sponsorship increasing (proxy: held_pct vs prior quarter)
    inst_pct = info.get("heldPercentInstitutions", 0)
    score_map["I"] = inst_pct >= 0.10   # At least 10% institutional (rough proxy)

    # M — Market Direction: BULL regime
    score_map["M"] = market_regime == "BULL"

    total    = sum(score_map.values())
    grade    = "A"  if total >= 6 else "B+" if total == 5 else "B" if total == 4 else "C"

    return {
        "ticker"   : ticker,
        "canslim"  : score_map,
        "total"    : total,
        "grade"    : grade,
        "signal"   : total >= 5,
    }
```

---

### A2 — Earnings Revision Scanner

**Concept:** Stocks where analyst EPS estimates are being revised **upward** have strong forward price momentum. Academic evidence (Hawkins, Chan) shows upward revisions precede price appreciation by 1–3 months.

```
Mathematical Logic (yfinance approximation):
  Revision = (Current_EPS_Estimate - Prior_EPS_Estimate) / |Prior_EPS_Estimate|
  Signal   = Revision > 5%           [Upward revision of 5%+ = meaningful]
           AND n_analysts_revising_up > n_analysts_revising_down

yfinance fields available:
  t.info["forwardEps"]              → current forward EPS estimate
  t.info["earningsGrowth"]          → expected EPS growth
  t.analyst_price_targets (if any)  → price target distribution
```

```python
def earnings_revision_scanner(ticker: str, rs_rating: float) -> dict:
    """
    Proxy earnings revision signal using yfinance.
    NOTE: yfinance doesn't provide historical estimate changes directly.
    Best approximation: compare forwardEps to trailingEps; check earnings growth.
    For precise revision data: use FMP API or Refinitiv.
    """
    t    = yf.Ticker(ticker)
    info = t.info

    trailing_eps = info.get("trailingEps", np.nan)
    forward_eps  = info.get("forwardEps", np.nan)
    earnings_g   = info.get("earningsGrowth", np.nan)   # Expected
    revenue_g    = info.get("revenueGrowth", np.nan)    # Trailing

    # Proxy: forward EPS significantly above trailing = upward revision implied
    if not (np.isnan(trailing_eps) or np.isnan(forward_eps)) and trailing_eps > 0:
        implied_revision = (forward_eps - trailing_eps) / trailing_eps
    else:
        implied_revision = np.nan

    # Analyst target price vs current (upward bias = bullish)
    target_mean = info.get("targetMeanPrice", np.nan)
    current     = info.get("currentPrice", np.nan)
    upside      = (target_mean - current) / current if (target_mean and current) else np.nan

    signal = (
        not np.isnan(implied_revision) and implied_revision > 0.10 and
        not np.isnan(earnings_g) and earnings_g > 0.15 and
        rs_rating >= 70
    )

    return {
        "signal"           : signal,
        "implied_revision" : implied_revision,
        "earnings_growth"  : earnings_g,
        "revenue_growth"   : revenue_g,
        "upside_to_target" : upside,
        "rs_rating"        : rs_rating,
        "note"             : "Precise revision data requires FMP/Refinitiv API",
    }
```

---

### A3 — Promoter / Insider Buying Scanner (India)

```python
def india_promoter_buying_scan(q_current_promoter_pct: float,
                                q_prior_promoter_pct: float,
                                ticker: str,
                                df: pd.DataFrame) -> dict:
    """
    India: Promoter increasing stake = strong conviction signal.
    Data source: BSE quarterly shareholding disclosure (manual download).

    Promoter buying signal:
      Promoter_Change = Current_Pct - Prior_Pct > 0.50%   [> 0.5% increase in quarter]
      AND current_promoter_pct > 40%                       [Promoters still majority]
      AND price not at 52W high already (buying low, not FOMO)
      AND pledging NOT increasing
    """
    promoter_change   = q_current_promoter_pct - q_prior_promoter_pct
    near_52w_high     = df['Close'].iloc[-1] >= df['High'].iloc[-252:].max() * 0.90

    # Logic: promoters buying into weakness = strongest signal
    # Promoters buying near ATH = less meaningful (could be ESOP/bonus)
    buying_into_weakness = promoter_change > 0.5 and not near_52w_high

    return {
        "promoter_change"      : promoter_change,
        "current_pct"          : q_current_promoter_pct,
        "buying_into_weakness" : buying_into_weakness,
        "signal"               : promoter_change > 0.5 and q_current_promoter_pct > 40,
        "grade"                : "A" if buying_into_weakness else
                                 "B" if promoter_change > 0.5 else "C",
        "note"                 : "Grade A = buying into price weakness (strongest signal)",
    }
```

---

### A4 — 12-1 Momentum Factor (Jegadeesh & Titman)

The academic momentum factor: **12-month return excluding the most recent month.** Avoids short-term reversal while capturing medium-term momentum. The most replicated factor in finance (1993 paper).

```
Momentum_Score(t) = (C_t / C_{t-252} - 1) - (C_t / C_{t-21} - 1)
                  = (C_{t-21} / C_{t-252}) - 1     [Simplified: 12M return skipping last month]

Ranking:
  Top_Decile  = stocks with Momentum_Score in top 10% of universe
  Long_Signal = top decile AND RS_Rating >= 75 AND above SMA200
```

```python
def momentum_12_1(close: pd.Series) -> float:
    """
    Jegadeesh-Titman 12-1 momentum.
    Returns raw score. Rank across universe for signal.
    """
    if len(close) < 253:
        return np.nan
    # 12-month return excluding last month
    return (close.iloc[-22] / close.iloc[-252]) - 1


def momentum_universe_rank(universe: dict) -> pd.Series:
    """Rank 12-1 momentum across universe. Returns percentile 0–100."""
    raw = {t: momentum_12_1(df['Close']) for t, df in universe.items()}
    s   = pd.Series(raw).dropna()
    return (s.rank(pct=True) * 100).rename("momentum_rank")
```

---

### A5 — Wyckoff Accumulation (Phase D — Entry Signal)

Wyckoff's accumulation schematic: Institutions accumulate during Phases A→C, and the entry signal is **Phase D — the Sign of Strength (SOS) breakout.**

```
Wyckoff Phase D Signal (simplified scanner proxy):
  Prerequisite: Stock spent 8+ weeks in a trading range (TR)
  TR_High = resistance level (Preliminary Supply / UTAD)
  TR_Low  = support level (Preliminary Support / Spring)

  SOS = Close > TR_High                       [Sign of Strength — breaks above TR]
       AND Volume on breakout > 1.5x avg      [Institutional buying]
       AND Close is in upper 25% of TR range  [Strong close above resistance]

  LPS (Last Point of Support) — re-entry:
       After SOS, stock pulls back to former TR_High (now support)
       Low volume on pullback (Back to Ice)
       Signal: Close returns to TR_High ± 2%  on declining volume
```

```python
def wyckoff_sos_scan(df: pd.DataFrame, tr_weeks: int = 12) -> dict:
    """
    Simplified Wyckoff Sign of Strength (Phase D) detection.
    Uses recent N-week trading range as TR boundaries.
    """
    weekly   = df.resample('W-FRI').agg({'High':'max','Low':'min',
                                          'Close':'last','Volume':'sum'}).dropna()
    if len(weekly) < tr_weeks + 4:
        return {"signal": False}

    # Trading range: lookback window before last 4 weeks
    tr_window = weekly.iloc[-tr_weeks-4:-4]
    tr_high   = tr_window['High'].max()
    tr_low    = tr_window['Low'].min()
    tr_range  = tr_high - tr_low

    # Current week
    close_t   = weekly['Close'].iloc[-1]
    vol_t     = weekly['Volume'].iloc[-1]
    avg_vol   = weekly['Volume'].iloc[-tr_weeks-4:-4].mean()

    # SOS: breakout above TR high
    sos       = close_t > tr_high
    vol_ok    = vol_t > 1.5 * avg_vol
    strong_close = (close_t - tr_low) / tr_range > 0.75 if tr_range > 0 else False

    return {
        "signal"      : sos and vol_ok and strong_close,
        "tr_high"     : tr_high,
        "tr_low"      : tr_low,
        "tr_weeks"    : tr_weeks,
        "sos"         : sos,
        "vol_ok"      : vol_ok,
        "strong_close": strong_close,
        "lps_target"  : tr_high,    # Pullback to this level = re-entry
        "stop"        : tr_low,
    }
```

---

### A6 — Short Squeeze Scanner (US)

```
Mathematical Definition:
  Short Interest Ratio (Days to Cover) = Shares Short / Avg Daily Volume
  Short Float % = Shares Short / Float Shares

Squeeze Setup:
  Short_Float_Pct  > 20%           [High short interest]
  Days_to_Cover    > 5             [At least 5 days to cover all shorts]
  Price breaking above key resistance  [Forces short covering]
  Volume expanding (short covering amplifies moves)

Signal: High short interest + breakout = squeeze fuel
```

```python
def short_squeeze_scanner(ticker: str, df: pd.DataFrame) -> dict:
    """yfinance provides short interest data in .info"""
    t    = yf.Ticker(ticker)
    info = t.info

    short_pct  = info.get("shortPercentOfFloat", np.nan)  # e.g. 0.25 = 25%
    shares_shrt= info.get("sharesShort", np.nan)
    days_cover = info.get("shortRatio", np.nan)             # Days to Cover

    # Technical: near 52W high breakout
    high_252   = df['High'].iloc[-252:].max()
    close_t    = df['Close'].iloc[-1]
    near_break = close_t >= high_252 * 0.97

    signal = (
        not np.isnan(short_pct) and short_pct > 0.15 and
        not np.isnan(days_cover) and days_cover > 5   and
        near_break
    )

    return {
        "signal"         : signal,
        "short_float_pct": short_pct,
        "days_to_cover"  : days_cover,
        "near_breakout"  : near_break,
        "squeeze_risk"   : "HIGH"   if (short_pct and short_pct > 0.30) else
                           "MEDIUM" if (short_pct and short_pct > 0.15) else "LOW",
        "note"           : "High short interest = explosive if thesis changes. "
                           "Short squeeze = violent but unstable. Use tight stops.",
    }
```

---

### A7 — Buyback + Capital Return Scanner

```python
def buyback_scanner(ticker: str, df: pd.DataFrame) -> dict:
    """
    Detects active share buybacks — management buying own stock = confidence signal.
    """
    t    = yf.Ticker(ticker)
    info = t.info
    cf   = t.cashflow

    # Shares outstanding declining QoQ = buybacks happening
    shares_now  = info.get("sharesOutstanding", np.nan)
    # yfinance quarterly balance sheet shares (approximate)
    bq = t.quarterly_balance_sheet
    shares_hist = []
    if bq is not None:
        for col in bq.columns[:4]:
            row = [r for r in bq.index if "shares" in r.lower() and "common" in r.lower()]
            if row:
                shares_hist.append(float(bq.loc[row[0], col]))

    shares_declining = (len(shares_hist) >= 2 and
                        shares_hist[0] < shares_hist[-1])   # Latest < oldest

    # Buyback from cash flow
    buyback_cf = get_fin(cf, "Repurchase Of Stock", 0, default=0)
    active_buyback = not np.isnan(buyback_cf) and abs(buyback_cf) > 0

    return {
        "signal"          : shares_declining and active_buyback,
        "shares_declining": shares_declining,
        "active_buyback"  : active_buyback,
        "buyback_amount"  : abs(buyback_cf) if not np.isnan(buyback_cf) else 0,
        "note"            : "Shares declining + FCF-funded buyback = highest quality signal",
    }
```

---

## What Was Missing — Complete Scanner Inventory

| # | Scanner | Category | This File | Framework File |
|---|---------|----------|-----------|----------------|
| 1 | 52W High Breakout | Breakout | — | S01 |
| 2 | ATH Breakout | Breakout | — | S02 |
| 3 | Multi-Year Breakout | Breakout | — | S03 |
| 4 | Monthly Close Breakout | Breakout | — | S04 |
| 5 | 3 Weeks Tight | Pattern | — | S05 |
| 6 | NR7/NR4 | Volatility | — | S06 |
| 7 | Darvas Box | Pattern | — | S07 |
| 8 | Donchian Breakout | Trend | — | S08 |
| 9 | ATR Volatility Contraction | Volatility | — | S09 |
| 10 | VCP (scipy method) | Pattern | Superseded by HV method | S10 |
| 11 | **VCP via HV Percentile** | Volatility | vcp_volatility_scanner.md | — |
| 12 | Volume Spurt / Pocket Pivot | Volume | — | S11 |
| 13 | Weekly Volume Breakout | Volume | — | S12 |
| 14 | Sector Leader | Composite | — | S13 |
| 15 | IPO Base | Lifecycle | — | S14 |
| 16 | Power Earnings Gap | Event | — | S15 |
| 17 | PEAD | Event | — | S16 |
| 18 | Near Breakout | Watchlist | — | S17 |
| 19 | High Tight Flag | Pattern | — | S18 |
| 20 | Cup & Handle | Pattern | — | S19 |
| 21 | Flat Base | Pattern | — | S20 |
| 22 | Inside Bar | Pattern | — | S21 |
| 23 | RS Line New High | RS | — | S22 |
| 24 | **Weinstein Stage 1→2** | Stage | weinstein_stage_analysis.md | — |
| 25 | **Weinstein Stage 2 Continuation** | Stage | weinstein_stage_analysis.md | — |
| 26 | **Government Shareholding (A)** | Fundamental | government_theme_scanner.md | — |
| 27 | **Government Theme/PLI (B)** | Thematic | government_theme_scanner.md | — |
| 28 | **Govt Composite A∩B (C)** | Composite | government_theme_scanner.md | — |
| 29 | **Value Compounder** | Fundamental | This file | — |
| 30 | **CANSLIM Composite** | Composite | This file | — |
| 31 | **Earnings Revision** | Fundamental | This file | — |
| 32 | **Promoter/Insider Buying** | Fundamental | This file | — |
| 33 | **12-1 Momentum Factor** | Quant | This file | — |
| 34 | **Wyckoff SOS (Phase D)** | Pattern | This file | — |
| 35 | **Short Squeeze** | Event | This file | — |
| 36 | **Buyback / Capital Return** | Fundamental | This file | — |

**Total: 36 scanners across 7 files. Complete system.**

---

*Cross-reference: scanner_logic_framework.md | scanner_guardrails.md | india_scanner_examples.md*
*vcp_volatility_scanner.md | government_theme_scanner.md | weinstein_stage_analysis.md*
