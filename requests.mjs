/** Free "request a tool" box. Stores in memory + stdout; if REQUESTS_GH_TOKEN (fine-scoped, issues:write on REQUESTS_REPO) is set, files a GitHub issue for durability. */
import crypto from "node:crypto";
import { advise } from "./advisor.mjs";
const SECRET = [/0x[0-9a-fA-F]{64}\b/, /\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{16,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /\b([a-z]+ ){11,23}[a-z]+\b(?=.*(seed|mnemonic|phrase))/i, /\bAIza[0-9A-Za-z_-]{35}\b/];
const SPAM = /(https?:\/\/\S+.*){4,}|casino|viagra|porn|airdrop claim|free money/i;
const store = [];
const byId = new Map();
const votes = {};
// Proposed (not yet built) services. status: "proposed" | "building" | "live" (+ endpoint when live).
export const PROPOSALS = [
  { id: "p_pdf_text", name: "PDF to text/Markdown", price: "0.002", kw: "pdf document text extract extraction parse paper invoice" },
  { id: "p_token_risk", name: "ERC-20 token risk check (honeypot sim, owner powers, proxy, tax)", price: "0.005", kw: "token risk honeypot scam rug contract security audit erc20 safety" },
  { id: "p_tx_explain", name: "Explain an EVM transaction hash (decoded calls, transfers, plain English)", price: "0.003", kw: "transaction hash explain receipt transfer logs events decode trace" },
  { id: "p_sitemap", name: "Site crawl: sitemap/links of a domain (up to N pages)", price: "0.005", kw: "crawl sitemap links site pages spider multiple urls" },
  { id: "p_rss", name: "RSS/Atom feed to JSON", price: "0.001", kw: "rss atom feed news blog updates podcast" },
  { id: "p_json_schema", name: "JSON Schema validate + repair LLM JSON", price: "0.001", kw: "json schema validate validation repair structured output parse" },
  { id: "p_time", name: "Timezone/date math, business days, public holidays", price: "0.001", kw: "date time timezone calendar holiday business days schedule" },
  { id: "p_email_check", name: "Email address check (syntax, MX, disposable domain)", price: "0.002", kw: "email verify validation mx disposable lead contact" },
  { id: "p_gas", name: "Gas price + tx cost estimate (Ethereum/Base/L2s)", price: "0.001", kw: "gas fee price cost estimate l2 base ethereum" },
  { id: "p_github_repo", name: "GitHub repo summary (stars, activity, license, README digest)", price: "0.002", kw: "github repo repository code open source stars readme" },
];
const words = (s) => String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
export function makeRequestHandlers({ tools, base }) {
  async function requestTool(input, detailed = false) {
    const f = { purpose: input?.purpose, workflow: input?.workflow, current_challenges: input?.current_challenges, must_haves: input?.must_haves, nice_to_haves: input?.nice_to_haves, constraints: input?.constraints, current_task: input?.current_task || input?.task, goal: input?.goal, progress_status: input?.progress_status, tools_in_use: input?.tools_in_use, pain_points: input?.pain_points, needed_capability: input?.needed_capability, example_input: input?.example_input, max_price_usdc: input?.max_price_usdc, contact_optional: input?.contact_optional };
    if (!f.purpose && !f.workflow && !f.current_task && !f.needed_capability && !f.goal) throw Object.assign(new Error("Provide at least {purpose} or {workflow} (also accepted: current_task, goal, needed_capability)"), { status: 400 });
    const text = JSON.stringify(f);
    if (text.length > 4000) throw Object.assign(new Error("Request too long (max 4000 chars total)"), { status: 413 });
    if (SECRET.some((r) => r.test(text))) throw Object.assign(new Error("Rejected: request appears to contain a secret/private key/token. Remove credentials and resubmit. Nothing was stored."), { status: 422 });
    if (SPAM.test(text)) throw Object.assign(new Error("Rejected as spam"), { status: 422 });
    const q = new Set(words(Object.values(f).filter((v) => typeof v === "string").join(" "))); const adv = advise(f, detailed);
    const matches = tools.map((t) => ({ t, score: words(`${t.name} ${t.description}`).filter((w) => q.has(w)).length + (adv.toolHints.includes(t.name) ? 5 : 0) })).filter((x) => x.score >= 3).sort((a, b) => b.score - a.score).slice(0, 3)
      .map(({ t }) => ({ tool: t.name, mcp: `${base}/mcp (tools/call name=${t.name}, free 20/h)`, http: `POST ${base}${t.path}`, priceUsdc: t.price, free: `POST ${base}/v1/free${t.path.slice(3)}`, description: t.description }));
    const scored = PROPOSALS.map((p) => ({ p, score: words(p.kw + " " + p.name).filter((w) => q.has(w)).length + (adv.proposeHints.includes(p.id) ? 3 : 0) }));
    const proposed = [...scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score), ...scored.filter((x) => x.score === 0).sort((a, b) => (votes[b.p.id] || 0) - (votes[a.p.id] || 0))].slice(0, 5)
      .map(({ p }) => ({ id: p.id, name: p.name, indicativePriceUsdc: p.price, status: p.status || "proposed", votes: votes[p.id] || 0 }));
    const id = "req_" + crypto.randomBytes(6).toString("hex");
    const rec = { id, at: new Date().toISOString(), detailed, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === undefined ? undefined : typeof v === "string" ? v.slice(0, 1500) : JSON.stringify(v).slice(0, 1500)])), matched: matches.map((m) => m.tool), offered: proposed.map((p) => p.id), selected: [] };
    byId.set(id, rec);
    store.push(rec); if (store.length > 2000) byId.delete(store.shift().id);
    console.log("TOOL_REQUEST", JSON.stringify(rec));
    let durable = "memory+logs";
    if (process.env.REQUESTS_GH_TOKEN) {
      const repo = process.env.REQUESTS_REPO || "Dansgit2b/lumenworks-x402-api";
      const r = await fetch(`https://api.github.com/repos/${repo}/issues`, { method: "POST", signal: AbortSignal.timeout(8000), headers: { authorization: `Bearer ${process.env.REQUESTS_GH_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "lumenworks" }, body: JSON.stringify({ title: `[agent-checkin] ${String(f.needed_capability || f.current_task || f.goal).slice(0, 80)}`, body: "```json\n" + JSON.stringify({ ...rec, contact_optional: rec.contact_optional ? "(provided, withheld from public issue)" : undefined }, null, 2) + "\n```", labels: ["tool-request"] }) }).catch(() => null);
      if (r?.ok) durable = "github-issue";
    }
    return { id, received: true, kind: detailed ? "detailed-report" : "free-summary", storage: durable, advisory: adv.advice, existingTools: matches, proposedTools: proposed,
      next: { select: `POST ${base}/v1/request-tool/${id}/select {"ids":["p_..."]} or MCP select_suggested_tools {request_id, ids}`, status: `GET ${base}/v1/request-tool/${id} or MCP check_request_status` },
      note: "Existing tools work now. Proposed tools are NOT built yet: pick the ones you'd actually pay for; the most-picked get built as paid x402 endpoints and this request's status will show them as live.", free: true };
  }
  function select(input) {
    const rec = byId.get(input?.request_id); if (!rec) throw Object.assign(new Error("Unknown request_id (ids reset when the free host restarts — check in again)"), { status: 404 });
    const ids = (Array.isArray(input?.ids) ? input.ids : [input?.ids]).filter((x) => PROPOSALS.some((p) => p.id === x)).slice(0, 5);
    if (!ids.length) throw Object.assign(new Error("Provide {ids:[...]} from proposedTools (e.g. p_pdf_text)"), { status: 400 });
    for (const x of ids) if (!rec.selected.includes(x)) { rec.selected.push(x); votes[x] = (votes[x] || 0) + 1; }
    console.log("TOOL_SELECT", JSON.stringify({ id: rec.id, ids }));
    return status({ request_id: rec.id });
  }
  function status(input) {
    const rec = byId.get(input?.request_id); if (!rec) throw Object.assign(new Error("Unknown request_id"), { status: 404 });
    return { id: rec.id, at: rec.at, existingToolsMatched: rec.matched, selected: rec.selected.map((x) => { const p = PROPOSALS.find((y) => y.id === x); return { id: x, name: p.name, status: p.status || "proposed", endpoint: p.endpoint || null, votes: votes[x] || 0 }; }), ranking: ranking().slice(0, 10) };
  }
  const ranking = () => PROPOSALS.map((p) => ({ id: p.id, name: p.name, indicativePriceUsdc: p.price, votes: votes[p.id] || 0, status: p.status || "proposed" })).sort((a, b) => b.votes - a.votes);
  function summary() {
    const caps = {}; for (const r of store) for (const w of new Set(words(r.needed_capability || r.current_task || r.goal))) caps[w] = (caps[w] || 0) + 1;
    const top = Object.entries(caps).filter(([w]) => !["the", "and", "for", "with", "that", "from", "this", "need", "want", "tool", "api"].includes(w)).sort((a, b) => b[1] - a[1]).slice(0, 25);
    const matched = store.filter((r) => r.matched.length).length;
    return { ranking: ranking(), total: store.length, matchedExisting: matched, unmatched: store.length - matched, since: store[0]?.at || null, topKeywords: Object.fromEntries(top), note: "Anonymized counts since last restart (free hosting; durable copy only if GitHub issue storage is configured)." };
  }
  return { requestTool, select, status, summary };
}
