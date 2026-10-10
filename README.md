# Lumen Works API (x402)
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

Planned (not built): continuous monitoring with alerts on price/payTo/asset changes. `POST /v1/monitoring/early-access` takes a 1 USDC x402 early-access deposit to signal demand; no delivery date is promised.

## Stats
`GET /v1/stats` — anonymous in-memory counters since last restart: calls per endpoint, unpaid 402s vs paid settlements (conversion), coarse user-agent buckets. No IPs or bodies stored.
