// GET /api/pistes?lat=..&lon=.. → ski runs, Nordic trails and lifts from OpenStreetMap around a spot.
// Cached for a week in Netlify Blobs (runs rarely change) so Overpass is asked at most once per spot per week.
import { json, store } from "../lib/shared.mjs";

const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = "Snowline/1.0 (snowline-forecast.netlify.app; ski run overlay)";

// Netlify ends a function at 10 s, so all servers share one ~9 s budget.
async function overpass(q) {
  let last; const end = Date.now() + 9000;
  for (const url of SERVERS) {
    const left = end - Date.now(); if (left < 1500) break;
    const c = new AbortController(), t = setTimeout(() => c.abort(), Math.min(6500, left));
    try {
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), signal: c.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" } });
      if (!r.ok) throw new Error(url + " " + r.status);
      return await r.json();
    } catch (e) { last = e; } finally { clearTimeout(t); }
  }
  throw last || new Error("Overpass unavailable");
}
const r5 = (v) => Math.round(v * 1e5) / 1e5;

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const lat = +q.get("lat"), lon = +q.get("lon");
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 85) return json({ error: "lat/lon required" }, { status: 400 });
  const kLat = lat.toFixed(2), kLon = lon.toFixed(2);
  const key = `pistes-v1-${kLat}-${kLon}`, s = store("snowline-cache");
  try { const c = await s.get(key, { type: "json" }); if (c && Date.now() - c.at < 7 * 864e5) return json(c, { cache: 86400 }); } catch (e) {}
  const d = 0.06, bb = [lat - d, lon - d * 1.4, lat + d, lon + d * 1.4].map(v => v.toFixed(4)).join(",");
  const query = `[out:json][timeout:8];(way["piste:type"](${bb});way["aerialway"]["aerialway"!~"station|pylon|goods"](${bb});node["aerialway"="station"](${bb}););out tags geom;`;
  try {
    const j = await overpass(query);
    const runs = [], lifts = [], stations = [];
    for (const e of j.elements || []) {
      const t = e.tags || {};
      if (e.type === "node") { stations.push({ name: t.name || "", lat: r5(e.lat), lon: r5(e.lon) }); continue; }
      const pts = (e.geometry || []).map(p => [r5(p.lat), r5(p.lon)]); if (pts.length < 2) continue;
      if (t.aerialway) lifts.push({ name: t.name || "", kind: t.aerialway, pts });
      else runs.push({ name: t.name || t["piste:name"] || "", type: t["piste:type"], diff: t["piste:difficulty"] || "", groom: t["piste:grooming"] || "", area: t.area === "yes", pts });
    }
    const out = { at: Date.now(), runs: runs.slice(0, 900), lifts, stations, source: "© OpenStreetMap contributors" };
    try { await s.setJSON(key, out); } catch (e) {}
    return json(out, { cache: 86400 });
  } catch (e) {
    try { const c = await s.get(key, { type: "json" }); if (c) return json(c, { cache: 600 }); } catch (_) {}
    return json({ runs: [], lifts: [], stations: [], error: String(e.message || e) }, { cache: 300 });
  }
};
export const config = { path: "/api/pistes" };
