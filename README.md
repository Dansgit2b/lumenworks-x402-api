# Lumen Works Decoder API (x402)
Pay-per-call decoders, 0.002 USDC per call on Base mainnet via x402 (exact scheme, PayAI public facilitator). Author: Dan ([Dansgit2b](https://github.com/Dansgit2b)). Early-stage, unaudited.

| Endpoint (POST JSON) | What |
|---|---|
| `/v1/x402/lint` `{header}` | decode + lint x402 PAYMENT-REQUIRED/SIGNATURE/RESPONSE |
| `/v1/eip712/decode` `{typedData}` | domain separator, digest, risk notes |
| `/v1/calldata/decode` `{data, signature?}` | selector, openchain/4byte lookup, decoded args |

Free tier: same paths under `/v1/free/...` (20/hour/IP). Discovery: `/`, `/.well-known/x402`, `/openapi.json`, `/llms.txt`.
payTo: `0xee9790cB3960952F585379F831a89b4e00B4029A`.

End-to-end proof (local run, 2026-10-10): paid call settled on Base, tx `0xff4af45df7caeef958b77700e96ba94e5ed37d3bac6e8cf40d6528a9497d77d4`.

Deploy: Render (render.yaml, free plan) or any Docker host (`Dockerfile`). Set `PUBLIC_BASE` to the public origin. No secrets needed (server only receives payments). License MIT.

## MCP server
Remote MCP (streamable HTTP, stateless JSON): `https://lumenworks-x402-decoder.onrender.com/mcp`, with tools `x402_lint`, `eip712_decode` and `calldata_decode`. Free tier: 20 tool calls/hour/IP. After that the tool returns the x402 payment requirements for the matching paid HTTP endpoint (0.002 USD).

## Celo
When `X402_CELO_API_KEY` (from the x402.celo.org dashboard) is set, every paid route also accepts USA₮ and USDC on Celo (`eip155:42220`), settled through Celo's hosted facilitator at api.x402.celo.org.
