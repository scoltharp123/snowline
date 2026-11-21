// GET /api/pistes?lat=..&lon=.. → ski runs, Nordic trails and lifts from OpenStreetMap around a spot.
// Kept for a week in Netlify Blobs (runs rarely change), so Overpass is asked at most once per spot per week.
// The Overpass lookup itself runs in /api/pistes-fill (a background function). This function only reads Blobs,
// starts a fill when there's nothing fresh, and waits a few seconds for it, so it always answers quickly.
// When the fill isn't done yet the answer says { pending: true } and the app asks again a little later.
import { json, store } from "../lib/shared.mjs";
import { pisteKey, fillKey, okPoint, WEEK } from "../lib/pistes.mjs";

const FILL_GAP = 3 * 60e3;     // don't start another fill for a spot within 3 minutes of the last one
const FAIL_WAIT = 20 * 60e3;   // after a failed fill, wait 20 minutes before trying Overpass again
const WAIT = 7000;             // how long this request waits for a fill it started
const get = async (s, k) => { try { return await s.get(k, { type: "json" }); } catch (e) { return null; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default async (req) => {
  const u = new URL(req.url), q = u.searchParams;
  const lat = +q.get("lat"), lon = +q.get("lon");
  if (!okPoint(lat, lon)) return json({ error: "lat/lon required" }, { status: 400 });
  const key = pisteKey(lat, lon), s = store("snowline-cache"), now = Date.now();

  const c = await get(s, key);
  if (c && now - c.at < WEEK) return json(c, { cache: 86400 });

  const f = await get(s, fillKey(key));
  const recent = f && now - f.at < (f.ok === false ? FAIL_WAIT : FILL_GAP);
  if (!recent) {
    try {
      await s.setJSON(fillKey(key), { at: now, ok: null });
      await fetch(new URL("/api/pistes-fill", u.origin), { method: "POST", body: JSON.stringify({ lat, lon }),
        headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(3000) });
    } catch (e) {}
  }
  if (c) return json({ ...c, stale: true }, { cache: 600 });   // an older copy beats an empty map while the fill runs
  if (f && f.ok === false && recent) return json({ runs: [], lifts: [], stations: [], error: f.error || "Overpass unavailable" }, { cache: 300 });

  // Wait briefly for the fill (it's often done in a few seconds), then let the app ask again.
  const end = Date.now() + WAIT;
  while (Date.now() < end) {
    await sleep(1500);
    const d = await get(s, key); if (d && Date.now() - d.at < WEEK) return json(d, { cache: 86400 });
    const g = await get(s, fillKey(key)); if (g && g.ok === false && g.at >= now) return json({ runs: [], lifts: [], stations: [], error: g.error }, { cache: 300 });
  }
  return json({ runs: [], lifts: [], stations: [], pending: true });
};
export const config = { path: "/api/pistes" };
