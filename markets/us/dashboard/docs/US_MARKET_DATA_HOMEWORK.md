# US Market Data Homework

## The three datasets are different

1. **Exchange security master:** discovers every active Nasdaq, NYSE and NYSE American security.
2. **Index membership:** assigns overlapping S&P, Nasdaq, Dow and Russell pools.
3. **Historical OHLCV:** downloads bars for each security and benchmark independently.

An index-history URL never provides all constituent histories. For example, `^NYA` gives NYSE Composite bars, while `otherlisted.txt` supplies NYSE/NYSE American symbols.

## Locked Yahoo and proxy map

| Pool / context | Yahoo index | RS proxy | Membership source |
|---|---|---|---|
| S&P 500 | `^GSPC` | `SPY` | State Street SPY daily holdings |
| Nasdaq Composite | `^IXIC` | `^IXIC` | Nasdaq Trader Nasdaq security master |
| Nasdaq 100 | `^NDX` | `QQQ` | Nasdaq official companies page |
| Dow 30 | `^DJI` | `DIA` | State Street DIA daily holdings |
| Russell 1000 | `^RUI` | `IWB` | iShares IWB holdings |
| Russell 2000 | `^RUT` | `IWM` | iShares IWM holdings |
| S&P MidCap 400 | `^SP400`; alternate `^MID` | `MDY` | State Street MDY daily holdings |
| S&P SmallCap 600 | `^SP600` | `IJR` | iShares IJR holdings |
| NYSE Composite | `^NYA` | `^NYA` | Nasdaq Trader other-listed security master |
| NYSE American Composite | `^XAX` | `^XAX` | Nasdaq Trader other-listed security master |
| Russell 3000 context | `^RUA` | `IWV` | iShares IWV holdings |
| Volatility | `^VIX` | `^VIX` | CBOE primary |

Yahoo Canada history URL format:

```text
https://ca.finance.yahoo.com/quote/{URL_ENCODED_SYMBOL}/history/
```

Examples: `^GSPC -> %5EGSPC`, `^NDX -> %5ENDX`, `^NYA -> %5ENYA`.

## Full-universe construction

1. Read `nasdaqlisted.txt` for Nasdaq.
2. Read `otherlisted.txt` and retain NYSE and NYSE American rows.
3. Exclude ETFs, funds, ETNs, warrants, rights, units, preferreds, bonds, test issues and OTC securities.
4. Cross-check ticker/exchange/CIK against SEC `company_tickers_exchange.json`.
5. Attach all matching index memberships from official index or ETF holdings sources.
6. Create `NON_INDEX` for eligible common stocks with no tracked membership.
7. Fetch at least 260 completed daily bars for each stock and every routed benchmark.
8. Record provider, as-of date, row count, adjustment policy and lane status.

## Historical validation gate

A symbol is technical-scan ready only when:

- at least 260 daily bars are present, unless it is explicitly in the IPO lane;
- dates are ascending, unique and aligned to completed US sessions;
- OHLC values are positive and `low <= open/close <= high`;
- volume is non-negative;
- the latest completed bar is not stale;
- split adjustments are consistent across price columns;
- its routed benchmark has overlapping dates.

Failures remain visible as `PARTIAL` or `UNKNOWN`; they are never silently promoted.

## Yahoo access behavior

Yahoo pages can be viewed interactively but may return HTTP 429 to automated server fetches. The adapter should use respectful throttling, caching, exponential backoff and a circuit breaker. It must not launch thousands of simultaneous requests. If Yahoo remains inaccessible after bounded retries, the free-source lane is marked failed and EODHD may be used only as the configured fallback.
