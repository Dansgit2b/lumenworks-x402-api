/** Lumen Works Web3 Decoder API — x402-paid (USDC on Base, PayAI public facilitator). Author: Dan (GitHub Dansgit2b). */
import express from "express";
import rateLimit from "express-rate-limit";
import { facilitator } from "@payai/facilitator";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { lintX402, decodeEip712, decodeCalldata } from "./decoders.mjs";
import { makeRequestHandlers } from "./requests.mjs";
import { webMarkdown, webUnfurl, evmAddress, domainLookup } from "./services.mjs";
const PAY_TO = "0xee9790cB3960952F585379F831a89b4e00B4029A", NETWORK = "eip155:8453", USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PRICE = process.env.PRICE_ATOMIC || "2000", PRICE_USD = (Number(PRICE) / 1e6).toString();
const PORT = Number(process.env.PORT || 4021), BASE = (process.env.PUBLIC_BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const BRAND = "Lumen Works (author: Dan, github.com/Dansgit2b)";
const EP = {
  "/v1/x402/lint": { fn: lintX402, desc: "Decode and lint an x402 PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE header (base64 or JSON): kind, decoded object, errors/warnings (CAIP-2, checksum, EIP-712 domain, expiry).", ex: { header: "<base64 PAYMENT-REQUIRED>" } },
  "/v1/eip712/decode": { fn: decodeEip712, desc: "Decode EIP-712 typed data: domain separator, signing digest, message, and plain-language risk notes (Permit, Permit2, EIP-3009, unlimited values).", ex: { typedData: { domain: {}, types: {}, primaryType: "Permit", message: {} } } },
  "/v1/calldata/decode": { fn: decodeCalldata, desc: "Decode Ethereum calldata: selector, 4byte/openchain signature lookup, ABI-decoded args for each matching candidate. Optional {signature} override.", ex: { data: "0xa9059cbb..." } },
  "/v1/web/markdown": { fn: webMarkdown, price: "1000", tags: ["web", "scrape", "markdown", "reader"], desc: "Fetch a public web page and return clean LLM-ready Markdown (Readability main-content extraction, nav/scripts stripped) plus title, byline, excerpt and OpenGraph metadata. {fullPage:true} keeps the whole body; {maxChars} caps output (default 100k). No JS rendering.", ex: { url: "https://example.com" } },
  "/v1/web/unfurl": { fn: webUnfurl, price: "1000", tags: ["web", "unfurl", "metadata", "opengraph"], desc: "Unfurl a URL: final URL after redirects, HTTP status, title, description, OpenGraph/Twitter image, site name, canonical, favicon, language, published time.", ex: { url: "https://github.com" } },
  "/v1/evm/address": { fn: evmAddress, tags: ["evm", "ens", "address", "balance", "base", "ethereum"], desc: "Look up an EVM address or ENS name on Ethereum + Base: ENS forward/reverse + text records, EOA vs contract (EIP-7702 delegation flag), native balance, tx count, USDC/USDT balances, and ERC-20 name/symbol/decimals/supply if it is a token.", ex: { address: "vitalik.eth" } },
  "/v1/domain/lookup": { fn: domainLookup, tags: ["dns", "rdap", "whois", "domain", "email"], desc: "Domain intelligence: DNS A/AAAA/CNAME/MX/NS/TXT/CAA (DNS-over-HTTPS), SPF + DMARC, RDAP registration/expiry/registrar/status, domain age in days. Useful for phishing/fraud checks and lead qualification.", ex: { domain: "example.com" } },
};
const CELO = "eip155:42220", CELO_KEY = process.env.X402_CELO_API_KEY || "";
const baseAccept = { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: { amount: PRICE, asset: USDC, extra: { name: "USD Coin", version: "2" } }, maxTimeoutSeconds: 120 };
const celoAccepts = CELO_KEY ? [
  { scheme: "exact", network: CELO, payTo: PAY_TO, price: { amount: PRICE, asset: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771", extra: { name: "Tether America USD", version: "1", assetTransferMethod: "eip3009" } }, maxTimeoutSeconds: 120 },
  { scheme: "exact", network: CELO, payTo: PAY_TO, price: { amount: PRICE, asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" } }, maxTimeoutSeconds: 120 },
] : [];
const accepts = [baseAccept, ...celoAccepts];
const mkAccepts = (price = PRICE) => [{ ...baseAccept, price: { ...baseAccept.price, amount: price } }, ...celoAccepts.map((a) => ({ ...a, price: { ...a.price, amount: price } }))];
const usd = (e) => (Number(e.price || PRICE) / 1e6).toString();
const routes = Object.fromEntries(Object.entries(EP).map(([p, e]) => [`POST ${p}`, { resource: `${BASE}${p}`, accepts: mkAccepts(e.price), description: e.desc, mimeType: "application/json", serviceName: "Lumen Works", tags: e.tags || ["x402", "eip712", "calldata", "decoder", "ethereum"], extensions: declareDiscoveryExtension({ method: "POST", bodyType: "json", input: e.ex, inputSchema: { properties: {} }, output: { example: {} } }) }]));
const app = express(); app.disable("x-powered-by"); app.set("trust proxy", 1); app.use(express.json({ limit: "64kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));
const discovery = () => ({ name: "Lumen Works Decoder API", author: "Dan (GitHub: Dansgit2b)", description: "Pay-per-call agent utilities: x402/EIP-712/calldata decoders, web page to Markdown, URL unfurl, EVM address/ENS lookup, domain DNS+RDAP.", prices: Object.fromEntries(Object.entries(EP).map(([p, e]) => [p, usd(e)])), network: NETWORK, networks: [NETWORK, ...(CELO_KEY ? [CELO] : [])], celoAssets: CELO_KEY ? ["USAT", "USDC"] : [], mcp: `${BASE}/mcp`, asset: USDC, payTo: PAY_TO, priceUsdc: PRICE_USD, facilitator: facilitator.url, resources: Object.keys(EP).map((p) => `${BASE}${p}`), freeTier: "POST /v1/free/<same path> — 20 calls/hour/IP, no payment", requestATool: `POST ${BASE}/v1/request-tool (free) — describe a capability you need; popular requests get built`, openapi: `${BASE}/openapi.json`, llms: `${BASE}/llms.txt` });
app.get("/", (_q, r) => r.json(discovery()));
app.get("/.well-known/x402", (_q, r) => r.json({ version: 1, ...discovery() }));
app.get("/health", (_q, r) => r.json({ ok: true }));
app.get("/llms.txt", (_q, r) => r.type("text/plain").send(`# Lumen Works API\n> x402-paid agent utilities (0.001-0.002 USDC/call on Base). Author: Dan (github.com/Dansgit2b).\n\n${Object.entries(EP).map(([p, e]) => `- POST ${BASE}${p} (${usd(e)} USDC) — ${e.desc} Body: ${JSON.stringify(e.ex)}`).join("\n")}\n\nFree tier: POST ${BASE}/v1/free/... (20/hour/IP). Missing a tool? POST ${BASE}/v1/request-tool {task, needed_capability, example_input, max_price_usdc} (free). OpenAPI: ${BASE}/openapi.json\n`));
app.get("/openapi.json", (_q, r) => r.json({ openapi: "3.1.0", info: { title: "Lumen Works Decoder API", version: "1.2.0", description: "x402-paid agent utilities. Author Dan (Dansgit2b)." }, servers: [{ url: BASE }], paths: Object.fromEntries(Object.entries(EP).map(([p, e]) => [p, { post: { operationId: p.replace(/\W+/g, "_"), summary: e.desc, "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: usd(e) }, protocols: [{ x402: { network: NETWORK, asset: USDC, payTo: PAY_TO } }] }, requestBody: { content: { "application/json": { schema: { type: "object" }, example: e.ex } } }, responses: { 200: { description: "Decoded" }, 402: { description: "Payment Required (x402 v2)" } } } }])) }));
const run = (fn) => async (q, r) => { try { r.json(await fn(q.body)); } catch (e) { r.status(e.status || 400).json({ error: e.message, charged: false }); } };
const freeLimit = rateLimit({ windowMs: 3600_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Free tier exhausted (20/h). Use paid endpoint." } });
for (const [p, e] of Object.entries(EP)) app.post(`/v1/free${p.slice(3)}`, freeLimit, run(e.fn));
const TOOLS = [
  { name: "x402_lint", path: "/v1/x402/lint", description: EP["/v1/x402/lint"].desc, inputSchema: { type: "object", properties: { header: { type: "string", description: "base64 x402 header value" }, json: { type: "object" } } } },
  { name: "eip712_decode", path: "/v1/eip712/decode", description: EP["/v1/eip712/decode"].desc, inputSchema: { type: "object", properties: { typedData: { type: "object" } }, required: ["typedData"] } },
  { name: "web_markdown", path: "/v1/web/markdown", description: EP["/v1/web/markdown"].desc, inputSchema: { type: "object", properties: { url: { type: "string" }, fullPage: { type: "boolean" }, maxChars: { type: "number" } }, required: ["url"] } },
  { name: "url_unfurl", path: "/v1/web/unfurl", description: EP["/v1/web/unfurl"].desc, inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "evm_address_lookup", path: "/v1/evm/address", description: EP["/v1/evm/address"].desc, inputSchema: { type: "object", properties: { address: { type: "string", description: "0x address or ENS name" } }, required: ["address"] } },
  { name: "domain_lookup", path: "/v1/domain/lookup", description: EP["/v1/domain/lookup"].desc, inputSchema: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] } },
  { name: "calldata_decode", path: "/v1/calldata/decode", description: EP["/v1/calldata/decode"].desc, inputSchema: { type: "object", properties: { data: { type: "string" }, signature: { type: "string" } }, required: ["data"] } },
];
const RQ = makeRequestHandlers({ base: BASE, tools: TOOLS.map((t) => ({ ...t, price: usd(EP[t.path]) })) });
const reqLimit = rateLimit({ windowMs: 3600_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Max 10 tool requests/hour/IP" } });
app.post("/v1/request-tool", reqLimit, run(RQ.requestTool));
app.get("/v1/requests/summary", (_q, r) => r.json(RQ.summary()));
const REQ_TOOL = { name: "request_a_tool", description: "FREE. Tell Lumen Works what you're blocked on. Describe your task and the capability you need; get back any existing Lumen Works tools that fit (with how to call them) plus a request id. Popular requests get built as paid x402 endpoints. Never include secrets/keys (requests containing them are rejected).", inputSchema: { type: "object", properties: { task: { type: "string" }, needed_capability: { type: "string" }, example_input: { type: "string" }, max_price_usdc: { type: "number" }, contact_optional: { type: "string" } } } };
const reqHits = new Map();
const mcpHits = new Map();
app.get("/mcp", (_q, r) => r.status(405).json({ error: "Use POST (MCP streamable HTTP, JSON responses)" }));
app.post("/mcp", async (q, r) => {
  const m = q.body || {}, id = m.id ?? null, ok = (result) => r.json({ jsonrpc: "2.0", id, result }), fail = (code, message, data) => r.json({ jsonrpc: "2.0", id, error: { code, message, data } });
  if (m.id === undefined) return r.status(202).end();
  if (m.method === "initialize") return ok({ protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "lumenworks-decoder", version: "1.2.0" }, instructions: "Free tier: 20 tool calls/hour/IP. Beyond that, call the x402-paid HTTP endpoints listed in each error (0.001-0.002 USD/call)." });
  if (m.method === "ping") return ok({});
  if (m.method === "tools/list") return ok({ tools: [...TOOLS.map(({ path, ...t }) => t), REQ_TOOL] });
  if (m.method === "tools/call" && m.params?.name === "request_a_tool") {
    const now = Date.now(), arr = (reqHits.get(q.ip) || []).filter((x) => now - x < 3600_000); if (arr.length >= 10) return ok({ isError: true, content: [{ type: "text", text: "Max 10 tool requests/hour" }] }); arr.push(now); reqHits.set(q.ip, arr);
    try { const out = await RQ.requestTool(m.params?.arguments || {}); return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out }); } catch (e) { return ok({ isError: true, content: [{ type: "text", text: e.message }] }); }
  }
  if (m.method === "tools/call") {
    const t = TOOLS.find((x) => x.name === m.params?.name); if (!t) return fail(-32602, "Unknown tool");
    const ip = q.ip, now = Date.now(), arr = (mcpHits.get(ip) || []).filter((x) => now - x < 3600_000);
    const paidHeader = q.get("payment-signature");
    if (arr.length >= 20 && !paidHeader) return ok({ isError: true, content: [{ type: "text", text: `Free tier exhausted (20/hour). Pay per call via x402: POST ${BASE}${t.path} with the same JSON arguments (${usd(EP[t.path])} USD, Base USDC${CELO_KEY ? " or Celo USAT/USDC" : ""}).` }], structuredContent: { x402: { resource: `${BASE}${t.path}`, accepts: mkAccepts(EP[t.path].price) } } });
    arr.push(now); mcpHits.set(ip, arr);
    try { const out = await EP[t.path].fn(m.params?.arguments || {}); return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out }); }
    catch (e) { return ok({ isError: true, content: [{ type: "text", text: e.message }] }); }
  }
  return fail(-32601, "Method not found");
});
app.use(paymentMiddleware(routes, new x402ResourceServer([new HTTPFacilitatorClient(facilitator), ...(CELO_KEY ? [new HTTPFacilitatorClient({ url: "https://api.x402.celo.org", createAuthHeaders: async () => { const h = { "X-API-Key": CELO_KEY }; return { verify: h, settle: h, supported: h }; } })] : [])]).register(NETWORK, new ExactEvmScheme()).register(CELO, new ExactEvmScheme())));
for (const [p, e] of Object.entries(EP)) app.post(p, run(e.fn));
app.use((_q, r) => r.status(404).json({ error: "Not found" }));
app.listen(PORT, process.env.HOST || "0.0.0.0", () => console.log("listening", PORT, BASE));
