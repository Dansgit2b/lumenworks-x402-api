/** Accuracy test set for /v1/tx/explain. `node test/accuracy.mjs` -> test/accuracy-results.json + prints table.
 * Expected verdicts are what a careful human reviewer would want, set BEFORE looking at output. */
import { encodeFunctionData, parseAbi, maxUint256, maxUint160 } from "viem";
import fs from "node:fs";
import { explainBeforeSign } from "../preflight.mjs";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3", UR = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af", INCH = "0x111111125421cA6dc452d289314280a0f8842A65";
const EVIL = "0x5e1f0000000000000000000000000000000bad01", PROXY = "0x9aa0000000000000000000000000000000c0ffee", NFT = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D", ME = "0x1111111111111111111111111111111111111111", PAYTO = "0xee9790cB3960952F585379F831a89b4e00B4029A";
const A = parseAbi(["function approve(address,uint256)", "function increaseAllowance(address,uint256)", "function setApprovalForAll(address,bool)", "function transfer(address,uint256)", "function transferFrom(address,address,uint256)", "function multicall(bytes[])", "function aggregate3((address,bool,bytes)[])", "function upgradeTo(address)", "function transferOwnership(address)", "function deposit()", "function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)"]);
const P2 = parseAbi(["function approve(address,address,uint160,uint48)"]);
const enc = (fn, args, abi = A) => encodeFunctionData({ abi, functionName: fn, args });
const now = Math.floor(Date.now() / 1000), tx = (to, data, value = "0") => ({ transaction: { to, data, value }, chainId: 8453 });
const permitTD = (spender, value, deadline, chainId = 8453) => ({ typedData: { domain: { name: "USD Coin", version: "2", chainId, verifyingContract: USDC }, primaryType: "Permit", types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, message: { owner: ME, spender, value: String(value), nonce: "0", deadline: String(deadline) } }, chainId: 8453 });
const p2TD = (spender, amount, expiration, sigDeadline) => ({ typedData: { domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2 }, primaryType: "PermitSingle", types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], PermitSingle: [{ name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }], PermitDetails: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }] }, message: { details: { token: USDC, amount: String(amount), expiration: String(expiration), nonce: "0" }, spender, sigDeadline: String(sigDeadline) } }, chainId: 8453 });
const eip3009 = (to, validBefore) => ({ typedData: { domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC }, primaryType: "TransferWithAuthorization", types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, message: { from: ME, to, value: "2000", validAfter: "0", validBefore: String(validBefore), nonce: "0x" + "ab".repeat(32) } }, chainId: 8453, expected_pay_to: PAYTO });
const seaport = (amt) => ({ typedData: { domain: { name: "Seaport", version: "1.6", chainId: 1, verifyingContract: "0x0000000000000068F116a894984e2DB1123eB395" }, primaryType: "OrderComponents", types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], OrderComponents: [{ name: "offerer", type: "address" }, { name: "consideration", type: "ConsiderationItem[]" }, { name: "endTime", type: "uint256" }], ConsiderationItem: [{ name: "itemType", type: "uint8" }, { name: "token", type: "address" }, { name: "startAmount", type: "uint256" }, { name: "recipient", type: "address" }] }, message: { offerer: ME, consideration: [{ itemType: 0, token: "0x0000000000000000000000000000000000000000", startAmount: String(amt), recipient: amt ? ME : EVIL }], endTime: String(now + 86400) } }, chainId: 1 });
const H = "do_not_sign_unless_intended", R = "review", OK = "looks_ok";
export const CASES = [
  // risky
  ["risky", "Unlimited USDC approve to unknown spender", tx(USDC, enc("approve", [EVIL, maxUint256])), H, ["UNLIMITED_APPROVAL", "UNKNOWN_SPENDER"]],
  ["risky", "Unlimited USDC approve to Permit2 (common, still unlimited)", tx(USDC, enc("approve", [PERMIT2, maxUint256])), H, ["UNLIMITED_APPROVAL"]],
  ["risky", "Unlimited increaseAllowance to unknown spender", tx(USDC, enc("increaseAllowance", [EVIL, maxUint256])), H, ["UNLIMITED_APPROVAL"]],
  ["risky", "setApprovalForAll(true) to unknown operator (NFT drainer)", tx(NFT, enc("setApprovalForAll", [EVIL, true])), H, ["APPROVAL_FOR_ALL"]],
  ["risky", "Permit2 PermitSingle unlimited to unknown spender (typed data)", p2TD(EVIL, maxUint160, now + 86400 * 30, now + 1800), H, ["UNLIMITED_PERMIT2", "UNKNOWN_SPENDER"]],
  ["risky", "On-chain Permit2 approve() unlimited to unknown spender", tx(PERMIT2, enc("approve", [USDC, EVIL, maxUint160, now + 86400], P2)), H, ["UNLIMITED_PERMIT2", "UNKNOWN_SPENDER"]],
  ["risky", "EIP-2612 Permit unlimited, deadline never", permitTD(EVIL, maxUint256, maxUint256), H, ["UNLIMITED_PERMIT", "LONG_DEADLINE"]],
  ["risky", "multicall wrapping an unlimited approve", tx(UR, enc("multicall", [[enc("approve", [EVIL, maxUint256])]])), H, ["BATCHED_CALL", "UNLIMITED_APPROVAL"]],
  ["risky", "aggregate3 wrapping setApprovalForAll", tx("0xcA11bde05977b3631167028862bE2a173976CA11", enc("aggregate3", [[[NFT, false, enc("setApprovalForAll", [EVIL, true])]]])), H, ["APPROVAL_FOR_ALL"]],
  ["risky", "Proxy contract as spender, limited amount (proxy not detectable statically)", tx(USDC, enc("approve", [PROXY, 50_000_000n])), R, ["UNKNOWN_SPENDER"]],
  ["risky", "Proxy contract as spender, unlimited", tx(USDC, enc("approve", [PROXY, maxUint256])), H, ["UNLIMITED_APPROVAL"]],
  ["risky", "upgradeTo (proxy admin call)", tx(PROXY, enc("upgradeTo", [EVIL])), H, ["ADMIN_CALL"]],
  ["risky", "transferOwnership to unknown address", tx(PROXY, enc("transferOwnership", [EVIL])), H, ["ADMIN_CALL"]],
  ["risky", "Seaport order with zero consideration (free-listing phish)", seaport(0), H, ["ZERO_PRICE_ORDER"]],
  ["risky", "x402 EIP-3009 payment to a different payTo than expected", eip3009(EVIL, now + 120), H, ["PAYTO_MISMATCH"]],
  ["risky", "Permit signed for another chain (chainId mismatch)", permitTD(INCH, 1_000_000n, now + 3600, 1), H, ["CHAIN_MISMATCH"]],
  ["risky", "Unknown selector ('claim rewards' style phishing)", tx(EVIL, "0x5f5e5e5e" + "00".repeat(32), "100000000000000000"), R, ["UNDECODED"]],
  ["risky", "transferFrom pulling tokens from another address", tx(USDC, enc("transferFrom", [ME, EVIL, 1_000_000n])), R, ["TRANSFER_FROM"]],
  // benign
  ["benign", "USDC transfer 10 USDC", tx(USDC, enc("transfer", [EVIL, 10_000_000n])), OK, []],
  ["benign", "Limited approve 100 USDC to 1inch v6 router", tx(USDC, enc("approve", [INCH, 100_000_000n])), OK, []],
  ["benign", "Revoke: approve(spender, 0)", tx(USDC, enc("approve", [EVIL, 0n])), OK, []],
  ["benign", "Revoke: setApprovalForAll(false)", tx(NFT, enc("setApprovalForAll", [EVIL, false])), OK, []],
  ["benign", "WETH deposit() with value", tx("0x4200000000000000000000000000000000000006", enc("deposit", []), "10000000000000000"), OK, []],
  ["benign", "x402 EIP-3009 payment to expected payTo, 2-min validity", eip3009(PAYTO, now + 120), OK, []],
  ["benign", "Permit 1 USDC to known router, 1h deadline", permitTD(INCH, 1_000_000n, now + 3600), OK, []],
  ["benign", "Permit2 PermitSingle limited to Universal Router, 30-day expiry", p2TD(UR, 5_000_000n, now + 86400 * 30, now + 1800), OK, []],
  // known limitations: ideal verdict listed; failures here are documented, not hidden
  ["limitation", "Universal Router execute() embedding an unlimited Permit2 permit", tx(UR, encodeFunctionData({ abi: parseAbi(["function execute(bytes,bytes[],uint256)"]), functionName: "execute", args: ["0x0a", ["0x" + "00".repeat(64)], BigInt(now + 600)] })), H, ["UNLIMITED_PERMIT2"]],
  ["limitation", "'Wallet migration' phish: transfer entire USDC balance to a fresh address", tx(USDC, enc("transfer", [EVIL, 25_000_000_000n])), R, []],
  ["limitation", "Approve on a fake look-alike 'USDC' token contract", tx("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA0291f", enc("approve", [INCH, 100_000_000n])), R, []],
  ["benign", "Seaport listing with real price", seaport(10n ** 17n), R, ["MARKET_ORDER"]],
];
const rows = [];
for (const [cls, name, input, expected, codes] of CASES) {
  const r = await explainBeforeSign(input), got = r.flags.map((f) => f.code);
  rows.push({ class: cls, name, expected, verdict: r.verdict, pass: r.verdict === expected, expectedFlags: codes, flags: got, missingFlags: codes.filter((c) => !got.includes(c)) });
}
const s = (c) => rows.filter((r) => r.class === c), pct = (a) => `${a.filter((r) => r.pass).length}/${a.length}`;
const lim = s("limitation");
const summary = { limitations: pct(lim), ranAt: new Date().toISOString(), total: rows.length, pass: rows.filter((r) => r.pass).length, risky: pct(s("risky")), benign: pct(s("benign")), riskyMissedAsLooksOk: s("risky").filter((r) => r.verdict === OK).length, benignEscalated: s("benign").filter((r) => !r.pass).length };
fs.writeFileSync(new URL("./accuracy-results.json", import.meta.url), JSON.stringify({ summary, rows }, null, 2));
for (const r of rows) console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.class} | ${r.name} | expected ${r.expected} | got ${r.verdict} | ${r.flags.join(",")}${r.missingFlags.length ? " | MISSING " + r.missingFlags : ""}`);
console.log(JSON.stringify(summary));
