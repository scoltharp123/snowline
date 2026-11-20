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
export async function modelSnow(spot, days = 5) {
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
  const peak = dayList.reduce((b, [d, v]) => v > b.v ? { d, v } : b, { d: null, v: 0 });
  return { past12, next1: next(1), next3: next(3), next5: next(5), peak };
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
export async function buildAlert(sub) {
  const lines = []; let top = null;
  for (const spot of (sub.spots || []).slice(0, 6)) {
    let m; try { m = await modelSnow(spot); } catch (e) { continue; }
    const meas = await measuredOvernight(spot);
    const over = meas ? meas.inches : m.past12;
    const p = sub.prefs || {};
    const short = spot.name.replace(/,\s*[A-Z]{2}$/, "");
    if (over >= (p.overnight ?? 4)) {
      const msg = `${r(over)}" ${meas ? "fell" : "estimated"} overnight at ${short}`;
      lines.push(msg); if (!top || over > top.v) top = { v: over, title: `❄️ ${r(over)}" overnight at ${short}` };
    } else if (m.next3 >= (p.forecast ?? 8)) {
      const pk = m.peak.d ? ` (most on ${DOW[new Date(m.peak.d + "T12:00:00Z").getUTCDay()]})` : "";
      lines.push(`${r(m.next3)}" forecast at ${short} next 3 days${pk}`);
      if (!top) top = { v: m.next3, title: `🌨 ${r(m.next3)}" coming to ${short}` };
    }
  }
  if (!lines.length) return null;
  return { title: top.title, body: lines.slice(0, 3).join(" · "), url: "/#forecast", tag: "snowline-daily" };
}
