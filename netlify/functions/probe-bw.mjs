// TEMPORARY: find where Mt. Bachelor's live lift-top weather comes from (round 2: read the site's own scripts).
const UA = { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Snowline", Accept: "*/*" };
export default async () => {
  const out = { api: [], hits: {}, tries: {} };
  const seen = new Set(), q = ["/app-0f991c103f1540adc856.js", "/c96b4d7e-0d00c12d39fee4e9d834.js", "/27c8ccd1-478161be6bfcb377b536.js", "/825918e7-2bf90dcf2b7ee7f2df1c.js", "/e85b80d3-73da547bddf9541b4591.js", "/c8940057-1f667937ab82a6c02354.js", "/b4ae93d6-99fa1edd6d9cdd0c58ef.js", "/webpack-runtime-7554ce7b0015e7f965bd.js"];
  // chunk names from the runtime so we can open the page's own component code
  try { const rt = await (await fetch("https://www.mtbachelor.com/webpack-runtime-7554ce7b0015e7f965bd.js", { headers: UA })).text();
    out.rtNames = (rt.match(/"component---[^"]+"/g) || []).filter(x => /weather|mountain/i.test(x)).slice(0, 10);
    const m = rt.match(/\{[^{}]*"component---src[^{}]*\}/g) || []; out.rtMapLen = m.length;
    // hashes for chunks: e.g. 123:"abcdef"
    const hashes = [...rt.matchAll(/(\d+):"([0-9a-f]{20})"/g)].slice(0, 400).map(x => `/${x[1]}-${x[2]}.js`);
    out.chunkCount = hashes.length; q.push(...hashes.slice(0, 120));
  } catch (e) { out.rtErr = e.message; }
  await Promise.all(q.map(async p => { try { const t = await (await fetch("https://www.mtbachelor.com" + p, { headers: UA })).text();
    for (const m of t.matchAll(/["'`]((?:https?:\/\/api\.mtbachelor\.com)?\/api\/v1\/[A-Za-z0-9_\-\/${}.]+)["'`]/g)) seen.add(m[1]);
    if (/[Ww]ind Speed Max|live-24|weather-server|WeatherData|liveWeather|weatherStation/.test(t)) out.hits[p] = (t.match(/.{0,160}(Wind Speed Max|live-24|weather-server|WeatherData|liveWeather|weatherStation|api\/v1\/[a-z\-\/]*weather)[\s\S]{0,200}/g) || []).slice(0, 4).map(s => s.replace(/\s+/g, " "));
  } catch (e) {} }));
  out.api = [...seen].slice(0, 80);
  for (const p of ["dor/agent-friendly/weather", "dor/agent-friendly/weather-data", "dor/drupal/weather-reports", "dor/drupal/live-weather", "dor/weather", "weather", "weather/stations", "dor/drupal/weather-observations"]) {
    try { const r = await fetch(`https://api.mtbachelor.com/api/v1/${p}`, { headers: UA }); out.tries[p] = r.status + " " + (await r.text()).slice(0, 200); } catch (e) { out.tries[p] = "ERR"; }
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json" } });
};
export const config = { path: "/api/probe-bw" };
