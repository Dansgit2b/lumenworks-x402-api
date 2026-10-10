/** Free "request a tool" box. Stores in memory + stdout; if REQUESTS_GH_TOKEN (fine-scoped, issues:write on REQUESTS_REPO) is set, files a GitHub issue for durability. */
import crypto from "node:crypto";
const SECRET = [/0x[0-9a-fA-F]{64}\b/, /\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{16,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /\b([a-z]+ ){11,23}[a-z]+\b(?=.*(seed|mnemonic|phrase))/i, /\bAIza[0-9A-Za-z_-]{35}\b/];
const SPAM = /(https?:\/\/\S+.*){4,}|casino|viagra|porn|airdrop claim|free money/i;
const store = [];
const words = (s) => String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
export function makeRequestHandlers({ tools, base }) {
  async function requestTool(input) {
    const f = { task: input?.task, needed_capability: input?.needed_capability, example_input: input?.example_input, max_price_usdc: input?.max_price_usdc, contact_optional: input?.contact_optional };
    if (!f.task && !f.needed_capability) throw Object.assign(new Error("Provide at least {task} or {needed_capability}"), { status: 400 });
    const text = JSON.stringify(f);
    if (text.length > 4000) throw Object.assign(new Error("Request too long (max 4000 chars total)"), { status: 413 });
    if (SECRET.some((r) => r.test(text))) throw Object.assign(new Error("Rejected: request appears to contain a secret/private key/token. Remove credentials and resubmit. Nothing was stored."), { status: 422 });
    if (SPAM.test(text)) throw Object.assign(new Error("Rejected as spam"), { status: 422 });
    const q = new Set(words(`${f.task} ${f.needed_capability}`));
    const matches = tools.map((t) => ({ t, score: words(`${t.name} ${t.description}`).filter((w) => q.has(w)).length })).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score).slice(0, 3)
      .map(({ t }) => ({ tool: t.name, mcp: `${base}/mcp (tools/call name=${t.name}, free 20/h)`, http: `POST ${base}${t.path}`, priceUsdc: t.price, free: `POST ${base}/v1/free${t.path.slice(3)}`, description: t.description }));
    const id = "req_" + crypto.randomBytes(6).toString("hex");
    const rec = { id, at: new Date().toISOString(), ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === undefined ? undefined : typeof v === "string" ? v.slice(0, 1500) : JSON.stringify(v).slice(0, 1500)])), matched: matches.map((m) => m.tool) };
    store.push(rec); if (store.length > 2000) store.shift();
    console.log("TOOL_REQUEST", JSON.stringify(rec));
    let durable = "memory+logs";
    if (process.env.REQUESTS_GH_TOKEN) {
      const repo = process.env.REQUESTS_REPO || "Dansgit2b/lumenworks-x402-api";
      const r = await fetch(`https://api.github.com/repos/${repo}/issues`, { method: "POST", signal: AbortSignal.timeout(8000), headers: { authorization: `Bearer ${process.env.REQUESTS_GH_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "lumenworks" }, body: JSON.stringify({ title: `[tool-request] ${String(f.needed_capability || f.task).slice(0, 80)}`, body: "```json\n" + JSON.stringify({ ...rec, contact_optional: rec.contact_optional ? "(provided, withheld from public issue)" : undefined }, null, 2) + "\n```", labels: ["tool-request"] }) }).catch(() => null);
      if (r?.ok) durable = "github-issue";
    }
    return { id, received: true, storage: durable, matches, note: matches.length ? "Existing Lumen Works tools that may cover this are listed above." : "No existing tool matched. Popular requests get built as paid x402 endpoints (typically $0.001-0.01/call); check GET " + base + "/v1/requests/summary.", free: true };
  }
  function summary() {
    const caps = {}; for (const r of store) for (const w of new Set(words(r.needed_capability || r.task))) caps[w] = (caps[w] || 0) + 1;
    const top = Object.entries(caps).filter(([w]) => !["the", "and", "for", "with", "that", "from", "this", "need", "want", "tool", "api"].includes(w)).sort((a, b) => b[1] - a[1]).slice(0, 25);
    const matched = store.filter((r) => r.matched.length).length;
    return { total: store.length, matchedExisting: matched, unmatched: store.length - matched, since: store[0]?.at || null, topKeywords: Object.fromEntries(top), note: "Anonymized counts since last restart (free hosting; durable copy only if GitHub issue storage is configured)." };
  }
  return { requestTool, summary };
}
