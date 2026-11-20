// GET /api/snowmap?lat=..&lon=.. → SNOTEL stations within ~220 km: current depth, new snow 24h/72h
import { json, store, snotelStations, awdbData, km, daysAgo, ymd, newSnowFrom } from "../lib/shared.mjs";

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const lat = Math.round(+q.get("lat") * 2) / 2, lon = Math.round(+q.get("lon") * 2) / 2;
  if (!isFinite(lat) || !isFinite(lon)) return json({ error: "lat/lon required" }, { status: 400 });
  const hour = new Date().toISOString().slice(0, 13);
  const key = `snowmap-v1-${lat}-${lon}-${hour}`, s = store("snowline-cache");
  try { const c = await s.get(key, { type: "json" }); if (c) return json(c, { cache: 1800 }); } catch (e) {}
  try {
    const near = (await snotelStations()).map(x => ({ ...x, d: km(lat, lon, x.lat, x.lon) })).filter(x => x.d <= 220).sort((a, b) => a.d - b.d).slice(0, 110);
    if (!near.length) return json({ stations: [] }, { cache: 3600 });
    const chunks = []; for (let i = 0; i < near.length; i += 40) chunks.push(near.slice(i, i + 40));
    const parts = await Promise.all(chunks.map(c => awdbData(c.map(x => x.id), ["SNWD"], "HOURLY", daysAgo(3), ymd(Date.now() + 864e5)).catch(() => ({}))));
    const data = Object.assign({}, ...parts);
    const stations = near.map(x => {
      const v = (data[x.id]?.SNWD || []).map(p => p.value); if (!v.length) return null;
      const last = (data[x.id].SNWD.at(-1) || {}).date;
      return { name: x.name, lat: x.lat, lon: x.lon, elevFt: x.elevFt, depth: v.at(-1), new24: v.length >= 12 ? Math.round(newSnowFrom(v.slice(-24))) : null, new72: v.length >= 36 ? Math.round(newSnowFrom(v.slice(-72))) : null, updated: last || null };
    }).filter(Boolean);
    const out = { stations, source: "USDA NRCS SNOTEL", updated: new Date().toISOString() };
    try { await s.setJSON(key, out); } catch (e) {}
    return json(out, { cache: 1800 });
  } catch (e) { return json({ stations: [], error: String(e.message || e) }, { cache: 120 }); }
};
export const config = { path: "/api/snowmap" };
