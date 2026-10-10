/** Persistent anonymous stats: aggregate counters, UA families, salted+hashed IPs (unique counts only), short retention.
 * Persistence: a private GitHub gist file when STATS_GIST_ID + STATS_GIST_TOKEN (gist-only scope) are set; otherwise memory only.
 * Never stores request bodies, raw IPs, full user-agents, or payment headers. */
import crypto from "node:crypto";
const GIST = process.env.STATS_GIST_ID || "", TOKEN = process.env.STATS_GIST_TOKEN || "", FILE = "lumenworks-stats.json";
const SALT = process.env.STATS_SALT || crypto.randomBytes(16).toString("hex"); // without a fixed salt, uniques are per-process
const RETAIN_DAYS = Number(process.env.STATS_RETAIN_DAYS || 30), FLUSH_MS = Number(process.env.STATS_FLUSH_MS || 300_000);
const day = () => new Date().toISOString().slice(0, 10);
const hashIp = (ip) => crypto.createHash("sha256").update(SALT + "|" + day() + "|" + (ip || "")).digest("hex").slice(0, 12); // rotates daily
const blank = () => ({ since: new Date().toISOString(), deploys: 0, endpoints: {}, sources: {}, days: {} });
let S = blank(), dirty = false, loaded = false;
export const bucket = (ua = "") => /claude|anthropic/i.test(ua) ? "claude" : /openai|gpt|chatgpt/i.test(ua) ? "openai" : /cursor/i.test(ua) ? "cursor" : /x402|axios|node|undici|python|httpx|requests|aiohttp|go-http|curl/i.test(ua) ? (ua.match(/x402|axios|node|undici|python|httpx|requests|aiohttp|go-http|curl/i)[0].toLowerCase()) : /bot|crawl|spider|scan/i.test(ua) ? "crawler" : /mozilla/i.test(ua) ? "browser" : ua ? "other" : "none";
const prune = () => { const cut = new Date(Date.now() - RETAIN_DAYS * 864e5).toISOString().slice(0, 10); for (const d of Object.keys(S.days)) if (d < cut) delete S.days[d]; };
export function record({ key, ua, ip, status, paidAttempt, free }) {
  const e = S.endpoints[key] ||= { calls: 0, unpaid402: 0, paidAttempts: 0, paidOk: 0, free: 0, errors: 0 };
  if (Object.keys(S.endpoints).length > 200 && e.calls === 0) { delete S.endpoints[key]; return; }
  const src = bucket(ua), d = S.days[day()] ||= { calls: 0, unpaid402: 0, paidAttempts: 0, paidOk: 0, free: 0, errors: 0, sources: {}, ipHashes: [] };
  for (const o of [e, d]) { o.calls++; if (status === 402) o.unpaid402++; if (paidAttempt) { o.paidAttempts++; if (status < 300) o.paidOk++; } if (free) o.free++; if (status >= 400 && status !== 402) o.errors++; }
  e.bySource ||= {}; e.bySource[src] = (e.bySource[src] || 0) + 1;
  S.sources[src] = (S.sources[src] || 0) + 1; d.sources[src] = (d.sources[src] || 0) + 1;
  const h = hashIp(ip); if (d.ipHashes.length < 5000 && !d.ipHashes.includes(h)) d.ipHashes.push(h);
  dirty = true;
}
export function snapshot() {
  const t = Object.values(S.endpoints).reduce((a, e) => ({ unpaid402: a.unpaid402 + e.unpaid402, paidAttempts: a.paidAttempts + e.paidAttempts, paidOk: a.paidOk + e.paidOk, free: a.free + e.free }), { unpaid402: 0, paidAttempts: 0, paidOk: 0, free: 0 });
  const days = Object.fromEntries(Object.entries(S.days).sort().map(([k, v]) => { const { ipHashes, ...rest } = v; return [k, { ...rest, uniqueClients: ipHashes.length }]; }));
  return { since: S.since, deploys: S.deploys, persisted: !!(GIST && TOKEN), retentionDays: RETAIN_DAYS, endpoints: S.endpoints, sources: S.sources, days, totals: { ...t, conversion402ToPaid: t.unpaid402 ? +(t.paidOk / t.unpaid402).toFixed(4) : null },
    note: "Anonymous aggregates. UA reduced to a family label; IPs only as daily-rotating salted hashes used for unique counts (never returned). No bodies or payment headers stored." + (GIST && TOKEN ? ` Persisted across deploys; ${RETAIN_DAYS}-day retention.` : " Memory only: resets on restart.") };
}
const api = (method, body) => fetch(`https://api.github.com/gists/${GIST}`, { method, headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "user-agent": "lumenworks-stats", ...(body ? { "content-type": "application/json" } : {}) }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
export async function load() {
  if (!GIST || !TOKEN) { loaded = true; return; }
  try { const r = await api("GET"); if (r.ok) { const f = (await r.json()).files?.[FILE]; if (f?.content) { const prev = JSON.parse(f.content); S = { ...blank(), ...prev, deploys: (prev.deploys || 0) + 1 }; prune(); dirty = true; } } else console.warn("stats load", r.status); }
  catch (e) { console.warn("stats load failed", e.message); }
  loaded = true;
}
export async function flush() {
  if (!GIST || !TOKEN || !dirty || !loaded) return;
  prune(); dirty = false;
  try { const r = await api("PATCH", { files: { [FILE]: { content: JSON.stringify(S) } } }); if (!r.ok) { dirty = true; console.warn("stats flush", r.status); } } catch (e) { dirty = true; console.warn("stats flush failed", e.message); }
}
export function startPersistence() {
  const ready = load(); setInterval(flush, FLUSH_MS).unref();
  for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, async () => { await flush(); process.exit(0); });
  return ready;
}
