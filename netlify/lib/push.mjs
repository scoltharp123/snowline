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
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lon}&elevation=${elev}&hourly=snowfall&past_days=1&forecast_days=${days + 1}&timezone=auto`);
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
  return { past12, next1: next(1), next3: next(3), next5: next(5), next10, peak };
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
