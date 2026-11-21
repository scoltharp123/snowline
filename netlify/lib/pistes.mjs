// Shared by /api/pistes (quick answer) and /api/pistes-fill (the slow OpenStreetMap lookup, run in the background).
const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = "Snowline/1.0 (snowline-forecast.netlify.app; ski run overlay)";

export const WEEK = 7 * 864e5;
export const pisteKey = (lat, lon) => `pistes-v1-${lat.toFixed(2)}-${lon.toFixed(2)}`;
export const fillKey = (key) => `${key}-fill`;
export const okPoint = (lat, lon) => isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180;
const r5 = (v) => Math.round(v * 1e5) / 1e5;

function query(lat, lon, serverTimeout) {
  const d = 0.06, bb = [lat - d, lon - d * 1.4, lat + d, lon + d * 1.4].map(v => v.toFixed(4)).join(",");
  return `[out:json][timeout:${serverTimeout}];(way["piste:type"](${bb});way["aerialway"]["aerialway"!~"station|pylon|goods"](${bb});node["aerialway"="station"](${bb}););out tags geom;`;
}

// Asks the Overpass servers one at a time (never in parallel, to stay light on these free services).
// Each server gets up to perServerMs; the whole lookup stops at budgetMs.
export async function fetchPistes(lat, lon, { perServerMs = 30000, budgetMs = 120000 } = {}) {
  const q = query(lat, lon, Math.round(perServerMs / 1000) - 2);
  let last; const end = Date.now() + budgetMs;
  for (const url of SERVERS) {
    const left = end - Date.now(); if (left < 3000) break;
    const c = new AbortController(), t = setTimeout(() => c.abort(), Math.min(perServerMs, left));
    try {
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), signal: c.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" } });
      if (!r.ok) throw new Error(new URL(url).hostname + " " + r.status);
      const j = await r.json();
      if (j.remark && /runtime error|timed out/i.test(j.remark) && !(j.elements || []).length) throw new Error(new URL(url).hostname + " " + j.remark.slice(0, 80));
      return shape(j);
    } catch (e) { last = e.name === "AbortError" ? new Error(new URL(url).hostname + " timed out") : e; console.log("pistes:", String(last.message || last)); }
    finally { clearTimeout(t); }
  }
  throw last || new Error("Overpass unavailable");
}

function shape(j) {
  const runs = [], lifts = [], stations = [];
  for (const e of j.elements || []) {
    const t = e.tags || {};
    if (e.type === "node") { stations.push({ name: t.name || "", lat: r5(e.lat), lon: r5(e.lon) }); continue; }
    const pts = (e.geometry || []).map(p => [r5(p.lat), r5(p.lon)]); if (pts.length < 2) continue;
    if (t.aerialway) lifts.push({ name: t.name || "", kind: t.aerialway, pts });
    else runs.push({ name: t.name || t["piste:name"] || "", type: t["piste:type"], diff: t["piste:difficulty"] || "", groom: t["piste:grooming"] || "", area: t.area === "yes", pts });
  }
  return { at: Date.now(), runs: runs.slice(0, 900), lifts, stations, source: "© OpenStreetMap contributors" };
}
