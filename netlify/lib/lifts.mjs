// Lift wind-hold learning: every 30 minutes while Mt. Bachelor is running, save each lift's status next to the wind
// Open-Meteo measures/forecasts at that moment near the summit. Over the season this shows the wind at which each
// lift actually goes on hold, and the forecast uses that instead of a generic guess.
import { store, getJSON } from "./shared.mjs";

const LIFTS_URL = "https://api.mtbachelor.com/api/v1/dor/drupal/lifts";
const WX = "https://api.open-meteo.com/v1/forecast?latitude=43.979&longitude=-121.688&elevation=2760&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m&hourly=wind_speed_700hPa&forecast_hours=2&timezone=America%2FLos_Angeles";

export async function logLifts() {
  const [lifts, wx] = await Promise.all([getJSON(LIFTS_URL, { timeout: 9000, headers: { "User-Agent": "Snowline (snowline-forecast.netlify.app)" } }), getJSON(WX, { timeout: 9000 }).catch(() => null)]);
  const win = (lifts || []).filter((l) => l.season === "winter" && l.type !== "carpet");
  const st = Object.fromEntries(win.map((l) => [l.name, String(l.status || "").toLowerCase()]));
  const open = Object.values(st).filter((s) => s === "open").length;
  if (!open) return { skipped: "mountain not running" };
  const c = wx?.current || {}, rw = wx?.hourly?.wind_speed_700hPa?.[0];
  const rec = { t: new Date().toISOString(), st, g: c.wind_gusts_10m ?? null, w: c.wind_speed_10m ?? null, wd: c.wind_direction_10m ?? null, rw: rw ?? null };
  const s = store("snowline-cache"), day = rec.t.slice(0, 10), key = "lifts-" + day;
  const cur = (await s.get(key, { type: "json" }).catch(() => null)) || [];
  cur.push(rec); await s.setJSON(key, cur);
  const idx = (await s.get("lifts-days", { type: "json" }).catch(() => null)) || [];
  if (!idx.includes(day)) { idx.push(day); await s.setJSON("lifts-days", idx.slice(-160)); }
  return { saved: day, open, n: cur.length };
}

// For each lift: the wind metric at each logged moment, and whether the lift was on hold while it was otherwise in
// service that day (open earlier or later the same day). Learned threshold = midway between typical "open" and "hold" wind.
export async function liftStats() {
  const s = store("snowline-cache");
  const days = (await s.get("lifts-days", { type: "json" }).catch(() => null)) || [];
  const per = {};
  for (const d of days) {
    const recs = (await s.get("lifts-" + d, { type: "json" }).catch(() => null)) || [];
    const ranToday = new Set(); recs.forEach((r) => Object.entries(r.st).forEach(([n, v]) => { if (v === "open") ranToday.add(n); }));
    for (const r of recs) {
      const m = Math.max(r.rw ?? 0, (r.g ?? 0) * 0.8); if (!m) continue;
      for (const [n, v] of Object.entries(r.st)) { if (!ranToday.has(n)) continue; const p = (per[n] ||= { open: [], hold: [] }); (v === "open" ? p.open : p.hold).push(m); }
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const out = {};
  for (const [n, p] of Object.entries(per)) {
    out[n] = { holds: p.hold.length, opens: p.open.length };
    if (p.hold.length >= 4 && p.open.length >= 10) { const h = mean(p.hold), o = mean(p.open); if (h > o) out[n].mid = Math.round((h + o) / 2); }
  }
  return { days: days.length, since: days[0] || null, lifts: out };
}
