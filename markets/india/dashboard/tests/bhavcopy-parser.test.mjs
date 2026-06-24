import assert from "node:assert/strict";
import { normalizeBhavcopyRow, parseCsv } from "../engine/bhavcopy-parser.mjs";

const oldNse = `SYMBOL,SERIES,DATE1,PREV_CLOSE,OPEN_PRICE,HIGH_PRICE,LOW_PRICE,LAST_PRICE,CLOSE_PRICE,AVG_PRICE,TTL_TRD_QNTY,TURNOVER_LACS,NO_OF_TRADES,DELIV_QTY,DELIV_PER
RELIANCE,EQ,22-JUN-2026,1500,1510,1540,1505,1530,1532,1520,100000,1520,5000,70000,70`;
const item = normalizeBhavcopyRow(parseCsv(oldNse)[0], "sec_bhavdata_full_22062026.csv");
assert.equal(item.exchange, "NSE");
assert.equal(item.symbol, "RELIANCE");
assert.equal(item.bar.date, "2026-06-22");
assert.equal(item.bar.volume, 100000);
assert.equal(item.bar.turnover, 152000000);

const bse = `SC_CODE,SC_NAME,SC_GROUP,OPEN,HIGH,LOW,CLOSE,NO_OF_SHRS,NET_TURNOV,DATE
500325,RELIANCE,A,1510,1540,1505,1532,90000,138000000,2026-06-22`;
const bseItem = normalizeBhavcopyRow(parseCsv(bse)[0], "BSE_EQ220626.csv");
assert.equal(bseItem.exchange, "BSE");
assert.equal(bseItem.security_code, "500325");
assert.equal(bseItem.bar.volume, 90000);

// Liquidity is retained as data; the parser has no liquidity rejection path.
assert.equal(bseItem.bar.turnover, 138000000);
console.log("bhavcopy-parser tests passed");
