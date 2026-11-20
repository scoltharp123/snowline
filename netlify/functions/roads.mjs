// GET /api/roads?spot=..&lat=..&lon=.. → nearby ODOT road-weather stations, incidents and cameras (TripCheck)
// Needs env TRIPCHECK_KEY (free at apiportal.odot.state.or.us). Without it, returns links only.
import { json, km } from "../lib/shared.mjs";

const BASE = "https://api.odot.state.or.us/tripcheck";
const ROUTES = {
  "Mt. Bachelor, OR": "Cascade Lakes Hwy (OR-372)",
  "Meissner Nordic (Bend), OR": "Cascade Lakes Hwy (OR-372)",
  "Mt. Bachelor Nordic Center, OR": "Cascade Lakes Hwy (OR-372)",
  "Hoodoo, OR": "Santiam Pass (US-20)",
  "Willamette Pass, OR": "Willamette Pass (OR-58)",
  "Mt. Hood Meadows, OR": "Mt. Hood (OR-35 / US-26)",
  "Timberline, OR": "Mt. Hood (US-26)",
  "Teacup Lake Nordic (Mt. Hood), OR": "Mt. Hood (OR-35)",
  "Mt. Ashland, OR": "Siskiyou Pass (I-5)",
  "Anthony Lakes, OR": "Anthony Lakes Hwy",
};
const https = (u) => String(u || "").replace(/^http:\/\//i, "https://");
const clean = (t) => String(t || "").split("<!--")[0].replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
async function tc(path, key) {
  const r = await fetch(`${BASE}/${path}`, { headers: { "Ocp-Apim-Subscription-Key": key, "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const spot = q.get("spot") || "", lat = +q.get("lat"), lon = +q.get("lon");
  const out = { configured: !!process.env.TRIPCHECK_KEY, route: ROUTES[spot] || null, links: { tripcheck: "https://www.tripcheck.com/", chains: "https://www.tripcheck.com/Pages/Chain-Law", snopark: "https://www.oregon.gov/odot/DMV/Pages/Vehicle/sno_park_permits.aspx" } };
  const key = process.env.TRIPCHECK_KEY;
  if (!key || !isFinite(lat) || !isFinite(lon)) return json(out, { cache: 3600 });
  const box = `${(lon - 0.45).toFixed(4)},${(lat - 0.33).toFixed(4)},${(lon + 0.45).toFixed(4)},${(lat + 0.33).toFixed(4)}`;
  const [inc, rw, cams] = await Promise.all([
    tc("Incidents", key).catch(e => ({ error: e.message })),
    tc("RW/Reports", key).catch(e => ({ error: e.message })),
    tc(`Cctv/Inventory?Bounds=${box}`, key).catch(e => ({ error: e.message })),
  ]);
  const now = Date.now();

  // Road-weather stations (e.g. "MT BACHELOR" on HWY372): temp, snow beside the road, restrictions, comments
  out.stations = (rw["road-weather-reports"] || []).map(r => {
    const s = r.location?.["start-location"] || {}, e = r.location?.["end-location"] || {};
    const d = Math.min(...[[s["start-lat"], s["start-long"]], [e["end-lat"], e["end-long"]]].filter(p => isFinite(p[0]) && isFinite(p[1])).map(p => km(lat, lon, p[0], p[1])));
    const restr = r["commercial-vehicle-restriction"]?.["restriction-type"];
    return { d, name: r.location?.["location-name"] || "", tempC: r["air-temperature"], snowIn: r["adjacent-snow-depth"], rate: r["snowfall-accum-rate"],
      restriction: restr && !/^no restriction$/i.test(restr) ? restr : null, comments: clean(r.comments), expires: Date.parse(r["expiry-time"]) };
  }).filter(r => r.d <= 35 && !(r.expires < now)).sort((a, b) => a.d - b.d).slice(0, 3)
    .map(({ d, expires, ...r }) => ({ ...r, mi: Math.round(d * 0.621) }));

  // Active incidents starting within ~35 km of the spot
  out.incidents = (inc.incidents || []).filter(x => String(x["is-active"]) === "true").map(x => {
    const s = x.location?.["start-location"] || {};
    return { d: km(lat, lon, s["start-lat"], s["start-long"]), headline: clean(x.headline), where: clean(s["location-desc"]), impact: x["impact-desc"] || "" };
  }).filter(x => isFinite(x.d) && x.d <= 35 && x.headline).sort((a, b) => a.d - b.d)
    .filter((x, i, a) => a.findIndex(y => y.headline === x.headline && y.where === x.where) === i).slice(0, 4)
    .map(({ d, ...x }) => ({ ...x, mi: Math.round(d * 0.621) }));

  // Cameras in the box, nearest first
  out.cams = ((cams.CCTVInventoryRequest) || []).filter(c => c["cctv-url"] && isFinite(c.latitude))
    .map(c => ({ img: https(c["cctv-url"]), name: c["device-name"] || c["cctv-other"] || "ODOT camera", d: km(lat, lon, c.latitude, c.longitude) }))
    .sort((a, b) => a.d - b.d).slice(0, 4).map(({ d, ...c }) => ({ ...c, mi: Math.round(d * 0.621) }));

  out.errors = [inc.error, rw.error, cams.error].filter(Boolean);
  return json(out, { cache: 300 });
};
export const config = { path: "/api/roads" };
