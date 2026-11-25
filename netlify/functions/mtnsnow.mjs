// GET /api/mtnsnow?lat=..&lon=.. → forecast snow across one mountain, at ~170 points each at its real elevation.
// Precipitation comes from the weather model; whether it falls as snow, and how fluffy, is worked out at each
// point's own height with the same rules Snowline uses everywhere — so totals climb with elevation the way they do
// on a real mountain. Cached 3 hours per mountain to stay well inside Open-Meteo's free limits.
import { json, store } from "../lib/shared.mjs";

const N = 13, DLAT = 0.065, DLON = 0.088;           // 13×13 points over ~14 × 14 km
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const slr = (Te) => clamp(Te > -2 ? 12 + 2 * (-2 - Te) : 12 + (-2 - Te), 4, 22);
const snowFrac = (Te, FL, e) => { const fT = clamp((3.5 - Te) / 2.5, 0, 1); if (!(FL > 0)) return fT; return Math.min(fT, clamp((e - (FL - 450)) / 300, 0, 1)); };

export default async (req) => {
  const q = new URL(req.url).searchParams, lat0 = Math.round(+q.get("lat") * 100) / 100, lon0 = Math.round(+q.get("lon") * 100) / 100;
  if (!isFinite(lat0) || !isFinite(lon0)) return json({ error: "lat/lon required" }, { status: 400 });
  const s = store("snowline-cache"), key = `mtnsnow-v1-${lat0}-${lon0}`;
  try { const c = await s.get(key, { type: "json" }); if (c && Date.now() - c.at < 3 * 3600e3) return json(c, { cache: 1800 }); } catch (e) {}
  const lats = [], lons = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { lats.push((lat0 + DLAT - (2 * DLAT * r) / (N - 1)).toFixed(4)); lons.push((lon0 - DLON + (2 * DLON * c) / (N - 1)).toFixed(4)); }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(",")}&longitude=${lons.join(",")}&hourly=precipitation,temperature_2m,freezing_level_height&forecast_days=6&timezone=auto`;
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error("Open-Meteo " + r.status);
    let arr = await r.json(); if (!Array.isArray(arr)) arr = [arr];
    const t0 = arr[0].hourly.time, nowK = new Date(Date.now() + (arr[0].utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13) + ":00";
    const i0 = Math.max(0, t0.findIndex((t) => t >= nowK));
    const wins = { "24h": 24, "3d": 72, "5d": 120 };
    const grids = Object.fromEntries(Object.keys(wins).map((k) => [k, []])), elev = [];
    arr.forEach((p) => {
      const h = p.hourly, e = p.elevation; elev.push(Math.round(e));
      const acc = Object.fromEntries(Object.keys(wins).map((k) => [k, 0]));
      for (let i = i0; i < Math.min(h.time.length, i0 + 120); i++) {
        const P = h.precipitation[i], T = h.temperature_2m[i]; if (!(P > 0) || T == null) continue;
        const sn = (P / 25.4) * slr(T) * snowFrac(T, h.freezing_level_height[i], e);
        for (const [k, n] of Object.entries(wins)) if (i < i0 + n) acc[k] += sn;
      }
      for (const k of Object.keys(wins)) grids[k].push(Math.round(acc[k] * 10) / 10);
    });
    const out = { at: Date.now(), n: N, bounds: [[lat0 - DLAT, lon0 - DLON], [lat0 + DLAT, lon0 + DLON]], from: t0[i0], grids, elev, source: "Open-Meteo, worked out at each point's elevation by Snowline" };
    try { await s.setJSON(key, out); } catch (e) {}
    return json(out, { cache: 1800 });
  } catch (e) { return json({ error: String(e.message || e) }, { status: 502, cache: 60 }); }
};
export const config = { path: "/api/mtnsnow" };
