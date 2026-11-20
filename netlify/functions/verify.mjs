// GET /api/verify?lat=..&lon=.. → per-model skill at the nearest SNOTEL station
// Compares each model's 1-day-ahead precipitation forecast (Open-Meteo Previous Runs API)
// with measured precipitation (SNOTEL PREC / SWE gain) over the last 30 days.
import { json, nearestStations, awdbData, daysAgo, getJSON, store, FT } from "../lib/shared.mjs";

const MODELS = {
  ecmwf: ["ecmwf_ifs025"], aifs: ["ecmwf_aifs025_single"], gfs: ["gfs_seamless"],
  hrrr: ["ncep_hrrr_conus"], nbm: ["ncep_nbm_conus"], gem: ["gem_seamless"],
  icon: ["icon_seamless"], ukmo: ["ukmo_seamless"], jma: ["jma_seamless"],
};
const DAYS = 30;

async function modelDaily(st, apis, start, end) {
  for (const api of apis) {
    try {
      const url = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}&elevation=${Math.round(st.elevFt / FT)}&hourly=precipitation_previous_day1,snowfall_previous_day1&models=${api}&start_date=${start}&end_date=${end}&timezone=America%2FLos_Angeles`;
      const j = await getJSON(url, { timeout: 15000 });
      const h = j.hourly || {}; const key = Object.keys(h).find(k => k.startsWith("precipitation_previous_day1")); if (!key) continue;
      const skey = Object.keys(h).find(k => k.startsWith("snowfall_previous_day1"));
      const out = {}, snow = {}; let any = false;
      h.time.forEach((t, i) => { const v = h[key][i]; if (v == null) return; any = true; const d = t.slice(0, 10); out[d] = (out[d] || 0) + v;
        const sv = skey ? h[skey][i] : null; if (sv != null) snow[d] = (snow[d] || 0) + sv / 2.54; });
      if (any) { Object.defineProperty(out, "_snow", { value: Object.keys(snow).length ? snow : null, enumerable: false }); return out; }
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
    const cacheKey = `verify-v3-${st.id}-${today}`;
    const s = store("snowline-cache");
    try { const c = await s.get(cacheKey, { type: "json" }); if (c) return json(c, { cache: 21600 }); } catch (e) {}

    const start = daysAgo(DAYS + 1), end = daysAgo(1);
    const obs = await awdbData([st.id], ["PREC", "WTEQ", "SNWD"], "DAILY", daysAgo(DAYS + 2), end);
    const o = obs[st.id] || {};
    // observed daily precip (mm): PREC increments, fall back to SWE gains
    const daily = {};
    const inc = (arr) => { for (let i = 1; i < arr.length; i++) { const dv = arr[i].value - arr[i - 1].value; const d = String(arr[i].date).slice(0, 10); if (dv >= 0 && dv < 6) daily[d] = dv * 25.4; else if (dv < 0) daily[d] = daily[d] ?? 0; } };
    if ((o.PREC || []).length > 10) inc(o.PREC); else inc(o.WTEQ || []);
    const days = Object.keys(daily).filter(d => d >= start && d <= end).sort();
    if (days.length < 10) return json({ status: "insufficient-obs", station: st }, { cache: 21600 });

    const results = await Promise.all(Object.entries(MODELS).map(async ([id, apis]) => [id, await modelDaily(st, apis, start, end)]));
    const scores = {}; const seen = new Set();
    for (const [id, f] of results) {
      if (!f) continue;
      const sig = JSON.stringify(Object.values(f).slice(-10).map(v => Math.round(v * 10)));
      if (seen.has(sig)) continue; seen.add(sig);
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
    // ---- Forecast vs. actual, storm by storm ----
    const depthGain = {}; const sd = o.SNWD || [];
    for (let i = 1; i < sd.length; i++) { const dv = sd[i].value - sd[i - 1].value; depthGain[String(sd[i].date).slice(0, 10)] = Math.max(0, dv); }
    const uniq = []; const sigs = new Set();
    for (const [id, f] of results) { if (!f || !f._snow) continue; const sig = JSON.stringify(Object.values(f).slice(-10).map(v => Math.round(v * 10))); if (sigs.has(sig)) continue; sigs.add(sig); uniq.push(f); }
    const wetDay = (d) => (daily[d] ?? 0) >= 2.5 || (depthGain[d] ?? 0) >= 1;
    const storms = []; let cur = null;
    for (const d of days) {
      if (wetDay(d)) { if (!cur) cur = { days: [] }; cur.days.push(d); }
      else if (cur) { storms.push(cur); cur = null; }
    }
    if (cur) { cur.ongoing = true; storms.push(cur); }
    const stormOut = storms.map(x => {
      const obsSnow = x.days.reduce((a, d) => a + (depthGain[d] || 0), 0), obsWater = x.days.reduce((a, d) => a + (daily[d] || 0), 0) / 25.4;
      const per = uniq.map(f => ({ s: x.days.reduce((a, d) => a + (f._snow[d] || 0), 0), w: x.days.reduce((a, d) => a + (f[d] || 0), 0) / 25.4 })).filter(v => isFinite(v.s));
      if (per.length < 3) return null;
      const ss = per.map(v => v.s).sort((a, b) => a - b), mean = ss.reduce((a, b) => a + b, 0) / ss.length;
      return { start: x.days[0], end: x.days[x.days.length - 1], ongoing: !!x.ongoing, obsSnow: Math.round(obsSnow * 10) / 10, obsWater: Math.round(obsWater * 100) / 100,
        fcstSnow: Math.round(mean * 10) / 10, fcstLo: Math.round(ss[0] * 10) / 10, fcstHi: Math.round(ss[ss.length - 1] * 10) / 10,
        fcstWater: Math.round(per.reduce((a, v) => a + v.w, 0) / per.length * 100) / 100, models: per.length };
    }).filter(x => x && (x.obsSnow >= 2 || x.obsWater >= 0.25)).reverse().slice(0, 4);
    const out = { storms: stormOut, status, station: { id: st.id, name: st.name, km: Math.round(st.km), elevFt: st.elevFt }, days: days.length, wetDays: wetTotal, scores, weights, best, updated: new Date().toISOString() };
    try { await s.setJSON(cacheKey, out); } catch (e) {}
    return json(out, { cache: 21600 });
  } catch (e) {
    return json({ status: "error", error: String(e.message || e) }, { cache: 600 });
  }
};
export const config = { path: "/api/verify" };
