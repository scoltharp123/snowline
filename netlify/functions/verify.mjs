// GET /api/verify?lat=..&lon=.. → how well each model (and Snowline itself) has done at the nearest SNOTEL station
//
// 1. Model skill by lead time: each model's forecast made 1, 3 and 5 days ahead (Open-Meteo Previous Runs API)
//    against measured precipitation (SNOTEL PREC, or SWE gains) over the last 90 days. If that window has
//    too few wet days (early season), last winter (Dec–Feb) is used instead.
//    → weights by lead time (better models get more say) and a capped wet/dry correction per model.
// 2. Storm by storm: forecast vs. measured snow and water for the last storms, with the closest model.
// 3. Snowline's own record: the forecasts Snowline saved each morning (POST /api/score) graded against
//    what fell, plus a snow-to-water calibration once enough storms are graded.
import { json, nearestStations, awdbData, daysAgo, getJSON, store, FT } from "../lib/shared.mjs";

const MODELS = {
  ecmwf: ["ecmwf_ifs025"], aifs: ["ecmwf_aifs025_single"], gfs: ["gfs_seamless"],
  hrrr: ["ncep_hrrr_conus"], nbm: ["ncep_nbm_conus"], gem: ["gem_seamless"],
  icon: ["icon_seamless"], ukmo: ["ukmo_seamless"], jma: ["jma_seamless"],
};
const LEADS = [1, 3, 5];
const DAYS = 90;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;

async function modelDaily(st, apis, start, end) {
  const vars = [...LEADS.map(l => `precipitation_previous_day${l}`), "snowfall_previous_day1"].join(",");
  for (const api of apis) {
    try {
      const url = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}&elevation=${Math.round(st.elevFt / FT)}&hourly=${vars}&models=${api}&start_date=${start}&end_date=${end}&timezone=auto`;
      const j = await getJSON(url, { timeout: 20000 });
      const h = j.hourly || {}; if (!h.time) continue;
      const out = { snow: {} }; let any = false;
      for (const l of LEADS) {
        const key = Object.keys(h).find(k => k.startsWith(`precipitation_previous_day${l}`)); if (!key) continue;
        const m = {}; h.time.forEach((t, i) => { const v = h[key][i]; if (v == null) return; any = true; const d = t.slice(0, 10); m[d] = (m[d] || 0) + v; });
        out[l] = m;
      }
      const sk = Object.keys(h).find(k => k.startsWith("snowfall_previous_day1"));
      if (sk) h.time.forEach((t, i) => { const v = h[sk][i]; if (v == null) return; const d = t.slice(0, 10); out.snow[d] = (out.snow[d] || 0) + v / 2.54; });
      if (any && out[1]) return out;
    } catch (e) {}
  }
  return null;
}

// observed daily water (mm) from PREC increments, falling back to SWE gains; daily depth gain (in)
function observed(o) {
  const daily = {}, depth = {};
  const inc = (arr) => { for (let i = 1; i < arr.length; i++) { const dv = arr[i].value - arr[i - 1].value; const d = String(arr[i].date).slice(0, 10); if (dv >= 0 && dv < 6) daily[d] = dv * 25.4; else if (dv < 0) daily[d] = 0; } };
  if ((o.PREC || []).length > 10) inc(o.PREC); else inc(o.WTEQ || []);
  const sd = o.SNWD || []; for (let i = 1; i < sd.length; i++) { const dv = sd[i].value - sd[i - 1].value; depth[String(sd[i].date).slice(0, 10)] = Math.max(0, dv); }
  return { daily, depth };
}

// per-model, per-lead skill on one window
function skill(results, daily, days) {
  const scores = {}, wLead = {}, corr = {}; const seen = new Set();
  for (const [id, f] of results) {
    if (!f) continue;
    const sig = JSON.stringify(Object.values(f[1]).slice(-10).map(v => Math.round(v * 10))); if (seen.has(sig)) continue; seen.add(sig);   // same model under two names
    for (const l of LEADS) {
      const F = f[l]; if (!F) continue;
      let n = 0, ae = 0, sf = 0, so = 0, wet = 0;
      for (const d of days) { const fo = F[d], ob = daily[d]; if (fo == null || ob == null) continue; n++;
        if (fo < 0.5 && ob < 0.5) continue; wet++; ae += Math.abs(fo - ob); sf += fo; so += ob; }
      if (n < 10) continue;
      (scores[l] ||= {})[id] = { days: n, wetDays: wet, mae: wet ? ae / wet : 0, bias: so > 2 ? sf / so : 1, fcstMm: Math.round(sf), obsMm: Math.round(so) };
      // shrunk toward 1 so a single odd storm can't swing it; capped
      if (wet >= 5) (corr[l] ||= {})[id] = r2(clamp((so + 40) / (sf + 40), 0.7, 1.4));
    }
  }
  for (const l of LEADS) {
    const S = scores[l] || {}, ids = Object.keys(S); if (ids.length < 3) continue;
    const raw = Object.fromEntries(ids.map(id => [id, 1 / Math.pow(S[id].mae + 1.5, 2)]));
    const mean = Object.values(raw).reduce((a, b) => a + b, 0) / ids.length;
    wLead[l] = Object.fromEntries(ids.map(id => [id, r2(clamp(raw[id] / mean, 0.4, 2.2))]));
  }
  const best = {}; for (const l of LEADS) { const S = scores[l] || {}; const ids = Object.keys(S); if (ids.length) best[l] = ids.reduce((a, b) => S[a].mae <= S[b].mae ? a : b); }
  return { scores, wLead, corr, best };
}

export default async (req) => {
  const u = new URL(req.url);
  const lat = +u.searchParams.get("lat"), lon = +u.searchParams.get("lon");
  if (!isFinite(lat) || !isFinite(lon)) return json({ error: "lat/lon required" }, { status: 400 });
  try {
    const [st] = await nearestStations(lat, lon, 1, 40);
    if (!st) return json({ status: "no-station" }, { cache: 86400 });
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `verify-v7-${st.id}-${today}`;
    const s = store("snowline-cache");
    try { const c = await s.get(cacheKey, { type: "json" }); if (c) return json(c, { cache: 21600 }); } catch (e) {}

    // ---- recent window
    const start = daysAgo(DAYS + 1), end = daysAgo(1);
    const obs = await awdbData([st.id], ["PREC", "WTEQ", "SNWD"], "DAILY", daysAgo(DAYS + 2), end);
    const { daily, depth } = observed(obs[st.id] || {});
    const days = Object.keys(daily).filter(d => d >= start && d <= end).sort();
    if (days.length < 10) return json({ status: "insufficient-obs", station: st }, { cache: 21600 });
    const results = await Promise.all(Object.entries(MODELS).map(async ([id, apis]) => [id, await modelDaily(st, apis, start, end)]));
    const wetRecent = days.filter(d => (daily[d] || 0) >= 0.5).length;

    // ---- skill: recent window, or last winter when it's been dry
    let basis = "recent", K = skill(results, daily, days), wetUsed = wetRecent;
    if (wetRecent < 8) {
      const now = new Date(), y = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;   // season that started last fall
      const ls = `${y - 1}-12-01`, le = `${y}-02-28`;
      const lsKey = `skill-ls-v1-${st.id}-${y}`;   // last winter doesn't change: work it out once
      try { const c = await s.get(lsKey, { type: "json" }); if (c?.K) { K = c.K; basis = "last-season"; wetUsed = c.wet; } } catch (e) {}
      if (basis !== "last-season") try {
        const o2 = await awdbData([st.id], ["PREC", "WTEQ", "SNWD"], "DAILY", `${y - 1}-11-30`, le);
        const ob2 = observed(o2[st.id] || {}); const d2 = Object.keys(ob2.daily).filter(d => d >= ls && d <= le).sort();
        const wet2 = d2.filter(d => (ob2.daily[d] || 0) >= 0.5).length;
        if (wet2 >= 8) {
          const res2 = await Promise.all(Object.entries(MODELS).map(async ([id, apis]) => [id, await modelDaily(st, apis, ls, le)]));
          const K2 = skill(res2, ob2.daily, d2); if (Object.keys(K2.wLead).length) { K = K2; basis = "last-season"; wetUsed = wet2; try { await s.setJSON(lsKey, { K: K2, wet: wet2 }); } catch (e) {} }
        }
      } catch (e) {}
    }
    const status = Object.keys(K.wLead).length && wetUsed >= 4 ? "ok" : "too-dry";

    // ---- storms (recent window)
    const uniq = []; const sigs = new Set();
    for (const [id, f] of results) { if (!f || !Object.keys(f.snow).length) continue; const sig = JSON.stringify(Object.values(f[1]).slice(-10).map(v => Math.round(v * 10))); if (sigs.has(sig)) continue; sigs.add(sig); uniq.push([id, f]); }
    const wetDay = (d) => (daily[d] ?? 0) >= 2.5 || (depth[d] ?? 0) >= 1;
    const raw = []; let cur = null;
    for (const d of days) { if (wetDay(d)) { if (!cur) cur = { days: [] }; cur.days.push(d); } else if (cur) { raw.push(cur); cur = null; } }
    if (cur) { cur.ongoing = true; raw.push(cur); }

    // Snowline's own saved forecasts: fc[issued][target] = [snowIn, waterIn]
    let fc = {}; try { fc = (await store("snowline-score").get(`fc-${st.id}`, { type: "json" })) || {}; } catch (e) {}
    const minus = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };
    const snowlineFor = (sd, lead) => { let s = 0, w = 0; for (const d of sd) { const v = fc[minus(d, lead)]?.[d]; if (!v) return null; s += v[0]; w += v[1]; } return { s: r1(s), w: r2(w) }; };

    const all = raw.map(x => {
      const obsSnow = x.days.reduce((a, d) => a + (depth[d] || 0), 0), obsWater = x.days.reduce((a, d) => a + (daily[d] || 0), 0) / 25.4;
      const per = uniq.map(([id, f]) => ({ id, s: x.days.reduce((a, d) => a + (f.snow[d] || 0), 0), w: x.days.reduce((a, d) => a + (f[1][d] || 0), 0) / 25.4 })).filter(v => isFinite(v.s));
      if (per.length < 2) return null;
      const ss = per.map(v => v.s).sort((a, b) => a - b), mean = ss.reduce((a, b) => a + b, 0) / ss.length;
      return { start: x.days[0], end: x.days[x.days.length - 1], ongoing: !!x.ongoing, obsSnow: r1(obsSnow), obsWater: r2(obsWater),
        fcstSnow: r1(mean), fcstLo: r1(ss[0]), fcstHi: r1(ss[ss.length - 1]), fcstWater: r2(per.reduce((a, v) => a + v.w, 0) / per.length), models: per.length,
        // water is the fairer test; snow depth settles
        closest: per.reduce((b, v) => { const e = Math.abs(v.w - obsWater) + Math.abs(v.s - obsSnow) / 12; return !b || e < b.e ? { id: v.id, s: r1(v.s), e } : b; }, null),
        perModel: Object.fromEntries(per.map(v => [v.id, r1(v.s)])),
        snowline: snowlineFor(x.days, 1), snowline3: snowlineFor(x.days, 3) };
    }).filter(x => x && (x.obsSnow >= 2 || x.fcstSnow >= 2) && (x.obsWater >= 0.1 || x.fcstWater >= 0.1)).reverse();

    // Snowline's record and snow-to-water calibration
    const graded = all.filter(x => x.snowline && !x.ongoing);
    const within = x => Math.abs(x.snowline.s - x.obsSnow) <= Math.max(2, 0.25 * x.obsSnow);
    let record = null, slrFix = null;
    if (graded.length) {
      const err = graded.reduce((a, x) => a + Math.abs(x.snowline.s - x.obsSnow), 0) / graded.length;
      const fs = graded.reduce((a, x) => a + x.snowline.s, 0), os = graded.reduce((a, x) => a + x.obsSnow, 0);
      record = { storms: graded.length, within: graded.filter(within).length, avgErr: r1(err), bias: os > 1 ? r2(fs / os) : null };
      const ratios = graded.filter(x => x.obsWater >= 0.3 && x.snowline.w >= 0.2 && x.snowline.s > 0.5).map(x => (x.obsSnow / x.obsWater) / (x.snowline.s / x.snowline.w)).sort((a, b) => a - b);
      if (ratios.length >= 3) { const med = ratios[Math.floor(ratios.length / 2)]; slrFix = r2(clamp(1 + (med - 1) * Math.min(1, ratios.length / 6), 0.75, 1.3)); }
    }

    const out = {
      status, basis, station: { id: st.id, name: st.name, km: Math.round(st.km), elevFt: st.elevFt }, days: days.length, wetDays: wetUsed,
      scores: K.scores[1] || {}, scoresByLead: K.scores, weights: K.wLead[1] || {}, wLead: K.wLead, corr: K.corr, best: K.best[1] || null, bestByLead: K.best,
      storms: all.slice(0, 6), stormCount: all.length, record, slrFix, updated: new Date().toISOString(),
    };
    try { await s.setJSON(cacheKey, out); } catch (e) {}
    return json(out, { cache: 21600 });
  } catch (e) {
    return json({ status: "error", error: String(e.message || e) }, { cache: 600 });
  }
};
export const config = { path: "/api/verify" };
