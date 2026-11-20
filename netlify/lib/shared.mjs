// Shared helpers for Snowline functions
import { getStore } from "@netlify/blobs";

export const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";
export const FT = 3.28084;

export function json(data, { status = 200, cache = 0 } = {}) {
  const h = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
  if (cache) {
    h["cache-control"] = "public, max-age=60";
    h["netlify-cdn-cache-control"] = `public, s-maxage=${cache}, stale-while-revalidate=${cache * 2}`;
    h["netlify-vary"] = "query";
  } else h["cache-control"] = "no-store";
  return new Response(JSON.stringify(data), { status, headers: h });
}

export const store = (name) => getStore({ name, consistency: "strong" });

export function km(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function getJSON(url, { timeout = 12000, headers = {} } = {}) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": "Snowline/1.0 (snowline-forecast.netlify.app)", ...headers } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
export async function getText(url, { timeout = 12000 } = {}) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; Snowline/1.0)" } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

const STATES = ["OR", "WA", "ID", "CA", "NV", "UT", "CO", "WY", "MT", "AZ", "NM", "AK", "SD"];
// SNOTEL station list, cached for a week in Blobs
export async function snotelStations() {
  const s = store("snowline-cache");
  try {
    const c = await s.get("snotel-stations-v1", { type: "json" });
    if (c && Date.now() - c.t < 7 * 864e5 && c.list?.length) return c.list;
  } catch (e) {}
  const triplets = STATES.map(st => `*:${st}:SNTL`).join(",");
  const raw = await getJSON(`${AWDB}/stations?stationTriplets=${encodeURIComponent(triplets)}&activeOnly=true&returnForecastPointMetadata=false&returnReservoirMetadata=false&returnStationElements=false`, { timeout: 25000 });
  const list = (Array.isArray(raw) ? raw : []).map(x => ({
    id: x.stationTriplet, name: x.name, lat: +x.latitude, lon: +x.longitude, elevFt: +x.elevation,
  })).filter(x => isFinite(x.lat) && isFinite(x.lon));
  if (list.length) { try { await s.setJSON("snotel-stations-v1", { t: Date.now(), list }); } catch (e) {} }
  return list;
}
export async function nearestStations(lat, lon, n = 2, maxKm = 40) {
  const list = await snotelStations();
  return list.map(x => ({ ...x, km: km(lat, lon, x.lat, x.lon) })).filter(x => x.km <= maxKm).sort((a, b) => a.km - b.km).slice(0, n);
}

// AWDB data → { [triplet]: { [element]: [{date, value}] } }
export async function awdbData(triplets, elements, duration, beginDate, endDate) {
  const url = `${AWDB}/data?stationTriplets=${encodeURIComponent(triplets.join(","))}&elements=${elements.join(",")}&duration=${duration}&beginDate=${encodeURIComponent(beginDate)}&endDate=${encodeURIComponent(endDate)}&periodRef=END&returnFlags=false&returnOriginalValues=false&returnSuspectData=false`;
  const raw = await getJSON(url, { timeout: 20000 });
  const out = {};
  for (const st of (Array.isArray(raw) ? raw : [])) {
    const o = out[st.stationTriplet] = {};
    for (const d of (st.data || [])) {
      const code = d.stationElement?.elementCode || d.elementCode; if (!code) continue;
      o[code] = (d.values || []).map(v => ({ date: v.date, value: v.value == null ? null : +v.value })).filter(v => v.value != null && isFinite(v.value));
    }
  }
  return out;
}
export const ymd = (d) => new Date(d).toISOString().slice(0, 10);
export const daysAgo = (n) => ymd(Date.now() - n * 864e5);

// "new snow" from an hourly depth series: largest rise above the running minimum (robust to settling and sensor noise)
export function newSnowFrom(series) {
  let best = 0, min = Infinity;
  for (const v of series) { if (v == null) continue; min = Math.min(min, v); best = Math.max(best, v - min); }
  return best;
}
