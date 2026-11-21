// GET /api/season?lat=..&lon=.. → this season at the nearest SNOTEL gauge:
// snowpack (snow water) vs the 1991–2020 median for the date, snow depth, and snow measured so far.
import { json, nearestStations, getJSON, store } from "../lib/shared.mjs";

const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";

export default async (req) => {
  const u = new URL(req.url);
  const lat = +u.searchParams.get("lat"), lon = +u.searchParams.get("lon");
  if (!isFinite(lat) || !isFinite(lon)) return json({ error: "lat/lon required" }, { status: 400 });
  try {
    const [st] = await nearestStations(lat, lon, 1, 40);
    if (!st) return json({ status: "no-station" }, { cache: 86400 });
    const now = new Date(), y = now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;   // season starts Oct 1
    const start = `${y}-10-01`, end = now.toISOString().slice(0, 10);
    const key = `season-v1-${st.id}-${end}`, s = store("snowline-cache");
    try { const c = await s.get(key, { type: "json" }); if (c) return json(c, { cache: 21600 }); } catch (e) {}

    const url = `${AWDB}/data?stationTriplets=${encodeURIComponent(st.id)}&elements=WTEQ,SNWD&duration=DAILY&beginDate=${start}&endDate=${end}&centralTendencyType=MEDIAN&periodRef=END&returnFlags=false&returnOriginalValues=false&returnSuspectData=false`;
    const raw = await getJSON(url, { timeout: 20000 });
    const rec = (Array.isArray(raw) ? raw : [])[0] || {};
    const by = {};
    for (const d of rec.data || []) {
      const code = d.stationElement?.elementCode || d.elementCode;
      for (const v of d.values || []) {
        const day = String(v.date).slice(0, 10), o = by[day] ||= {};
        if (code === "WTEQ") { if (v.value != null) o.swe = +v.value; if (v.median != null) o.med = +v.median; }
        if (code === "SNWD" && v.value != null) o.depth = +v.value;
      }
    }
    const days = Object.keys(by).sort();
    if (!days.length) return json({ status: "no-data", station: st }, { cache: 21600 });
    const series = days.map(d => [d, by[d].swe ?? null, by[d].depth ?? null, by[d].med ?? null]);
    // snow measured so far: add up daily rises in snow depth (it settles between storms, so this is a floor, not an exact total)
    let fallen = 0, prev = null; for (const [, , dp] of series) { if (dp == null) continue; if (prev != null && dp > prev && dp - prev < 40) fallen += dp - prev; prev = dp; }
    const last = [...series].reverse().find(r => r[1] != null) || [];
    const pct = last[1] != null && last[3] > 0.3 ? Math.round(last[1] / last[3] * 100) : null;
    const lastDepth = [...series].reverse().find(r => r[2] != null)?.[2] ?? null;
    const out = { status: "ok", station: { id: st.id, name: st.name, elevFt: st.elevFt, km: Math.round(st.km) }, start, series,
      now: { date: last[0] || end, swe: last[1] ?? null, med: last[3] ?? null, pct, depth: lastDepth }, fallen: Math.round(fallen) };
    try { await s.setJSON(key, out); } catch (e) {}
    return json(out, { cache: 21600 });
  } catch (e) {
    return json({ status: "error", error: String(e.message || e) }, { cache: 600 });
  }
};
export const config = { path: "/api/season" };
