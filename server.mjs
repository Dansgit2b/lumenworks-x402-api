/** Lumen Works Web3 Decoder API — x402-paid (USDC on Base, PayAI public facilitator). Author: Dan (GitHub Dansgit2b). */
import express from "express";
import rateLimit from "express-rate-limit";
import { facilitator } from "@payai/facilitator";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { lintX402, decodeEip712, decodeCalldata } from "./decoders.mjs";
import { x402SafetyCheck } from "./safety.mjs";
import { explainBeforeSign } from "./preflight.mjs";
import { pubmedSearch, arxivSearch, secFilings, weather, polymarketMarkets } from "./data.mjs";
import { createFacilitatorConfig } from "@coinbase/x402";
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
  "/v1/tx/explain": { fn: explainBeforeSign, tags: ["wallet", "security", "calldata", "eip712", "permit", "preflight"], desc: "Explain before you sign: decode a transaction's calldata (to/data/value) and/or EIP-712 typed data in one call, with a plain-language summary and risk flags (unlimited approve/permit/Permit2, setApprovalForAll, unknown spender, zero-price orders, long deadlines, chain or payTo mismatch) and verdict looks_ok/review/do_not_sign_unless_intended.", ex: { transaction: { to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: "0x095ea7b3...", value: "0" }, typedData: null, chainId: 8453 } },
  "/v1/pubmed/search": { fn: pubmedSearch, price: "1000", tags: ["pubmed", "biomedical", "research", "papers", "science"], desc: "Search PubMed (36M+ biomedical citations): PMID, title, journal, date, authors, DOI, URL and abstract. {query, limit<=50, sort:relevance|date, abstracts:true}.", ex: { query: "GLP-1 obesity", limit: 5 } },
  "/v1/arxiv/search": { fn: arxivSearch, price: "1000", tags: ["arxiv", "papers", "research", "science", "academic"], desc: "Search arXiv preprints: id, title, abstract, authors, categories, dates, PDF link. Supports arXiv field prefixes (ti:, au:, cat:). {query, limit<=50, sort:relevance|date}.", ex: { query: "LLM agents tool use", limit: 5 } },
  "/v1/sec/filings": { fn: secFilings, price: "1000", tags: ["sec", "edgar", "finance", "filings", "10-k", "stocks"], desc: "SEC EDGAR company lookup by ticker or CIK: company profile, recent filings (filter by form e.g. 10-K, 10-Q, 8-K, 4) with document links, and latest annual XBRL facts (revenue, net income, assets, liabilities, equity, EPS, cash).", ex: { ticker: "AAPL", forms: ["10-K", "10-Q"], limit: 10 } },
  "/v1/weather/forecast": { fn: weather, price: "1000", tags: ["weather", "forecast", "geocoding", "climate"], desc: "Weather for any place name or lat/lon (Open-Meteo): current conditions plus up to 16-day daily forecast (temp min/max, precipitation and probability, wind, UV, sunrise/sunset). {location | latitude+longitude, days, units:metric|imperial}.", ex: { location: "Berlin", days: 3 } },
  "/v1/polymarket/markets": { fn: polymarketMarkets, price: "1000", tags: ["polymarket", "prediction-markets", "probabilities", "data"], desc: "Read-only Polymarket prediction-market data: search by {query} or top active markets by 24h volume. Returns question, outcomes with implied probabilities, 24h/total volume, liquidity, end date, URL. Data only, no trading.", ex: { query: "election", limit: 5 } },
};
const CDP_ID = process.env.CDP_API_KEY_ID || "", CDP_SECRET = process.env.CDP_API_KEY_SECRET || "";
const cdpFac = CDP_ID && CDP_SECRET ? createFacilitatorConfig(CDP_ID, CDP_SECRET) : null;
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
const STATS = { since: new Date().toISOString(), endpoints: {}, sources: {} };
const bucket = (ua = "") => /claude|anthropic/i.test(ua) ? "claude" : /openai|gpt|chatgpt/i.test(ua) ? "openai" : /cursor/i.test(ua) ? "cursor" : /x402|axios|node|undici|python|httpx|requests|aiohttp|go-http|curl/i.test(ua) ? (ua.match(/x402|axios|node|undici|python|httpx|requests|aiohttp|go-http|curl/i)[0].toLowerCase()) : /bot|crawl|spider|scan/i.test(ua) ? "crawler" : /mozilla/i.test(ua) ? "browser" : ua ? "other" : "none";
app.use((q, r, next) => { if (q.method === "GET" && !q.path.startsWith("/v1/")) return next(); const key = `${q.method} ${q.path.startsWith("/v1/request") ? "/v1/request" : q.path}`.slice(0, 80); const src = bucket(q.get("user-agent")); const paidAttempt = !!(q.get("payment-signature") || q.get("x-payment"));
  r.on("finish", () => { const e = STATS.endpoints[key] ||= { calls: 0, unpaid402: 0, paidAttempts: 0, paidOk: 0, free: 0, errors: 0 }; if (Object.keys(STATS.endpoints).length > 200 && e.calls === 0) return; e.calls++; if (r.statusCode === 402) e.unpaid402++; if (paidAttempt) { e.paidAttempts++; if (r.statusCode < 300) e.paidOk++; } if (q.path.startsWith("/v1/free") || q.path === "/mcp" || q.path === "/v1/x402/safety-check") e.free++; if (r.statusCode >= 400 && r.statusCode !== 402) e.errors++; STATS.sources[src] = (STATS.sources[src] || 0) + 1; }); next(); });
app.get("/v1/stats", (_q, r) => { const t = Object.values(STATS.endpoints).reduce((a, e) => ({ unpaid402: a.unpaid402 + e.unpaid402, paidOk: a.paidOk + e.paidOk }), { unpaid402: 0, paidOk: 0 }); r.json({ ...STATS, totals: { ...t, conversion402ToPaid: t.unpaid402 ? +(t.paidOk / t.unpaid402).toFixed(4) : null }, note: "Anonymous in-memory counters since last restart (no IPs, no bodies stored)." }); });
const discovery = () => ({ name: "Lumen Works Decoder API", author: "Dan (GitHub: Dansgit2b)", description: "Pay-per-call agent utilities: explain-before-you-sign (calldata+EIP-712 risk flags), PubMed, arXiv, SEC EDGAR, weather, Polymarket data, x402/EIP-712/calldata decoders, web page to Markdown, URL unfurl, EVM address/ENS lookup, domain DNS+RDAP.", prices: Object.fromEntries(Object.entries(EP).map(([p, e]) => [p, usd(e)])), network: NETWORK, networks: [NETWORK, ...(CELO_KEY ? [CELO] : [])], celoAssets: CELO_KEY ? ["USAT", "USDC"] : [], mcp: `${BASE}/mcp`, asset: USDC, payTo: PAY_TO, priceUsdc: PRICE_USD, facilitator: cdpFac ? cdpFac.url : facilitator.url, facilitators: [...(cdpFac ? [cdpFac.url] : []), facilitator.url], resources: Object.keys(EP).map((p) => `${BASE}${p}`), freeTier: "POST /v1/free/<same path> — 20 calls/hour/IP, no payment", monitoringWaitlist: `POST ${BASE}/v1/monitoring/waitlist (free)`, x402SafetyCheck: `POST ${BASE}/v1/x402/safety-check (free)`, stats: `${BASE}/v1/stats`, openapi: `${BASE}/openapi.json`, llms: `${BASE}/llms.txt` });
app.get("/", (_q, r) => r.json(discovery()));
app.get("/.well-known/x402", (_q, r) => r.json({ version: 1, ...discovery() }));
app.get("/health", (_q, r) => r.json({ ok: true }));
app.get("/llms.txt", (_q, r) => r.type("text/plain").send(`# Lumen Works API\n> x402-paid agent utilities (0.001-0.002 USDC/call on Base). Author: Dan (github.com/Dansgit2b).\n\n${Object.entries(EP).map(([p, e]) => `- POST ${BASE}${p} (${usd(e)} USDC) — ${e.desc} Body: ${JSON.stringify(e.ex)}`).join("\n")}\n\nFree tier: POST ${BASE}/v1/free/... (20/hour/IP). FREE x402 payment safety check: POST ${BASE}/v1/x402/safety-check {url | payment_required, expected_pay_to?, max_price_usdc?, client_config?}. Anonymous stats: ${BASE}/v1/stats. OpenAPI: ${BASE}/openapi.json\n`));
app.get("/openapi.json", (_q, r) => r.json({ openapi: "3.1.0", info: { title: "Lumen Works Decoder API", version: "1.2.0", description: "x402-paid agent utilities. Author Dan (Dansgit2b)." }, servers: [{ url: BASE }], paths: Object.fromEntries(Object.entries(EP).map(([p, e]) => [p, { post: { operationId: p.replace(/\W+/g, "_"), summary: e.desc, "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: usd(e) }, protocols: [{ x402: { network: NETWORK, asset: USDC, payTo: PAY_TO } }] }, requestBody: { content: { "application/json": { schema: { type: "object" }, example: e.ex } } }, responses: { 200: { description: "Decoded" }, 402: { description: "Payment Required (x402 v2)" } } } }])) }));
const run = (fn) => async (q, r) => { try { r.json(await fn(q.body)); } catch (e) { r.status(e.status || 400).json({ error: e.message, charged: false }); } };
const freeLimit = rateLimit({ windowMs: 3600_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Free tier exhausted (20/h). Use paid endpoint." } });
for (const [p, e] of Object.entries(EP)) if (!e.noFree) app.post(`/v1/free${p.slice(3)}`, freeLimit, run(e.fn));
const TOOLS = [
  { name: "x402_lint", path: "/v1/x402/lint", description: EP["/v1/x402/lint"].desc, inputSchema: { type: "object", properties: { header: { type: "string", description: "base64 x402 header value" }, json: { type: "object" } } } },
  { name: "eip712_decode", path: "/v1/eip712/decode", description: EP["/v1/eip712/decode"].desc, inputSchema: { type: "object", properties: { typedData: { type: "object" } }, required: ["typedData"] } },
  { name: "web_markdown", path: "/v1/web/markdown", description: EP["/v1/web/markdown"].desc, inputSchema: { type: "object", properties: { url: { type: "string" }, fullPage: { type: "boolean" }, maxChars: { type: "number" } }, required: ["url"] } },
  { name: "url_unfurl", path: "/v1/web/unfurl", description: EP["/v1/web/unfurl"].desc, inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "evm_address_lookup", path: "/v1/evm/address", description: EP["/v1/evm/address"].desc, inputSchema: { type: "object", properties: { address: { type: "string", description: "0x address or ENS name" } }, required: ["address"] } },
  { name: "domain_lookup", path: "/v1/domain/lookup", description: EP["/v1/domain/lookup"].desc, inputSchema: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] } },
  { name: "explain_before_sign", path: "/v1/tx/explain", description: "Explain before you sign", inputSchema: { type: "object", properties: { transaction: { type: "object", properties: { to: { type: "string" }, data: { type: "string" }, value: { type: "string" } } }, typedData: { type: "object" }, chainId: { type: "number" }, expected_pay_to: { type: "string" } } } },
  { name: "pubmed_search", path: "/v1/pubmed/search", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" }, sort: { type: "string", enum: ["relevance", "date"] }, abstracts: { type: "boolean" } }, required: ["query"] } },
  { name: "arxiv_search", path: "/v1/arxiv/search", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" }, sort: { type: "string", enum: ["relevance", "date"] } }, required: ["query"] } },
  { name: "sec_filings", path: "/v1/sec/filings", inputSchema: { type: "object", properties: { ticker: { type: "string" }, cik: { type: "string" }, forms: { type: "array", items: { type: "string" } }, limit: { type: "number" }, facts: { type: "boolean" } } } },
  { name: "weather_forecast", path: "/v1/weather/forecast", inputSchema: { type: "object", properties: { location: { type: "string" }, latitude: { type: "number" }, longitude: { type: "number" }, days: { type: "number" }, units: { type: "string", enum: ["metric", "imperial"] } } } },
  { name: "polymarket_markets", path: "/v1/polymarket/markets", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } } },
  { name: "calldata_decode", path: "/v1/calldata/decode", description: EP["/v1/calldata/decode"].desc, inputSchema: { type: "object", properties: { data: { type: "string" }, signature: { type: "string" } }, required: ["data"] } },
];
for (const t of TOOLS) t.description = EP[t.path].desc;
const mcpHits = new Map();
const safetyLimit = rateLimit({ windowMs: 3600_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Free safety check limit: 30/hour/IP" } });
app.post("/v1/x402/safety-check", safetyLimit, run(x402SafetyCheck));
const WAIT = []; const waitLimit = rateLimit({ windowMs: 3600_000, limit: 5, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Waitlist: max 5/hour/IP" } });
app.post("/v1/monitoring/waitlist", waitLimit, run(async (b) => {
  const contact = typeof b?.contact === "string" ? b.contact.trim().slice(0, 120) : "", endpoint = typeof b?.endpoint_url === "string" ? b.endpoint_url.trim().slice(0, 300) : "";
  if (!contact && !endpoint) throw Object.assign(new Error("Provide endpoint_url (x402 endpoint to monitor) and/or contact (email/handle)"), { status: 400 });
  if (endpoint && !/^https:\/\//.test(endpoint)) throw Object.assign(new Error("endpoint_url must be https://"), { status: 400 });
  if (/0x[0-9a-fA-F]{64}|PRIVATE KEY|gh[pousr]_|sk[-_][A-Za-z0-9]{16}/.test(contact + endpoint)) throw Object.assign(new Error("Rejected: looks like a secret. Nothing stored."), { status: 422 });
  WAIT.push({ at: new Date().toISOString().slice(0, 10), contact, endpoint }); if (WAIT.length > 500) WAIT.shift();
  console.log("WAITLIST", JSON.stringify({ contact, endpoint }));
  return { ok: true, position: WAIT.length, note: "Free waitlist for planned x402 endpoint monitoring (alerts on price/payTo/asset changes, downtime). Not built yet; no date promised. Stored only in memory and service logs on a free host, so it may be lost on restart." };
}));
const SAFETY_TOOL = { name: "x402_payment_safety_check", description: "FREE, deterministic pre-payment check for an x402 endpoint. Give {url} (we fetch its unpaid 402) and/or {payment_required} (402 JSON or base64 header), plus optional expected_pay_to, expected_network, max_price_usdc, listed_price_usdc, facilitator_url, client_config {max_per_call_usdc, max_daily_usdc, idempotency_key, allow_any_pay_to}. Returns verdict ok/review/do_not_pay with checks: HTTPS/health, payTo validity & mismatch, unknown asset/network, price sanity vs cap/listing, timeout/replay window, multiple payTo, unknown facilitator, missing spend caps/idempotency. Nothing is stored; inputs that look like private keys are rejected.", inputSchema: { type: "object", properties: { url: { type: "string" }, method: { type: "string", enum: ["POST", "GET"] }, payment_required: {}, expected_pay_to: { type: "string" }, expected_network: { type: "string" }, max_price_usdc: { type: "number" }, listed_price_usdc: { type: "number" }, facilitator_url: { type: "string" }, client_config: { type: "object" } } } };
app.get("/mcp", (_q, r) => r.status(405).json({ error: "Use POST (MCP streamable HTTP, JSON responses)" }));
app.post("/mcp", async (q, r) => {
  const m = q.body || {}, id = m.id ?? null, ok = (result) => r.json({ jsonrpc: "2.0", id, result }), fail = (code, message, data) => r.json({ jsonrpc: "2.0", id, error: { code, message, data } });
  if (m.id === undefined) return r.status(202).end();
  if (m.method === "initialize") return ok({ protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "lumenworks-decoder", version: "1.3.0" }, instructions: "Free tier: 20 tool calls/hour/IP. Beyond that, call the x402-paid HTTP endpoints listed in each error (0.001-0.002 USD/call)." });
  if (m.method === "ping") return ok({});
  if (m.method === "tools/list") return ok({ tools: [...TOOLS.map(({ path, ...t }) => t), SAFETY_TOOL] });
  if (m.method === "tools/call" && m.params?.name === SAFETY_TOOL.name) { try { const out = await x402SafetyCheck(m.params?.arguments || {}); return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out }); } catch (e) { return ok({ isError: true, content: [{ type: "text", text: e.message }] }); } }
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
app.use(paymentMiddleware(routes, new x402ResourceServer([...(cdpFac ? [new HTTPFacilitatorClient(cdpFac)] : []), new HTTPFacilitatorClient(facilitator), ...(CELO_KEY ? [new HTTPFacilitatorClient({ url: "https://api.x402.celo.org", createAuthHeaders: async () => { const h = { "X-API-Key": CELO_KEY }; return { verify: h, settle: h, supported: h }; } })] : [])]).register(NETWORK, new ExactEvmScheme()).register(CELO, new ExactEvmScheme()).registerExtension(bazaarResourceServerExtension)));
for (const [p, e] of Object.entries(EP)) app.post(p, run(e.fn));
app.use((_q, r) => r.status(404).json({ error: "Not found" }));
app.listen(PORT, process.env.HOST || "0.0.0.0", () => console.log("listening", PORT, BASE));
