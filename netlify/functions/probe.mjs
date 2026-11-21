// temporary: checks which public data sources respond (removed after use)
export default async () => {
  const H = { "User-Agent": "Snowline (snowline-forecast.netlify.app)" };
  const out = {};
  try { const j = await (await fetch("https://api.weather.gov/points/43.979,-121.688/stations", { headers: H })).json(); out.nws = (j.features || []).slice(0, 15).map(f => [f.properties.stationIdentifier, f.properties.name, f.properties.elevation?.value]); } catch (e) { out.nws = String(e); }
  try { const t = await (await fetch("https://www.mtbachelor.com/page-data/the-mountain/weather-operations/conditions-report/page-data.json", { headers: H })).text();
    out.apis = [...new Set(t.match(/https?:\/\/[a-z0-9.-]+\/api[^"'\s]{0,80}/gi) || [])];
    out.wx = (t.match(/.{0,200}(Pine Marten|Summit|West Village).{0,300}/i) || [""])[0]; out.len = t.length; } catch (e) { out.pd = String(e); }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json" } });
};
export const config = { path: "/api/probe" };
