// GET /api/roads?spot=..&lat=..&lon=.. → road conditions, chain restrictions and nearby cameras (ODOT TripCheck)
// Needs env TRIPCHECK_KEY (free subscription at apiportal.odot.state.or.us). Without it, returns links only.
import { json, km } from "../lib/shared.mjs";

const BASE = "https://api.odot.state.or.us/tripcheck";
const ROUTES = {
  "Mt. Bachelor, OR": { ids: ["OR372", "372"], name: "Cascade Lakes Hwy (OR-372)" },
  "Meissner Nordic (Bend), OR": { ids: ["OR372", "372"], name: "Cascade Lakes Hwy (OR-372)" },
  "Mt. Bachelor Nordic Center, OR": { ids: ["OR372", "372"], name: "Cascade Lakes Hwy (OR-372)" },
  "Hoodoo, OR": { ids: ["US20", "OR126"], name: "Santiam Pass (US-20)" },
  "Willamette Pass, OR": { ids: ["OR58", "58"], name: "Willamette Pass (OR-58)" },
  "Mt. Hood Meadows, OR": { ids: ["OR35", "US26"], name: "Mt. Hood (OR-35 / US-26)" },
  "Timberline, OR": { ids: ["US26"], name: "Mt. Hood (US-26)" },
  "Mt. Ashland, OR": { ids: ["I5"], name: "Siskiyou Pass (I-5)" },
};
async function tc(path, key) {
  const r = await fetch(`${BASE}/${path}`, { headers: { "Ocp-Apim-Subscription-Key": key, "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}
function arrays(o, out = []) { if (Array.isArray(o)) { if (o.length && typeof o[0] === "object") out.push(o); o.forEach(x => arrays(x, out)); } else if (o && typeof o === "object") Object.values(o).forEach(x => arrays(x, out)); return out; }
function coords(o) { let lat = null, lon = null; JSON.stringify(o, (k, v) => { if (typeof v === "number" || (typeof v === "string" && /^-?\d+\.\d+$/.test(v))) { const n = +v; if (lat == null && /lat/i.test(k) && n > 30 && n < 50) lat = n; if (lon == null && /lon|lng/i.test(k) && n < -100 && n > -130) lon = n; } return v; }); return lat != null && lon != null ? [lat, lon] : null; }
function texts(o) { const t = []; JSON.stringify(o, (k, v) => { if (typeof v === "string" && v.length > 12 && !/^https?:/.test(v) && /desc|comment|headline|condition|restriction|message|text|summary/i.test(k)) t.push(v.trim()); return v; }); return [...new Set(t)].slice(0, 3).join(" · "); }
function url(o) { let u = null; JSON.stringify(o, (k, v) => { if (!u && typeof v === "string" && /^https?:.*\.(jpg|jpeg|png)/i.test(v)) u = v; return v; }); return u; }

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const spot = q.get("spot") || "", lat = +q.get("lat"), lon = +q.get("lon");
  const route = ROUTES[spot] || null;
  const out = { configured: !!process.env.TRIPCHECK_KEY, route: route?.name || null, links: { tripcheck: "https://www.tripcheck.com/", chains: "https://www.tripcheck.com/Pages/Chain-Law", snopark: "https://www.oregon.gov/odot/DMV/Pages/Vehicle/sno_park_permits.aspx" } };
  const key = process.env.TRIPCHECK_KEY;
  if (!key || !isFinite(lat) || !isFinite(lon)) return json(out, { cache: 3600 });
  const near = (o, r) => { const c = coords(o); return c && km(lat, lon, c[0], c[1]) <= r; };
  const onRoute = (o) => route && route.ids.some(id => JSON.stringify(o).replace(/[\s-]/g, "").toUpperCase().includes(id));
  const [inc, rw, cams] = await Promise.all([
    tc("Incidents", key).catch(e => ({ error: String(e.message) })),
    tc("RW/Reports", key).catch(() => tc("RWReports", key)).catch(e => ({ error: String(e.message) })),
    tc("Cctv/Inventory", key).catch(() => tc("CctvInventory", key)).catch(e => ({ error: String(e.message) })),
  ]);
  const pick = (data, r) => data.error ? [] : (arrays(data).sort((a, b) => b.length - a.length)[0] || []).filter(o => onRoute(o) || near(o, r));
  out.incidents = pick(inc, 40).slice(0, 5).map(o => texts(o)).filter(Boolean);
  out.conditions = pick(rw, 40).slice(0, 4).map(o => texts(o)).filter(Boolean);
  out.cams = (cams.error ? [] : (arrays(cams).sort((a, b) => b.length - a.length)[0] || []))
    .map(o => ({ c: coords(o), img: url(o), name: texts(o) || "ODOT camera" })).filter(x => x.c && x.img)
    .map(x => ({ ...x, d: km(lat, lon, x.c[0], x.c[1]) })).filter(x => x.d <= 35).sort((a, b) => a.d - b.d).slice(0, 4)
    .map(x => ({ img: x.img, name: x.name.slice(0, 60), mi: Math.round(x.d * 0.621) }));
  out.errors = [inc.error, rw.error, cams.error].filter(Boolean);
  return json(out, { cache: 300 });
};
export const config = { path: "/api/roads" };
