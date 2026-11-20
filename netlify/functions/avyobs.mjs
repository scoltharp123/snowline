// GET /api/avyobs?lat=..&lon=.. → field observations near a spot from the last 14 days, as published on avalanche.org
// (Central Oregon Avalanche Center and other centers on the avalanche.org platform). Facts as reported; no ratings added.
import { json } from "../lib/shared.mjs";

const CENTER_LINK = { coaa: "https://coavalanche.org/pages/observations#/view/observations/", nwac: "https://nwac.us/observations/#/view/observations/" };
export default async (req) => {
  const q = new URL(req.url).searchParams; const lat = +q.get("lat"), lon = +q.get("lon");
  if (!isFinite(lat) || !isFinite(lon)) return json({ error: "lat/lon required" }, { status: 400 });
  const d = 0.35, end = new Date(), start = new Date(Date.now() - 14 * 864e5), ymd = (x) => x.toISOString().slice(0, 10);
  const url = `https://api.avalanche.org/obs/v1/public/observation/list/?start_date[gte]=${ymd(start)}&start_date[lte]=${ymd(end)}&page=1&page_size=25&sort_by=start_date&sort_order=desc&bbox=${(lon - d * 1.4).toFixed(3)},${(lat - d).toFixed(3)},${(lon + d * 1.4).toFixed(3)},${(lat + d).toFixed(3)}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Snowline (snowline-forecast.netlify.app)" }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error("avalanche.org " + r.status);
    const j = await r.json();
    const obs = (j.results || []).filter((o) => o.status === "published").map((o) => {
      const i = o.instability || {}, c = String(o.center_id || "").toLowerCase();
      return { id: o.id, date: o.start_date, where: o.location_name || o.zone_name || "", zone: o.zone_name || "", pro: o.observer_type && o.observer_type !== "public", who: o.show_name ? o.name : null, org: o.organization || null,
        lat: o.location_point?.lat, lon: o.location_point?.lng,
        flags: { cracking: !!i.cracking, collapsing: !!i.collapsing, avalanchesSeen: !!i.avalanches_observed, triggered: !!i.avalanches_triggered, caught: !!i.avalanches_caught },
        instability: String(o.instability_summary || "").trim().slice(0, 600), avalanches: String(o.avalanches_summary || "").trim().slice(0, 600), summary: String(o.observation_summary || "").trim().slice(0, 900),
        photo: (o.media || []).find((m) => m.type === "image")?.url?.thumbnail || null, link: (CENTER_LINK[c] || "https://avalanche.org/#") + o.id };
    });
    return json({ obs, total: j.total || obs.length, from: ymd(start) }, { cache: 900 });
  } catch (e) { return json({ obs: [], error: String(e.message || e) }, { cache: 120 }); }
};
export const config = { path: "/api/avyobs" };
