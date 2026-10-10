/** Lumen Works utility services: web page -> markdown/metadata, EVM address/ENS/token lookup, domain DNS+RDAP. No paid upstreams. */
import dns from "node:dns/promises";
import net from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { createPublicClient, http, isAddress, getAddress, formatUnits, parseAbi } from "viem";
import { mainnet, base } from "viem/chains";
import { normalize } from "viem/ens";

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const privateIp = (ip) => {
  if (net.isIPv4(ip)) { const [a, b] = ip.split(".").map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  const l = ip.toLowerCase(); return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:") && privateIp(l.slice(7));
};
async function safeFetch(raw, maxBytes = 3_000_000) {
  let url; try { url = new URL(raw); } catch { throw bad("Invalid url"); }
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw bad("Only http(s) URLs");
    const addrs = net.isIP(url.hostname) ? [url.hostname] : (await dns.lookup(url.hostname, { all: true }).catch(() => { throw bad("DNS lookup failed"); })).map((x) => x.address);
    if (addrs.some(privateIp)) throw bad("Private/internal addresses are not allowed");
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(12000), headers: { "user-agent": "LumenWorksFetcher/1.0 (+https://lumenworks-x402-decoder.onrender.com)", accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url); continue; }
    const reader = res.body?.getReader(); const chunks = []; let n = 0;
    while (reader) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > maxBytes) { reader.cancel(); break; } chunks.push(value); }
    return { url: url.href, status: res.status, contentType: res.headers.get("content-type") || "", body: Buffer.concat(chunks).toString("utf8"), truncated: n > maxBytes };
  }
  throw bad("Too many redirects");
}
function meta(document, pageUrl) {
  const m = (sel) => document.querySelector(sel)?.getAttribute("content") || undefined;
  const abs = (u) => { try { return u ? new URL(u, pageUrl).href : undefined; } catch { return undefined; } };
  const icon = document.querySelector('link[rel~="icon"], link[rel="apple-touch-icon"]')?.getAttribute("href");
  return { title: m('meta[property="og:title"]') || document.querySelector("title")?.textContent?.trim(), description: m('meta[property="og:description"]') || m('meta[name="description"]'), image: abs(m('meta[property="og:image"]') || m('meta[name="twitter:image"]')), siteName: m('meta[property="og:site_name"]'), type: m('meta[property="og:type"]'), author: m('meta[name="author"]'), publishedTime: m('meta[property="article:published_time"]'), canonical: abs(document.querySelector('link[rel="canonical"]')?.getAttribute("href")), favicon: abs(icon || "/favicon.ico"), lang: document.documentElement?.getAttribute("lang") || undefined, twitterCard: m('meta[name="twitter:card"]') };
}
export async function webMarkdown(input) {
  if (!input?.url) throw bad("Provide {url}");
  const r = await fetchPage(input.url);
  if (!/html|xml/.test(r.contentType)) return { url: r.url, status: r.status, contentType: r.contentType, markdown: r.body.slice(0, 200_000), truncated: r.truncated };
  const { document } = parseHTML(r.body);
  const metadata = meta(document, r.url);
  const art = input.fullPage ? null : new Readability(parseHTML(r.body).document).parse();
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }); td.remove(["script", "style", "noscript", "iframe"]);
  let markdown = td.turndown(art?.content || document.body?.innerHTML || "");
  const max = Math.min(Number(input.maxChars) || 100_000, 200_000), cut = markdown.length > max; markdown = markdown.slice(0, max);
  return { url: r.url, status: r.status, title: art?.title || metadata.title, byline: art?.byline || undefined, excerpt: art?.excerpt || metadata.description, metadata, wordCount: markdown.split(/\s+/).filter(Boolean).length, truncated: cut || r.truncated, markdown };
}
async function fetchPage(u) { const r = await safeFetch(u); if (r.status >= 400) throw bad(`Upstream returned HTTP ${r.status}`, 422); return r; }
export async function webUnfurl(input) {
  if (!input?.url) throw bad("Provide {url}");
  const r = await fetchPage(input.url);
  if (!/html|xml/.test(r.contentType)) return { url: r.url, status: r.status, contentType: r.contentType };
  const { document } = parseHTML(r.body);
  const links = [...document.querySelectorAll("a[href]")].length;
  return { url: r.url, status: r.status, contentType: r.contentType, ...meta(document, r.url), linkCount: links };
}

const clients = {
  ethereum: createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC || "https://ethereum-rpc.publicnode.com", { timeout: 10000 }) }),
  base: createPublicClient({ chain: base, transport: http(process.env.BASE_RPC || "https://base-rpc.publicnode.com", { timeout: 10000 }) }),
};
const erc20 = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"]);
const STABLES = { ethereum: { USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7" }, base: { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } };
const settle = async (p) => { try { return await p; } catch { return undefined; } };
export async function evmAddress(input) {
  let q = String(input?.address || input?.ens || "").trim(); if (!q) throw bad("Provide {address} (0x… or ENS name)");
  let ens; if (!isAddress(q)) { ens = q; const a = await settle(clients.ethereum.getEnsAddress({ name: normalize(q) })); if (!a) throw bad("ENS name did not resolve", 404); q = a; }
  const address = getAddress(q);
  const primaryName = ens || await settle(clients.ethereum.getEnsName({ address }));
  const chains = {};
  await Promise.all(Object.entries(clients).map(async ([name, c]) => {
    const [code, bal, nonce] = await Promise.all([settle(c.getCode({ address })), settle(c.getBalance({ address })), settle(c.getTransactionCount({ address }))]);
    const isContract = !!code && code !== "0x";
    const out = { isContract, nativeBalance: bal === undefined ? null : formatUnits(bal, 18), txCount: nonce ?? null, stablecoins: {} };
    if (isContract) { out.codeSize = (code.length - 2) / 2; out.eip7702Delegated = code.startsWith("0xef0100"); const [n, s, d, t] = await Promise.all(["name", "symbol", "decimals", "totalSupply"].map((f) => settle(c.readContract({ address, abi: erc20, functionName: f })))); if (s !== undefined && d !== undefined) out.erc20 = { name: n, symbol: s, decimals: Number(d), totalSupply: t === undefined ? null : formatUnits(t, Number(d)) }; }
    await Promise.all(Object.entries(STABLES[name]).map(async ([sym, tok]) => { const b = await settle(c.readContract({ address: tok, abi: erc20, functionName: "balanceOf", args: [address] })); out.stablecoins[sym] = b === undefined ? null : formatUnits(b, 6); }));
    chains[name] = out;
  }));
  const ensRecords = primaryName ? Object.fromEntries((await Promise.all(["avatar", "url", "com.twitter", "com.github", "description"].map(async (k) => [k, await settle(clients.ethereum.getEnsText({ name: normalize(primaryName), key: k }))]))).filter(([, v]) => v)) : {};
  return { address, ens: primaryName || null, ensRecords, chains, source: "public RPC (publicnode.com)", at: new Date().toISOString() };
}

let boot, bootAt = 0;
async function rdapBase(tld) {
  if (!boot || Date.now() - bootAt > 864e5) { const j = await settle(fetch("https://data.iana.org/rdap/dns.json", { signal: AbortSignal.timeout(8000) }).then((r) => r.json())); if (j) { boot = new Map(); for (const [tlds, urls] of j.services) for (const t of tlds) boot.set(t, urls.find((u) => u.startsWith("https")) || urls[0]); bootAt = Date.now(); } }
  return boot?.get(tld);
}
export async function domainLookup(input) {
  const domain = String(input?.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)) throw bad("Provide {domain} like example.com");
  const doh = async (name, t) => { const res = await settle(fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${t}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(8000) })); const j = res?.ok ? await settle(res.json()) : null; return (j?.Answer || []).filter((a) => a.type === { A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16, CNAME: 5, CAA: 257 }[t]).map((a) => a.data); };
  const r = async (t) => { const v = await doh(domain, t); if (t === "MX") return v.map((x) => { const [p, e] = x.split(" "); return { priority: Number(p), exchange: e.replace(/\.$/, "") }; }); if (t === "TXT") return v.map((x) => [x.replace(/^"|"$/g, "").replace(/" "/g, "")]); return v.map((x) => x.replace(/\.$/, "")); };
  const [A, AAAA, MX, NS, TXT, CNAME, CAA] = await Promise.all(["A", "AAAA", "MX", "NS", "TXT", "CNAME", "CAA"].map(r));
  const txt = (TXT || []).map((x) => x.join(""));
  const dmarc = (await doh(`_dmarc.${domain}`, "TXT")).map((x) => x.replace(/^"|"$/g, "").replace(/" "/g, "")).find((x) => x.startsWith("v=DMARC1"));
  let rdap = null;
  const base = await rdapBase(domain.split(".").pop());
  const res = base && await settle(fetch(`${base.replace(/\/$/, "")}/domain/${domain}`, { signal: AbortSignal.timeout(10000), headers: { accept: "application/rdap+json" } }));
  if (res?.ok) { const j = await settle(res.json()); if (j) { const ev = (a) => j.events?.find((e) => e.eventAction === a)?.eventDate; const reg = j.entities?.find((e) => e.roles?.includes("registrar")); rdap = { handle: j.handle, status: j.status, registered: ev("registration"), expires: ev("expiration"), lastChanged: ev("last changed"), registrar: reg?.vcardArray?.[1]?.find((v) => v[0] === "fn")?.[3] || reg?.publicIds?.[0]?.identifier, nameservers: j.nameservers?.map((n) => n.ldhName?.toLowerCase()), dnssec: j.secureDNS?.delegationSigned }; } }
  else if (res?.status === 404) rdap = { registered: false, note: "RDAP 404 — domain likely unregistered (or TLD lacks RDAP)" };
  const ageDays = rdap?.registered && typeof rdap.registered === "string" ? Math.floor((Date.now() - Date.parse(rdap.registered)) / 864e5) : null;
  return { domain, resolves: !!(A?.length || AAAA?.length || CNAME?.length), dns: { A, AAAA, CNAME, MX, NS, TXT: txt, CAA }, email: { hasMx: !!MX?.length, spf: txt.find((x) => x.startsWith("v=spf1")) || null, dmarc: dmarc || null }, rdap, ageDays, at: new Date().toISOString() };
}
