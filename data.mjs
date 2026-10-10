/** Lumen Works free-public-data wrappers: PubMed (NCBI E-utilities), arXiv, SEC EDGAR, Open-Meteo (MET Norway + Nominatim fallback), Polymarket (read-only Gamma API). No keys, no paid upstreams. */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const UA = "LumenWorks-API/1.0 lumenworks-x402-decoder.onrender.com";
const get = async (url, { json = true, headers = {} } = {}) => {
  const r = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw bad(`Upstream HTTP ${r.status}`, r.status === 404 ? 404 : 502);
  return json ? r.json() : r.text();
};
const lim = (v, d, max) => Math.max(1, Math.min(Number(v) || d, max));
const cache = new Map(); const cached = async (k, ttl, f) => { const c = cache.get(k); if (c && Date.now() - c.t < ttl) return c.v; const v = await f(); cache.set(k, { t: Date.now(), v }); if (cache.size > 500) cache.delete(cache.keys().next().value); return v; };

export async function pubmedSearch(input) {
  const q = String(input?.query || "").trim(); if (!q) throw bad("Provide {query}");
  const n = lim(input?.limit, 10, 50), E = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  const sort = input?.sort === "date" ? "pub_date" : "relevance";
  const s = await get(`${E}/esearch.fcgi?db=pubmed&retmode=json&retmax=${n}&sort=${sort}&term=${encodeURIComponent(q)}&tool=lumenworks`);
  const ids = s.esearchresult?.idlist || [];
  if (!ids.length) return { query: q, total: Number(s.esearchresult?.count || 0), results: [] };
  const [sum, abs] = await Promise.all([get(`${E}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}&tool=lumenworks`), input?.abstracts === false ? "" : get(`${E}/efetch.fcgi?db=pubmed&rettype=abstract&retmode=xml&id=${ids.join(",")}&tool=lumenworks`, { json: false }).catch(() => "")]);
  const absMap = {}; for (const art of String(abs).split("<PubmedArticle>").slice(1)) { const pmid = art.match(/<PMID[^>]*>(\d+)</)?.[1]; const t = [...art.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) => m[1].replace(/<[^>]+>/g, "")).join(" "); if (pmid) absMap[pmid] = t.slice(0, 3000) || null; }
  const results = ids.map((id) => { const d = sum.result?.[id] || {}; return { pmid: id, title: d.title, journal: d.fulljournalname || d.source, pubDate: d.pubdate, authors: (d.authors || []).slice(0, 10).map((a) => a.name), doi: d.articleids?.find((a) => a.idtype === "doi")?.value || null, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, abstract: absMap[id] ?? null }; });
  return { query: q, total: Number(s.esearchresult?.count || 0), results, source: "NCBI PubMed E-utilities" };
}

const unx = (s = "") => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
export async function arxivSearch(input) {
  const q = String(input?.query || "").trim(); if (!q) throw bad("Provide {query}");
  const n = lim(input?.limit, 10, 50), sort = input?.sort === "date" ? "submittedDate" : "relevance";
  const sq = /^(all|ti|au|abs|cat|id):/.test(q) ? q : `all:${q}`;
  const xml = await cached(`ax:${sq}:${n}:${sort}`, 600_000, () => get(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(sq)}&start=0&max_results=${n}&sortBy=${sort}&sortOrder=descending`, { json: false }));
  const tag = (s, t) => s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1];
  const total = Number(tag(xml, "opensearch:totalResults") || 0);
  const results = xml.split("<entry>").slice(1).map((e) => ({ id: tag(e, "id")?.split("/abs/")[1], title: unx(tag(e, "title")), summary: unx(tag(e, "summary")).slice(0, 3000), authors: [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => unx(m[1])).slice(0, 15), published: tag(e, "published"), updated: tag(e, "updated"), categories: [...e.matchAll(/<category term="([^"]+)"/g)].map((m) => m[1]), pdf: e.match(/href="([^"]+)"[^>]*title="pdf"/)?.[1] || null, url: tag(e, "id") }));
  return { query: q, total, results, source: "arXiv API" };
}

const SEC_UA = process.env.SEC_USER_AGENT || UA;
const sec = (u) => get(u, { headers: { "user-agent": SEC_UA, accept: "application/json" } });
export async function secFilings(input) {
  const raw = String(input?.ticker || input?.cik || input?.company || "").trim(); if (!raw) throw bad("Provide {ticker} (e.g. AAPL) or {cik}");
  let cik = /^\d{1,10}$/.test(raw) ? raw : null, name = null, ticker = null;
  if (!cik) { const t = await cached("sec:tickers", 864e5, () => sec("https://www.sec.gov/files/company_tickers.json")); const up = raw.toUpperCase(); const hit = Object.values(t).find((x) => x.ticker === up) || Object.values(t).find((x) => x.title.toUpperCase().includes(up)); if (!hit) throw bad("Ticker/company not found in SEC list", 404); cik = String(hit.cik_str); ticker = hit.ticker; name = hit.title; }
  const pad = cik.padStart(10, "0");
  const s = await cached(`sec:sub:${pad}`, 600_000, () => sec(`https://data.sec.gov/submissions/CIK${pad}.json`));
  const r = s.filings?.recent || {}, forms = input?.forms ? [].concat(input.forms).map((f) => String(f).toUpperCase()) : null, n = lim(input?.limit, 15, 100);
  const filings = []; for (let i = 0; i < (r.form || []).length && filings.length < n; i++) { if (forms && !forms.includes(r.form[i])) continue; const acc = r.accessionNumber[i]; filings.push({ form: r.form[i], filed: r.filingDate[i], reportDate: r.reportDate[i] || null, description: r.primaryDocDescription[i] || null, url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${r.primaryDocument[i]}` }); }
  let facts = null;
  if (input?.facts !== false) { const f = await cached(`sec:facts:${pad}`, 36e5, () => sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad}.json`)).catch(() => null); const g = f?.facts?.["us-gaap"] || {}; const last = (k) => { const u = g[k]?.units; const arr = u && (u.USD || u["USD/shares"] || Object.values(u)[0]); const fy = arr?.filter((x) => x.form === "10-K" && x.fp === "FY"); const x = (fy?.length ? fy : arr)?.at(-1); return x ? { value: x.val, period: x.end, form: x.form, fy: x.fy } : undefined; }; facts = Object.fromEntries(["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "NetIncomeLoss", "Assets", "Liabilities", "StockholdersEquity", "EarningsPerShareDiluted", "CashAndCashEquivalentsAtCarryingValue"].map((k) => [k, last(k)]).filter(([, v]) => v)); }
  return { cik: pad, name: s.name || name, ticker: ticker || s.tickers?.[0] || null, sic: s.sic, sicDescription: s.sicDescription, stateOfIncorporation: s.stateOfIncorporation, fiscalYearEnd: s.fiscalYearEnd, filings, latestAnnualFacts: facts, source: "SEC EDGAR (data.sec.gov)" };
}

const CONTACT_UA = process.env.WEATHER_USER_AGENT || "LumenWorks-API/1.3 (+https://github.com/Dansgit2b/lumenworks-x402-api)";
let nomLast = 0; const nomQueue = { p: Promise.resolve() };
// Nominatim usage policy: max 1 req/s, identifying UA, cache results. Serialized + 24h cache.
const nominatim = (q) => (nomQueue.p = nomQueue.p.catch(() => {}).then(async () => { const w = 1100 - (Date.now() - nomLast); if (w > 0) await new Promise((r) => setTimeout(r, w)); nomLast = Date.now(); return get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&addressdetails=1`, { headers: { "user-agent": CONTACT_UA, "accept-language": "en" } }); }));
async function geocode(q) {
  return cached(`geo:${q.toLowerCase()}`, 864e5, async () => {
    try { const g = await get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&format=json`); const h = g.results?.[0]; if (h) return { latitude: h.latitude, longitude: h.longitude, name: h.name, country: h.country, admin1: h.admin1, timezone: h.timezone, geocoder: "open-meteo" }; } catch {}
    const n = (await nominatim(q))?.[0]; if (!n) throw bad("Location not found", 404);
    const ad = n.address || {}; return { latitude: +n.lat, longitude: +n.lon, name: n.name || n.display_name, country: ad.country, admin1: ad.state, timezone: null, geocoder: "nominatim (© OpenStreetMap contributors, ODbL)" };
  });
}
const WMO_FROM_MET = (s = "") => { s = s.replace(/_(day|night|polartwilight)$/, ""); if (/thunder/.test(s)) return 95; if (/snow/.test(s)) return /heavy/.test(s) ? 75 : /light/.test(s) ? 71 : 73; if (/sleet/.test(s)) return 68; if (/rain/.test(s)) return /heavy/.test(s) ? 65 : /light/.test(s) ? 61 : 63; if (s === "fog") return 45; if (s === "cloudy") return 3; if (s === "partlycloudy") return 2; if (s === "fair") return 1; if (s === "clearsky") return 0; return null; };
async function metNorway(lat, lon, days, imperial) {
  const j = await get(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { headers: { "user-agent": CONTACT_UA } });
  const ts = j.properties?.timeseries || []; if (!ts.length) throw bad("No forecast data", 502);
  const cv = (c) => (imperial ? Math.round((c * 9 / 5 + 32) * 10) / 10 : c), ws = (m) => (imperial ? Math.round(m * 2.23694 * 10) / 10 : Math.round(m * 3.6 * 10) / 10), pr = (mm) => (imperial ? Math.round(mm / 25.4 * 100) / 100 : mm);
  const c0 = ts[0].data.instant.details, n1 = ts[0].data.next_1_hours || ts[0].data.next_6_hours;
  const byDay = new Map(); for (const t of ts) { const d = t.time.slice(0, 10), x = t.data.instant.details; const e = byDay.get(d) || { t: [], w: [], p: 0, codes: [] }; e.t.push(x.air_temperature); e.w.push(x.wind_speed); if (t.data.next_1_hours) e.p += t.data.next_1_hours.details?.precipitation_amount || 0; else if (t.data.next_6_hours && !e.h6) e.p += t.data.next_6_hours.details?.precipitation_amount || 0; const sym = (t.data.next_6_hours || t.data.next_1_hours)?.summary?.symbol_code; if (sym && t.time.slice(11, 13) >= "06" && t.time.slice(11, 13) <= "18") e.codes.push(WMO_FROM_MET(sym)); byDay.set(d, e); }
  const daily = [...byDay.entries()].slice(0, days).map(([date, e]) => ({ date, weatherCode: e.codes.length ? Math.max(...e.codes.filter((c) => c !== null), 0) : null, tMax: cv(Math.max(...e.t)), tMin: cv(Math.min(...e.t)), precipSum: pr(Math.round(e.p * 10) / 10), precipProbMax: null, windMax: ws(Math.max(...e.w)), uvMax: null, sunrise: null, sunset: null }));
  return { latitude: lat, longitude: lon, timezone: "UTC", units: { temperature_2m: imperial ? "°F" : "°C", wind_speed_10m: imperial ? "mph" : "km/h", precipitation: imperial ? "inch" : "mm", time: "iso8601 UTC" }, current: { time: ts[0].time, temperature_2m: cv(c0.air_temperature), relative_humidity_2m: c0.relative_humidity, wind_speed_10m: ws(c0.wind_speed), wind_direction_10m: c0.wind_from_direction, precipitation: pr(n1?.details?.precipitation_amount ?? null), weather_code: WMO_FROM_MET(n1?.summary?.symbol_code) }, daily, source: "MET Norway Locationforecast 2.0 (CC BY 4.0, fallback; dates in UTC, up to ~10 days)" };
}
export async function weather(input) {
  let { latitude: lat, longitude: lon } = input || {}; let place = null;
  if (lat === undefined || lon === undefined) { const q = String(input?.location || input?.city || "").trim(); if (!q) throw bad("Provide {location} or {latitude, longitude}"); const h = await geocode(q); lat = h.latitude; lon = h.longitude; place = { name: h.name, country: h.country, admin1: h.admin1, timezone: h.timezone, geocoder: h.geocoder }; }
  lat = +lat; lon = +lon;
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw bad("Invalid coordinates");
  const days = lim(input?.days, 7, 16), imperial = input?.units === "imperial", units = imperial ? "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch" : "";
  const rl = Math.round(lat * 100) / 100, rn = Math.round(lon * 100) / 100; // ~1 km grid: shared cache key and upstream coords
  const out = await cached(`wx:${rl},${rn}:${days}:${imperial}`, 600_000, async () => {
    try {
      const w = await get(`https://api.open-meteo.com/v1/forecast?latitude=${rl}&longitude=${rn}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=${days}${units}`);
      const d = w.daily || {};
      return { latitude: w.latitude, longitude: w.longitude, timezone: w.timezone, units: { ...w.current_units }, current: w.current, daily: (d.time || []).map((t, i) => ({ date: t, weatherCode: d.weather_code[i], tMax: d.temperature_2m_max[i], tMin: d.temperature_2m_min[i], precipSum: d.precipitation_sum[i], precipProbMax: d.precipitation_probability_max?.[i], windMax: d.wind_speed_10m_max[i], uvMax: d.uv_index_max?.[i], sunrise: d.sunrise[i], sunset: d.sunset[i] })), source: "Open-Meteo (CC BY 4.0)" };
    } catch (e) { return await metNorway(rl, rn, days, imperial); }
  });
  return { place, ...out };
}

const pm = (m) => { const p = (s) => { try { return JSON.parse(s); } catch { return null; } }; const outcomes = p(m.outcomes) || [], prices = p(m.outcomePrices) || []; return { question: m.question, slug: m.slug, endDate: m.endDate, outcomes: outcomes.map((o, i) => ({ outcome: o, probability: prices[i] !== undefined ? Number(prices[i]) : null })), volume24h: m.volume24hr !== undefined ? Number(m.volume24hr) : null, volumeTotal: m.volume !== undefined ? Number(m.volume) : null, liquidity: m.liquidity !== undefined ? Number(m.liquidity) : null, active: m.active, closed: m.closed, url: m.slug ? `https://polymarket.com/market/${m.slug}` : null }; };
export async function polymarketMarkets(input) {
  const q = String(input?.query || "").trim(), n = lim(input?.limit, 10, 50);
  if (q) { const j = await cached(`pm:s:${q}:${n}`, 60_000, () => get(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=${n}&events_status=active`)); const markets = (j.events || []).flatMap((e) => (e.markets || []).filter((m) => !m.closed).map((m) => ({ event: e.title, ...pm(m) }))).sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)).slice(0, n); return { query: q, markets, note: "Read-only market data; probabilities = last outcome prices. Not financial advice.", source: "Polymarket Gamma API" }; }
  const j = await cached(`pm:top:${n}`, 60_000, () => get(`https://gamma-api.polymarket.com/markets?limit=${n}&active=true&closed=false&order=volume24hr&ascending=false`));
  return { query: null, markets: j.map(pm), note: "Top active markets by 24h volume. Read-only data; not financial advice.", source: "Polymarket Gamma API" };
}
