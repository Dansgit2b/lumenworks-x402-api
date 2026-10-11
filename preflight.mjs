/** Explain-before-you-sign: decode calldata and/or EIP-712 typed data and flag risks. Deterministic, no keys. */
import { decodeCalldata, decodeEip712 } from "./decoders.mjs";
const MAX = 2n ** 255n, BIG = 2n ** 128n;
const big = (v) => { try { return BigInt(v); } catch { return null; } };
const isUnlimited = (v) => { const b = big(v); return b !== null && b >= BIG; };
const KNOWN = { "0x000000000022d473030f116ddee9f6b43ac78ba3": "Uniswap Permit2", "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": "Uniswap Universal Router", "0x66a9893cc07d91d95644aedd05d03f95e1dba8af": "Uniswap Universal Router v4", "0x1111111254eeb25477b68fb85ed929f73a960582": "1inch v5 Router", "0x111111125421ca6dc452d289314280a0f8842a65": "1inch v6 Router", "0xdef1c0ded9bec7f1a1670819833240f027b25eff": "0x Exchange Proxy", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC (Base)", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC (Ethereum)", "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT (Ethereum)" };
const LOCAL_SIGS = { "0x095ea7b3": "approve(address,uint256)", "0x39509351": "increaseAllowance(address,uint256)", "0xa22cb465": "setApprovalForAll(address,bool)", "0xa9059cbb": "transfer(address,uint256)", "0x23b872dd": "transferFrom(address,address,uint256)", "0x42842e0e": "safeTransferFrom(address,address,uint256)", "0xd505accf": "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", "0x87517c45": "approve(address,address,uint160,uint48)", "0xac9650d8": "multicall(bytes[])", "0x5ae401dc": "multicall(uint256,bytes[])", "0x82ad56cb": "aggregate3((address,bool,bytes)[])", "0x3659cfe6": "upgradeTo(address)", "0x4f1ef286": "upgradeToAndCall(address,bytes)", "0xf2fde38b": "transferOwnership(address)", "0x715018a6": "renounceOwnership()", "0xd0e30db0": "deposit()", "0x2e1a7d4d": "withdraw(uint256)" };
const MAX160 = 2n ** 159n;
const label = (a) => (a && KNOWN[String(a).toLowerCase()]) || null;
export async function explainBeforeSign(input = {}) {
  const flags = [], add = (level, code, msg) => flags.push({ level, code, msg });
  const out = { kind: null, summary: [], flags };
  const tx = input.transaction || input.tx || input;
  const data = tx.data || tx.calldata || input.calldata;
  const td = input.typedData || input.typed_data;
  if (!data && !td) throw Object.assign(new Error("Provide {calldata|transaction:{to,data,value}} and/or {typedData}"), { status: 400 });
  if (data) {
    out.kind = "transaction";
    const sel = String(data).slice(0, 10).toLowerCase();
    const d = await decodeCalldata({ data, signature: input.signature || LOCAL_SIGS[sel] }); if (!input.signature && LOCAL_SIGS[sel]) d.source = "built-in"; out.calldata = d;
    const to = tx.to, value = big(tx.value || 0) || 0n;
    out.to = to || null; out.toLabel = label(to); out.valueWei = value.toString();
    if (value > 0n) out.summary.push(`Sends ${Number(value) / 1e18} native coin${to ? ` to ${to}` : ""}`);
    if (!d.decoded) add(d.signaturesFound ? "high" : "medium", "UNDECODED", `Selector ${d.selector} ${d.signaturesFound ? "matched signatures but args did not decode" : "is unknown in public signature DBs"}. Do not sign blind.`);
    const sig = d.decoded?.signature || "", a = d.decoded?.args || [], fn = sig.split("(")[0];
    if (fn === "approve" && a.length === 2) { out.summary.push(`Approve ${a[0]}${label(a[0]) ? ` (${label(a[0])})` : ""} to spend ${isUnlimited(a[1]) ? "UNLIMITED" : a[1]} units of token ${to || "?"}`); if (isUnlimited(a[1])) add("high", "UNLIMITED_APPROVAL", "Unlimited token approval: spender can drain this token at any time."); if (big(a[1]) === 0n) out.summary.push("(amount 0 = revoking the allowance)"); else if (!label(a[0])) add("medium", "UNKNOWN_SPENDER", "Spender is not a well-known router/contract; verify it."); }
    if (fn === "increaseAllowance") { out.summary.push(`Increase allowance of ${a[0]} by ${a[1]}`); if (isUnlimited(a[1])) add("high", "UNLIMITED_APPROVAL", "Allowance increase is effectively unlimited."); }
    if (fn === "setApprovalForAll") { out.summary.push(`${a[1] ? "GRANT" : "Revoke"} operator ${a[0]} control of ALL NFTs in collection ${to || "?"}`); if (a[1]) add("high", "APPROVAL_FOR_ALL", "Grants control of every NFT in this collection; classic drainer pattern."); }
    if (fn === "transfer") out.summary.push(`Transfer ${a[1]} units of token ${to || "?"}${label(to) ? ` (${label(to)})` : ""} to ${a[0]}`);
    if (fn === "transferFrom" || fn === "safeTransferFrom") { out.summary.push(`Move asset from ${a[0]} to ${a[1]} (${a[2]})`); add("medium", "TRANSFER_FROM", "Moves assets out of an address via allowance; confirm you are the intended sender."); }
    if (/^(multicall|execute|aggregate|batch)/i.test(fn)) add("medium", "BATCHED_CALL", "Batched/multicall transaction: multicall(bytes[]) and aggregate3 inner calls are decoded one level; other batch formats (Universal Router execute, Safe multiSend) are not. Review each call.");
    if (fn === "permit") { out.summary.push(`On-chain EIP-2612 permit: ${a[1]} may spend ${isUnlimited(a[2]) ? "UNLIMITED" : a[2]} of token ${to || "?"}`); add(isUnlimited(a[2]) ? "high" : "medium", "ONCHAIN_PERMIT", "Submits a permit allowance on-chain."); }
    if (fn === "approve" && a.length === 4) { out.summary.push(`Permit2 allowance: ${a[1]}${label(a[1]) ? ` (${label(a[1])})` : ""} may spend ${big(a[2]) >= MAX160 ? "UNLIMITED" : a[2]} of token ${a[0]}`); if (big(a[2]) >= MAX160) add("high", "UNLIMITED_PERMIT2", "Unlimited on-chain Permit2 allowance."); if (!label(a[1])) add("medium", "UNKNOWN_SPENDER", "Permit2 spender is not a well-known router; verify it."); }
    if (/^(multicall|aggregate3)$/.test(fn) && (input._depth || 0) < 2) {
      const inner = fn === "aggregate3" ? (a[0] || []).map((c) => ({ to: c[0] ?? c.target, data: c[2] ?? c.callData })) : (a[a.length - 1] || []).map((x) => ({ to, data: x }));
      out.inner = [];
      for (const c of inner.slice(0, 20)) { if (typeof c.data !== "string" || c.data.length < 10) continue; const r = await explainBeforeSign({ transaction: { to: c.to, data: c.data, value: "0" }, _depth: (input._depth || 0) + 1 }); out.inner.push({ to: c.to, signature: r.calldata?.decoded?.signature || null, summary: r.summary, verdict: r.verdict }); for (const f of r.flags) add(f.level, f.code, `[inner call ${out.inner.length}] ${f.msg}`); r.summary.forEach((x) => out.summary.push(`inner: ${x}`)); }
    }
    if (/upgradeTo|transferOwnership|renounceOwnership|setOwner/.test(fn)) add("high", "ADMIN_CALL", `Admin function ${fn}: changes contract control.`);
    if (value > 0n && d.decoded && fn !== "deposit") add("low", "VALUE_WITH_CALL", "Sends native value together with a contract call.");
  }
  if (td) {
    out.kind = out.kind ? "both" : "typedData";
    const e = decodeEip712({ typedData: td }); out.typedData = { primaryType: e.primaryType, domain: e.domain, digest: e.digest, notes: e.notes };
    const m = (typeof td === "string" ? JSON.parse(td) : td).message || {}, pt = e.primaryType, vc = e.domain?.verifyingContract;
    const now = Math.floor(Date.now() / 1000), dl = big(m.deadline ?? m.sigDeadline ?? m.expiration ?? m.details?.expiration);
    if (pt === "Permit") { out.summary.push(`Off-chain permit: let ${m.spender}${label(m.spender) ? ` (${label(m.spender)})` : ""} spend ${isUnlimited(m.value) ? "UNLIMITED" : m.value} of token ${vc || "?"}${label(vc) ? ` (${label(vc)})` : ""}`); if (isUnlimited(m.value)) add("high", "UNLIMITED_PERMIT", "Gasless unlimited approval; no on-chain tx needed for it to be abused."); }
    if (/^Permit(Single|Batch)$/.test(pt)) { const det = [].concat(m.details || []); out.summary.push(`Permit2 allowance for ${m.spender}: ${det.map((x) => `${isUnlimited(x.amount) ? "UNLIMITED" : x.amount} of ${x.token}`).join(", ")}`); if (det.some((x) => isUnlimited(x.amount))) add("high", "UNLIMITED_PERMIT2", "Unlimited Permit2 allowance."); if (!label(m.spender)) add("medium", "UNKNOWN_SPENDER", "Permit2 spender is not a well-known router."); }
    if (/PermitTransferFrom/.test(pt)) { out.summary.push(`Permit2 signature transfer to spender ${m.spender}`); add("medium", "SIGNATURE_TRANSFER", "Signature lets spender pull tokens directly."); }
    if (/TransferWithAuthorization|ReceiveWithAuthorization/.test(pt)) { out.summary.push(`EIP-3009: pay ${m.value} units of ${vc || "?"}${label(vc) ? ` (${label(vc)})` : ""} from ${m.from} to ${m.to}`); if (input.expected_pay_to && String(m.to).toLowerCase() !== String(input.expected_pay_to).toLowerCase()) add("high", "PAYTO_MISMATCH", `Recipient ${m.to} differs from expected ${input.expected_pay_to}.`); const vb = big(m.validBefore); if (vb !== null && vb - BigInt(now) > 3600n) add("low", "LONG_VALIDITY", "Authorization valid for more than 1h."); }
    if (/Order|Seaport|OrderComponents/.test(pt)) { add("medium", "MARKET_ORDER", "Marketplace order signature: check consideration/recipient; zero-price listings are a common scam."); const cons = [].concat(m.consideration || []); if (cons.length && cons.every((c) => big(c.startAmount) === 0n)) add("high", "ZERO_PRICE_ORDER", "Order asks for nothing in return."); }
    if (dl !== null) { if (dl > MAX || dl - BigInt(now) > 365n * 86400n) add("medium", "LONG_DEADLINE", "Signature deadline is more than a year away or effectively never."); else if (dl < BigInt(now)) add("low", "EXPIRED", "Deadline already passed."); }
    if (input.chainId && e.domain?.chainId && Number(e.domain.chainId) !== Number(input.chainId)) add("high", "CHAIN_MISMATCH", `Typed data chainId ${e.domain.chainId} differs from wallet chain ${input.chainId}.`);
    if (!vc) add("low", "NO_VERIFYING_CONTRACT", "Domain has no verifyingContract.");
  }
  const rank = { high: 3, medium: 2, low: 1 }, worst = Math.max(0, ...flags.map((f) => rank[f.level]));
  out.risk = ["none", "low", "medium", "high"][worst]; out.verdict = worst >= 3 ? "do_not_sign_unless_intended" : worst === 2 ? "review" : "looks_ok";
  out.disclaimer = "Informational, not a security guarantee; looks_ok does not mean safe; no simulation. No on-chain state (proxy implementations, spender code, balances) is checked.";
  out.security_guarantee = false;
  if (out.verdict === "looks_ok") out.verdict_note = "looks_ok means no known risk pattern matched; it does not mean the transaction is safe.";
  return out;
}
