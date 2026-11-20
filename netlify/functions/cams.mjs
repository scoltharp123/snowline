// GET /api/cams?bounds=minLon,minLat,maxLon,maxLat → ODOT TripCheck cameras in the box
import { json } from "../lib/shared.mjs";
export default async (req) => {
  const key = process.env.TRIPCHECK_KEY; if (!key) return json({ cams: [], configured: false }, { cache: 3600 });
  const b = (new URL(req.url).searchParams.get("bounds") || "").split(",").map(Number);
  if (b.length !== 4 || b.some(v => !isFinite(v))) return json({ error: "bounds required" }, { status: 400 });
  const r4 = b.map(v => (Math.round(v * 4) / 4).toFixed(2));   // snap so nearby views share a cache entry
  const box = [Math.min(r4[0], b[0]).toFixed(2), Math.min(r4[1], b[1]).toFixed(2), Math.max(+r4[2] + 0.25, b[2]).toFixed(2), Math.max(+r4[3] + 0.25, b[3]).toFixed(2)].join(",");
  try {
    const r = await fetch(`https://api.odot.state.or.us/tripcheck/Cctv/Inventory?Bounds=${box}`, { headers: { "Ocp-Apim-Subscription-Key": key, "Cache-Control": "no-cache" } });
    if (!r.ok) throw new Error("TripCheck " + r.status);
    const j = await r.json();
    const cams = (j.CCTVInventoryRequest || []).filter(c => c["cctv-url"] && isFinite(c.latitude)).slice(0, 300)
      .map(c => ({ id: c["device-id"], name: c["device-name"] || c["cctv-other"] || "ODOT camera", lat: +c.latitude, lon: +c.longitude, route: c["route-id"] || "", img: String(c["cctv-url"]).replace(/^http:\/\//i, "https://") }));
    return json({ cams, configured: true }, { cache: 3600 });
  } catch (e) { return json({ cams: [], error: String(e.message || e) }, { cache: 120 }); }
};
export const config = { path: "/api/cams" };
