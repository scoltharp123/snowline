// TEMPORARY: which free NWS-listed weather stations sit near Mt. Bachelor, Bachelor Nordic and Meissner, and what they measure.
const PTS = { bachelor: [43.979, -121.689], nordic: [43.995, -121.677], meissner: [43.970, -121.457] };
const H = { "User-Agent": "Snowline (snowline-forecast.netlify.app)", Accept: "application/geo+json" };
export default async () => {
  const out = {};
  for (const [k, [la, lo]] of Object.entries(PTS)) {
    try {
      const j = await (await fetch(`https://api.weather.gov/points/${la},${lo}/stations?limit=12`, { headers: H })).json();
      const st = (j.features || []).slice(0, 12);
      out[k] = await Promise.all(st.map(async f => { const p = f.properties, c = f.geometry.coordinates;
        let last = null; try { const o = await (await fetch(`https://api.weather.gov/stations/${p.stationIdentifier}/observations/latest`, { headers: H })).json(); const q = o.properties || {};
          last = { t: q.timestamp, temp: q.temperature?.value, snowDepth: q.snowDepth?.value, precip1h: q.precipitationLastHour?.value }; } catch (e) {}
        return { id: p.stationIdentifier, name: p.name, elevFt: Math.round((p.elevation?.value || 0) * 3.281), lat: c[1], lon: c[0], last }; }));
    } catch (e) { out[k] = String(e); }
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json" } });
};
export const config = { path: "/api/probe-st" };
