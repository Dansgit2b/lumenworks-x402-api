/** Capture REAL outputs for every tool (live upstream calls) -> examples.json, used as Bazaar output.example. Long strings/arrays trimmed. */
import fs from "node:fs";
import { lintX402, decodeEip712, decodeCalldata } from "../decoders.mjs";
import { explainBeforeSign } from "../preflight.mjs";
import { pubmedSearch, arxivSearch, secFilings, weather, polymarketMarkets } from "../data.mjs";
import { webMarkdown, webUnfurl, evmAddress, domainLookup } from "../services.mjs";
const UNL = "0x095ea7b3000000000000000000000000111111125421ca6dc452d289314280a0f8842a65ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const pr = Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: "https://lumenworks-x402-decoder.onrender.com/v1/tx/explain" }, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "2000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0xee9790cB3960952F585379F831a89b4e00B4029A", maxTimeoutSeconds: 120, extra: { name: "USD Coin", version: "2" } }] })).toString("base64");
const td = { domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, primaryType: "Permit", types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, message: { owner: "0x1111111111111111111111111111111111111111", spender: "0x111111125421cA6dc452d289314280a0f8842A65", value: "1000000", nonce: "0", deadline: "1893456000" } };
export const INPUTS = {
  "/v1/tx/explain": [explainBeforeSign, { transaction: { to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: UNL, value: "0" }, chainId: 8453 }],
  "/v1/calldata/decode": [decodeCalldata, { data: "0xa9059cbb000000000000000000000000ee9790cb3960952f585379f831a89b4e00b4029a00000000000000000000000000000000000000000000000000000000000f4240" }],
  "/v1/web/markdown": [webMarkdown, { url: "https://example.com", maxChars: 2000 }],
  "/v1/x402/lint": [lintX402, { header: pr }],
  "/v1/eip712/decode": [decodeEip712, { typedData: td }],
  "/v1/web/unfurl": [webUnfurl, { url: "https://github.com" }],
  "/v1/evm/address": [evmAddress, { address: "vitalik.eth" }],
  "/v1/domain/lookup": [domainLookup, { domain: "example.com" }],
  "/v1/pubmed/search": [pubmedSearch, { query: "GLP-1 obesity", limit: 2 }],
  "/v1/arxiv/search": [arxivSearch, { query: "LLM agents tool use", limit: 2 }],
  "/v1/sec/filings": [secFilings, { ticker: "AAPL", forms: ["10-K"], limit: 2 }],
  "/v1/weather/forecast": [weather, { location: "Berlin", days: 2 }],
  "/v1/polymarket/markets": [polymarketMarkets, { limit: 2 }],
};
const trim = (v, d = 0) => Array.isArray(v) ? v.slice(0, 3).map((x) => trim(x, d + 1)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [k, trim(x, d + 1)])) : typeof v === "string" && v.length > 400 ? v.slice(0, 400) + "…" : v;
if (process.argv[1].endsWith("capture-examples.mjs")) {
  const out = {};
  for (const [p, [fn, input]] of Object.entries(INPUTS)) { try { out[p] = { capturedAt: new Date().toISOString(), input, output: trim(await fn(input)) }; console.log("ok", p); } catch (e) { console.log("FAIL", p, e.message); } }
  fs.writeFileSync(new URL("../examples.json", import.meta.url), JSON.stringify(out, null, 1));
}
