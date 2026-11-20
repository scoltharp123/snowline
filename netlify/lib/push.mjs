import webpush from "web-push";
import { store, getJSON, nearestStations, awdbData, daysAgo, ymd, newSnowFrom } from "./shared.mjs";

export function vapid() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:alerts@snowline-forecast.netlify.app", pub, priv);
  return webpush;
}
export const subKey = (endpoint) => "sub-" + Buffer.from(endpoint).toString("base64url").slice(-80);
export const subs = () => store("snowline-push");

export async function send(sub, payload) {
  const wp = vapid();
  try { await wp.sendNotification(sub, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "normal" }); return "ok"; }
  catch (e) { return e.statusCode === 404 || e.statusCode === 410 ? "gone" : "error:" + (e.statusCode || e.message); }
}

// model snow (inches) from Open-Meteo best match at the spot's summit: past 12h + next N days by day
export async function modelSnow(spot, days = 10) {
  const elev = Math.round((spot.top || spot.base || 5000) / 3.28084);
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lon}&elevation=${elev}&hourly=snowfall,temperature_2m&past_days=1&forecast_days=${days + 1}&timezone=auto`);
  const h = j.hourly; const off = j.utc_offset_seconds * 1000;
  const nk = new Date(Date.now() + off).toISOString().slice(0, 13) + ":00";
  const i0 = Math.max(0, h.time.findIndex(t => t >= nk));
  const cm2in = (v) => (v || 0) / 2.54;
  let past12 = 0; for (let i = Math.max(0, i0 - 12); i < i0; i++) past12 += cm2in(h.snowfall[i]);
  const byDay = {}; for (let i = i0; i < h.time.length; i++) { const d = h.time[i].slice(0, 10); byDay[d] = (byDay[d] || 0) + cm2in(h.snowfall[i]); }
  const dayList = Object.entries(byDay).slice(0, days);
  const next = (n) => dayList.slice(0, n).reduce((a, [, v]) => a + v, 0);
  const next10 = next(10);
  const peak = dayList.reduce((b, [d, v]) => v > b.v ? { d, v } : b, { d: null, v: 0 });
  const today = h.time[i0].slice(0, 10), i9 = h.time.indexOf(today + "T09:00");
  let todaySnow = 0; for (let i = i0; i < h.time.length && h.time[i].startsWith(today); i++) todaySnow += cm2in(h.snowfall[i]);
  return { past12, next1: next(1), next3: next(3), next5: next(5), next10, peak, todaySnow, t9: i9 >= 0 ? h.temperature_2m[i9] : null };
}
export async function measuredOvernight(spot) {
  try {
    const [st] = await nearestStations(spot.lat, spot.lon, 1, 25); if (!st) return null;
    const h = (await awdbData([st.id], ["SNWD"], "HOURLY", daysAgo(2), ymd(Date.now() + 864e5)))[st.id]?.SNWD || [];
    if (h.length < 8) return null;
    return { inches: newSnowFrom(h.slice(-12).map(v => v.value)), station: st.name };
  } catch (e) { return null; }
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const r = (v) => Math.round(v);
const WIN = { h24: ["next1", "next 24 hours"], d3: ["next3", "next 3 days"], d5: ["next5", "next 5 days"], d10: ["next10", "next 10 days"] };
export async function buildAlert(sub) {
  const rules = Array.isArray(sub.rules) && sub.rules.length ? sub.rules
    : [{ spot: "*favs", type: "overnight", inches: sub.prefs?.overnight ?? 4 }, { spot: "*favs", type: "forecast", win: "d3", inches: sub.prefs?.forecast ?? 8 }];
  const cache = new Map(); const hits = [];
  const getM = async (sp) => { if (!cache.has(sp.name)) cache.set(sp.name, Promise.all([modelSnow(sp).catch(() => null), measuredOvernight(sp)])); return cache.get(sp.name); };
  for (const r of rules.slice(0, 12)) {
    const spots = r.spot === "*favs" || r.spot === "*all" ? (sub.spots || []) : (r.spotObj ? [r.spotObj] : []);
    for (const sp of spots.slice(0, 6)) {
      const [m, meas] = await getM(sp); if (!m) continue;
      const short = sp.name.replace(/,\s*[A-Z]{2}$/, "");
      if (r.type === "overnight") { const v = meas ? meas.inches : m.past12; if (v >= r.inches) hits.push({ v, title: `❄️ ${Math.round(v)}" overnight at ${short}`, line: `${Math.round(v)}" ${meas ? "fell" : "estimated"} overnight at ${short}` }); }
      else { const [k, lab] = WIN[r.win] || WIN.d3; const v = m[k]; if (v >= r.inches) { const pk = m.peak.d ? ` (most on ${DOW[new Date(m.peak.d + "T12:00:00Z").getUTCDay()]})` : ""; hits.push({ v: v * 0.6, title: `🌨 ${Math.round(v)}" coming to ${short}`, line: `${Math.round(v)}" forecast at ${short}, ${lab}${pk}` }); } }
    }
  }
  if (!hits.length) return null;
  const seen = new Set(); const lines = hits.filter(h => !seen.has(h.line) && seen.add(h.line));
  const top = lines.slice().sort((a, b) => b.v - a.v)[0];
  return { title: top.title, body: lines.slice(0, 3).map(h => h.line).join(" · "), url: "/#forecast", tag: "snowline-daily" };
}

// ---- Morning brief: one line per favorite on days that matter (or every day, if chosen) ----
const BACH = ["Mt. Bachelor, OR", "Mt. Bachelor Nordic Center, OR"];
async function bachelorGroom(nordic) {
  try {
    const r = await fetch("https://api.mtbachelor.com/api/v1/dor/drupal/trails", { headers: { "User-Agent": "Snowline (snowline-forecast.netlify.app)" }, signal: AbortSignal.timeout(8000) });
    const list = (await r.json()).filter(t => t.season === "winter" && t.type === (nordic ? "cross_country_trail" : "alpine_trail"));
    const g = list.filter(t => t.groom_status && t.groom_status !== "not_groomed");
    const latest = g.reduce((m, t) => Math.max(m, (t.updated || 0) * 1000), 0);
    return { total: list.length, groomed: g.length, fresh: latest && Date.now() - latest < 14 * 3600e3 };
  } catch (e) { return null; }
}
export async function buildBrief(sub, force) {
  const mode = sub.prefs?.brief || "snow"; if (mode === "off" && !force) return null;
  const met = sub.prefs?.units === "met";
  const snow = (inch) => met ? `${Math.round(inch * 2.54)} cm` : `${inch < 1 ? inch.toFixed(1) : Math.round(inch)}"`;
  const temp = (c) => c == null ? null : met ? `${Math.round(c)}°C` : `${Math.round(c * 9 / 5 + 32)}°`;
  const lines = []; let matters = false;
  for (const sp of (sub.spots || []).slice(0, 4)) {
    const [m, meas] = await Promise.all([modelSnow(sp, 3).catch(() => null), measuredOvernight(sp)]);
    if (!m) continue;
    const short = sp.name.replace(/,\s*[A-Z]{2}$/, "").replace(/\s*\(.*\)$/, "");
    const over = meas ? meas.inches : m.past12, parts = [];
    if (over >= 0.5) parts.push(`${snow(over)} overnight`);
    if (m.todaySnow >= 0.5) parts.push(`${snow(m.todaySnow)} more today`);
    else if (m.next3 >= 2) parts.push(`${snow(m.next3)} in 3 days`);
    if (BACH.includes(sp.name)) { const g = await bachelorGroom(/Nordic/.test(sp.name)); if (g && g.groomed) { parts.push(`${g.groomed} of ${g.total} ${/Nordic/.test(sp.name) ? "trails" : "runs"} groomed`); if (g.fresh) matters = true; } }
    if (m.t9 != null) parts.push(`${temp(m.t9)} at 9am up top`);
    if (over >= 1 || m.todaySnow >= 2) matters = true;
    if (parts.length) lines.push(`${short}: ${parts.join(", ")}`);
  }
  if (!lines.length || (mode === "snow" && !matters && !force)) return null;
  return { title: "☀️ Snowline morning brief", body: lines.join("\n"), url: "/#favs", tag: "snowline-daily" };
}
export function combine(alert, brief) {
  if (alert && brief) return { ...alert, body: alert.body + "\n" + brief.body };
  return alert || brief || null;
}
