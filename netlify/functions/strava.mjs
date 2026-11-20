// Strava connect: /api/strava/login → Strava OAuth → /api/strava/callback
// /api/strava/data → recent workouts (ski workouts tagged with that day's conditions) + training load
// /api/strava/logout
// Needs env STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET (create an app at strava.com/settings/api).
import { json, store, getJSON } from "../lib/shared.mjs";
import crypto from "node:crypto";

const ID = () => process.env.STRAVA_CLIENT_ID, SECRET = () => process.env.STRAVA_CLIENT_SECRET;
const SKI = new Set(["NordicSki", "BackcountrySki", "AlpineSki", "RollerSki", "Snowshoe"]);
const cookieSid = (req) => (req.headers.get("cookie") || "").match(/(?:^|;\s*)sl_sid=([a-f0-9]{32})/)?.[1];

async function tokenFor(sid) {
  const s = store("snowline-strava"); const rec = await s.get(sid, { type: "json" }); if (!rec) return null;
  if (rec.expires_at * 1000 > Date.now() + 60e3) return rec;
  const r = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: ID(), client_secret: SECRET(), grant_type: "refresh_token", refresh_token: rec.refresh_token }) });
  if (!r.ok) return null;
  const t = await r.json(); const next = { ...rec, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at };
  await s.setJSON(sid, next); return next;
}

async function conditionsFor(a) {
  const [lat, lon] = a.start_latlng || []; if (lat == null) return null;
  const d = a.start_date_local.slice(0, 10), prev = new Date(Date.parse(d) - 864e5).toISOString().slice(0, 10);
  try {
    const j = await getJSON(`https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,snowfall,wind_speed_10m,precipitation&start_date=${prev}&end_date=${d}&timezone=auto`);
    const h = j.hourly; const hr = +a.start_date_local.slice(11, 13);
    const i = h.time.findIndex(t => t === `${d}T${String(hr).padStart(2, "0")}:00`); if (i < 0) return null;
    let snow24 = 0, maxPrev = -99, rain = 0;
    for (let k = Math.max(0, i - 24); k < i; k++) { snow24 += (h.snowfall[k] || 0) / 2.54; maxPrev = Math.max(maxPrev, h.temperature_2m[k]); if ((h.precipitation[k] || 0) > 0.2 && (h.snowfall[k] || 0) < 0.05) rain++; }
    const T = h.temperature_2m[i];
    const surface = rain >= 2 ? "wet / rain-affected" : snow24 >= 3 ? "fresh snow" : maxPrev > 2 && T < -1 ? "firm / refrozen" : T > 1 ? "soft / wet" : T < -12 ? "cold packed" : "packed powder";
    return { tempC: Math.round(T * 10) / 10, snow24: Math.round(snow24 * 10) / 10, windKmh: Math.round(h.wind_speed_10m[i]), surface };
  } catch (e) { return null; }
}

export default async (req) => {
  const u = new URL(req.url); const path = u.pathname; const origin = u.origin;
  if (!ID() || !SECRET()) return json({ error: "strava-not-configured" }, { status: 503 });

  if (path.endsWith("/login")) {
    const state = crypto.randomBytes(12).toString("hex");
    const redirect = `${origin}/api/strava/callback`;
    const loc = `https://www.strava.com/oauth/authorize?client_id=${ID()}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&approval_prompt=auto&scope=read,activity:read_all&state=${state}`;
    return new Response(null, { status: 302, headers: { location: loc, "set-cookie": `sl_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (path.endsWith("/callback")) {
    const code = u.searchParams.get("code"), state = u.searchParams.get("state");
    const want = (req.headers.get("cookie") || "").match(/(?:^|;\s*)sl_state=([a-f0-9]+)/)?.[1];
    if (!code || !state || state !== want) return new Response(null, { status: 302, headers: { location: "/#alerts?strava=failed" } });
    const r = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: ID(), client_secret: SECRET(), code, grant_type: "authorization_code" }) });
    if (!r.ok) return new Response(null, { status: 302, headers: { location: "/?strava=failed#forecast" } });
    const t = await r.json(); const sid = crypto.randomBytes(16).toString("hex");
    await store("snowline-strava").setJSON(sid, { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, athlete: { id: t.athlete?.id, name: [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(" ") } });
    return new Response(null, { status: 302, headers: { location: "/?strava=connected#forecast", "set-cookie": `sl_sid=${sid}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (path.endsWith("/logout")) {
    const sid = cookieSid(req); if (sid) await store("snowline-strava").delete(sid);
    return json({ ok: true });
  }
  if (path.endsWith("/data")) {
    const sid = cookieSid(req); if (!sid) return json({ connected: false });
    const tok = await tokenFor(sid); if (!tok) return json({ connected: false });
    const after = Math.floor((Date.now() - 120 * 864e5) / 1000);
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200`, { headers: { authorization: `Bearer ${tok.access_token}` } });
    if (!r.ok) return json({ connected: true, error: `strava ${r.status}` });
    const acts = (await r.json()).map(a => ({
      id: a.id, name: a.name, type: a.sport_type || a.type, date: a.start_date_local, km: Math.round(a.distance / 100) / 10, min: Math.round(a.moving_time / 60),
      climbM: Math.round(a.total_elevation_gain || 0), hr: a.average_heartrate || null, effort: a.suffer_score || null, start_latlng: a.start_latlng,
    }));
    // training load (fitness/fatigue/form) from relative effort, falling back to time-based estimate
    const load = {}; for (const a of acts) { const d = a.date.slice(0, 10); load[d] = (load[d] || 0) + (a.effort ?? a.min * 0.7); }
    let ctl = 0, atl = 0; const series = [];
    for (let k = 119; k >= 0; k--) { const d = new Date(Date.now() - k * 864e5).toISOString().slice(0, 10); const L = load[d] || 0; ctl += (L - ctl) / 42; atl += (L - atl) / 7; series.push({ d, L: Math.round(L), ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10 }); }
    const weeks = []; for (let w = 11; w >= 0; w--) { const end = Date.now() - w * 7 * 864e5, start = end - 7 * 864e5; const inW = acts.filter(a => { const t = Date.parse(a.date); return t > start && t <= end; }); weeks.push({ start: new Date(start).toISOString().slice(0, 10), hours: Math.round(inW.reduce((s, a) => s + a.min, 0) / 6) / 10, skiHours: Math.round(inW.filter(a => SKI.has(a.type)).reduce((s, a) => s + a.min, 0) / 6) / 10, load: Math.round(inW.reduce((s, a) => s + (a.effort ?? a.min * 0.7), 0)) }); }
    const ski = acts.filter(a => SKI.has(a.type)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
    await Promise.all(ski.map(async a => { a.conditions = await conditionsFor(a); delete a.start_latlng; }));
    const recent = acts.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(({ start_latlng, ...a }) => a);
    return json({ connected: true, athlete: tok.athlete, ski, recent, weeks, fitness: series.slice(-60) });
  }
  return json({ error: "not found" }, { status: 404 });
};
export const config = { path: ["/api/strava/login", "/api/strava/callback", "/api/strava/data", "/api/strava/logout"] };
