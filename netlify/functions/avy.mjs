// GET /api/avy?lat=..&lon=.. → avalanche forecast detail for the zone containing the point
import { json, getJSON, store } from "../lib/shared.mjs";

function inRing(x, y, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside; } return inside; }
function inGeom(lon, lat, g) { if (!g) return false; const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []; return polys.some(p => inRing(lon, lat, p[0]) && !p.slice(1).some(h => inRing(lon, lat, h))); }
const strip = (h) => (h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export default async (req) => {
  const u = new URL(req.url); const lat = +u.searchParams.get("lat"), lon = +u.searchParams.get("lon");
  if (!isFinite(lat) || !isFinite(lon)) return json({ error: "lat/lon required" }, { status: 400 });
  try {
    const s = store("snowline-cache"); let layer;
    try { const c = await s.get("avy-layer", { type: "json" }); if (c && Date.now() - c.t < 3600e3) layer = c.layer; } catch (e) {}
    if (!layer) { layer = await getJSON("https://api.avalanche.org/v2/public/products/map-layer"); try { await s.setJSON("avy-layer", { t: Date.now(), layer }); } catch (e) {} }
    const f = (layer.features || []).find(f => inGeom(lon, lat, f.geometry));
    if (!f) return json({ zone: null }, { cache: 3600 });
    const p = f.properties || {};
    const zone = { name: p.name, center: p.center, centerId: p.center_id, id: f.id, danger: +p.danger_level, color: p.color, link: p.link, travel_advice: p.travel_advice, off_season: !!p.off_season };
    let detail = null;
    if (zone.centerId && zone.id != null && !zone.off_season) {
      try {
        const d = await getJSON(`https://api.avalanche.org/v2/public/product?type=forecast&center_id=${encodeURIComponent(zone.centerId)}&zone_id=${encodeURIComponent(zone.id)}`);
        const cur = (d.danger || []).find(x => x.valid_day === "current") || (d.danger || [])[0];
        const tom = (d.danger || []).find(x => x.valid_day === "tomorrow");
        detail = {
          published: d.published_time, expires: d.expires_time, author: d.author,
          bottomLine: strip(d.bottom_line).slice(0, 900),
          danger: cur ? { upper: cur.upper, middle: cur.middle, lower: cur.lower } : null,
          tomorrow: tom ? { upper: tom.upper, middle: tom.middle, lower: tom.lower } : null,
          problems: (d.forecast_avalanche_problems || []).map(x => ({ name: x.name, likelihood: x.likelihood, size: x.size, location: x.location, icon: x.icon, note: strip(x.problem_description || x.discussion).slice(0, 400) })),
        };
      } catch (e) { detail = { error: String(e.message || e) }; }
    }
    return json({ zone, detail }, { cache: 1800 });
  } catch (e) { return json({ error: String(e.message || e) }, { cache: 300 }); }
};
export const config = { path: "/api/avy" };
