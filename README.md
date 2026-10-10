# Lumen Works Agent API (x402)

Two listings on one origin:
- **Lumen Pre-Sign Check**: `POST /v1/tx/explain` ($0.002). Use before signing any EVM transaction or EIP-712 message; returns `{summary[], flags[], verdict}` with `looks_ok | review | do_not_sign_unless_intended`. Agent policy: abort on `do_not_sign_unless_intended`, escalate `review`. **Informational, not a security guarantee; looks_ok does not mean safe; no simulation.** Accuracy set and known limits: [ACCURACY.md](ACCURACY.md). MCP: `/mcp/presign`.
- **Lumen Agent Utilities**: every other route below. MCP: `/mcp`.

Trust terms: no signup; free tier 20 calls/hour/IP under `/v1/free/...`; `GET`/`HEAD` on any paid path returns the 402 quote (it never settles); **not charged when a call errors**, because the x402 middleware settles only after the handler returns a status below 400. Input schemas and real example outputs (`examples.json`, captured live by `test/capture-examples.mjs`) are in each route's Bazaar extension and in `/openapi.json`, validated with `node test/validate-bazaar.mjs <base>`.

Stats: `/v1/stats` has anonymous aggregates only (UA family, daily unique counts from salted daily-rotating IP hashes, 30-day retention). They persist across deploys when `STATS_GIST_ID` + `STATS_GIST_TOKEN` (a gist-only token) are set; otherwise they are kept in memory.

Pay-per-call agent utilities, 0.001–0.002 USDC per call on Base mainnet via x402 (exact scheme, PayAI public facilitator). Author: Dan ([Dansgit2b](https://github.com/Dansgit2b)). Early-stage, unaudited.

| Endpoint (POST JSON) | What |
|---|---|
| `/v1/x402/lint` `{header}` | decode + lint x402 PAYMENT-REQUIRED/SIGNATURE/RESPONSE |
| `/v1/eip712/decode` `{typedData}` | domain separator, digest, risk notes |
| `/v1/calldata/decode` `{data, signature?}` | selector, openchain/4byte lookup, decoded args |
| `/v1/web/markdown` `{url, fullPage?, maxChars?}` — $0.001 | public page → clean Markdown (Readability) + metadata. No JS rendering. |
| `/v1/web/unfurl` `{url}` — $0.001 | final URL, status, title, description, OG image, canonical, favicon |
| `/v1/evm/address` `{address}` (0x or ENS) — $0.002 | Ethereum+Base: ENS + records, EOA/contract/7702, balances, USDC/USDT, ERC-20 info (public RPC) |
| `/v1/domain/lookup` `{domain}` — $0.002 | DNS (DoH) A/AAAA/MX/NS/TXT/CAA, SPF/DMARC, RDAP registrar/created/expiry, age |

Free tier: same paths under `/v1/free/...` (20/hour/IP). Discovery: `/`, `/.well-known/x402`, `/openapi.json`, `/llms.txt`.
payTo: `0xee9790cB3960952F585379F831a89b4e00B4029A`.

End-to-end proof (local run, 2026-10-10): paid call settled on Base, tx `0xff4af45df7caeef958b77700e96ba94e5ed37d3bac6e8cf40d6528a9497d77d4`.

Deploy: Render (render.yaml, free plan) or any Docker host (`Dockerfile`). Set `PUBLIC_BASE` to the public origin. No secrets needed (server only receives payments). License MIT.

## MCP server
Remote MCP (streamable HTTP, stateless JSON): `https://lumenworks-x402-decoder.onrender.com/mcp`, with tools `x402_lint`, `eip712_decode`, `calldata_decode`, `web_markdown`, `url_unfurl`, `evm_address_lookup` and `domain_lookup`. Free tier: 20 tool calls/hour/IP. After that the tool returns the x402 payment requirements for the matching paid HTTP endpoint (0.001–0.002 USD).

## Celo
When `X402_CELO_API_KEY` (from the x402.celo.org dashboard) is set, every paid route also accepts USA₮ and USDC on Celo (`eip155:42220`), settled through Celo's hosted facilitator at api.x402.celo.org.

## Free x402 payment safety check
`POST /v1/x402/safety-check` (MCP tool `x402_payment_safety_check`) — deterministic pre-payment check. Body: `{url?, method?, payment_required?, expected_pay_to?, expected_network?, max_price_usdc?, listed_price_usdc?, facilitator_url?, client_config?}`. We fetch the unpaid 402 (SSRF-guarded) and return `ok | review | do_not_pay` with checks: HTTPS/health/latency, payTo validity/checksum/mismatch, unknown asset/network, price vs your cap and the listed price, timeout/replay window, multiple payTo, unknown facilitator, missing spend caps / idempotency in your client config. Nothing is stored; inputs that look like private keys are rejected. 30/hour/IP.

Planned (not built): continuous monitoring with alerts on price/payTo/asset changes. Free waitlist: `POST /v1/monitoring/waitlist {endpoint_url, contact?}` (5/hour/IP). No date promised; stored in memory/logs only on a free host, so it may be lost on restart.

## Stats
`GET /v1/stats` — anonymous in-memory counters since last restart: calls per endpoint, unpaid 402s vs paid settlements (conversion), coarse user-agent buckets. No IPs or bodies stored.

## v1.3: explain-before-you-sign + public-data tools
| Endpoint (POST) | Price | MCP tool | Upstream (free, no key) |
|---|---|---|---|
| `/v1/tx/explain` | 0.002 | `explain_before_sign` | calldata (openchain/4byte) + EIP-712, risk flags |
| `/v1/pubmed/search` | 0.001 | `pubmed_search` | NCBI E-utilities |
| `/v1/arxiv/search` | 0.001 | `arxiv_search` | arXiv API |
| `/v1/sec/filings` | 0.001 | `sec_filings` | SEC EDGAR (set `SEC_USER_AGENT` with a contact email per SEC policy) |
| `/v1/weather/forecast` | 0.001 | `weather_forecast` | Open-Meteo (CC BY 4.0) |
| `/v1/polymarket/markets` | 0.001 | `polymarket_markets` | Polymarket Gamma (read-only data) |

Free tier: `/v1/free/<path>` or MCP, 20 calls/hour/IP.

### Facilitators
If `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are set, Coinbase's CDP facilitator is used first. Settlements through it are what get the service indexed in the x402 Bazaar. The PayAI facilitator stays registered as the fallback. Without CDP keys, PayAI handles everything, as before.
