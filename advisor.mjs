/** Rule-based agent hardening advisor (no paid upstream). Optional LLM polish only if OPENAI_API_KEY is set (not used by default). */
const has = (t, re) => re.test(t);
const RULES = [
  { id: "payments", when: /pay|x402|usdc|wallet|crypto|purchase|buy|spend|transfer|trade|swap/, sev: "high", area: "payment safety",
    risk: "Agent moves money/signs payments.", recs: ["Hard per-call and per-day spend caps enforced outside the LLM (e.g. max 0.05 USDC/call).", "Dedicated hot wallet with small float; never the treasury key.", "Validate x402 PAYMENT-REQUIRED before signing: network, asset address, payTo allowlist, amount vs. quoted price, expiry.", "Decode EIP-712/permits before signing; reject unlimited approvals and Permit2 with far deadlines.", "Log every settlement tx hash and reconcile daily."], tools: ["x402_lint", "eip712_decode", "calldata_decode"] },
  { id: "keys", when: /key|secret|token|credential|private|seed|mnemonic|api/, sev: "high", area: "security",
    risk: "Secrets are reachable by the agent loop.", recs: ["Keep secrets in env/secret manager; never in prompts, memory, logs or tool outputs.", "Redact outputs with a secret scanner before persisting or sending.", "Use fine-scoped, expiring tokens per integration."], tools: [] },
  { id: "web", when: /web|scrap|browse|url|page|crawl|fetch|research|read/, sev: "medium", area: "reliability/security",
    risk: "Untrusted web content enters the context (prompt injection, SSRF, bloat).", recs: ["Treat fetched content as data; never execute instructions from it.", "Block private/internal IPs and re-check after redirects (SSRF).", "Convert pages to clean Markdown and cap size before feeding the model to cut tokens.", "Cache by URL+ETag to avoid repeat cost."], tools: ["web_markdown", "url_unfurl"] },
  { id: "onchain", when: /chain|evm|ethereum|base|token|contract|ens|address|defi|nft/, sev: "medium", area: "validation",
    risk: "Acting on unverified addresses/contracts.", recs: ["Resolve ENS and checksum addresses; confirm EOA vs contract before sending.", "Check token metadata/decimals on-chain instead of trusting user/LLM text.", "Use 2+ RPC providers with timeouts; simulate (eth_call) before sending txs."], tools: ["evm_address_lookup", "calldata_decode"], propose: ["p_token_risk", "p_tx_explain", "p_gas"] },
  { id: "email", when: /email|outreach|lead|crm|domain|phish|fraud|kyc/, sev: "medium", area: "validation",
    risk: "Acting on unverified domains/contacts.", recs: ["Verify domain age, MX, SPF/DMARC before trusting or emailing.", "Flag domains < 30 days old as phishing risk."], tools: ["domain_lookup"], propose: ["p_email_check"] },
  { id: "json", when: /json|schema|structured|parse|output|format|extract/, sev: "medium", area: "validation",
    risk: "LLM structured output breaks downstream steps.", recs: ["Validate every LLM JSON against a schema; repair-or-retry once, then fail loudly.", "Version your schemas."], tools: [], propose: ["p_json_schema"] },
  { id: "docs", when: /pdf|document|invoice|paper|report/, sev: "low", area: "capability", risk: "Document ingestion path.", recs: ["Extract text deterministically before LLM; keep page refs for citations."], tools: [], propose: ["p_pdf_text"] },
  { id: "schedule", when: /schedul|cron|deadline|calendar|timezone|date/, sev: "low", area: "reliability", risk: "Date/timezone errors.", recs: ["Do date math in code with explicit IANA zones, never in the LLM."], tools: [], propose: ["p_time"] },
];
const BASELINE = [
  { area: "reliability", rec: "Timeouts + bounded retries with backoff on every external call; idempotency keys for side effects." },
  { area: "cost", rec: "Budget tokens and paid calls per task; cache deterministic tool results; prefer cheap deterministic tools over LLM calls." },
  { area: "security", rec: "Least-privilege tools; human approval for irreversible actions (send, pay, delete, deploy)." },
  { area: "observability", rec: "Structured logs per step (inputs hash, tool, cost, latency, outcome) and a kill switch." },
  { area: "validation", rec: "Validate tool outputs before acting; define explicit success criteria per task." },
];
export function advise(f, detailed = false) {
  const t = Object.values(f).filter(Boolean).map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" ").toLowerCase();
  const hit = RULES.filter((r) => has(t, r.when));
  const findings = hit.map((r) => ({ area: r.area, severity: r.sev, risk: r.risk, recommendations: detailed ? r.recs : r.recs.slice(0, 1) }));
  const gaps = [];
  if (!f.constraints) gaps.push("No constraints stated (budget, latency, allowed actions) — define them explicitly.");
  if (!f.must_haves) gaps.push("No must-haves stated — write acceptance criteria so the agent can self-check.");
  if (!/test|eval|monitor|log/.test(t)) gaps.push("No testing/monitoring mentioned — add an eval set and run logs.");
  if (!/approv|human|review|confirm/.test(t) && hit.some((r) => r.sev === "high")) gaps.push("High-risk actions without a human-approval or cap mechanism mentioned.");
  const score = Math.max(0, 100 - hit.reduce((s, r) => s + (r.sev === "high" ? 20 : r.sev === "medium" ? 10 : 3), 0) - gaps.length * 5);
  const out = { readinessScore: score, scoreNote: "Heuristic 0-100; lower = more hardening needed.", findings: detailed ? findings : findings.slice(0, 3), gaps: detailed ? gaps : gaps.slice(0, 2), method: "rule-based heuristics (no LLM)" };
  if (detailed) { out.baseline = BASELINE; out.checklist = [...hit.flatMap((r) => r.recs), ...BASELINE.map((b) => b.rec)].map((x, i) => ({ n: i + 1, item: x, done: false })); }
  return { advice: out, toolHints: [...new Set(hit.flatMap((r) => r.tools))], proposeHints: [...new Set(hit.flatMap((r) => r.propose || []))] };
}
