// POST /api/pistes-fill {lat, lon} → looks up ski runs, Nordic trails and lifts from OpenStreetMap and keeps them
// in Netlify Blobs for /api/pistes. Runs in the background (up to 15 min), so a slow Overpass server can't
// time the request out the way it did when the lookup ran inside /api/pistes.
import { store } from "../lib/shared.mjs";
import { fetchPistes, pisteKey, fillKey, okPoint } from "../lib/pistes.mjs";

export default async (req) => {
  let b = {}; try { b = await req.json(); } catch (e) {}
  const lat = +b.lat, lon = +b.lon; if (!okPoint(lat, lon)) return;
  const key = pisteKey(lat, lon), s = store("snowline-cache");
  try {
    const out = await fetchPistes(lat, lon);
    await s.setJSON(key, out);
    await s.setJSON(fillKey(key), { at: Date.now(), ok: true });
  } catch (e) {
    // Remember the failure so /api/pistes answers at once instead of asking Overpass again on every visit.
    try { await s.setJSON(fillKey(key), { at: Date.now(), ok: false, error: String(e.message || e) }); } catch (_) {}
  }
};
export const config = { background: true, path: "/api/pistes-fill", method: "POST" };
