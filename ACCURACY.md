# Lumen Pre-Sign Check (`POST /v1/tx/explain`): accuracy and limits

> **Informational, not a security guarantee; `looks_ok` does not mean safe; no simulation.**

Test set: `test/accuracy.mjs` (run `node test/accuracy.mjs`; raw output in `test/accuracy-results.json`). Run on 2026-10-10 12:49 UTC.

| Set | Result |
|---|---|
| Risky patterns (unlimited approve, Permit/Permit2, setApprovalForAll, proxy spenders, multicall/aggregate3, admin calls, Seaport zero-price, x402 payTo mismatch, chain mismatch, unknown selector, transferFrom) | **18/18** correct verdict, 0 risky case scored `looks_ok` |
| Benign (transfers, limited approvals to known routers, revokes, WETH deposit, matching x402 payment, short permits) | **9/9** correct, 0 escalated |
| Known limitations (ideal verdict listed; expected to fail) | 0/3 |

**Read this honestly:** the cases were written by the same author as the rules, and two fixes (multicall/aggregate3 inner decoding, `approve(x, 0)` treated as a revoke, no-arg functions like `deposit()`) were made while building the set. This is a regression suite for documented behaviour, not an independent benchmark. A real-world false-negative rate is unknown.

| | Class | Case | Expected | Got | Flags |
|---|---|---|---|---|---|
| ✅ | risky | Unlimited USDC approve to unknown spender | do_not_sign_unless_intended | do_not_sign_unless_intended | UNLIMITED_APPROVAL, UNKNOWN_SPENDER |
| ✅ | risky | Unlimited USDC approve to Permit2 (common, still unlimited) | do_not_sign_unless_intended | do_not_sign_unless_intended | UNLIMITED_APPROVAL |
| ✅ | risky | Unlimited increaseAllowance to unknown spender | do_not_sign_unless_intended | do_not_sign_unless_intended | UNLIMITED_APPROVAL |
| ✅ | risky | setApprovalForAll(true) to unknown operator (NFT drainer) | do_not_sign_unless_intended | do_not_sign_unless_intended | APPROVAL_FOR_ALL |
| ✅ | risky | Permit2 PermitSingle unlimited to unknown spender (typed data) | do_not_sign_unless_intended | do_not_sign_unless_intended | UNLIMITED_PERMIT2, UNKNOWN_SPENDER |
| ✅ | risky | On-chain Permit2 approve() unlimited to unknown spender | do_not_sign_unless_intended | do_not_sign_unless_intended | UNLIMITED_PERMIT2, UNKNOWN_SPENDER |
| ✅ | risky | EIP-2612 Permit unlimited, deadline never | do_not_sign_unless_intended | do_not_sign_unless_intended | UNLIMITED_PERMIT, LONG_DEADLINE |
| ✅ | risky | multicall wrapping an unlimited approve | do_not_sign_unless_intended | do_not_sign_unless_intended | BATCHED_CALL, UNLIMITED_APPROVAL, UNKNOWN_SPENDER |
| ✅ | risky | aggregate3 wrapping setApprovalForAll | do_not_sign_unless_intended | do_not_sign_unless_intended | BATCHED_CALL, APPROVAL_FOR_ALL |
| ✅ | risky | Proxy contract as spender, limited amount (proxy not detectable statically) | review | review | UNKNOWN_SPENDER |
| ✅ | risky | Proxy contract as spender, unlimited | do_not_sign_unless_intended | do_not_sign_unless_intended | UNLIMITED_APPROVAL, UNKNOWN_SPENDER |
| ✅ | risky | upgradeTo (proxy admin call) | do_not_sign_unless_intended | do_not_sign_unless_intended | ADMIN_CALL |
| ✅ | risky | transferOwnership to unknown address | do_not_sign_unless_intended | do_not_sign_unless_intended | ADMIN_CALL |
| ✅ | risky | Seaport order with zero consideration (free-listing phish) | do_not_sign_unless_intended | do_not_sign_unless_intended | MARKET_ORDER, ZERO_PRICE_ORDER |
| ✅ | risky | x402 EIP-3009 payment to a different payTo than expected | do_not_sign_unless_intended | do_not_sign_unless_intended | PAYTO_MISMATCH |
| ✅ | risky | Permit signed for another chain (chainId mismatch) | do_not_sign_unless_intended | do_not_sign_unless_intended | CHAIN_MISMATCH |
| ✅ | risky | Unknown selector ('claim rewards' style phishing) | review | review | UNDECODED |
| ✅ | risky | transferFrom pulling tokens from another address | review | review | TRANSFER_FROM |
| ✅ | benign | USDC transfer 10 USDC | looks_ok | looks_ok | – |
| ✅ | benign | Limited approve 100 USDC to 1inch v6 router | looks_ok | looks_ok | – |
| ✅ | benign | Revoke: approve(spender, 0) | looks_ok | looks_ok | – |
| ✅ | benign | Revoke: setApprovalForAll(false) | looks_ok | looks_ok | – |
| ✅ | benign | WETH deposit() with value | looks_ok | looks_ok | – |
| ✅ | benign | x402 EIP-3009 payment to expected payTo, 2-min validity | looks_ok | looks_ok | – |
| ✅ | benign | Permit 1 USDC to known router, 1h deadline | looks_ok | looks_ok | – |
| ✅ | benign | Permit2 PermitSingle limited to Universal Router, 30-day expiry | looks_ok | looks_ok | – |
| ❌ | limitation | Universal Router execute() embedding an unlimited Permit2 permit | do_not_sign_unless_intended | review | BATCHED_CALL |
| ❌ | limitation | 'Wallet migration' phish: transfer entire USDC balance to a fresh address | review | looks_ok | – |
| ❌ | limitation | Approve on a fake look-alike 'USDC' token contract | review | looks_ok | – |
| ✅ | benign | Seaport listing with real price | review | review | MARKET_ORDER |

## What it does
Static decoding of calldata (built-in selectors for approve/permit/Permit2/setApprovalForAll/multicall/aggregate3/admin calls, then openchain/4byte) and EIP-712 typed data (Permit, PermitSingle/Batch, PermitTransferFrom, EIP-3009, Seaport orders). Deterministic rules map to flags (high/medium/low); verdict = worst flag (high → `do_not_sign_unless_intended`, medium → `review`, else `looks_ok`).

## Limits (not detected)
- **No simulation and no on-chain reads.** It cannot see balances, proxy implementations, spender bytecode, token legitimacy, or what a contract will actually do.
- **Proxy spenders** are only flagged as "unknown spender"; we cannot tell a proxy from any other contract.
- **Universal Router `execute`, Safe `multiSend`, 1inch/0x swap payloads** are not decoded inside (flagged `BATCHED_CALL` → `review`).
- **Look-alike tokens / address poisoning / "migrate your wallet" full-balance transfers** score `looks_ok` (no reputation or balance data).
- `eth_sign` / `personal_sign` raw messages, Solana and non-EVM transactions are out of scope.
- Known-address list is short (Permit2, Uniswap Universal Router, 1inch, 0x, USDC/USDT); everything else is "unknown".
- Selector lookups depend on openchain/4byte availability; collisions are possible for unknown selectors.
