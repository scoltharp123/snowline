// Mt. Bachelor's snow plot: an automated snow-depth sensor in Bachelor's own weather feed, read hourly.
// Snowline logs it so forecasts can be graded against a real measurement, not just the daily report.
import { store } from "./shared.mjs";

export const FEED = "https://api.mtbachelor.com/api/v1/dor/24-hour-weather";
export const PLOT_FT = 6400;   // assumed near the West Village snow stake; adjust if Bachelor says otherwise
const KEY = "plot-bachelor", KEEP_DAYS = 200;

// Bachelor writes Pacific clock time but labels it "Z". Read it as Pacific.
export function pacific(ts) {
  const m = String(ts || "").match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/); if (!m) return null;
  const asUtc = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(asUtc)).map(x => [x.type, x.value]));
  const off = Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - asUtc;
  const t = asUtc - off;
  return t > Date.now() + 15 * 60e3 ? asUtc : t;
}

export async function fetchFeed() {
  const r = await fetch(FEED, { headers: { "User-Agent": "Mozilla/5.0 Snowline", Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// hourly depths from the feed → { "YYYY-MM-DDTHH" (Pacific): inches }
export function plotHours(feed) {
  const out = {};
  for (const x of feed?.snowplot || []) { const d = parseFloat(x?.depth), k = String(x?.timestamp || "").slice(0, 13);
    if (/^\d{4}-\d\d-\d\dT\d\d$/.test(k) && Number.isFinite(d) && d >= 0 && d < 400) out[k] = Math.round(d * 100) / 100; }
  return out;
}

// New snow in a run of hourly depths: the biggest rise above the lowest point before it.
// A 3-hour median first, so one bad reading can't invent snow. Settling and melt never count as new snow.
export function newSnow(depths) {
  const v = depths.filter(Number.isFinite); if (v.length < 2) return 0;
  const s = v.map((_, i) => { const w = v.slice(Math.max(0, i - 1), i + 2).sort((a, b) => a - b); return w[Math.floor(w.length / 2)]; });
  let lo = s[0], best = 0; for (const x of s) { lo = Math.min(lo, x); best = Math.max(best, x - lo); }
  return Math.round(best * 10) / 10;
}

export async function logPlot(feed) {
  const h = plotHours(feed); if (!Object.keys(h).length) return 0;
  const st = store("snowline-score"); let all = {};
  try { all = (await st.get(KEY, { type: "json" })) || {}; } catch (e) {}
  const before = Object.keys(all).length; Object.assign(all, h);
  if (Object.keys(all).length === before && Object.keys(h).every(k => all[k] === h[k])) return 0;   // nothing new
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  for (const k of Object.keys(all)) if (k < cutoff) delete all[k];
  await st.setJSON(KEY, all); return Object.keys(all).length - before;
}

export async function readPlot() { try { return (await store("snowline-score").get(KEY, { type: "json" })) || {}; } catch (e) { return {}; } }

// Daily new snow (Pacific calendar days). Each day starts from the last reading of the day before.
export function plotDays(log) {
  const ks = Object.keys(log).sort(), by = {};
  for (const k of ks) (by[k.slice(0, 10)] ||= []).push(k);
  const days = Object.keys(by).sort(), out = {};
  days.forEach((d, i) => { const prev = i && by[days[i - 1]].at(-1); const run = [...(prev ? [log[prev]] : []), ...by[d].map(k => log[k])];
    if (by[d].length >= 18) out[d] = newSnow(run); });   // only grade days the sensor mostly covered
  return out;
}
