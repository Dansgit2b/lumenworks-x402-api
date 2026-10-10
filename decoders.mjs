import { hashTypedData, hashDomain, decodeFunctionData, parseAbiItem, isHex, getAddress } from "viem";
const b64 = (s) => JSON.parse(Buffer.from(String(s).trim(), "base64").toString("utf8"));
export function lintX402(input) {
  const issues = [], warn = (m) => issues.push({ level: "warn", msg: m }), err = (m) => issues.push({ level: "error", msg: m });
  let obj = input?.json;
  const raw = input?.header || input?.value;
  if (!obj && raw) { try { obj = b64(raw); } catch { try { obj = JSON.parse(raw); } catch { return { ok: false, issues: [{ level: "error", msg: "Not base64 JSON or JSON" }] }; } } }
  if (!obj || typeof obj !== "object") return { ok: false, issues: [{ level: "error", msg: "Provide {header} (base64) or {json}" }] };
  let kind = obj.accepts ? "PAYMENT-REQUIRED" : obj.payload ? "PAYMENT-SIGNATURE" : obj.transaction || obj.success !== undefined ? "PAYMENT-RESPONSE" : "unknown";
  if (![1, 2].includes(obj.x402Version)) err("x402Version must be 1 or 2");
  if (kind === "PAYMENT-REQUIRED") {
    if (!Array.isArray(obj.accepts) || !obj.accepts.length) err("accepts[] empty");
    for (const [i, a] of (obj.accepts || []).entries()) {
      for (const f of ["scheme", "network", "payTo", "asset"]) if (!a[f]) err(`accepts[${i}].${f} missing`);
      if (!(a.amount || a.maxAmountRequired)) err(`accepts[${i}].amount missing`);
      if (obj.x402Version === 2 && a.network && !/^[a-z0-9]+:/.test(a.network)) warn(`accepts[${i}].network should be CAIP-2 in v2 (e.g. eip155:8453)`);
      if (a.payTo) { try { getAddress(a.payTo); } catch { if (String(a.payTo).startsWith("0x")) err(`accepts[${i}].payTo bad checksum/address`); } }
      if (a.scheme === "exact" && String(a.network).startsWith("eip155") && !a.extra?.name) warn(`accepts[${i}].extra.name/version (EIP-712 domain) missing`);
      if (!a.maxTimeoutSeconds) warn(`accepts[${i}].maxTimeoutSeconds missing`);
    }
    if (obj.x402Version === 2 && !obj.resource) warn("resource missing (v2)");
  }
  if (kind === "PAYMENT-SIGNATURE") {
    const au = obj.payload?.authorization;
    if (au) { const now = Date.now() / 1000; if (Number(au.validBefore) < now) err("authorization expired (validBefore in past)"); if (Number(au.validAfter) > now) warn("validAfter in future"); }
    if (!obj.payload?.signature) err("payload.signature missing");
  }
  return { ok: !issues.some((x) => x.level === "error"), kind, decoded: obj, issues };
}
export function decodeEip712(input) {
  let td = input?.typedData ?? input;
  if (typeof td === "string") td = JSON.parse(td);
  const { domain, types, primaryType, message } = td || {};
  if (!types || !primaryType || !message) throw Object.assign(new Error("typedData needs types, primaryType, message"), { status: 400 });
  const t = { ...types }; delete t.EIP712Domain;
  const notes = [];
  if (domain?.verifyingContract) notes.push(`verifyingContract ${domain.verifyingContract} on chainId ${domain.chainId ?? "?"}`);
  if (primaryType === "Permit") notes.push("ERC-2612 Permit: grants token allowance to spender, check value/deadline");
  if (/PermitSingle|PermitBatch|PermitTransferFrom/.test(primaryType)) notes.push("Permit2 signature: grants token spending via Permit2");
  if (primaryType === "TransferWithAuthorization") notes.push("EIP-3009 transfer authorization (used by x402 exact): moves tokens from->to");
  const m = message;
  if (m.value !== undefined && /^\d+$/.test(String(m.value)) && BigInt(m.value) > 2n ** 200n) notes.push("value is ~unlimited");
  return { primaryType, domain, domainSeparator: hashDomain({ domain: domain || {}, types: { EIP712Domain: types.EIP712Domain || [] } }), digest: hashTypedData({ domain: domain || {}, types: t, primaryType, message }), message, notes };
}
const cache = new Map();
async function lookup(sel) {
  if (cache.has(sel)) return cache.get(sel);
  let sigs = [];
  try { const r = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${sel}&filter=true`, { signal: AbortSignal.timeout(6000) }); const j = await r.json(); sigs = (j.result?.function?.[sel] || []).map((x) => x.name); } catch {}
  if (!sigs.length) { try { const r = await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${sel}`, { signal: AbortSignal.timeout(6000) }); const j = await r.json(); sigs = (j.results || []).sort((a, b) => a.id - b.id).map((x) => x.text_signature); } catch {} }
  cache.set(sel, sigs); return sigs;
}
const ser = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
export async function decodeCalldata(input) {
  const data = String(input?.data || "").trim();
  if (!isHex(data) || data.length < 10) throw Object.assign(new Error("data must be 0x hex with 4-byte selector"), { status: 400 });
  const selector = data.slice(0, 10).toLowerCase();
  const sigs = input?.signature ? [input.signature] : await lookup(selector);
  const candidates = [];
  for (const s of sigs.slice(0, 10)) {
    try { const item = parseAbiItem(`function ${s}`); const d = decodeFunctionData({ abi: [item], data }); candidates.push({ signature: s, args: ser(d.args ?? []) }); } catch {}
  }
  return { selector, signaturesFound: sigs.length, decoded: candidates[0] || null, candidates, source: input?.signature ? "user" : "openchain/4byte" };
}
