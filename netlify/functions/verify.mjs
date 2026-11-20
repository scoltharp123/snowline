// GET /api/verify?lat=..&lon=.. → per-model skill at the nearest SNOTEL station
// Compares each model's 1-day-ahead precipitation forecast (Open-Meteo Previous Runs API)
// with measured precipitation (SNOTEL PREC / SWE gain) over the last 30 days.
import { json, nearestStations, awdbData, daysAgo, getJSON, store, FT } from "../lib/shared.mjs";

const MODELS = {
  ecmwf: ["ecmwf_ifs025"], aifs: ["ecmwf_aifs025_single", "ecmwf_aifs025"], gfs: ["gfs_seamless"],
  hrrr: ["ncep_hrrr_conus", "gfs_hrrr"], nbm: ["ncep_nbm_conus"], gem: ["gem_seamless"],
  icon: ["icon_seamless"], ukmo: ["ukmo_seamless"], jma: ["jma_seamless"],
};
const DAYS = 30;

async function modelDaily(st, apis, start, end) {
  for (const api of apis) {
    try {
      const url = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}&elevation=${Math.round(st.elevFt / FT)}&hourly=precipitation_previous_day1&models=${api}&start_date=${start}&end_date=${end}&timezone=America%2FLos_Angeles`;
      const j = await getJSON(url, { timeout: 15000 });
      const h = j.hourly || {}; const key = Object.keys(h).find(k => k.startsWith("precipitation_previous_day1")); if (!key) continue;
      const out = {}; let any = false;
      h.time.forEach((t, i) => { const v = h[key][i]; if (v == null) return; any = true; const d = t.slice(0, 10); out[d] = (out[d] || 0) + v; });
      if (any) return out;
    } catch (e) {}
  }
  return null;
}

export default async (req) => {
  const u = new URL(req.url);
  const lat = +u.searchParams.get("lat"), lon = +u.searchParams.get("lon");
  if (!isFinite(lat) || !isFinite(lon)) return json({ error: "lat/lon required" }, { status: 400 });
  try {
    const [st] = await nearestStations(lat, lon, 1, 40);
    if (!st) return json({ status: "no-station" }, { cache: 86400 });
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `verify-${st.id}-${today}`;
    const s = store("snowline-cache");
    try { const c = await s.get(cacheKey, { type: "json" }); if (c) return json(c, { cache: 21600 }); } catch (e) {}

    const start = daysAgo(DAYS + 1), end = daysAgo(1);
    const obs = await awdbData([st.id], ["PREC", "WTEQ"], "DAILY", daysAgo(DAYS + 2), end);
    const o = obs[st.id] || {};
    // observed daily precip (mm): PREC increments, fall back to SWE gains
    const daily = {};
    const inc = (arr) => { for (let i = 1; i < arr.length; i++) { const dv = arr[i].value - arr[i - 1].value; const d = String(arr[i].date).slice(0, 10); if (dv >= 0 && dv < 6) daily[d] = dv * 25.4; else if (dv < 0) daily[d] = daily[d] ?? 0; } };
    if ((o.PREC || []).length > 10) inc(o.PREC); else inc(o.WTEQ || []);
    const days = Object.keys(daily).filter(d => d >= start && d <= end).sort();
    if (days.length < 10) return json({ status: "insufficient-obs", station: st }, { cache: 21600 });

    const results = await Promise.all(Object.entries(MODELS).map(async ([id, apis]) => [id, await modelDaily(st, apis, start, end)]));
    const scores = {};
    for (const [id, f] of results) {
      if (!f) continue;
      let n = 0, ae = 0, sf = 0, so = 0, wet = 0;
      for (const d of days) {
        const fo = f[d], ob = daily[d]; if (fo == null || ob == null) continue;
        if (fo < 0.5 && ob < 0.5) { n++; continue; }      // correct dry day
        wet++; n++; ae += Math.abs(fo - ob); sf += fo; so += ob;
      }
      if (n < 10) continue;
      scores[id] = { days: n, wetDays: wet, mae: wet ? ae / wet : 0, bias: so > 2 ? sf / so : 1, fcstMm: Math.round(sf), obsMm: Math.round(so) };
    }
    const ids = Object.keys(scores);
    const wetTotal = Object.values(daily).filter(v => v >= 0.5).length;
    let weights = {}, status = "ok";
    if (ids.length < 3 || wetTotal < 4) status = "too-dry";
    else {
      const raw = Object.fromEntries(ids.map(id => [id, 1 / Math.pow(scores[id].mae + 1.5, 2)]));
      const mean = Object.values(raw).reduce((a, b) => a + b, 0) / ids.length;
      weights = Object.fromEntries(ids.map(id => [id, Math.max(0.4, Math.min(2.2, raw[id] / mean))]));
    }
    const best = ids.length ? ids.reduce((a, b) => scores[a].mae <= scores[b].mae ? a : b) : null;
    const out = { status, station: { id: st.id, name: st.name, km: Math.round(st.km), elevFt: st.elevFt }, days: days.length, wetDays: wetTotal, scores, weights, best, updated: new Date().toISOString() };
    try { await s.setJSON(cacheKey, out); } catch (e) {}
    return json(out, { cache: 21600 });
  } catch (e) {
    return json({ status: "error", error: String(e.message || e) }, { cache: 600 });
  }
};
export const config = { path: "/api/verify" };
