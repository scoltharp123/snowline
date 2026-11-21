// GET /api/nws?lat=..&lon=.. → National Weather Service data for a US point (public domain, free):
//   alerts: active watches, warnings and advisories for the point
//   afd:    the local office's Area Forecast Discussion, written by its meteorologists, split into sections
// Points → office is kept for 30 days, the discussion for 30 minutes per office (then re-downloaded only if the office
// has issued a new one), alerts for 5 minutes per point. Alerts and the discussion are fetched at the same time.
import { json, store } from "../lib/shared.mjs";

const UA = { "User-Agent": "Snowline (snowline-forecast.netlify.app)", Accept: "application/geo+json" };
async function nws(path, ms = 7000) {
  const r = await fetch("https://api.weather.gov" + path, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error("NWS " + r.status);
  return r.json();
}
const KEEP = ["KEY MESSAGES", "SYNOPSIS", "DISCUSSION", "SHORT TERM", "LONG TERM", "UPDATE"];
function parseAFD(text) {
  const t = String(text || "").replace(/\r/g, "");
  const out = [];
  for (const chunk of t.split(/\n&&\n/)) {
    const m = chunk.match(/^[ \t]*\.([A-Z][A-Z ]+?)[ \t]*(\/[^\n]*?\/)?[ \t]*\.\.\.(.*)$/m);
    if (!m) continue;
    const name = m[1].trim();
    const key = KEEP.find(k => name.startsWith(k)); if (!key) continue;
    const sub = (m[2] || "").replace(/^\/|\/$/g, "");
    const rest = (m[3] ? m[3] + "\n" : "") + chunk.slice(chunk.indexOf(m[0]) + m[0].length);
    // join wrapped lines into paragraphs; keep numbered/bulleted items on their own lines
    const body = rest.split(/\n\s*\n/).map(p => p.replace(/\n(?!\s*[-*•]|\s*\d+[.)])/g, " ").replace(/[ \t]+/g, " ").trim()).filter(Boolean)
      .filter(p => !/^\$\$|^[A-Z]{2}\.\.\.|^(Issued|Updated) at/i.test(p));
    if (body.length) out.push({ key, title: name.charAt(0) + name.slice(1).toLowerCase(), when: sub.trim(), text: body.join("\n\n").slice(0, 4000) });
  }
  return out;
}

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const lat = +q.get("lat"), lon = +q.get("lon");
  if (!isFinite(lat) || !isFinite(lon)) return json({ error: "lat/lon required" }, { status: 400 });
  const s = store("snowline-cache"), now = Date.now();
  const pk = `nws-pt-${lat.toFixed(2)}-${lon.toFixed(2)}`;
  let pt = null;
  try { const c = await s.get(pk, { type: "json" }); if (c && now - c.at < 30 * 864e5) pt = c; } catch (e) {}
  if (!pt) {
    try {
      const p = await nws(`/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
      pt = { at: now, office: p.properties?.cwa || null, city: p.properties?.relativeLocation?.properties?.city || null };
    } catch (e) { pt = { at: now, office: null, err: String(e.message || e) }; }
    if (pt.office || /404/.test(pt.err || "")) { try { await s.setJSON(pk, pt); } catch (e) {} }   // outside the US the answer is 404: remember that too
  }
  if (!pt.office) return json({ covered: false }, { cache: 3600 });

  // Alerts for the point and the office's latest Area Forecast Discussion are fetched side by side
  // (they used to run one after the other, which made a first load take 3-4 s).
  const getAlerts = async () => {
    try {
      const a = await nws(`/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`);
      return (a.features || []).map(f => f.properties).filter(Boolean).map(p => ({
        event: p.event, headline: p.headline, severity: p.severity, onset: p.onset || p.effective, ends: p.ends || p.expires,
        area: p.areaDesc, desc: String(p.description || "").replace(/\s*\n\s*/g, " ").slice(0, 1200), instr: String(p.instruction || "").replace(/\s*\n\s*/g, " ").slice(0, 500),
      }));
    } catch (e) { return []; }
  };
  const ak = `nws-afd-${pt.office}`;
  const getAFD = async () => {
    let cached = null;
    try { cached = await s.get(ak, { type: "json" }); } catch (e) {}
    if (cached && now - cached.at < 30 * 60e3) return cached;
    try {
      const list = await nws(`/products/types/AFD/locations/${pt.office}`);
      const latest = (list["@graph"] || [])[0];
      if (!latest) return cached;
      // Same discussion as the copy we have (offices issue a few a day): keep it and just mark it checked.
      if (cached && cached.id === latest.id) { const kept = { ...cached, at: now }; try { await s.setJSON(ak, kept); } catch (e) {} return kept; }
      const prod = await nws(`/products/${latest.id}`);
      const afd = { at: now, id: latest.id, issued: prod.issuanceTime, office: pt.office, officeName: (prod.issuingOffice || pt.office), sections: parseAFD(prod.productText),
        url: `https://forecast.weather.gov/product.php?site=NWS&issuedby=${pt.office}&product=AFD&format=txt&version=1&glossary=1` };
      try { await s.setJSON(ak, afd); } catch (e) {}
      return afd;
    } catch (e) { return cached; }
  };
  const [alerts, afd] = await Promise.all([getAlerts(), getAFD()]);
  return json({ covered: true, office: pt.office, alerts, afd }, { cache: 300 });
};
export const config = { path: "/api/nws" };
