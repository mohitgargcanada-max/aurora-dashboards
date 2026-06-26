import assert from "node:assert/strict";
import { parseAuroraKeys, resolveEodhdToken } from "../scripts/aurora-env.mjs";

assert.equal(resolveEodhdToken({ EODHD_API_TOKEN: "token-a" }), "token-a");
assert.equal(resolveEodhdToken({ EODHD_API_KEY: "token-b" }), "token-b");
assert.equal(resolveEodhdToken({ EODHD_API_KEY: "token-b", AURORAKEYS: "EODHD_API_TOKEN=token-c" }), "token-b");
assert.equal(resolveEodhdToken({ AURORAKEYS: JSON.stringify({ EODHD_API_TOKEN: "token-c", SEC_USER_AGENT: "agent" }) }), "token-c");
assert.equal(resolveEodhdToken({ AURORAKEYS: "SEC_USER_AGENT=agent\nEODHD_API_TOKEN=token-d\n" }), "token-d");
assert.equal(resolveEodhdToken({ AURORAKEYS: "export EODHD_KEY=token-f\n" }), "token-f");
assert.equal(resolveEodhdToken({ AURORAKEYS: JSON.stringify({ aurora: { eodhd: { api_key: "token-g" } } }) }), "token-g");
assert.equal(resolveEodhdToken({ AURORAKEYS: JSON.stringify({ keys: [{ name: "EODHD_API_KEY", value: "token-h" }] }) }), "token-h");
assert.equal(resolveEodhdToken({ AURORAKEYS: JSON.stringify({ providers: { eodHistoricalData: { credential: "token-i" } } }) }), "token-i");
assert.equal(resolveEodhdToken({ AURORAKEYS: JSON.stringify({ providers: [{ provider: "EODHD", key: "token-j" }] }) }), "token-j");
assert.equal(resolveEodhdToken({ AURORAKEYS: JSON.stringify({ "EOD Historical Data": "token-k" }) }), "token-k");
assert.equal(resolveEodhdToken({ AURORAKEYS: JSON.stringify({ aurora: { eod: { token: "token-l" } } }) }), "token-l");
assert.equal(resolveEodhdToken({ AURORAKEYS: "token-m" }), "token-m");
assert.equal(resolveEodhdToken({ AURORAKEYS: JSON.stringify("token-n") }), "token-n");
assert.equal(resolveEodhdToken({ AURORAKEYS: "EOD Historical Data: token-o\n" }), "token-o");
assert.deepEqual(parseAuroraKeys("EODHD_API_KEY='token-e'\n# comment\n"), { EODHD_API_KEY: "token-e" });

console.log("Aurora env tests passed");
