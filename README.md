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
