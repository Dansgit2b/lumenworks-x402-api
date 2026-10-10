/** Fetch the unpaid 402 for every paid route from a running server and validate its bazaar extension with the official @x402/extensions validators. */
import { validateDiscoveryExtension, validateDiscoveryExtensionSpec, validateAndExtract } from "@x402/extensions/bazaar";
const B = process.argv[2] || "http://127.0.0.1:4021", paths = (await (await fetch(`${B}/.well-known/x402`)).json()).resources.map((u) => new URL(u).pathname);
let bad = 0;
for (const p of paths) {
  const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const pr = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString()), ext = pr.extensions?.bazaar;
  const spec = ext ? validateDiscoveryExtensionSpec(ext) : { valid: false, errors: ["missing"] }, sch = ext ? validateDiscoveryExtension(ext) : spec;
  let extract; try { extract = validateAndExtract(ext); } catch (e) { extract = { valid: false, errors: [e.message] }; }
  const props = Object.keys(ext?.info?.input?.body ? (ext.schema.properties.input.properties.body.properties || {}) : {}), hasEx = !!(ext?.info?.output?.example && Object.keys(ext.info.output.example).length);
  const ok = spec.valid && sch.valid && extract.valid !== false && props.length && hasEx; if (!ok) bad++;
  const q = await fetch(B + p, { method: "HEAD" });
  console.log(`${ok ? "OK " : "BAD"} ${p} spec=${spec.valid} schema=${sch.valid} extract=${extract.valid ?? "?"} inputProps=${props.length} outputExample=${hasEx} desc=${(pr.resource?.description || "").length}ch HEAD=${q.status} ${[...(spec.errors || []), ...(sch.errors || []), ...(extract.errors || [])].join("; ")}`);
}
console.log(bad ? `${bad} route(s) failed` : "all routes valid"); process.exit(bad ? 1 : 0);
