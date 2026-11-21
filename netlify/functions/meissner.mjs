// GET /api/meissner → live conditions at Virginia Meissner Sno-Park:
//  • Meissner Nordic's own weather station (read from their public Weather page, meissnernordic.org/weather)
//  • ODOT's Wanoga Butte weather station (ODT31) via the National Weather Service API, with the last 24 hours
// Cached 10 minutes so we never put load on Meissner's site.
import { json, store } from "../lib/shared.mjs";

const UA = { "User-Agent": "Snowline (snowline-forecast.netlify.app; free snow forecasts)" };
const get = async (u, h = {}) => { const r = await fetch(u, { headers: { ...UA, ...h }, signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; };
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };

async function meissnerStation() {
  const html = await (await get("https://meissnernordic.org/weather/")).text();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&deg;|&#176;/g, "°").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const pick = re => (text.match(re) || [])[1];
  const t = num(pick(/Temperature:\s*(-?[\d.]+)\s*°?\s*F/i)), rh = num(pick(/Relative Humidity:\s*([\d.]+)\s*%/i));
  const dir = pick(/Wind Direction:\s*([NSEW][NSEW\-]{0,6})/i) || null;
  const wg = text.match(/Wind Speed\/Gust:\s*([\d.]+)\s*\/\s*([\d.]+)\s*mph/i);
  const upd = pick(/Updated:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*[ap]m)/i) || null;
  if (t == null && rh == null) throw new Error("no readings found on the page");
  return { name: "Meissner Sno-Park", elevFt: 5400, tempF: t, rh, windDir: dir, windMph: wg ? num(wg[1]) : null, gustMph: wg ? num(wg[2]) : null, updated: upd, source: "Meissner Nordic weather station", link: "https://meissnernordic.org/weather/" };
}

async function wanoga() {
  const j = await (await get("https://api.weather.gov/stations/ODT31/observations?limit=160", { Accept: "application/geo+json" })).json();
  const f = (j.features || []).map(x => x.properties).filter(p => p && p.timestamp);
  if (!f.length) throw new Error("no observations");
  const c2f = c => (c == null ? null : Math.round((c * 9 / 5 + 32) * 10) / 10), k2m = k => (k == null ? null : Math.round(k * 0.621371));
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const L = f[0], last = k => { for (const p of f.slice(0, 12)) if (p[k]?.value != null) return p[k].value; return null; };
  return {
    name: "Wanoga Butte", elevFt: L.elevation?.value != null ? Math.round(L.elevation.value * 3.28084) : null, time: L.timestamp,
    tempF: c2f(last("temperature")), rh: last("relativeHumidity") != null ? Math.round(last("relativeHumidity")) : null,
    windMph: k2m(last("windSpeed")), gustMph: k2m(L.windGust?.value), windDir: last("windDirection") != null ? dirs[Math.round(last("windDirection") / 22.5) % 16] : null,
    series: f.filter(p => Date.now() - Date.parse(p.timestamp) < 864e5).filter((p, i) => i % 3 === 0).reverse().map(p => [p.timestamp, c2f(p.temperature?.value)]).filter(r => r[1] != null),
    source: "ODOT weather station (ODT31) via the National Weather Service", link: "https://www.weather.gov/wrh/timeseries?site=ODT31&hours=24",
  };
}

export default async () => {
  const s = store("snowline-cache");
  try { const c = await s.get("meissner-live2", { type: "json" }); if (c && Date.now() - Date.parse(c.at) < 10 * 60e3) return json(c, { cache: 300 }); } catch (e) {}
  const [a, b] = await Promise.allSettled([meissnerStation(), wanoga()]);
  const out = { at: new Date().toISOString(),
    stations: [a.status === "fulfilled" ? a.value : { name: "Meissner Sno-Park", error: String(a.reason?.message || a.reason), link: "https://meissnernordic.org/weather/" },
               b.status === "fulfilled" ? b.value : { name: "Wanoga Butte", error: String(b.reason?.message || b.reason), link: "https://www.weather.gov/wrh/timeseries?site=ODT31&hours=24" }],
    cam: { name: "Meissner Sno-Park", img: "https://teacup-trailcams.fly.dev/meissner/photos/latest", page: "https://meissnernordic.org/webcam/", credit: "Meissner Nordic webcam, sponsored by Visit Bend · updates every 2 hours" },
    links: [["Grooming report", "https://meissnernordic.org/grooming/"], ["Trail descriptions", "https://meissnernordic.org/trail-descriptions/"], ["Meissner Nordic app", "https://meissnernordic.org/apps/"]] };
  try { await s.setJSON("meissner-live2", out); } catch (e) {}
  return json(out, { cache: 300 });
};
export const config = { path: "/api/meissner" };
