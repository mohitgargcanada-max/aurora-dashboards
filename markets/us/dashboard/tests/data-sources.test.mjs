import assert from "node:assert/strict";
import {collectHistory, validateBars} from "../worker/data-sources.js";

const bars = Array.from({length:200}, (_, index) => {
  const date = new Date(Date.UTC(2025, 0, 1 + index));
  return {date:date.toISOString().slice(0,10),open:100,high:102,low:99,close:101,adjusted_close:101,volume:1000};
});
validateBars(bars, {minimumBars:200, expectedSession:bars.at(-1).date});
assert.throws(() => validateBars([...bars, bars.at(-1)], {minimumBars:200}), /duplicated or unordered/);

const yahooPayload = {chart:{result:[{meta:{currency:"USD",exchangeName:"NMS"},timestamp:bars.map(x=>Date.parse(x.date)/1000),indicators:{quote:[{open:bars.map(x=>x.open),high:bars.map(x=>x.high),low:bars.map(x=>x.low),close:bars.map(x=>x.close),volume:bars.map(x=>x.volume)}],adjclose:[{adjclose:bars.map(x=>x.adjusted_close)}]}}],error:null}};
const yahooFetch = async () => new Response(JSON.stringify(yahooPayload), {status:200,headers:{"content-type":"application/json"}});
const yahoo = await collectHistory({symbol:"AAPL",eodhdSymbol:"AAPL.US",startDate:bars[0].date,endDate:bars.at(-1).date,expectedSession:bars.at(-1).date,minimumBars:200,eodhdToken:"unused",fetcher:yahooFetch});
assert.equal(yahoo.provenance.provider, "YAHOO_FINANCE");

let calls = 0;
const fallbackFetch = async url => {
  calls += 1;
  if (url.includes("query1.finance.yahoo.com")) return new Response("blocked", {status:403});
  return new Response(JSON.stringify(bars), {status:200,headers:{"content-type":"application/json"}});
};
const fallback = await collectHistory({symbol:"AAPL",eodhdSymbol:"AAPL.US",startDate:bars[0].date,endDate:bars.at(-1).date,expectedSession:bars.at(-1).date,minimumBars:200,eodhdToken:"secret",fetcher:fallbackFetch});
assert.equal(fallback.provenance.provider, "EODHD");
assert.equal(fallback.provenance.fallback_label, "EODHD_FALLBACK");
assert.equal(calls, 2);
assert(!JSON.stringify(fallback).includes("secret"));
console.log("Data source adapter tests passed");
