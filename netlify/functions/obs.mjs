// GET /api/obs?lat=..&lon=.. → nearest SNOTEL observations (measured snow)
import { json, nearestStations, awdbData, daysAgo, ymd, newSnowFrom } from "../lib/shared.mjs";

export default async (req) => {
  const u = new URL(req.url);
  const lat = +u.searchParams.get("lat"), lon = +u.searchParams.get("lon");
  if (!isFinite(lat) || !isFinite(lon)) return json({ error: "lat/lon required" }, { status: 400 });
  try {
    const st = await nearestStations(lat, lon, 2, 45);
    if (!st.length) return json({ stations: [] }, { cache: 3600 });
    const ids = st.map(s => s.id);
    const tomorrow = ymd(Date.now() + 864e5);
    const [hourly, daily] = await Promise.all([
      awdbData(ids, ["SNWD", "WTEQ", "TOBS"], "HOURLY", daysAgo(4), tomorrow).catch(() => ({})),
      awdbData(ids, ["SNWD", "WTEQ", "PREC"], "DAILY", daysAgo(10), tomorrow).catch(() => ({})),
    ]);
    const stations = st.map(s => {
      const h = hourly[s.id] || {}, d = daily[s.id] || {};
      const depth = (h.SNWD || []).slice(-96), swe = (h.WTEQ || []).slice(-96), temp = h.TOBS || [];
      const last = (arr) => arr.length ? arr[arr.length - 1] : null;
      const lastN = (arr, n) => arr.slice(-n).map(v => v.value);
      const new12 = depth.length >= 6 ? newSnowFrom(lastN(depth, 12)) : null;
      const new24 = depth.length >= 12 ? newSnowFrom(lastN(depth, 24)) : null;
      const new72 = depth.length >= 36 ? newSnowFrom(lastN(depth, 72)) : null;
      const sweNow = last(swe)?.value ?? last(d.WTEQ || [])?.value ?? null;
      const swe24ago = swe.length >= 24 ? swe[swe.length - 24].value : null;
      const swe24 = sweNow != null && swe24ago != null ? Math.max(0, sweNow - swe24ago) : null;
      const dDepth = d.SNWD || [], dSwe = d.WTEQ || [];
      const hist = dDepth.slice(-8).map(v => ({ date: String(v.date).slice(0, 10), depth: v.value }));
      return {
        id: s.id, name: s.name, km: Math.round(s.km * 10) / 10, elevFt: s.elevFt, lat: s.lat, lon: s.lon,
        updated: last(depth)?.date || last(dDepth)?.date || null,
        depth: last(depth)?.value ?? last(dDepth)?.value ?? null,
        swe: sweNow, new12, new24, new72, swe24,
        density: new24 && swe24 && new24 >= 1 ? Math.round(100 * swe24 / new24) : null,
        tempF: last(temp)?.value ?? null,
        hist,
      };
    });
    return json({ stations, source: "USDA NRCS SNOTEL" }, { cache: 1200 });
  } catch (e) {
    return json({ error: String(e.message || e), stations: [] }, { status: 200, cache: 120 });
  }
};
export const config = { path: "/api/obs" };
