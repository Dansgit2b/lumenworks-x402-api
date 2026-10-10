/** Deterministic x402 payment safety check. Stores nothing; only anonymous counters elsewhere. */
import { isAddress, getAddress } from "viem";
import { safeFetch } from "./services.mjs";
const KNOWN_ASSETS = {
  "eip155:8453": { "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { sym: "USDC", dec: 6 } },
  "eip155:84532": { "0x036cbd53842c5426634e7929541ec2318f3dcf7e": { sym: "USDC (Base Sepolia testnet)", dec: 6, testnet: true } },
  "eip155:1": { "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { sym: "USDC", dec: 6 } },
  "eip155:137": { "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { sym: "USDC", dec: 6 } },
  "eip155:42161": { "0xaf88d065e77c8cc2239327c5edb3a432268e5831": { sym: "USDC", dec: 6 } },
  "eip155:10": { "0x0b2c639c533813f4aa9d7837caf62653d097ff85": { sym: "USDC", dec: 6 } },
  "eip155:43114": { "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": { sym: "USDC", dec: 6 } },
  "eip155:42220": { "0xceba9300f2b948710d2653dd7b07f33a8b32118c": { sym: "USDC", dec: 6 }, "0xd2ab3c9a02dbbab236bfec45d1d755df4267f771": { sym: "USAT", dec: 6 } },
};
const V1NET = { base: "eip155:8453", "base-sepolia": "eip155:84532", ethereum: "eip155:1", polygon: "eip155:137", arbitrum: "eip155:42161", optimism: "eip155:10", avalanche: "eip155:43114", celo: "eip155:42220" };
const KNOWN_FACILITATORS = ["facilitator.payai.network", "x402.org", "api.cdp.coinbase.com", "facilitator.x402.rs", "api.x402.celo.org", "facilitator.daydreams.systems", "x402.dexter.cash", "facilitator.corbits.dev", "facilitator.mogami.tech"];
const SECRET = [/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bsk[-_][A-Za-z0-9_-]{20,}/, /\bAKIA[0-9A-Z]{16}\b/];
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const decodeHdr = (h) => { try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch { try { return JSON.parse(h); } catch { return null; } } };

export async function x402SafetyCheck(input) {
  const pasted = input?.payment_required ?? input?.paymentRequired;
  if (pasted && SECRET.some((r) => r.test(typeof pasted === "string" ? pasted : JSON.stringify(pasted)))) throw bad("Rejected: input looks like it contains a private key/secret. Nothing stored.", 422);
  if (!input?.url && !pasted) throw bad("Provide {url} of an x402 endpoint and/or {payment_required} (402 JSON or base64 PAYMENT-REQUIRED header)");
  const checks = [], add = (level, id, msg) => checks.push({ level, id, msg });
  let pr = pasted ? (typeof pasted === "string" ? decodeHdr(pasted) : pasted) : null;
  let health = null;
  if (input?.url) {
    const method = String(input.method || "POST").toUpperCase() === "GET" ? "GET" : "POST";
    const t0 = Date.now(); let r;
    try { r = await safeFetch(input.url, 200_000, method); } catch (e) { r = null; health = { reachable: false, error: e.message }; }
    if (r) {
      health = { reachable: true, status: r.status, latencyMs: Date.now() - t0, finalUrl: r.url, https: r.url.startsWith("https:") };
      if (!health.https) add("error", "no_https", "Endpoint is not HTTPS — payment headers can be intercepted/modified.");
      if (r.status !== 402) add("warn", "not_402", `Unpaid ${method} returned HTTP ${r.status}, expected 402 (try method:"GET"/"POST").`);
      const h = r.headers.get("payment-required"); const fromUrl = h ? decodeHdr(h) : (() => { try { return JSON.parse(r.body); } catch { return null; } })();
      if (fromUrl?.accepts) { if (pr) { const a = JSON.stringify(pr.accepts?.map((x) => [x.payTo, x.amount || x.maxAmountRequired, x.asset])), b = JSON.stringify(fromUrl.accepts.map((x) => [x.payTo, x.amount || x.maxAmountRequired, x.asset])); if (a !== b) add("error", "live_mismatch", "Pasted payment requirements differ from what the live endpoint returns now (payTo/amount/asset)."); } else pr = fromUrl; }
      else if (r.status === 402) add("error", "no_requirements", "402 without a parseable PAYMENT-REQUIRED header or JSON body.");
    }
  }
  const accepts = pr?.accepts || [];
  if (pr && ![1, 2].includes(pr.x402Version)) add("warn", "version", "x402Version missing or not 1/2.");
  if (!accepts.length) add("error", "no_accepts", pr ? "accepts[] is empty." : "No payment requirements could be obtained — cannot verify; do not pay blind.");
  const payTos = new Set();
  const options = accepts.map((a, i) => {
    const net = V1NET[a.network] || a.network; const asset = String(a.asset || "").toLowerCase(); const known = KNOWN_ASSETS[net]?.[asset];
    const raw = a.amount ?? a.maxAmountRequired; const dec = known?.dec ?? a.extra?.decimals ?? 6; const usd = raw !== undefined && /^\d+$/.test(String(raw)) ? Number(raw) / 10 ** dec : null;
    const p = `accepts[${i}]`;
    if (a.scheme !== "exact" && a.scheme !== "upto") add("warn", "scheme", `${p}: unusual scheme "${a.scheme}".`);
    if (!isAddress(String(a.payTo || ""))) add("error", "payto_invalid", `${p}: payTo is not a valid address.`); else { if (a.payTo !== getAddress(a.payTo) && /[A-F]/.test(a.payTo)) add("warn", "payto_checksum", `${p}: payTo has bad EIP-55 checksum.`); payTos.add(getAddress(a.payTo)); }
    if (/^0x0{40}$/i.test(a.payTo || "")) add("error", "payto_zero", `${p}: payTo is the zero address.`);
    if (!known) add(KNOWN_ASSETS[net] ? "error" : "warn", "asset_unknown", `${p}: asset ${a.asset} on ${net} is not a known stablecoin — verify the token before paying.`);
    if (known?.testnet) add("info", "testnet", `${p}: testnet asset (no real value).`);
    if (a.extra?.name && known && !new RegExp(known.sym.split(" ")[0], "i").test(a.extra.name) && !/usd/i.test(a.extra.name)) add("warn", "domain_name", `${p}: EIP-712 domain name "${a.extra.name}" doesn't look like ${known.sym}.`);
    if (usd === null) add("error", "amount", `${p}: amount missing/not an integer string.`);
    else { if (usd === 0) add("warn", "price_zero", `${p}: price is 0.`); if (usd > 1) add("warn", "price_high", `${p}: ${usd} ${known?.sym || "units"} per call is high for an API call — confirm intent.`); if (input?.max_price_usdc !== undefined && usd > Number(input.max_price_usdc)) add("error", "over_cap", `${p}: ${usd} exceeds your cap ${input.max_price_usdc}.`); if (input?.listed_price_usdc !== undefined && Math.abs(usd - Number(input.listed_price_usdc)) > 1e-9) add("warn", "listing_diff", `${p}: live price ${usd} differs from listed ${input.listed_price_usdc}.`); }
    const to = Number(a.maxTimeoutSeconds); if (!to) add("warn", "no_timeout", `${p}: maxTimeoutSeconds missing — authorization window unbounded by server hint.`); else if (to > 600) add("warn", "long_timeout", `${p}: maxTimeoutSeconds ${to}s is long; signed authorizations stay replayable until validBefore.`);
    if (input?.expected_pay_to && isAddress(input.expected_pay_to) && isAddress(String(a.payTo || "")) && getAddress(input.expected_pay_to) !== getAddress(a.payTo)) add("error", "payto_mismatch", `${p}: payTo ${a.payTo} != expected ${input.expected_pay_to}.`);
    if (input?.expected_network && (V1NET[input.expected_network] || input.expected_network) !== net) add("error", "network_mismatch", `${p}: network ${net} != expected ${input.expected_network}.`);
    return { network: net, asset: a.asset, assetSymbol: known?.sym || null, priceUsd: usd, payTo: a.payTo, scheme: a.scheme, maxTimeoutSeconds: a.maxTimeoutSeconds ?? null };
  });
  if (payTos.size > 1) add("warn", "multi_payto", `Options pay ${payTos.size} different addresses — confirm all belong to the seller.`);
  const fac = input?.facilitator_url; if (fac) { let host = ""; try { host = new URL(fac).hostname; } catch {} if (!KNOWN_FACILITATORS.some((k) => host === k || host.endsWith("." + k))) add("warn", "facilitator_unknown", `Facilitator ${host || fac} is not in our known list — it will see and settle your signed authorization.`); }
  const cfg = input?.client_config || {};
  if (input?.client_config) {
    if (!(cfg.max_per_call_usdc ?? cfg.maxPerCall)) add("error", "no_per_call_cap", "Client config has no per-call spend cap.");
    if (!(cfg.max_daily_usdc ?? cfg.dailyCap)) add("warn", "no_daily_cap", "Client config has no daily/total spend cap.");
    if (cfg.allow_any_pay_to || cfg.allowAnyPayTo) add("warn", "payto_allowlist", "Client pays any payTo — consider an allowlist per domain.");
    if (!(cfg.idempotency_key ?? cfg.idempotency)) add("info", "idempotency", "No idempotency key handling — retries after timeouts can pay twice.");
  } else add("info", "no_client_config", "Pass client_config {max_per_call_usdc, max_daily_usdc, idempotency_key, allow_any_pay_to} to check your own spend controls.");
  add("info", "replay", "exact/EIP-3009: each authorization carries a random nonce and validBefore; never reuse a signed PAYMENT-SIGNATURE and keep validBefore short.");
  const errors = checks.filter((c) => c.level === "error").length, warns = checks.filter((c) => c.level === "warn").length;
  return { verdict: errors ? "do_not_pay" : warns ? "review" : "ok", errors, warnings: warns, health, options, resource: pr?.resource ?? null, checks, method: "deterministic rules; nothing stored", monitoring: "Continuous monitoring (alerts on price/payTo changes) is not built yet. Free waitlist: POST /v1/monitoring/waitlist {endpoint_url, contact?}." };
}
