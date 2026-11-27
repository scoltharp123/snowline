// TEMPORARY: find where Mt. Bachelor's live lift-top weather comes from.
const UA = { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Snowline", Accept: "*/*" };
const B = "https://api.mtbachelor.com/api/v1/dor/drupal";
export default async () => {
  const out = { tries: {}, page: {} };
  for (const p of ["weather", "weather-data", "weather-stations", "weather-station", "weatherstations", "mountain-weather", "stations", "live-weather", "weather/live", "weather-data/24-hour", "snow-reports"]) {
    try { const r = await fetch(`${B}/${p}`, { headers: UA }); const t = await r.text(); out.tries[p] = r.status + " " + t.slice(0, 260); } catch (e) { out.tries[p] = "ERR " + e.message; }
  }
  for (const u of ["https://www.mtbachelor.com/the-mountain/live-24-hour-weather/", "https://www.mtbachelor.com/the-mountain/mountain-report/"]) {
    try { const h = await (await fetch(u, { headers: UA })).text();
      const urls = [...new Set((h.match(/https?:\/\/[^"'\s<>)]+/g) || []).filter(x => /api|weather|json|station|dor/i.test(x)))].slice(0, 40);
      const scripts = [...new Set((h.match(/<script[^>]+src="([^"]+)"/g) || []))].slice(0, 30);
      const near = (h.match(/.{0,120}(weather|Wind Speed)[^<]{0,160}/gi) || []).slice(0, 8);
      out.page[u] = { len: h.length, urls, scripts, near };
    } catch (e) { out.page[u] = "ERR " + e.message; }
  }
  console.log("PROBEBW " + JSON.stringify(out).slice(0, 9000));
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json" } });
};
export const config = { path: "/api/probe-bw" };
