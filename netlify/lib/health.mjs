// Health check of every free data source Snowline depends on (used by /api/health and the morning job).
import { store, getJSON } from "./shared.mjs";

const LAT = 43.979, LON = -121.688, UA = { "User-Agent": "Snowline (snowline-forecast.netlify.app)" };
const ok = (cond, note) => { if (!cond) throw new Error(note || "unexpected response"); };
const fetchJSON = async (u, h = {}) => { const r = await fetch(u, { headers: { ...UA, ...h }, signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

const CHECKS = {
  "Weather models (Open-Meteo)": async () => { const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=precipitation&models=ecmwf_ifs025&forecast_days=2`); ok(j.hourly?.precipitation?.length > 24); },
  "Ensembles (Open-Meteo)": async () => { const j = await getJSON(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${LAT}&longitude=${LON}&hourly=precipitation&models=gfs025&forecast_days=2`); ok(Object.keys(j.hourly || {}).length > 5); },
  "Model history (Open-Meteo)": async () => { const d = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10); const j = await getJSON(`https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=precipitation_previous_day1&models=gfs_seamless&start_date=${d}&end_date=${d}`); ok(j.hourly?.time?.length); },
  "Snow gauges (SNOTEL)": async () => { const d = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10); const j = await fetchJSON(`https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?stationTriplets=815:OR:SNTL&elements=SNWD&duration=DAILY&beginDate=${d}&endDate=${d}`); ok(Array.isArray(j) && j.length, "no station data"); },
  "Weather Service (NWS)": async () => { const j = await fetchJSON(`https://api.weather.gov/points/${LAT},${LON}`, { Accept: "application/geo+json" }); ok(j.properties?.forecastOffice); },
  "Avalanche forecast": async () => { const j = await fetchJSON("https://api.avalanche.org/v2/public/products/map-layer"); ok(j.features?.length > 5); },
  "Mt. Bachelor trails & grooming": async () => { const j = await fetchJSON("https://api.mtbachelor.com/api/v1/dor/drupal/trails"); ok(Array.isArray(j) && j.length > 20); },
  "Mt. Bachelor snow report": async () => { const j = await fetchJSON("https://api.mtbachelor.com/api/v1/dor/drupal/snow-reports?sort=date&direction=desc"); ok(Array.isArray(j) && j.length); },
  "Radar (RainViewer)": async () => { const j = await fetchJSON("https://api.rainviewer.com/public/weather-maps.json"); ok(j.radar?.past?.length); },
  "Snow stake pictures": async () => { const { blobs } = await store("snowline-stake").list(); const t = Math.max(0, ...blobs.map(b => +b.key.replace("img-", "")).filter(isFinite)); ok(Date.now() - t < 3 * 3600e3, t ? `last picture ${Math.round((Date.now() - t) / 3600e3)} h ago` : "no pictures saved"); },
  "Bachelor report log": async () => { const log = await store("snowline-score").get("resort-bachelor", { type: "json" }); ok(log && Object.keys(log).length, "nothing logged yet"); },
};

export async function runHealth() {
  const results = await Promise.all(Object.entries(CHECKS).map(async ([name, fn]) => {
    const t0 = Date.now(); try { await fn(); return { name, ok: true, ms: Date.now() - t0 }; } catch (e) { return { name, ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 140) }; }
  }));
  return { at: new Date().toISOString(), ok: results.every(r => r.ok), results };
}

