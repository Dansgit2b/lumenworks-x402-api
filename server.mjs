/** Lumen Works Web3 Decoder API — x402-paid (USDC on Base, PayAI public facilitator). Author: Dan (GitHub Dansgit2b). */
import express from "express";
import rateLimit from "express-rate-limit";
import { facilitator } from "@payai/facilitator";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { lintX402, decodeEip712, decodeCalldata } from "./decoders.mjs";
const PAY_TO = "0xee9790cB3960952F585379F831a89b4e00B4029A", NETWORK = "eip155:8453", USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PRICE = process.env.PRICE_ATOMIC || "2000", PRICE_USD = (Number(PRICE) / 1e6).toString();
const PORT = Number(process.env.PORT || 4021), BASE = (process.env.PUBLIC_BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const BRAND = "Lumen Works (author: Dan, github.com/Dansgit2b)";
const EP = {
  "/v1/x402/lint": { fn: lintX402, desc: "Decode and lint an x402 PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE header (base64 or JSON): kind, decoded object, errors/warnings (CAIP-2, checksum, EIP-712 domain, expiry).", ex: { header: "<base64 PAYMENT-REQUIRED>" } },
  "/v1/eip712/decode": { fn: decodeEip712, desc: "Decode EIP-712 typed data: domain separator, signing digest, message, and plain-language risk notes (Permit, Permit2, EIP-3009, unlimited values).", ex: { typedData: { domain: {}, types: {}, primaryType: "Permit", message: {} } } },
  "/v1/calldata/decode": { fn: decodeCalldata, desc: "Decode Ethereum calldata: selector, 4byte/openchain signature lookup, ABI-decoded args for each matching candidate. Optional {signature} override.", ex: { data: "0xa9059cbb..." } },
};
const accepts = { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: { amount: PRICE, asset: USDC, extra: { name: "USD Coin", version: "2" } }, maxTimeoutSeconds: 120 };
const routes = Object.fromEntries(Object.entries(EP).map(([p, e]) => [`POST ${p}`, { resource: `${BASE}${p}`, accepts, description: e.desc, mimeType: "application/json", serviceName: "Lumen Works Decoder", tags: ["x402", "eip712", "calldata", "decoder", "ethereum"], extensions: declareDiscoveryExtension({ method: "POST", bodyType: "json", input: e.ex, inputSchema: { properties: {} }, output: { example: {} } }) }]));
const app = express(); app.disable("x-powered-by"); app.set("trust proxy", 1); app.use(express.json({ limit: "64kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));
const discovery = () => ({ name: "Lumen Works Decoder API", author: "Dan (GitHub: Dansgit2b)", description: "Pay-per-call decoders for x402 headers, EIP-712 typed data and Ethereum calldata.", network: NETWORK, asset: USDC, payTo: PAY_TO, priceUsdc: PRICE_USD, facilitator: facilitator.url, resources: Object.keys(EP).map((p) => `${BASE}${p}`), freeTier: "POST /v1/free/<same path> — 20 calls/hour/IP, no payment", openapi: `${BASE}/openapi.json`, llms: `${BASE}/llms.txt` });
app.get("/", (_q, r) => r.json(discovery()));
app.get("/.well-known/x402", (_q, r) => r.json({ version: 1, ...discovery() }));
app.get("/health", (_q, r) => r.json({ ok: true }));
app.get("/llms.txt", (_q, r) => r.type("text/plain").send(`# Lumen Works Decoder API\n> x402-paid decoders (${PRICE_USD} USDC/call on Base). Author: Dan (github.com/Dansgit2b).\n\n${Object.entries(EP).map(([p, e]) => `- POST ${BASE}${p} — ${e.desc} Body: ${JSON.stringify(e.ex)}`).join("\n")}\n\nFree tier: POST ${BASE}/v1/free/... (20/hour/IP). OpenAPI: ${BASE}/openapi.json\n`));
app.get("/openapi.json", (_q, r) => r.json({ openapi: "3.1.0", info: { title: "Lumen Works Decoder API", version: "1.0.0", description: "x402-paid decoders. Author Dan (Dansgit2b)." }, servers: [{ url: BASE }], paths: Object.fromEntries(Object.entries(EP).map(([p, e]) => [p, { post: { operationId: p.replace(/\W+/g, "_"), summary: e.desc, "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: PRICE_USD }, protocols: [{ x402: { network: NETWORK, asset: USDC, payTo: PAY_TO } }] }, requestBody: { content: { "application/json": { schema: { type: "object" }, example: e.ex } } }, responses: { 200: { description: "Decoded" }, 402: { description: "Payment Required (x402 v2)" } } } }])) }));
const run = (fn) => async (q, r) => { try { r.json(await fn(q.body)); } catch (e) { r.status(e.status || 400).json({ error: e.message, charged: false }); } };
const freeLimit = rateLimit({ windowMs: 3600_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Free tier exhausted (20/h). Use paid endpoint." } });
for (const [p, e] of Object.entries(EP)) app.post(`/v1/free${p.slice(3)}`, freeLimit, run(e.fn));
app.use(paymentMiddleware(routes, new x402ResourceServer(new HTTPFacilitatorClient(facilitator)).register(NETWORK, new ExactEvmScheme())));
for (const [p, e] of Object.entries(EP)) app.post(p, run(e.fn));
app.use((_q, r) => r.status(404).json({ error: "Not found" }));
app.listen(PORT, process.env.HOST || "0.0.0.0", () => console.log("listening", PORT, BASE));
